// -----------------------------------------------------------------------------
// The MQTT client against the in-memory broker and the simulated controller,
// with mocked timers: the reconnections, the watchdog and the 1 publish per
// second run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMINGS } from '../src/constants.js';
import { NhcClient, errorReason, failureKind } from '../src/nhc2/client.js';
import { SUBSCRIPTIONS } from '../src/nhc2/protocol.js';
import { NOW, TOKEN, UUID } from './fixtures/niko.js';
import { fakeController, settle } from './helpers/broker.js';

function setup(t, { token = TOKEN, prepare = () => {}, reconnect = true } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const box = fakeController();
  prepare(box);
  const client = new NhcClient({
    host: '192.168.1.50',
    port: 8884,
    token,
    clientId: 'gladys-nhc-0a1b2c3d',
    connect: box.connect,
    now: () => Date.now(),
    reconnect,
  });
  const events = [];
  for (const name of [
    'connecting',
    'list',
    'status',
    'change',
    'systeminfo',
    'offline',
    'controlError',
    'time',
  ]) {
    client.on(name, (...args) => events.push([name, ...args]));
  }
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  /** Connection, system information (after the 50 ms window), device list (1 s later). */
  const online = async () => {
    await tick(0);
    await tick(TIMINGS.coalesce);
    await tick(TIMINGS.publishGap);
  };
  t.after(() => client.stop());
  return { box, client, events, tick, online, of: (name) => events.filter((e) => e[0] === name) };
}

test('connects as Niko asks: TLS 8884, user hobby, the token, a stable id, clean, 3.1.1', async (t) => {
  const { box, client, tick, of } = setup(t);
  client.start();
  await tick(0);
  const options = box.connections[0];
  assert.deepEqual(
    {
      protocol: options.protocol,
      host: options.host,
      port: options.port,
      username: options.username,
      password: options.password,
      clientId: options.clientId,
      protocolVersion: options.protocolVersion,
      clean: options.clean,
      keepalive: options.keepalive,
      reconnectPeriod: options.reconnectPeriod,
      rejectUnauthorized: options.rejectUnauthorized,
      ca: options.ca.length,
    },
    {
      protocol: 'mqtts',
      host: '192.168.1.50',
      port: 8884,
      username: 'hobby',
      password: TOKEN,
      clientId: 'gladys-nhc-0a1b2c3d',
      protocolVersion: 4,
      clean: true,
      keepalive: 60,
      reconnectPeriod: 0,
      rejectUnauthorized: true,
      ca: 2,
    },
  );
  assert.equal(typeof options.checkServerIdentity, 'function');
  assert.deepEqual([...box.clients][0].filters, SUBSCRIPTIONS);
  // One publish per second: the system information first, then the device list.
  await tick(TIMINGS.coalesce);
  assert.deepEqual(
    box.published.map((p) => [p.topic, p.message.Method]),
    [['hobby/system/cmd', 'systeminfo.publish']],
  );
  assert.equal(client.online, false);
  await tick(TIMINGS.publishGap - 1);
  assert.equal(box.published.length, 1);
  await tick(1);
  assert.deepEqual(box.published[1].message, { Method: 'devices.list' });
  assert.equal(box.published[1].qos, 1);
  assert.equal(client.online, true);
  assert.equal(of('list').length, 1);
  assert.equal(of('list')[0][1].length, 24);
  assert.deepEqual(of('list')[0][2], { first: true });
  assert.equal(client.systemInfo.nhcVersion, '2.27.1.0');
});

test('commands of the same moment are merged into one devices.control, one per second', async (t) => {
  const { box, client, tick, online } = setup(t);
  client.start();
  await online();
  const sent = [
    client.control(UUID.light, [['Status', 'Off']]),
    client.control(UUID.dimmer, [['Brightness', '70']]),
    client.control(UUID.light, [['Status', 'On']]),
  ];
  let settled = 0;
  sent.forEach((p) => p.then(() => (settled += 1)));
  await tick(TIMINGS.publishGap);
  await Promise.all(sent);
  assert.equal(settled, 3);
  assert.equal(box.count('devices.control'), 1);
  assert.deepEqual(box.commands(), [
    [UUID.light, { Status: 'On' }],
    [UUID.dimmer, { Brightness: '70' }],
  ]);
  // The next command waits for the next second.
  const next = client.control(UUID.socket, [['Status', 'On']]);
  await tick(TIMINGS.publishGap - 1);
  assert.equal(box.count('devices.control'), 1);
  await tick(1);
  await next;
  assert.equal(box.count('devices.control'), 2);
  // After a quiet second, a command leaves within the 50 ms window.
  await tick(5000);
  client.control(UUID.socket, [['Status', 'Off']]);
  await tick(TIMINGS.coalesce);
  assert.equal(box.count('devices.control'), 3);
});

test('a big scene is split into messages of 16 devices at most', async (t) => {
  const { box, client, tick, online } = setup(t);
  client.start();
  await online();
  for (let i = 0; i < 20; i += 1) {
    client.control(`uuid-${i}`, [['Status', 'On']]).catch(() => {});
  }
  await tick(TIMINGS.publishGap);
  await tick(TIMINGS.publishGap);
  const sizes = box.published
    .filter((p) => p.message.Method === 'devices.control')
    .map((p) => p.message.Params[0].Devices.length);
  assert.deepEqual(sizes, [16, 4]);
});

