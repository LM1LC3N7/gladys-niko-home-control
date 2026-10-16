// -----------------------------------------------------------------------------
// The MQTT link to the Connected Controller (Hobby API), on mqtt.js.
//
// Niko's rules, all honoured here: MQTT 3.1.1 over TLS on 8884, user "hobby"
// and the token as password, a stable client id, clean session, keepalive
// 60 s; at most 5 clients, 1 new connection per second and 1 publish per
// second (commands are merged into one devices.control message per second).
// Nothing is retained: after every connection the device list is asked again,
// and only then is the link "online". The reconnection is ours (mqtt.js's is
// off, as openHAB and node-red-contrib-nhc2 do): growing delays, a slow pace
// after a refused token, and a watchdog on the time event the controller
// publishes every 30 s.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import mqtt from 'mqtt';
import { HOBBY_USER, LIMITS, TIMINGS } from '../constants.js';
import {
  METHODS,
  SUBSCRIPTIONS,
  TOPICS,
  controlMessage,
  devicesOf,
  parseMessage,
  systemInfoOf,
} from './protocol.js';
import { describeCertificate, tlsOptions } from './tls.js';

/** MQTT 3.1.1 CONNACK refusals. */
const REFUSALS = {
  1: 'unacceptable protocol version',
  2: 'client id rejected',
  3: 'server unavailable',
  4: 'bad user name or password',
  5: 'not authorized',
};

/** A refusal of the token (CONNACK 4 or 5). */
export const isRefusal = (err) => [4, 5].includes(err?.code);

/** A readable reason for a connection error (never the token). */
export function errorReason(err) {
  if (!err) {
    return 'unknown error';
  }
  if (typeof err.code === 'number' && REFUSALS[err.code]) {
    return REFUSALS[err.code];
  }
  if (typeof err.code === 'string') {
    if (err.code.startsWith('ERR_TLS') || /CERT|SELF_SIGNED|UNABLE_TO/.test(err.code)) {
      return `certificate not issued by Niko (${err.code})`;
    }
    return `${err.code}${err.address ? ` ${err.address}${err.port ? `:${err.port}` : ''}` : ''}`;
  }
  return String(err.message ?? err).slice(0, 200);
}

/** The kind of a failure, for the status messages. */
export function failureKind(err) {
  if (isRefusal(err)) {
    return 'refused';
  }
  const code = typeof err?.code === 'string' ? err.code : '';
  if (code.startsWith('ERR_TLS') || /CERT|SELF_SIGNED|UNABLE_TO/.test(code)) {
    return 'certificate';
  }
  if (
    ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(
      code,
    )
  ) {
    return 'unreachable';
  }
  return 'other';
}

