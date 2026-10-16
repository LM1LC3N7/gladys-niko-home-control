// -----------------------------------------------------------------------------
// End to end in memory: the real SDK wiring (src/handlers.js) against the
// SDK's fake Gladys, and the simulated controller behind an in-memory broker.
// Timers are mocked: the connection, the 1 publish per second, the
// reconnections and the state flush run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { NikoApp } from '../src/app.js';
import { ACTIONS, SCENE_TRIGGERS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import {
  DAY,
  EXPIRED_TOKEN,
  NOW,
  SOON_TOKEN,
  TOKEN,
  UUID,
  discoveryReply,
} from './fixtures/niko.js';
import { fakeController, settle } from './helpers/broker.js';

const CONFIG = { controller_host: '192.168.1.50', hobby_token: TOKEN, language: 'en' };
const ID = (uuid) => `ext:test-integration:nhc:${uuid}`;
const CONTROLLER = 'ext:test-integration:nhc:controller';

async function setup(
  t,
  { config = CONFIG, prepare = () => {}, store = memoryStore(), scanResults, connect = true } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config, scanResults });
  const box = fakeController();
  prepare(box);
  const app = new NikoApp({
    gladys,
    connect: box.connect,
    store,
    now: () => Date.now(),
    logger: createLogger({ level: 'silent' }),
  });
  registerHandlers(gladys, app);
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  /** Connection, system information, device list (see client.test.js). */
  const online = async () => {
    await tick(0);
    await tick(TIMINGS.coalesce);
    await tick(TIMINGS.publishGap);
  };
  await gladys.connect();
  await settle();
  if (connect) {
    await online();
  }
  t.after(() => app.stop());
  const device = (uuid) => gladys.fake.discoveredDevices.find((d) => d.external_id === ID(uuid));
  const create = async (uuid) => {
    const found =
      uuid === 'controller'
        ? gladys.fake.discoveredDevices.find((d) => d.external_id === CONTROLLER)
        : device(uuid);
    assert.ok(found, `${uuid} is discovered`);
    await gladys.fake.deviceCreated(found);
    await tick(TIMINGS.flushInterval);
    return found;
  };
  const feature = (dev, key) =>
    dev.features.find((f) => f.external_id === `${dev.external_id}:${key}`);
  const state = (uuid, key) => gladys.fake.lastState(`${ID(uuid)}:${key}`);
  /** Sends a command and lets it reach the controller; resolves with the ack. */
  const command = async (dev, key, value) => {
    const ack = gladys.fake.setValue(dev, feature(dev, key), value);
    await tick(TIMINGS.publishGap);
    const result = await ack;
    await tick(TIMINGS.flushInterval);
    return result;
  };
  const badge = (externalId) =>
    gladys.fake.transports.filter((b) => b.device_external_id === externalId).at(-1);
  return { gladys, app, box, store, tick, online, device, create, feature, state, command, badge };
}

test('the installation in Discovery, with the controller and its token', async (t) => {
  const { gladys, box } = await setup(t);
  const devices = gladys.fake.discoveredDevices;
  assert.equal(devices.length, 22);
  const controller = devices[0];
  assert.equal(controller.external_id, CONTROLLER);
  assert.equal(controller.name, 'Niko Home Control II');
  assert.deepEqual(controller.params, [
    { name: 'NIKO_HOST', value: '192.168.1.50' },
    { name: 'NHC_VERSION', value: '2.27.1.0' },
    { name: 'NHC_IMAGE', value: '2026.3-20261001093000' },
    { name: 'TOKEN_EXPIRES', value: '2027-05-04' },
  ]);
  assert.deepEqual(
    controller.features.map((f) => [f.category, f.type, f.unit, f.read_only]),
    [['duration', 'integer', 'days', true]],
  );
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Connected to Niko Home Control 2.27.1.0: 21 devices in Discovery.',
      fr: 'Connecté à Niko Home Control 2.27.1.0 : 21 appareils dans Découverte.',
    },
  });
  // Nothing is sent before the user creates a device.
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(box.count('devices.list'), 1);
});

