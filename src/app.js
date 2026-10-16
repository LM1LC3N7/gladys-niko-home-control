// -----------------------------------------------------------------------------
// The integration: one Niko Home Control II installation, reached through the
// Hobby API of its Connected Controller (or Wireless Smart Hub). index.js only
// wires the SDK handlers to it.
//
// Lifecycle: start -> the client connects (TLS, token) and asks the device
// list -> the devices are offered in Discovery and their values sent -> the
// controller pushes every change (devices.status), there is no polling -> a
// configuration uploaded to the controller (devices.added/removed,
// systeminfo.published) reads the list again. The client reconnects by itself
// (src/nhc2/client.js). The token expiry is checked every hour: a sensor, a
// warning in the logs and the status from 14 days before, and the
// "token_expiring" scene trigger once a day.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  CONTROLLER_ID,
  DEVICE_TYPE,
  DISCOVERY,
  LIMITS,
  SCENE_TRIGGERS,
  TIMINGS,
} from './constants.js';
import { T, nameOf } from './i18n.js';
import { buildModel, emptyModel } from './model.js';
import { NhcClient } from './nhc2/client.js';
import { METHODS, applyChange, parseDevice, parseDiscoveryReply } from './nhc2/protocol.js';
import { StatePublisher } from './publisher.js';
import { createStore } from './store.js';
import { tokenInfo } from './token.js';

