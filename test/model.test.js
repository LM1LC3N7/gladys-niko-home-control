import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildModel, deviceName, mapDevice, toNikoNumber } from '../src/model.js';
import { parseDevice } from '../src/nhc2/protocol.js';
import { UUID, installation } from './fixtures/niko.js';

const gladys = createFakeGladys();
const idsOf = (uuid) => gladys.externalIds('nhc', uuid);
const parsed = () => new Map(installation().map((raw) => [raw.Uuid, parseDevice(raw)]));

function setup(options = { language: 'en' }) {
  const devices = parsed();
  const model = buildModel(idsOf, devices.values(), options);
  const device = (uuid) => model.devices.find((d) => d.external_id === idsOf(uuid).device);
  const feature = (uuid, key) => {
    const found = device(uuid)?.features.find((f) => f.external_id === idsOf(uuid).feature(key));
    assert.ok(found, `${uuid} has ${key}`);
    return found;
  };
  const read = (uuid, key) => {
    const reader = model.readers.get(uuid).find((r) => r.featureId === idsOf(uuid).feature(key));
    return reader.read(devices.get(uuid));
  };
  const write = (uuid, key, value) =>
    model.writers.get(idsOf(uuid).feature(key)).write(value, devices.get(uuid));
  const keys = (uuid) => device(uuid).features.map((f) => f.external_id.split(':').pop());
  return { devices, model, device, feature, read, write, keys };
}

test('which devices are offered', () => {
  const { model, device } = setup();
  assert.deepEqual(model.counts, { devices: 24, offered: 21, empty: 2, overflow: 0 });
  assert.deepEqual([...model.unsupported], [['action/nikohomecontrol/audiocontrol', 1]]);
  assert.equal(device(UUID.panel), undefined, 'hardware has no state');
  assert.equal(device(UUID.firmware), undefined);
  const light = device(UUID.light);
  assert.equal(light.name, 'Plafonnier (Salon)');
  assert.equal(light.external_id, `ext:test-integration:nhc:${UUID.light}`);
  assert.equal(light.should_poll, false);
  assert.deepEqual(light.params, [
    { name: 'NIKO_UUID', value: UUID.light },
    { name: 'NIKO_MODEL', value: 'action/nikohomecontrol/light' },
    { name: 'NIKO_LOCATION', value: 'Salon' },
  ]);
  // The fake Gladys validates the devices like the core.
  return gladys.publishDiscoveredDevices(model.devices);
});

test('the room is not repeated in the name', () => {
  const device = parseDevice(installation()[0]);
  device.parameters.LocationName = 'Plafonnier';
  assert.equal(deviceName(device), 'Plafonnier');
  delete device.parameters.LocationName;
  assert.equal(deviceName(device), 'Plafonnier');
});

test('relays: a light, or a switch', () => {
  const { feature, read, write } = setup();
  assert.equal(feature(UUID.light, 'binary').category, 'light');
  assert.equal(feature(UUID.socket, 'binary').category, 'switch');
  assert.equal(feature(UUID.light, 'binary').read_only, false);
  assert.deepEqual(read(UUID.light, 'binary'), { state: 1 });
  assert.deepEqual(read(UUID.socket, 'binary'), { state: 0 });
  assert.deepEqual(write(UUID.socket, 'binary', 1), [['Status', 'On']]);
  assert.deepEqual(write(UUID.light, 'binary', 0), [['Status', 'Off']]);
});