test('the controller confirms with devices.status events, refuses with an error', async (t) => {
  const { client, tick, online, of } = setup(t);
  client.start();
  await online();
  const sent = client.control(UUID.socket, [['Status', 'On']]);
  await tick(TIMINGS.publishGap);
  await sent;
  assert.deepEqual(of('status').at(-1)[1], [{ Uuid: UUID.socket, Properties: [{ Status: 'On' }] }]);
  client.control(UUID.socket, [['Status', '100']]);
  await tick(TIMINGS.publishGap);
  assert.equal(of('controlError').length, 1);
  assert.equal(of('controlError')[0][1].errCode, 'INTERNAL_ERROR');
});

test('a command while offline is refused at once', async (t) => {
  const { client } = setup(t);
  await assert.rejects(client.control(UUID.light, [['Status', 'On']]), /not connected/);
});

test('a refused token: no retry before 30 minutes', async (t) => {
  const { box, client, tick, of } = setup(t, { token: 'eyJ.wrong.token' });
  client.start();
  await tick(0);
  const [, failure] = of('offline')[0];
  assert.deepEqual(failure, {
    reason: 'not authorized',
    kind: 'refused',
    refused: true,
    wasOnline: false,
    retryIn: TIMINGS.authRetry,
  });
  await tick(TIMINGS.authRetry - 1);
  assert.equal(box.connections.length, 1);
  await tick(1);
  assert.equal(box.connections.length, 2);
});

test('an unreachable controller: growing delays, from the shortest again once back', async (t) => {
  const { box, client, tick, online, of } = setup(t, { prepare: (b) => (b.unreachable = true) });
  client.start();
  await tick(0);
  assert.equal(of('offline')[0][1].kind, 'unreachable');
  assert.equal(of('offline')[0][1].reason, 'ECONNREFUSED 192.168.1.50:8884');
  const delays = [];
  for (let i = 0; i < 8; i += 1) {
    delays.push(of('offline').at(-1)[1].retryIn);
    await tick(of('offline').at(-1)[1].retryIn);
  }
  assert.deepEqual(delays, [5000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
  box.unreachable = false;
  t.mock.timers.tick(of('offline').at(-1)[1].retryIn);
  await online();
  assert.equal(client.online, true);
  box.drop();
  await settle();
  assert.equal(of('offline').at(-1)[1].retryIn, 5000);
  assert.equal(of('offline').at(-1)[1].wasOnline, true);
});

test('a silent controller is dropped by the watchdog, then joined again', async (t) => {
  const { box, client, tick, online, of } = setup(t);
  client.start();
  await online();
  // The time event every 30 s keeps the link alive.
  for (let i = 0; i < 6; i += 1) {
    box.sim.time();
    await tick(30_000);
  }
  assert.equal(of('offline').length, 0);
  assert.equal(of('time').length, 6);
  box.mute = true;
  await tick(TIMINGS.watchdog + TIMINGS.watchdogCheck);
  assert.equal(of('offline')[0][1].reason, 'the controller went silent');
  box.mute = false;
  t.mock.timers.tick(of('offline')[0][1].retryIn);
  await online();
  assert.equal(client.online, true);
  assert.equal(box.connections.length, 2);
  assert.deepEqual(of('list').at(-1)[2], { first: true });
});

test('no device list within 20 s: reconnect', async (t) => {
  const { client, tick, of } = setup(t, { prepare: (b) => (b.mute = true) });
  client.start();
  await tick(0);
  await tick(TIMINGS.listTimeout);
  assert.equal(of('offline')[0][1].reason, 'the controller sent no device list');
  assert.equal(client.online, false);
});

test('changes of the installation and of the configuration', async (t) => {
  const { box, client, tick, online, of } = setup(t);
  client.start();
  await online();
  box.sim.event('devices.displayname_changed', [{ Uuid: UUID.light, DisplayName: 'Lustre' }]);
  box.sim.event('devices.removed', [{ Uuid: UUID.socket }]);
  box.sim.configurationChanged();
  await settle();
  assert.deepEqual(
    of('change').map((e) => e[1]),
    ['devices.displayname_changed', 'devices.removed'],
  );
  assert.deepEqual(
    of('systeminfo').map((e) => e[2]),
    [{ changed: false }, { changed: true }],
  );
  client.requestList();
  await tick(TIMINGS.publishGap);
  assert.deepEqual(of('list').at(-1)[2], { first: false });
});

test('new connections are at least 1.5 s apart (Niko: 1 per second)', async (t) => {
  const { box, client, tick, online } = setup(t);
  client.start();
  await online();
  client.lastConnect = Date.now();
  box.drop();
  await settle();
  // A forced open() right away still waits for the gap.
  client.open();
  await tick(0);
  assert.equal(box.connections.length, 1);
  await tick(TIMINGS.connectGap);
  assert.equal(box.connections.length, 2);
});

test('readable reasons, never the token', () => {
  assert.equal(errorReason({ code: 4 }), 'bad user name or password');
  assert.equal(
    errorReason({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }),
    'certificate not issued by Niko (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)',
  );
  assert.equal(errorReason(new Error('boom')), 'boom');
  assert.equal(errorReason(undefined), 'unknown error');
  assert.equal(failureKind({ code: 5 }), 'refused');
  assert.equal(failureKind({ code: 'SELF_SIGNED_CERT_IN_CHAIN' }), 'certificate');
  assert.equal(failureKind({ code: 'EHOSTUNREACH' }), 'unreachable');
  assert.equal(failureKind(new Error('x')), 'other');
});