export class NikoApp {
  /**
   * @param {object} options
   * @param {object} options.gladys the SDK client
   * @param {Function} [options.connect] mqtt.connect (tests)
   * @param {string[]} [options.extraCa] more trusted CAs (test brokers only, never in production)
   */
  constructor({
    gladys,
    logger = createLogger({ name: 'niko' }),
    connect,
    store = createStore({ logger }),
    extraCa = [],
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.connectImpl = connect;
    this.store = store;
    this.extraCa = extraCa;
    this.now = now;
    this.timers = timers;
    this.config = normalizeConfig();
    this.client = null;
    /** uuid -> parsed Niko device */
    this.devices = new Map();
    this.model = emptyModel();
    this.systemInfo = {};
    /** feature id -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    /** device id -> last badge published (JSON) */
    this.transports = new Map();
    this.publishedDevices = undefined;
    this.lastStatus = undefined;
    this.relistTimer = undefined;
    this.rebuildTimer = undefined;
    this.tokenTimer = undefined;
    this.usageTimer = undefined;
    this.warned = new Set();
    this.reported = new Set();
    this.generation = 0;
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.refreshCreated();
    if (this.config.error) {
      await this.setStatus(false, T.configError(this.config.error));
      return;
    }
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: this.model.throttled,
    });
    this.publisher.start();
    this.tokenTimer = this.timers.setInterval(() => {
      this.checkToken().catch((err) => this.logger.warn(`Token check failed: ${err.message}`));
    }, TIMINGS.tokenCheck);
    const token = tokenInfo(this.config.token, this.now());
    if (token.expired) {
      // As openHAB: no connection with a token known to be expired.
      this.logger.warn(
        `The Hobby API token expired on ${token.expiresAt.toISOString().slice(0, 10)}`,
      );
      await this.publishDevices();
      await this.checkToken();
      await this.setStatus(false, T.tokenExpired(token.expiresAt));
      return;
    }
    await this.setStatus(false, T.connecting);
    if (!this.current(generation)) {
      return;
    }
    this.client = this.newClient();
    this.wire(this.client, generation);
    this.client.start();
    this.usageTimer = this.timers.setInterval(() => this.askInstantUsage(), TIMINGS.instantUsage);
    await this.checkToken();
  }

  stop() {
    this.generation += 1;
    for (const timer of [this.relistTimer, this.rebuildTimer]) {
      this.timers.clearTimeout(timer);
    }
    for (const timer of [this.tokenTimer, this.usageTimer]) {
      this.timers.clearInterval(timer);
    }
    this.relistTimer = undefined;
    this.rebuildTimer = undefined;
    this.tokenTimer = undefined;
    this.usageTimer = undefined;
    this.publisher.stop();
    this.client?.stop();
    this.client?.removeAllListeners();
    this.client = null;
  }

  current(generation) {
    return generation === this.generation;
  }

  /** A stable client id, kept in /data (Niko: stable and unique per application). */
  clientId() {
    const state = this.store.load('state') ?? {};
    if (!/^gladys-nhc-[0-9a-f]{8}$/.test(state.clientId ?? '')) {
      state.clientId = `gladys-nhc-${randomBytes(4).toString('hex')}`;
      this.store.save('state', state);
    }
    return state.clientId;
  }

  newClient({ reconnect = true, clientId = this.clientId() } = {}) {
    return new NhcClient({
      host: this.config.host,
      port: this.config.port,
      token: this.config.token,
      clientId,
      logger: this.logger,
      connect: this.connectImpl,
      extraCa: this.extraCa,
      timers: this.timers,
      now: this.now,
      reconnect,
    });
  }

  wire(client, generation) {
    const guard =
      (fn) =>
      (...args) => {
        if (!this.current(generation)) {
          return;
        }
        Promise.resolve()
          .then(() => fn(...args))
          .catch((err) => this.logger.error(`Niko Home Control: ${err.message}`));
      };
    client.on(
      'list',
      guard((devices, { first }) => this.onList(devices, { first })),
    );
    client.on(
      'status',
      guard((entries) => this.onStatus(entries)),
    );
    client.on(
      'change',
      guard((method, entries) => this.onChange(method, entries)),
    );
    client.on(
      'systeminfo',
      guard((info, { changed }) => {
        this.systemInfo = info;
        if (changed) {
          // A configuration was uploaded to the controller: read the devices again.
          this.relistSoon();
        }
      }),
    );
    client.on(
      'offline',
      guard(async (failure) => {
        const level = failure.refused ? 'error' : 'warn';
        this.logger[level](
          `Controller ${this.config.host}: ${failure.reason}${failure.retryIn ? ` (retrying in ${Math.round(failure.retryIn / 1000)} s)` : ''}`,
        );
        await this.setStatus(false, T.failure(failure));
        await this.publishAllTransports();
      }),
    );
    client.on(
      'controlError',
      guard((message) => {
        this.logger.warn(
          `The controller refused ${message.method || 'a command'}: ${message.errCode} ${message.errMessage}`,
        );
      }),
    );
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  // --- The devices of the installation ------------------------------------------------

  idsOf(uuid) {
    return this.gladys.externalIds(DEVICE_TYPE, uuid);
  }

  async onList(rawDevices, { first }) {
    const devices = new Map();
    for (const raw of rawDevices) {
      const device = parseDevice(raw);
      if (device) {
        devices.set(device.uuid, device);
      }
    }
    this.devices = devices;
    this.rebuild();
    for (const device of devices.values()) {
      this.applyStates(device, Object.keys(device.properties), { initial: true });
    }
    await this.publishDevices();
    if (first) {
      this.logger.info(
        `Connected to ${this.config.host}${this.systemInfo.nhcVersion ? ` (Niko Home Control ${this.systemInfo.nhcVersion})` : ''}: ${this.model.counts.offered} devices offered out of ${this.model.counts.devices}`,
      );
    }
    for (const [kind, count] of this.model.unsupported) {
      if (!this.reported.has(kind)) {
        this.reported.add(kind);
        this.logger.info(`Not supported yet: ${count} device(s) of kind ${kind}`);
      }
    }
    await this.setStatus(true, this.connectedStatus());
    await this.checkToken();
    await this.publishAllTransports();
    this.askInstantUsage();
  }

  /** The model from the devices known (no new device list). */
  rebuild() {
    this.model = buildModel((uuid) => this.idsOf(uuid), this.devices.values(), {
      language: this.config.language,
      overruleMinutes: this.config.overruleMinutes,
    });
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: this.model.throttled,
    });
  }

  /** The device of the controller itself: the days left of the token. */
  controllerDevice() {
    const token = tokenInfo(this.config.token, this.now());
    if (token.daysLeft === undefined) {
      return null;
    }
    const ids = this.idsOf(CONTROLLER_ID);
    const params = [
      { name: 'NIKO_HOST', value: this.config.host },
      { name: 'NHC_VERSION', value: this.systemInfo.nhcVersion },
      { name: 'NHC_IMAGE', value: this.systemInfo.cocoImage },
      { name: 'TOKEN_EXPIRES', value: token.expiresAt.toISOString().slice(0, 10) },
    ].filter((p) => p.value !== undefined && p.value !== '');
    return {
      name: nameOf('controller', this.config.language),
      external_id: ids.device,
      should_poll: false,
      params,
      features: [
        {
          name: nameOf('tokenDays', this.config.language),
          external_id: ids.feature('token-days'),
          category: 'duration',
          type: 'integer',
          unit: 'days',
          min: 0,
          max: 366,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
      ],
    };
  }

  async publishDevices({ force = false } = {}) {
    const controller = this.controllerDevice();
    const devices = controller ? [controller, ...this.model.devices] : this.model.devices;
    const json = JSON.stringify(devices);
    if (!force && json === this.publishedDevices) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices.slice(0, LIMITS.devices));
      this.publishedDevices = json;
    } catch (err) {
      this.logger.error(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /**
   * The values of a device whose properties `changed` (all of them at the
   * device list). Presses (events) only come from live changes.
   */
  applyStates(device, changed, { initial = false } = {}) {
    const touched = new Set(changed);
    for (const reader of this.model.readers.get(device.uuid) ?? []) {
      if (reader.props.length > 0 && !reader.props.some((p) => touched.has(p))) {
        continue;
      }
      try {
        if (reader.event) {
          const value = initial ? null : reader.event(device);
          if (value !== null && value !== undefined && this.created.has(reader.featureId)) {
            this.publisher.pushEvent(reader.featureId, { state: value });
          }
        } else if (reader.read) {
          const value = reader.read(device);
          if (value) {
            this.record(reader.featureId, value);
          }
        }
      } catch (err) {
        this.warnOnce(`read:${reader.featureId}`, `${reader.featureId}: ${err.message}`);
      }
    }
  }

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, value) {
    this.lastValues.set(featureId, value);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  async onStatus(entries) {
    let unknown = false;
    const badges = [];
    for (const entry of entries) {
      const device = this.devices.get(entry?.Uuid);
      if (!device) {
        unknown = true;
        continue;
      }
      const wasOnline = device.online;
      const changed = applyChange(device, entry);
      if (changed.length > 0) {
        this.applyStates(device, changed);
      }
      if (device.online !== wasOnline) {
        badges.push(this.idsOf(device.uuid).device);
      }
    }
    for (const deviceId of badges) {
      await this.publishTransport(deviceId);
    }
    if (unknown) {
      // A device the list did not have: the configuration changed.
      this.relistSoon();
    }
  }

  async onChange(method, entries) {
    if (method === METHODS.ADDED || method === METHODS.REMOVED) {
      this.relistSoon();
      return;
    }
    for (const entry of entries) {
      const device = this.devices.get(entry?.Uuid);
      if (device) {
        applyChange(device, entry);
      }
    }
    // A renamed device, new property definitions or parameters: offer them again.
    this.timers.clearTimeout(this.rebuildTimer);
    const generation = this.generation;
    this.rebuildTimer = this.timers.setTimeout(() => {
      this.rebuildTimer = undefined;
      if (this.current(generation)) {
        this.rebuild();
        this.publishDevices().catch(() => {});
      }
    }, TIMINGS.relistDebounce);
  }

  relistSoon() {
    this.timers.clearTimeout(this.relistTimer);
    const generation = this.generation;
    this.relistTimer = this.timers.setTimeout(() => {
      this.relistTimer = undefined;
      if (this.current(generation) && this.client?.online) {
        this.client.requestList();
      }
    }, TIMINGS.relistDebounce);
  }

  /** The Scan button of the Discovery tab. */
  async rescan() {
    if (this.client?.online) {
      this.client.requestList();
      return;
    }
    await this.publishDevices({ force: true });
  }

  /** Live power stops 30 s after it was asked: ask again for the meters created in Gladys. */
  askInstantUsage() {
    if (!this.client?.online) {
      return;
    }
    for (const uuid of this.model.instantUsage) {
      const device = this.devices.get(uuid);
      if (device?.online && this.createdDevices().has(this.idsOf(uuid).device)) {
        this.client
          .control(uuid, [['ReportInstantUsage', 'True']])
          .catch((err) => this.logger.debug(`Live power of ${device.name}: ${err.message}`));
      }
    }
  }

  // --- Token -------------------------------------------------------------------------

  /** The days left of the token, the warnings and the scene trigger (once a day). */
  async checkToken() {
    const token = tokenInfo(this.config.token, this.now());
    if (token.daysLeft === undefined) {
      return;
    }
    const featureId = this.idsOf(CONTROLLER_ID).feature('token-days');
    this.record(featureId, { state: Math.max(0, token.daysLeft) });
    if (this.client?.online) {
      await this.setStatus(true, this.connectedStatus(token));
    }
    await this.publishTransport(this.idsOf(CONTROLLER_ID).device);
    if (!token.expiringSoon && !token.expired) {
      return;
    }
    const today = new Date(this.now()).toISOString().slice(0, 10);
    const state = this.store.load('state') ?? {};
    if (state.lastReminder === today) {
      return;
    }
    state.lastReminder = today;
    this.store.save('state', state);
    const expiresOn = token.expiresAt.toISOString().slice(0, 10);
    this.logger.warn(
      token.expired
        ? `The Hobby API token expired on ${expiresOn}: create a new one and paste it in the configuration`
        : `The Hobby API token expires in ${token.daysLeft} day(s), on ${expiresOn}: create a new one in the Niko Home Control programming software`,
    );
    await this.gladys
      .publishSceneEvent(SCENE_TRIGGERS.TOKEN_EXPIRING, {
        days_left: Math.max(0, token.daysLeft),
        expires_on: expiresOn,
        expired: Boolean(token.expired),
      })
      .catch((err) => this.logger.warn(`Scene event failed: ${err.message}`));
  }

  connectedStatus(token = tokenInfo(this.config.token, this.now())) {
    return T.connected({
      version: this.systemInfo.nhcVersion,
      offered: this.model.counts.offered,
      warning: token.expiringSoon ? T.tokenSoon(token.daysLeft, token.expiresAt) : undefined,
    });
  }

  // --- Transport badges ----------------------------------------------------------------

  transportOf(deviceId) {
    if (!this.client?.online) {
      return {
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
        degraded: true,
        message: T.badge.controllerOffline,
      };
    }
    if (deviceId === this.idsOf(CONTROLLER_ID).device) {
      const token = tokenInfo(this.config.token, this.now());
      return token.expiringSoon
        ? {
            transport: DEVICE_TRANSPORTS.LOCAL,
            degraded: true,
            message: T.badge.tokenSoon(token.daysLeft),
          }
        : { transport: DEVICE_TRANSPORTS.LOCAL };
    }
    const device = this.devices.get(this.model.deviceUuid.get(deviceId));
    if (device && !device.online) {
      // The SDK shows a message only with `degraded`: unreachable, and why.
      return {
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
        degraded: true,
        message: T.badge.deviceOffline,
      };
    }
    return { transport: DEVICE_TRANSPORTS.LOCAL };
  }

  async publishTransport(deviceId) {
    if (!this.createdDevices().has(deviceId)) {
      return;
    }
    const badge = this.transportOf(deviceId);
    const key = JSON.stringify(badge);
    if (this.transports.get(deviceId) === key) {
      return;
    }
    this.transports.set(deviceId, key);
    await this.gladys
      .publishTransports([{ external_id: deviceId, ...badge }])
      .catch((err) => this.logger.warn(`Transport badge failed: ${err.message}`));
  }

  async publishAllTransports() {
    const entries = [];
    for (const deviceId of this.createdDevices()) {
      const badge = this.transportOf(deviceId);
      const key = JSON.stringify(badge);
      if (this.transports.get(deviceId) !== key) {
        this.transports.set(deviceId, key);
        entries.push({ external_id: deviceId, ...badge });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Devices created by the user -------------------------------------------------------

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value) {
        this.publisher.push(f.external_id, value);
      }
    }
    if (device?.external_id) {
      await this.publishTransport(device.external_id);
    }
    this.askInstantUsage();
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  // --- Commands ------------------------------------------------------------------------

  async setValue(device, feature, value) {
    const writer = this.model.writers.get(feature?.external_id);
    if (!writer) {
      throw new Error(`${feature?.name ?? feature?.external_id} cannot be controlled`);
    }
    if (!this.client?.online) {
      throw new Error(T.notConnected.en);
    }
    const niko = this.devices.get(writer.uuid);
    if (!niko) {
      throw new Error('this device is no longer in the Niko Home Control installation');
    }
    if (!niko.online) {
      // Niko answers nothing for an offline device: say it here.
      throw new Error(`${niko.name} is offline for the controller`);
    }
    const properties = writer.write(value, niko);
    if (properties.length === 0) {
      return;
    }
    this.logger.debug(`${niko.name}: ${properties.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    await this.client.control(niko.uuid, properties);
  }

  // --- Configuration screen buttons -------------------------------------------------------

  /** Connects with the saved configuration (or reads the live link) and counts. */
  async testConnection() {
    const config = this.config;
    if (config.error) {
      return T.configError(config.error);
    }
    const token = tokenInfo(config.token, this.now());
    if (token.expired) {
      return T.tokenExpired(token.expiresAt);
    }
    let rawDevices;
    let version = this.systemInfo.nhcVersion;
    if (this.client?.online) {
      // Niko allows 5 clients: the live link answers, no second connection.
      rawDevices = null;
    } else {
      const client = this.newClient({ reconnect: false, clientId: `${this.clientId()}-test` });
      try {
        ({ rawDevices, version } = await this.listOnce(client));
      } catch (err) {
        return err.failure ? T.failure(err.failure) : T.test.timeout;
      } finally {
        client.stop();
        client.removeAllListeners();
      }
    }
    const model = rawDevices
      ? buildModel((uuid) => this.idsOf(uuid), rawDevices.map(parseDevice).filter(Boolean), {
          language: config.language,
        })
      : this.model;
    return T.test.ok({
      version,
      offered: model.counts.offered,
      total: model.counts.devices,
      unsupported: [...model.unsupported.values()].reduce((a, b) => a + b, 0),
      expiresAt: token.expiresAt,
      daysLeft: token.daysLeft,
    });
  }

  /** One connection, one device list. */
  listOnce(client) {
    return new Promise((resolve, reject) => {
      let version;
      const timer = this.timers.setTimeout(() => reject(new Error('timeout')), TIMINGS.testTimeout);
      client.on('systeminfo', (info) => {
        version = info.nhcVersion;
      });
      client.on('list', (rawDevices) => {
        this.timers.clearTimeout(timer);
        resolve({ rawDevices, version: version ?? client.systemInfo.nhcVersion });
      });
      client.on('offline', (failure) => {
        this.timers.clearTimeout(timer);
        reject(Object.assign(new Error(failure.reason), { failure }));
      });
      client.start();
    });
  }

  /**
   * Looks for the controllers on the local network (UDP broadcast relayed by
   * Gladys) and, when the address is empty and one is found, saves it.
   */
  async findControllers() {
    let replies;
    try {
      replies = await this.gladys.scanNetwork('udp-active-broadcast', {
        port: DISCOVERY.port,
        payload: Buffer.from([DISCOVERY.payload]),
        timeoutSeconds: DISCOVERY.timeoutSeconds,
      });
    } catch (err) {
      return T.find.unavailable(err.message);
    }
    const controllers = new Map();
    for (const reply of Array.isArray(replies) ? replies : []) {
      let payload;
      try {
        payload = Buffer.from(String(reply?.payload_base64 ?? ''), 'base64');
      } catch {
        continue;
      }
      const found = parseDiscoveryReply(payload, reply?.source_ip);
      if (found && !controllers.has(found.ip)) {
        controllers.set(found.ip, found);
      }
    }
    if (controllers.size === 0) {
      return T.find.none;
    }
    const list = [...controllers.values()];
    const nhc2 = list.filter((c) => c.generation === 2);
    let saved;
    if (this.config.error === 'empty' || !this.config.host) {
      if (nhc2.length === 1) {
        saved = nhc2[0].ip;
        await this.gladys.setConfig({ controller_host: saved });
        this.logger.info(`Controller found at ${saved}: saved in the configuration`);
        await this.start({ ...(this.gladys.config ?? {}), controller_host: saved });
      }
    }
    return T.find.found({ controllers: list, saved });
  }
}