test('dimmer: switched on with its brightness when off', () => {
  const { devices, feature, read, write } = setup();
  assert.deepEqual(
    { ...feature(UUID.dimmer, 'brightness'), external_id: undefined },
    {
      name: 'Brightness',
      external_id: undefined,
      category: 'light',
      type: 'brightness',
      min: 0,
      max: 100,
      unit: 'percent',
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
  );
  assert.deepEqual(read(UUID.dimmer, 'brightness'), { state: 40 });
  assert.deepEqual(write(UUID.dimmer, 'brightness', 75.4), [
    ['Status', 'On'],
    ['Brightness', '75'],
  ]);
  devices.get(UUID.dimmer).properties.Status = 'On';
  assert.deepEqual(write(UUID.dimmer, 'brightness', 120), [['Brightness', '100']]);
  devices.get(UUID.dimmer).properties.Status = 'Off';
  assert.deepEqual(write(UUID.dimmer, 'brightness', 0), [['Brightness', '0']], '0 is not off');
});

test('motors: open / close / stop and position (100 = open)', () => {
  const { devices, feature, read, write, keys } = setup();
  assert.deepEqual(keys(UUID.shutter), ['state', 'position']);
  assert.equal(feature(UUID.shutter, 'state').category, 'shutter');
  assert.equal(feature(UUID.gate, 'state').category, 'shutter');
  assert.equal(feature(UUID.sunblind, 'state').category, 'curtain');
  assert.equal(feature(UUID.sunblind, 'position').type, 'position');
  assert.deepEqual(read(UUID.shutter, 'position'), { state: 100 });
  assert.deepEqual(read(UUID.shutter, 'state'), { state: 0 });
  Object.assign(devices.get(UUID.shutter).properties, { Moving: 'True', LastDirection: 'Close' });
  assert.deepEqual(read(UUID.shutter, 'state'), { state: -1 });
  devices.get(UUID.shutter).properties.LastDirection = 'Open';
  assert.deepEqual(read(UUID.shutter, 'state'), { state: 1 });
  assert.deepEqual(write(UUID.shutter, 'state', 1), [['Action', 'Open']]);
  assert.deepEqual(write(UUID.shutter, 'state', -1), [['Action', 'Close']]);
  assert.deepEqual(write(UUID.shutter, 'state', 0), [['Action', 'Stop']]);
  assert.throws(() => write(UUID.shutter, 'state', 2), /unknown cover command/);
  assert.deepEqual(write(UUID.shutter, 'position', 33.3), [['Position', '33']]);
});

test('garage door: a push to operate it, and closed from PortClosed', () => {
  const { devices, feature, read, write } = setup();
  assert.equal(feature(UUID.garage, 'run').type, 'push');
  assert.equal(feature(UUID.garage, 'closed').category, 'opening-sensor');
  assert.deepEqual(write(UUID.garage, 'run', 1), [['BasicState', 'Triggered']]);
  assert.deepEqual(read(UUID.garage, 'closed'), { state: 1 });
  devices.get(UUID.garage).properties.PortClosed = 'False';
  assert.deepEqual(read(UUID.garage, 'closed'), { state: 0 });
  // Without the PortClosed sensor: the BasicState.
  const raw = installation().find((d) => d.Uuid === UUID.garage);
  raw.Properties = [{ BasicState: 'On' }];
  raw.PropertyDefinitions = raw.PropertyDefinitions.filter((d) => !('PortClosed' in d));
  const mapped = mapDevice(parseDevice(raw));
  const closed = mapped.readers.find((r) => r.key === 'closed');
  assert.deepEqual(closed.read(parseDevice(raw)), { state: 0 });
  raw.Properties = [{ BasicState: 'Intermediate' }];
  assert.equal(closed.read(parseDevice(raw)), null, 'moving: unchanged');
});

test('routines: their state, toggled by "Triggered" only when it differs, and Run', () => {
  const { devices, feature, read, write, keys } = setup();
  assert.deepEqual(keys(UUID.generic), ['active', 'run']);
  assert.deepEqual(keys(UUID.mood), ['active', 'run']);
  assert.deepEqual(keys(UUID.alloff), ['active', 'run']);
  assert.deepEqual(keys(UUID.pir), ['active'], 'enable/disable only');
  assert.equal(feature(UUID.pir, 'active').name, 'Detection enabled');
  assert.deepEqual(read(UUID.generic, 'active'), { state: 0 });
  assert.deepEqual(write(UUID.generic, 'active', 1), [['BasicState', 'Triggered']]);
  assert.deepEqual(write(UUID.generic, 'active', 0), [], 'already off');
  devices.get(UUID.generic).properties.BasicState = 'On';
  assert.deepEqual(write(UUID.generic, 'active', 0), [['BasicState', 'Triggered']]);
  assert.deepEqual(write(UUID.mood, 'run', 1), [['BasicState', 'Triggered']]);
  assert.deepEqual(write(UUID.mood, 'run', 0), []);
  assert.deepEqual(read(UUID.pir, 'active'), { state: 1 });
});

test('bell button: the ring is an event, the door lock opens only', () => {
  const { devices, feature, model, read, write } = setup();
  assert.equal(feature(UUID.bell, 'ring').category, 'doorbell');
  assert.equal(feature(UUID.bell, 'ring').read_only, true);
  const ring = model.readers.get(UUID.bell).find((r) => r.featureId.endsWith(':ring'));
  assert.equal(ring.read, undefined);
  assert.equal(ring.event(devices.get(UUID.bell)), null);
  devices.get(UUID.bell).properties.BasicState = 'On';
  assert.equal(ring.event(devices.get(UUID.bell)), 1);
  assert.deepEqual(read(UUID.bell, 'doorlock'), { state: 1 });
  assert.deepEqual(write(UUID.bell, 'doorlock', 0), [['Doorlock', 'Open']]);
  assert.deepEqual(write(UUID.bell, 'doorlock', 1), [], 'it locks again by itself');
});

test('fan action and virtual flag', () => {
  const { feature, read, write } = setup({ language: 'fr' });
  const speed = feature(UUID.fan, 'speed');
  assert.equal(speed.name, 'Vitesse');
  assert.deepEqual(speed.supported_options, [
    { value: 'Low', label: 'Faible' },
    { value: 'Medium', label: 'Moyenne' },
    { value: 'High', label: 'Forte' },
    { value: 'Boost', label: 'Boost' },
  ]);
  assert.equal(speed.keep_history, false);
  assert.deepEqual(read(UUID.fan, 'speed'), { text: 'Low' });
  assert.deepEqual(write(UUID.fan, 'speed', 'Boost'), [['FanSpeed', 'Boost']]);
  assert.throws(() => write(UUID.fan, 'speed', 'Turbo'), /not one of/);
  assert.equal(feature(UUID.flag, 'binary').category, 'switch');
  assert.deepEqual(read(UUID.flag, 'binary'), { state: 0 });
  assert.deepEqual(write(UUID.flag, 'binary', 1), [['Status', 'True']]);
});

test('NHC thermostat: temperature, temporary setpoint, program as mode, demand', () => {
  const { devices, feature, read, write, keys } = setup({ language: 'en', overruleMinutes: 90 });
  assert.deepEqual(keys(UUID.thermostat), [
    'temperature',
    'setpoint',
    'mode',
    'activity',
    'program',
    'overrule',
    'eco',
  ]);
  assert.deepEqual(
    [feature(UUID.thermostat, 'setpoint').min, feature(UUID.thermostat, 'setpoint').max],
    [5, 30],
  );
  assert.equal(feature(UUID.thermostat, 'temperature').unit, 'celsius');
  assert.deepEqual(read(UUID.thermostat, 'temperature'), { state: 20.5 });
  assert.deepEqual(read(UUID.thermostat, 'setpoint'), { state: 21 });
  assert.deepEqual(write(UUID.thermostat, 'setpoint', 21.3), [
    ['OverruleActive', 'True'],
    ['OverruleSetpoint', '21.5'],
    ['OverruleTime', '90'],
  ]);
  assert.deepEqual(read(UUID.thermostat, 'mode'), { state: 1 });
  assert.deepEqual(write(UUID.thermostat, 'mode', 0), [
    ['OverruleActive', 'False'],
    ['Program', 'Off'],
  ]);
  assert.deepEqual(write(UUID.thermostat, 'mode', 3), [
    ['OverruleActive', 'False'],
    ['Program', 'Prog1'],
  ]);
  assert.deepEqual(write(UUID.thermostat, 'mode', 2)[1], ['Program', 'Cool']);
  assert.deepEqual(write(UUID.thermostat, 'mode', 1), [], 'Day is heating already');
  devices.get(UUID.thermostat).properties.Program = 'Night';
  assert.deepEqual(write(UUID.thermostat, 'mode', 1), [], 'Night is heating too');
  devices.get(UUID.thermostat).properties.Program = 'Prog2';
  assert.deepEqual(read(UUID.thermostat, 'mode'), { state: 3 });
  assert.deepEqual(write(UUID.thermostat, 'mode', 1)[1], ['Program', 'Day']);
  assert.deepEqual(read(UUID.thermostat, 'activity'), { state: 1 });
  assert.deepEqual(read(UUID.thermostat, 'program'), { text: 'Prog2' });
  assert.deepEqual(write(UUID.thermostat, 'program', 'Eco'), [
    ['OverruleActive', 'False'],
    ['Program', 'Eco'],
  ]);
  assert.deepEqual(write(UUID.thermostat, 'overrule', 0), [['OverruleActive', 'False']]);
  assert.deepEqual(write(UUID.thermostat, 'eco', 1), [['EcoSave', 'True']]);
});

test('HVAC thermostat: on/off and heating or cooling, fan speed', () => {
  const { read, write, keys } = setup();
  assert.deepEqual(keys(UUID.hvac), [
    'temperature',
    'setpoint',
    'mode',
    'activity',
    'program',
    'overrule',
    'eco',
    'fan',
  ]);
  assert.deepEqual(read(UUID.hvac, 'mode'), { state: 2 });
  assert.deepEqual(read(UUID.hvac, 'activity'), { state: 2 });
  assert.deepEqual(write(UUID.hvac, 'mode', 0), [['ThermostatOn', 'Off']]);
  assert.deepEqual(write(UUID.hvac, 'mode', 1), [
    ['ThermostatOn', 'On'],
    ['OperationMode', 'Heating'],
  ]);
  assert.throws(() => write(UUID.hvac, 'mode', 3), /no automatic mode/);
  assert.deepEqual(write(UUID.hvac, 'setpoint', 21.6)[1], ['OverruleSetpoint', '22']);
  assert.deepEqual(write(UUID.hvac, 'fan', 'High'), [['FanSpeed', 'High']]);
});

test('meters: power (W), production as a positive value, live power to ask', () => {
  const { model, feature, read, write, keys } = setup();
  assert.deepEqual(keys(UUID.meter), ['power']);
  assert.equal(feature(UUID.meter, 'power').category, 'energy-sensor');
  assert.equal(feature(UUID.meter, 'power').unit, 'watt');
  assert.equal(feature(UUID.meter, 'power').read_only, true);
  assert.equal(read(UUID.meter, 'power'), null, 'not reported yet');
  assert.equal(feature(UUID.solar, 'power').category, 'energy-production-sensor');
  assert.deepEqual(read(UUID.solar, 'power'), { state: 1520.5 });
  assert.deepEqual(keys(UUID.plug), ['binary', 'power']);
  assert.deepEqual(read(UUID.plug, 'power'), { state: 1980 });
  assert.deepEqual(write(UUID.plug, 'binary', 0), [['Status', 'Off']]);
  assert.deepEqual([...model.instantUsage].sort(), [UUID.meter, UUID.plug, UUID.solar].sort());
  assert.ok(model.throttled.has(idsOf(UUID.plug).feature('power')));
  assert.ok(!model.throttled.has(idsOf(UUID.plug).feature('binary')));
});

test('smart plug measuring only: its switch is read only', () => {
  const raw = installation().find((d) => d.Uuid === UUID.plug);
  raw.Parameters.push({ MeasuringOnly: 'true' });
  const mapped = mapDevice(parseDevice(raw));
  assert.equal(mapped.features.find((f) => f.key === 'binary').read_only, true);
  assert.equal(mapped.writers.binary, undefined);
});

test('energy home: from and to the grid', () => {
  const mapped = mapDevice(
    parseDevice({
      Uuid: 'eh',
      Type: 'energyhome',
      Technology: 'nikohomecontrol',
      Model: 'generic',
      Properties: [{ ElectricalPowerFromGrid: '1200' }, { ElectricalPowerToGrid: '0' }],
      PropertyDefinitions: [
        {
          ElectricalPowerFromGrid: {
            Description: 'Range(0,999999999,0.001)',
            HasStatus: 'true',
            CanControl: 'false',
          },
        },
        {
          ElectricalPowerToGrid: {
            Description: 'Range(0,999999999,0.001)',
            HasStatus: 'true',
            CanControl: 'false',
          },
        },
        { ReportInstantUsage: { Description: 'Boolean', HasStatus: 'true', CanControl: 'true' } },
      ],
    }),
  );
  assert.deepEqual(
    mapped.features.map((f) => [f.key, f.category, f.type]),
    [
      ['from-grid', 'grid-sensor', 'input-power'],
      ['to-grid', 'grid-sensor', 'output-power'],
    ],
  );
  assert.equal(mapped.instantUsage, true);
});

test('sensors: temperature of a thermometer', () => {
  const { feature, read } = setup();
  assert.equal(feature(UUID.thermometer, 'temperature').category, 'temperature-sensor');
  assert.deepEqual(read(UUID.thermometer, 'temperature'), { state: 13.2 });
});

test('feature names in Dutch', () => {
  const { feature } = setup({ language: 'nl' });
  assert.equal(feature(UUID.dimmer, 'brightness').name, 'Helderheid');
  assert.equal(feature(UUID.thermostat, 'setpoint').name, 'Setpunt');
  assert.deepEqual(feature(UUID.thermostat, 'program').supported_options[0], {
    value: 'Day',
    label: 'Dag',
  });
});

test('numbers on the grid of the property', () => {
  assert.equal(toNikoNumber(21.26, { min: 5, max: 30, step: 0.5 }), '21.5');
  assert.equal(toNikoNumber(2, { min: 5, max: 30, step: 0.5 }), '5');
  assert.equal(toNikoNumber(50.4, {}), '50');
  assert.equal(toNikoNumber('7.15', { step: 0.1 }), '7.2');
  assert.throws(() => toNikoNumber('abc'), /not a number/);
});
