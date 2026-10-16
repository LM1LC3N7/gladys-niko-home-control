import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyChange,
  controlMessage,
  devicesOf,
  parseDevice,
  parseDiscoveryReply,
  parseGrammar,
  parseMessage,
  systemInfoOf,
  toMap,
} from '../src/nhc2/protocol.js';
import { SYSTEM_INFO, UUID, discoveryReply, installation } from './fixtures/niko.js';

const raw = (uuid) => installation().find((d) => d.Uuid === uuid);

test('lists of single-key objects become one object', () => {
  assert.deepEqual(toMap([{ a: '1' }, { b: '2' }, null, 'x', { a: '3' }]), { a: '3', b: '2' });
  assert.deepEqual(toMap({ a: '1' }), { a: '1' });
  assert.deepEqual(toMap(undefined), {});
});

test('messages: JSON with a Method, trimmed; errors kept short', () => {
  assert.deepEqual(parseMessage(Buffer.from('{"Method":" systeminfo.publish "}')), {
    method: 'systeminfo.publish',
    params: {},
  });
  const error = parseMessage(
    JSON.stringify({
      Method: 'devices.control',
      ErrCode: 'INTERNAL_ERROR',
      ErrMessage: 'x'.repeat(500),
    }),
  );
  assert.equal(error.errCode, 'INTERNAL_ERROR');
  assert.equal(error.errMessage.length, 300);
  for (const bad of ['not json', '[1,2]', 'null', '"text"']) {
    assert.equal(parseMessage(bad), null, bad);
  }
  const list = parseMessage(
    JSON.stringify({ Method: 'devices.list', Params: [{ Devices: installation() }] }),
  );
  assert.equal(devicesOf(list).length, installation().length);
  assert.deepEqual(devicesOf({ params: {} }), []);
});

test('grammars of the property definitions', () => {
  assert.deepEqual(parseGrammar('Range(0.00,100.00,1.00)'), {
    kind: 'range',
    min: 0,
    max: 100,
    step: 1,
  });
  assert.deepEqual(parseGrammar('Range(-201326,201326,0.001)'), {
    kind: 'range',
    min: -201326,
    max: 201326,
    step: 0.001,
  });
  assert.deepEqual(parseGrammar('Range(...)'), { kind: 'range' });
  assert.deepEqual(parseGrammar('Choice(On, Off,Triggered)'), {
    kind: 'choice',
    options: ['On', 'Off', 'Triggered'],
  });
  assert.deepEqual(parseGrammar('Choice(...)'), { kind: 'choice', options: [] });
  assert.deepEqual(parseGrammar('Boolean'), { kind: 'boolean' });
  assert.deepEqual(parseGrammar('Text'), { kind: 'text' });
  assert.deepEqual(parseGrammar('Color(hsv(h,s,v),rgb(r,g,b))'), { kind: 'color' });
  assert.deepEqual(parseGrammar(undefined), { kind: 'unknown' });
});

test('a device of the list, parsed', () => {
  const dimmer = parseDevice(raw(UUID.dimmer));
  assert.equal(dimmer.uuid, UUID.dimmer);
  assert.equal(dimmer.name, 'Spots');
  assert.equal(dimmer.type, 'action');
  assert.equal(dimmer.model, 'dimmer');
  assert.equal(dimmer.online, true);
  assert.equal(dimmer.parameters.LocationName, 'Salon');
  assert.deepEqual(dimmer.properties, { Status: 'Off', Brightness: '40', Aligned: 'True' });
  assert.deepEqual(dimmer.definitions.Brightness, {
    grammar: { kind: 'range', min: 0, max: 100, step: 1 },
    status: true,
    control: true,
  });
  assert.equal(dimmer.definitions.Aligned.control, false);
  assert.equal(parseDevice(raw(UUID.offline)).online, false);
});

test('partial or broken devices never throw (openHAB issue 21302)', () => {
  assert.equal(parseDevice(null), null);
  assert.equal(parseDevice({ Name: 'no uuid' }), null);
  const partial = parseDevice({
    Uuid: 'u1',
    Type: 'chargingstation',
    PropertyDefinitions: [{ Status: null }, { Mode: 'nonsense' }, {}],
    Properties: [{ Status: null }, { Power: { nested: true } }, { Level: 3 }],
  });
  assert.deepEqual(partial.definitions, {});
  assert.deepEqual(partial.properties, { Level: '3' });
  assert.equal(partial.name, 'u1');
  assert.equal(partial.online, true, 'absent Online means online');
});

test('events change the device: values, online, definitions, parameters, name', () => {
  const device = parseDevice(raw(UUID.dimmer));
  assert.deepEqual(
    applyChange(device, {
      Uuid: UUID.dimmer,
      Properties: [{ Status: 'On' }, { Brightness: '40' }],
    }),
    ['Status'],
  );
  assert.equal(device.properties.Status, 'On');
  applyChange(device, { Uuid: UUID.dimmer, Online: 'false' });
  assert.equal(device.online, false);
  applyChange(device, {
    PropertyDefinitions: [
      { Speed: { Description: 'Range(0,100,1)', HasStatus: 'false', CanControl: 'true' } },
    ],
    Parameters: [{ LocationName: 'Cuisine' }],
    DisplayName: ' Spots cuisine ',
  });
  assert.equal(device.definitions.Speed.control, true);
  assert.equal(device.parameters.LocationName, 'Cuisine');
  assert.equal(device.name, 'Spots cuisine');
});

test('devices.control: one key per property object, in order', () => {
  assert.deepEqual(
    controlMessage([
      {
        uuid: 'a',
        properties: [
          ['Status', 'On'],
          ['Brightness', 50],
        ],
      },
      { uuid: 'b', properties: [['Action', 'Stop']] },
    ]),
    {
      Method: 'devices.control',
      Params: [
        {
          Devices: [
            { Uuid: 'a', Properties: [{ Status: 'On' }, { Brightness: '50' }] },
            { Uuid: 'b', Properties: [{ Action: 'Stop' }] },
          ],
        },
      ],
    },
  );
});

test('system information', () => {
  assert.deepEqual(systemInfoOf(parseMessage(JSON.stringify(SYSTEM_INFO))), {
    nhcVersion: '2.27.1.0',
    cocoImage: '2026.3-20261001093000',
    lastConfig: '20261012183000',
    language: 'FR',
  });
  assert.deepEqual(systemInfoOf({ params: {} }), {
    nhcVersion: undefined,
    cocoImage: undefined,
    lastConfig: undefined,
    language: undefined,
  });
});

test('replies to the UDP discovery', () => {
  assert.deepEqual(parseDiscoveryReply(discoveryReply('192.168.1.50'), '192.168.1.50'), {
    id: '443b00870a12',
    ip: '192.168.1.50',
    generation: 2,
    version: '2.27.1.0',
  });
  const nhc1 = parseDiscoveryReply(
    discoveryReply('192.168.1.60', { generation: 1 }).subarray(0, 16),
    '192.168.1.60',
  );
  assert.deepEqual(nhc1, { id: '443b00870a12', ip: '192.168.1.60', generation: 1 });
  // A reply without a usable address in it: the sender's address.
  assert.equal(parseDiscoveryReply(discoveryReply('0.0.0.0'), '10.0.0.9').ip, '10.0.0.9');
  assert.equal(parseDiscoveryReply(Buffer.from([0x45, ...Buffer.alloc(24)]), '1.2.3.4'), null);
  assert.equal(parseDiscoveryReply(Buffer.from([0x44, 1, 2]), '1.2.3.4'), null);
  assert.equal(parseDiscoveryReply('nope', '1.2.3.4'), null);
});