test('values once created, live changes, a command and its confirmation', async (t) => {
  const { gladys, box, create, state, command, tick } = await setup(t);
  const dimmer = await create(UUID.dimmer);
  assert.equal(state(UUID.dimmer, 'binary'), 0);
  assert.equal(state(UUID.dimmer, 'brightness'), 40);
  box.sim.status(UUID.dimmer, { Status: 'On' });
  await settle();
  await tick(TIMINGS.flushInterval);
  assert.equal(state(UUID.dimmer, 'binary'), 1);
  assert.deepEqual(await command(dimmer, 'brightness', 80), { success: true });
  assert.deepEqual(box.commands().at(-1), [UUID.dimmer, { Brightness: '80' }]);
  assert.equal(state(UUID.dimmer, 'brightness'), 80);
  // Unchanged values are not sent again (publishChangedStates).
  const count = gladys.fake.states.length;
  box.sim.status(UUID.dimmer, { Aligned: 'False' });
  await settle();
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.states.length, count);
});

test('a shutter closes, a switch, a flag', async (t) => {
  const { box, create, state, command } = await setup(t);
  const shutter = await create(UUID.shutter);
  assert.equal(state(UUID.shutter, 'position'), 100);
  await command(shutter, 'state', -1);
  assert.deepEqual(box.commands().at(-1), [UUID.shutter, { Action: 'Close' }]);
  assert.equal(state(UUID.shutter, 'position'), 0);
  assert.equal(state(UUID.shutter, 'state'), 0, 'arrived: stopped');
  await command(shutter, 'position', 35);
  assert.deepEqual(box.commands().at(-1), [UUID.shutter, { Position: '35' }]);
  assert.equal(state(UUID.shutter, 'position'), 35);
  const flag = await create(UUID.flag);
  await command(flag, 'binary', 1);
  assert.deepEqual(box.commands().at(-1), [UUID.flag, { Status: 'True' }]);
  assert.equal(state(UUID.flag, 'binary'), 1);
});

test('routines: run a mood, switch a free function only when it differs', async (t) => {
  const { box, create, state, command } = await setup(t);
  const mood = await create(UUID.mood);
  await command(mood, 'run', 1);
  assert.deepEqual(box.commands().at(-1), [UUID.mood, { BasicState: 'Triggered' }]);
  assert.equal(state(UUID.mood, 'active'), 1);
  const generic = await create(UUID.generic);
  const before = box.count('devices.control');
  assert.deepEqual(await command(generic, 'active', 0), { success: true });
  assert.equal(box.count('devices.control'), before, 'already off: nothing sent');
  await command(generic, 'active', 1);
  assert.equal(state(UUID.generic, 'active'), 1);
});

test('the doorbell: every ring is an event, even twice in a row', async (t) => {
  const { gladys, box, create, tick } = await setup(t);
  await create(UUID.bell);
  const ring = `${ID(UUID.bell)}:ring`;
  assert.equal(gladys.fake.states.filter((s) => s.device_feature_external_id === ring).length, 0);
  for (let i = 0; i < 2; i += 1) {
    box.sim.status(UUID.bell, { BasicState: 'On', CallPending: 'True' });
    box.sim.status(UUID.bell, { BasicState: 'Off', CallPending: 'False' });
  }
  await settle();
  await tick(TIMINGS.flushInterval);
  const rings = gladys.fake.states.filter((s) => s.device_feature_external_id === ring);
  assert.deepEqual(
    rings.map((s) => s.state),
    [1, 1],
  );
  assert.equal(gladys.fake.lastState(`${ID(UUID.bell)}:doorlock`), 1);
});