export class NhcClient extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} options.port
   * @param {string} options.token the Hobby API JWT
   * @param {string} options.clientId stable and unique (Niko's rule)
   * @param {Function} [options.connect] mqtt.connect (tests)
   * @param {string[]} [options.extraCa] more trusted CAs (test brokers only)
   */
  constructor({
    host,
    port,
    token,
    clientId,
    logger,
    connect = mqtt.connect,
    extraCa = [],
    timers = globalThis,
    now = Date.now,
    reconnect = true,
  }) {
    super();
    this.host = host;
    this.port = port;
    this.token = token;
    this.clientId = clientId;
    this.logger = logger;
    this.connectImpl = connect;
    this.extraCa = extraCa;
    this.timers = timers;
    this.now = now;
    this.reconnect = reconnect;
    this.mqtt = null;
    this.connected = false;
    this.online = false;
    this.stopped = true;
    this.failures = 0;
    this.lastConnect = 0;
    this.lastMessage = 0;
    this.lastPublish = 0;
    this.generation = 0;
    this.retryTimer = undefined;
    this.listTimer = undefined;
    this.flushTimer = undefined;
    this.watchdogTimer = undefined;
    /** Messages other than commands, in order: [{ topic, message }] */
    this.queue = [];
    /** Commands not sent yet: uuid -> Map(property -> value) */
    this.commands = new Map();
    /** Waiters of the commands not sent yet */
    this.waiters = [];
    this.certificateLogged = false;
    this.systemInfo = {};
  }

  start() {
    this.stopped = false;
    this.failures = 0;
    this.open();
    this.watchdogTimer = this.timers.setInterval(() => this.checkWatchdog(), TIMINGS.watchdogCheck);
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    this.timers.clearTimeout(this.retryTimer);
    this.timers.clearInterval(this.watchdogTimer);
    this.retryTimer = undefined;
    this.watchdogTimer = undefined;
    this.close();
    this.dropCommands(new Error('the connection to the controller was closed'));
  }

  // --- Connection ----------------------------------------------------------------

  open() {
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (this.stopped) {
      return;
    }
    // One new connection per second at most (Niko's rule).
    const wait = this.lastConnect + TIMINGS.connectGap - this.now();
    if (wait > 0) {
      this.retryTimer = this.timers.setTimeout(() => this.open(), wait);
      return;
    }
    this.lastConnect = this.now();
    this.generation += 1;
    const generation = this.generation;
    this.emit('connecting');
    const client = this.connectImpl({
      protocol: 'mqtts',
      host: this.host,
      port: this.port,
      username: HOBBY_USER,
      password: this.token,
      clientId: this.clientId,
      protocolVersion: 4,
      clean: true,
      keepalive: TIMINGS.keepalive,
      connectTimeout: TIMINGS.connectTimeout,
      reconnectPeriod: 0,
      resubscribe: false,
      ...tlsOptions(this.extraCa),
    });
    this.mqtt = client;
    const live = () => generation === this.generation && this.mqtt === client;
    client.on('connect', () => {
      if (live()) {
        this.onConnect(client, generation);
      }
    });
    client.on('message', (topic, payload) => {
      if (live()) {
        this.onMessage(topic, payload);
      }
    });
    client.on('error', (err) => {
      if (live()) {
        this.fail(generation, err);
      }
    });
    client.on('close', () => {
      if (live()) {
        this.fail(generation, new Error(this.connected ? 'connection lost' : 'connection closed'));
      }
    });
  }

  onConnect(client, generation) {
    this.connected = true;
    this.lastMessage = this.now();
    if (!this.certificateLogged) {
      const certificate = describeCertificate(client.stream);
      if (certificate) {
        this.certificateLogged = true;
        this.logger?.info(`Controller certificate: ${certificate}`);
      }
    }
    client.subscribe(SUBSCRIPTIONS, { qos: 1 }, (err) => {
      if (err && generation === this.generation) {
        this.fail(generation, err);
      }
    });
    this.send(TOPICS.systemCmd, { Method: METHODS.SYSINFO });
    this.requestList();
    this.timers.clearTimeout(this.listTimer);
    this.listTimer = this.timers.setTimeout(() => {
      if (generation === this.generation && !this.online) {
        this.fail(generation, new Error('the controller sent no device list'));
      }
    }, TIMINGS.listTimeout);
  }

  close() {
    this.timers.clearTimeout(this.listTimer);
    this.timers.clearTimeout(this.flushTimer);
    this.listTimer = undefined;
    this.flushTimer = undefined;
    this.queue = [];
    const client = this.mqtt;
    this.mqtt = null;
    this.connected = false;
    this.online = false;
    if (client) {
      client.removeAllListeners?.();
      client.on?.('error', () => {});
      client.end?.(true);
    }
  }

  fail(generation, err) {
    if (generation !== this.generation || this.stopped) {
      return;
    }
    const wasOnline = this.online;
    this.generation += 1;
    this.close();
    this.dropCommands(new Error(`the controller is not connected (${errorReason(err)})`));
    this.failures += 1;
    const refused = isRefusal(err);
    const delay = refused
      ? TIMINGS.authRetry
      : Math.min(TIMINGS.retryMax, TIMINGS.retryMin * 2 ** (this.failures - 1));
    this.emit('offline', {
      reason: errorReason(err),
      kind: failureKind(err),
      refused,
      wasOnline,
      retryIn: this.reconnect ? delay : undefined,
    });
    if (this.reconnect) {
      this.timers.clearTimeout(this.retryTimer);
      this.retryTimer = this.timers.setTimeout(() => this.open(), delay);
    }
  }

  checkWatchdog() {
    if (this.connected && this.now() - this.lastMessage > TIMINGS.watchdog) {
      this.fail(this.generation, new Error('the controller went silent'));
    }
  }

  // --- Messages received ------------------------------------------------------------

  onMessage(topic, payload) {
    this.lastMessage = this.now();
    if (payload?.length > LIMITS.payloadBytes) {
      this.logger?.warn(`Ignored a message of ${payload.length} bytes on ${topic}`);
      return;
    }
    const message = parseMessage(payload);
    if (!message) {
      this.logger?.debug(`Ignored a message that is not JSON on ${topic}`);
      return;
    }
    switch (topic) {
      case TOPICS.devicesRsp:
        if (message.method === METHODS.LIST) {
          this.onList(devicesOf(message));
        }
        return;
      case TOPICS.devicesEvt:
        this.onDeviceEvent(message);
        return;
      case TOPICS.devicesErr:
      case TOPICS.systemRsp:
      case TOPICS.systemEvt:
        this.onSystem(topic, message);
        return;
      default:
    }
  }

  onList(devices) {
    this.timers.clearTimeout(this.listTimer);
    this.listTimer = undefined;
    const first = !this.online;
    this.online = true;
    this.failures = 0;
    this.emit('list', devices, { first });
  }

  onDeviceEvent(message) {
    const devices = devicesOf(message);
    switch (message.method) {
      case METHODS.STATUS:
        this.emit('status', devices);
        return;
      case METHODS.ADDED:
      case METHODS.REMOVED:
      case METHODS.RENAMED:
      case METHODS.CHANGED:
      case METHODS.PARAMS:
        this.emit('change', message.method, devices);
        return;
      default:
        this.logger?.debug(`Unknown device event ${message.method}`);
    }
  }

  onSystem(topic, message) {
    if (message.errCode !== undefined) {
      this.emit('controlError', message);
      return;
    }
    if (message.method === METHODS.TIME) {
      this.emit('time');
      return;
    }
    if (message.method === METHODS.SYSINFO || message.method === METHODS.SYSINFO_EVENT) {
      this.systemInfo = systemInfoOf(message);
      // An event (not the answer to our request) means the configuration was uploaded.
      this.emit('systeminfo', this.systemInfo, { changed: topic === TOPICS.systemEvt });
    }
  }

  // --- Messages sent -----------------------------------------------------------------

  /** Asks the device list again (its answer comes as a 'list' event). */
  requestList() {
    this.send(TOPICS.devicesCmd, { Method: METHODS.LIST });
  }

  send(topic, message) {
    if (!this.queue.some((m) => m.topic === topic && m.message.Method === message.Method)) {
      this.queue.push({ topic, message });
    }
    this.scheduleFlush();
  }

  /**
   * Sets properties of a device. Merged with the other commands of the same
   * second into one devices.control message; resolves once it is published.
   * @param {string} uuid
   * @param {Array<[string, string]>} properties
   */
  control(uuid, properties) {
    if (!this.online) {
      return Promise.reject(new Error('the controller is not connected'));
    }
    let pending = this.commands.get(uuid);
    if (!pending) {
      pending = new Map();
      this.commands.set(uuid, pending);
    }
    for (const [key, value] of properties) {
      // A newer value of the same property replaces the older one, at its place.
      pending.delete(key);
      pending.set(key, String(value));
    }
    const done = new Promise((resolve, reject) => this.waiters.push({ uuid, resolve, reject }));
    this.scheduleFlush();
    return done;
  }

  dropCommands(err) {
    this.commands.clear();
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter.reject(err);
    }
  }

  scheduleFlush() {
    if (this.flushTimer || !this.connected) {
      return;
    }
    // A short window merges the commands of a same moment (a scene), then one per second.
    const wait = Math.max(TIMINGS.coalesce, this.lastPublish + TIMINGS.publishGap - this.now());
    this.flushTimer = this.timers.setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, wait);
  }

  /** Publishes ONE message (Niko: one per second), then schedules the next one. */
  flush() {
    const client = this.mqtt;
    if (!client || !this.connected) {
      return;
    }
    let topic;
    let message;
    let waiters = [];
    if (this.queue.length > 0) {
      ({ topic, message } = this.queue.shift());
    } else if (this.commands.size > 0) {
      const devices = [];
      let count = 0;
      for (const [uuid, pending] of this.commands) {
        const full =
          devices.length >= LIMITS.controlDevices ||
          count + pending.size > LIMITS.controlProperties;
        if (devices.length > 0 && full) {
          break;
        }
        devices.push({ uuid, properties: [...pending] });
        count += pending.size;
        this.commands.delete(uuid);
      }
      const sent = new Set(devices.map((d) => d.uuid));
      waiters = this.waiters.filter((w) => sent.has(w.uuid));
      this.waiters = this.waiters.filter((w) => !sent.has(w.uuid));
      topic = TOPICS.devicesCmd;
      message = controlMessage(devices);
    } else {
      return;
    }
    this.lastPublish = this.now();
    client.publish(topic, JSON.stringify(message), { qos: 1 }, (err) => {
      for (const waiter of waiters) {
        if (err) {
          waiter.reject(new Error(`the command was not sent (${errorReason(err)})`));
        } else {
          waiter.resolve();
        }
      }
    });
    if (this.queue.length > 0 || this.commands.size > 0) {
      this.scheduleFlush();
    }
  }
}