test('a thermostat: temporary setpoint for the configured time, then the program', async (t) => {
  const { box, create, state, command } = await setup(t, {
    config: { ...CONFIG, overrule_minutes: 120 },
  });
  const thermostat = await create(UUID.thermostat);
  assert.equal(state(UUID.thermostat, 'temperature'), 20.5);
  assert.equal(state(UUID.thermostat, 'mode'), 1);
  assert.equal(state(UUID.thermostat, 'activity'), 1);
  await command(thermostat, 'setpoint', 22);
  assert.deepEqual(box.commands().at(-1), [
    UUID.thermostat,
    { OverruleActive: 'True', OverruleSetpoint: '22', OverruleTime: '120' },
  ]);
  assert.equal(state(UUID.thermostat, 'setpoint'), 22);
  assert.equal(state(UUID.thermostat, 'overrule'), 1);
  await command(thermostat, 'program', 'Eco');
  assert.equal(state(UUID.thermostat, 'program'), 'Eco');
  assert.equal(state(UUID.thermostat, 'overrule'), 0);
  await command(thermostat, 'mode', 0);
  assert.equal(state(UUID.thermostat, 'mode'), 0);
});

test('meters: live power asked while the device exists, every 25 s', async (t) => {
  const { box, create, state, tick } = await setup(t);
  assert.equal(box.commands().length, 0, 'nothing created: nothing asked');
  await create(UUID.meter);
  await tick(TIMINGS.publishGap);
  assert.deepEqual(box.commands().at(-1), [UUID.meter, { ReportInstantUsage: 'True' }]);
  await tick(TIMINGS.flushInterval);
  assert.equal(state(UUID.meter, 'power'), 850);
  const asked = box.commands().length;
  await tick(TIMINGS.instantUsage);
  await tick(TIMINGS.publishGap);
  assert.equal(box.commands().length, asked + 1);
});

test('an offline device: its badge, and a command refused with a reason', async (t) => {
  const { box, create, command, badge, tick } = await setup(t);
  const lamp = await create(UUID.offline);
  assert.deepEqual(badge(ID(UUID.offline)), {
    device_external_id: ID(UUID.offline),
    transport: 'unreachable',
    degraded: true,
    message: {
      en: 'The controller reports this device offline',
      fr: 'Le contrôleur signale cet appareil hors ligne',
    },
  });
  const result = await command(lamp, 'binary', 1);
  assert.equal(result.success, false);
  assert.match(result.error, /Applique is offline/);
  box.sim.setOnline(UUID.offline, true);
  await settle();
  await tick(0);
  assert.equal(badge(ID(UUID.offline)).transport, 'local');
  assert.equal(badge(ID(UUID.offline)).degraded, undefined);
});

test('the controller goes away and comes back', async (t) => {
  const { gladys, box, create, badge, tick, online } = await setup(t);
  await create(UUID.light);
  assert.equal(badge(ID(UUID.light)).transport, 'local');
  box.unreachable = true;
  box.drop();
  await settle();
  assert.equal(badge(ID(UUID.light)).transport, 'unreachable');
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Connection to the controller lost: connection lost\. Retrying in 5 s\./,
  );
  assert.equal(gladys.fake.connectionStatus.connected, false);
  await tick(5000);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /unreachable \(ECONNREFUSED 192\.168\.1\.50:8884\)/,
  );
  box.unreachable = false;
  t.mock.timers.tick(10_000);
  await online();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(badge(ID(UUID.light)).transport, 'local');
  assert.equal(box.count('devices.list'), 2, 'the list is read again');
});

test('a refused token: said so, slow retries', async (t) => {
  const { gladys, box } = await setup(t, { prepare: (b) => (b.token = 'another.token.value') });
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /refused the Hobby API token \(not authorized\)/,
  );
  assert.match(gladys.fake.connectionStatus.message.fr, /a refusé le jeton Hobby API/);
  assert.equal(box.connections.length, 1);
});

test('a token about to expire: sensor, status, badge, one reminder a day', async (t) => {
  const { gladys, create, state, badge, tick } = await setup(t, {
    config: { ...CONFIG, hobby_token: SOON_TOKEN },
    prepare: (b) => (b.token = SOON_TOKEN),
  });
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /21 devices in Discovery\. The Hobby API token expires in 10 days \(2026-10-26\)/,
  );
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: SCENE_TRIGGERS.TOKEN_EXPIRING,
      data: { days_left: 10, expires_on: '2026-10-26', expired: false },
    },
  ]);
  await create('controller');
  assert.equal(state('controller', 'token-days'), 10);
  assert.deepEqual(badge(CONTROLLER), {
    device_external_id: CONTROLLER,
    transport: 'local',
    degraded: true,
    message: { en: 'Hobby API token: 10 days left', fr: 'Jeton Hobby API : 10 jours restants' },
  });
  await tick(TIMINGS.tokenCheck * 3);
  assert.equal(gladys.fake.sceneEvents.length, 1, 'once a day');
  await tick(DAY);
  assert.equal(gladys.fake.sceneEvents.length, 2);
  assert.equal(gladys.fake.sceneEvents[1].data.days_left, 9);
  await tick(TIMINGS.flushInterval);
  assert.equal(state('controller', 'token-days'), 9);
});

test('a reminder already sent today is not sent again after a restart', async (t) => {
  const store = memoryStore({
    state: { clientId: 'gladys-nhc-01234567', lastReminder: '2026-10-16' },
  });
  const { gladys, box } = await setup(t, {
    store,
    config: { ...CONFIG, hobby_token: SOON_TOKEN },
    prepare: (b) => (b.token = SOON_TOKEN),
  });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.sceneEvents.length, 0);
  assert.equal(box.connections[0].clientId, 'gladys-nhc-01234567');
});

test('an expired token: no connection, the reason, the reminder', async (t) => {
  const { gladys, box } = await setup(t, { config: { ...CONFIG, hobby_token: EXPIRED_TOKEN } });
  assert.equal(box.connections.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^The Hobby API token expired on 2026-10-13\. Create a new one/,
  );
  assert.equal(gladys.fake.sceneEvents[0].data.expired, true);
  assert.equal(gladys.fake.sceneEvents[0].data.days_left, 0);
  assert.equal(gladys.fake.discoveredDevices[0].external_id, CONTROLLER);
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(ack.data.message.en, /expired on 2026-10-13/);
});

test('configuration errors are shown', async (t) => {
  const { gladys, box } = await setup(t, { config: { controller_host: '192.168.1.50' } });
  assert.equal(box.connections.length, 0);
  assert.deepEqual(
    gladys.fake.connectionStatus.message.en,
    'Paste your Hobby API token in the configuration.',
  );
  await gladys.fake.configUpdated({ ...CONFIG, hobby_token: 'not-a-token' });
  assert.match(gladys.fake.connectionStatus.message.en, /not valid: paste the whole token/);
  await gladys.fake.configUpdated(CONFIG);
  await settle();
  assert.equal(box.connections.length, 1);
});

test('the connection test: from the live link, or with its own connection', async (t) => {
  const { gladys, box, tick } = await setup(t, { prepare: (b) => (b.unreachable = true) });
  const failed = gladys.fake.action(ACTIONS.TEST, {});
  await tick(0);
  assert.match((await failed).data.message.en, /^The controller is unreachable \(ECONNREFUSED/);
  box.unreachable = false;
  const ok = gladys.fake.action(ACTIONS.TEST, {});
  await tick(0);
  await tick(TIMINGS.coalesce);
  await tick(TIMINGS.publishGap);
  assert.deepEqual((await ok).data.message, {
    en: 'Connected to Niko Home Control 2.27.1.0: 21 devices offered in Discovery out of 24 listed (1 of a kind not supported yet). Token valid until 2027-05-04 (200 days).',
    fr: "Connecté à Niko Home Control 2.27.1.0 : 21 appareils proposés dans Découverte sur 24 listés (1 d'un type pas encore pris en charge). Jeton valable jusqu'au 2027-05-04 (200 jours).",
  });
  assert.equal(box.connections.at(-1).clientId.endsWith('-test'), true);
  // Once connected, the test reads the live link: no new connection.
  await tick(10_000);
  await tick(TIMINGS.coalesce);
  await tick(TIMINGS.publishGap);
  const connections = box.connections.length;
  const live = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(live.data.message.en, /^Connected to Niko Home Control 2\.27\.1\.0: 21 devices/);
  assert.equal(box.connections.length, connections);
});

test('find the controller: the UDP broadcast relayed by Gladys, the address saved', async (t) => {
  const reply = (ip, generation) => ({
    source_ip: ip,
    source_port: 10000,
    payload_base64: discoveryReply(ip, { generation }).toString('base64'),
  });
  const { gladys, box, tick } = await setup(t, {
    config: { hobby_token: TOKEN },
    scanResults: {
      'udp-active-broadcast': [
        reply('192.168.1.50', 2),
        reply('192.168.1.50', 2),
        reply('192.168.1.70', 1),
      ],
    },
  });
  assert.equal(box.connections.length, 0);
  const ack = await gladys.fake.action(ACTIONS.FIND, {});
  assert.deepEqual(ack.data.message, {
    en: 'Found: 192.168.1.50, 192.168.1.70 (Niko Home Control I). 192.168.1.50 saved as the address of the controller. Niko Home Control I is not supported yet.',
    fr: 'Trouvé : 192.168.1.50, 192.168.1.70 (Niko Home Control I). 192.168.1.50 enregistrée comme adresse du contrôleur. Niko Home Control I n’est pas encore pris en charge.',
  });
  assert.deepEqual(gladys.fake.scans[0], {
    type: 'udp-active-broadcast',
    port: 10000,
    payload_base64: 'RA==',
    timeout_seconds: 5,
  });
  assert.equal(gladys.fake.config.controller_host, '192.168.1.50');
  await tick(0);
  assert.equal(box.connections[0].host, '192.168.1.50');
});

test('find the controller: nothing found, or an address already typed', async (t) => {
  const { gladys } = await setup(t, { scanResults: { 'udp-active-broadcast': [] } });
  assert.match(
    (await gladys.fake.action(ACTIONS.FIND, {})).data.message.en,
    /^No Niko Home Control controller answered/,
  );
  gladys.fake.scanResults['udp-active-broadcast'] = [
    {
      source_ip: '192.168.1.99',
      source_port: 10000,
      payload_base64: discoveryReply('192.168.1.99').toString('base64'),
    },
  ];
  const found = await gladys.fake.action(ACTIONS.FIND, {});
  assert.match(found.data.message.en, /^Found: 192\.168\.1\.99\. Type the address/);
  assert.equal(gladys.fake.config.controller_host, '192.168.1.50', 'kept');
});

test('Scan, a renamed device, a configuration uploaded to the controller', async (t) => {
  const { gladys, box, tick, device } = await setup(t);
  await gladys.fake.scanRequest();
  await tick(TIMINGS.publishGap);
  assert.equal(box.count('devices.list'), 2);
  box.sim.event('devices.displayname_changed', [{ Uuid: UUID.light, DisplayName: 'Lustre' }]);
  await settle();
  await tick(TIMINGS.relistDebounce);
  assert.equal(device(UUID.light).name, 'Lustre (Salon)');
  box.sim.configurationChanged();
  box.sim.event('devices.added', [{ Uuid: 'new' }]);
  await settle();
  await tick(TIMINGS.relistDebounce);
  await tick(TIMINGS.publishGap);
  assert.equal(box.count('devices.list'), 3, 'one list for the burst');
  // A status of a device the integration does not know: the list again.
  box.deliver('hobby/control/devices/evt', {
    Method: 'devices.status',
    Params: [{ Devices: [{ Uuid: 'unknown', Properties: [{ Status: 'On' }] }] }],
  });
  await settle();
  await tick(TIMINGS.relistDebounce);
  await tick(TIMINGS.publishGap);
  assert.equal(box.count('devices.list'), 4);
});

test('a deleted device is forgotten; the client id stays the same', async (t) => {
  const store = memoryStore();
  const { gladys, box, create, tick } = await setup(t, { store });
  const light = await create(UUID.light);
  await gladys.fake.deviceDeleted(light);
  box.sim.status(UUID.light, { Status: 'Off' });
  await settle();
  const states = gladys.fake.states.length;
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.states.length, states);
  assert.match(store.docs.get('state').clientId, /^gladys-nhc-[0-9a-f]{8}$/);
  assert.equal(box.connections[0].clientId, store.docs.get('state').clientId);
});
