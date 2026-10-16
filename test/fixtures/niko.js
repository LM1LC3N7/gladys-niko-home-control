// -----------------------------------------------------------------------------
// A Niko Home Control II installation WRITTEN for the tests.
//
// Shaped after the messages of Niko's Hobby API documentation (the PDF
// "Hobby API - Technical documentation" v1.4 of March 2025, and the device
// catalog 2.27.1 of https://device-api-doc.cloud.motiv.eu/): the device
// fields, the property names, their grammars (Range, Choice, Boolean) and the
// value formats ("True"/"False", numbers as strings) are Niko's; the names,
// uuids and values are invented. Nothing is copied from the documentation
// (its PDF is "shared under Niko Terms and Conditions") nor from the
// reference projects.
// -----------------------------------------------------------------------------

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A JWT shaped like the Hobby API token (the signature is not checked by the integration). */
export const jwt = (claims, header = { alg: 'RS256', typ: 'JWT' }) =>
  `${b64(header)}.${b64(claims)}.c2lnbmF0dXJlLW9mLXRoZS10ZXN0LXRva2Vu`;

/** The clock of the tests: 2026-10-16T08:00:00Z. */
export const NOW = Date.parse('2026-10-16T08:00:00Z');
export const DAY = 86_400_000;
/** A token valid 200 more days. */
export const TOKEN = jwt({
  sub: 'hobby',
  iat: Math.floor((NOW - 165 * DAY) / 1000),
  exp: Math.floor((NOW + 200 * DAY) / 1000),
});
/** A token expiring in 10 days (the warning period of 14 days). */
export const SOON_TOKEN = jwt({ sub: 'hobby', exp: Math.floor((NOW + 10 * DAY) / 1000) });
/** A token that expired 3 days ago. */
export const EXPIRED_TOKEN = jwt({ sub: 'hobby', exp: Math.floor((NOW - 3 * DAY) / 1000) });

const B = 'Boolean';
const ONOFF = 'Choice(On,Off)';
const ROUTINE = 'Choice(On,Off,Triggered)';
const PERCENT = 'Range(0.00,100.00,1.00)';

/**
 * One device of devices.list. `props`: [name, value, grammar, flags] where
 * flags is "S" (HasStatus), "C" (CanControl) or "SC"; value undefined = not
 * reported (write-only properties).
 */
function device({
  uuid,
  name,
  type = 'action',
  technology = 'nikohomecontrol',
  model,
  location = 'Salon',
  online = 'True',
  props = [],
  params = [],
  traits = [],
}) {
  const raw = {
    Uuid: uuid,
    Identifier: `cfg-${uuid.slice(0, 8)}`,
    Model: model,
    Online: online,
    Name: name,
    Technology: technology,
    Type: type,
    Traits: traits.map(([k, v]) => ({ [k]: v })),
    Parameters: [
      { LocationId: 'a6b1c0de-0000-4000-8000-000000000001' },
      { LocationName: location },
      { LocationIcon: 'general' },
      ...params.map(([k, v]) => ({ [k]: v })),
    ],
  };
  if (props.length > 0) {
    raw.Properties = props.filter(([, v]) => v !== undefined).map(([k, v]) => ({ [k]: v }));
    raw.PropertyDefinitions = props.map(([k, , grammar, flags]) => ({
      [k]: {
        Description: grammar,
        HasStatus: flags.includes('S') ? 'true' : 'false',
        CanControl: flags.includes('C') ? 'true' : 'false',
      },
    }));
  }
  return raw;
}

export const UUID = {
  light: '0b9f3a10-1111-4a1a-9a1a-000000000001',
  socket: '0b9f3a10-1111-4a1a-9a1a-000000000002',
  dimmer: '0b9f3a10-1111-4a1a-9a1a-000000000003',
  shutter: '0b9f3a10-1111-4a1a-9a1a-000000000004',
  sunblind: '0b9f3a10-1111-4a1a-9a1a-000000000005',
  gate: '0b9f3a10-1111-4a1a-9a1a-000000000006',
  garage: '0b9f3a10-1111-4a1a-9a1a-000000000007',
  generic: '0b9f3a10-1111-4a1a-9a1a-000000000008',
  mood: '0b9f3a10-1111-4a1a-9a1a-000000000009',
  alloff: '0b9f3a10-1111-4a1a-9a1a-000000000010',
  pir: '0b9f3a10-1111-4a1a-9a1a-000000000011',
  bell: '0b9f3a10-1111-4a1a-9a1a-000000000012',
  fan: '0b9f3a10-1111-4a1a-9a1a-000000000013',
  flag: '0b9f3a10-1111-4a1a-9a1a-000000000014',
  thermostat: '0b9f3a10-1111-4a1a-9a1a-000000000015',
  hvac: '0b9f3a10-1111-4a1a-9a1a-000000000016',
  meter: '0b9f3a10-1111-4a1a-9a1a-000000000017',
  solar: '0b9f3a10-1111-4a1a-9a1a-000000000018',
  plug: '0b9f3a10-1111-4a1a-9a1a-000000000019',
  thermometer: '0b9f3a10-1111-4a1a-9a1a-000000000020',
  panel: '0b9f3a10-1111-4a1a-9a1a-000000000021',
  audio: '0b9f3a10-1111-4a1a-9a1a-000000000022',
  offline: '0b9f3a10-1111-4a1a-9a1a-000000000023',
  firmware: '0b9f3a10-1111-4a1a-9a1a-000000000024',
};

const motor = (position) => [
  ['Action', undefined, 'Choice(Open,Close,Stop)', 'C'],
  ['Position', position, 'Range(0,100,1)', 'SC'],
  ['Aligned', 'True', B, 'S'],
  ['Moving', 'False', B, 'S'],
  ['LastDirection', 'Close', 'Choice(Open,Close)', 'S'],
];

/** The raw devices of devices.list (a fresh copy each time). */
export function installation() {
  return [
    device({
      uuid: UUID.light,
      name: 'Plafonnier',
      model: 'light',
      props: [['Status', 'On', ONOFF, 'SC']],
    }),
    device({
      uuid: UUID.socket,
      name: 'Prise TV',
      model: 'socket',
      props: [['Status', 'Off', ONOFF, 'SC']],
    }),
    device({
      uuid: UUID.dimmer,
      name: 'Spots',
      model: 'dimmer',
      props: [
        ['Status', 'Off', ONOFF, 'SC'],
        ['Brightness', '40', PERCENT, 'SC'],
        ['Aligned', 'True', B, 'S'],
      ],
    }),
    device({ uuid: UUID.shutter, name: 'Volet', model: 'rolldownshutter', props: motor('100') }),
    device({
      uuid: UUID.sunblind,
      name: 'Store',
      model: 'sunblind',
      location: 'Terrasse',
      props: motor('0'),
    }),
    device({
      uuid: UUID.gate,
      name: 'Portail',
      model: 'gate',
      location: 'Jardin',
      props: motor('0'),
    }),
    device({
      uuid: UUID.garage,
      name: 'Porte de garage',
      model: 'garagedoor',
      location: 'Garage',
      props: [
        ['BasicState', 'Off', 'Choice(On,Off,Intermediate,Triggered)', 'SC'],
        ['PortClosed', 'True', B, 'S'],
      ],
    }),
    device({
      uuid: UUID.generic,
      name: 'Arrosage',
      model: 'generic',
      location: 'Jardin',
      params: [
        ['StartText', 'Activé'],
        ['StopText', 'Désactivé'],
      ],
      props: [
        ['BasicState', 'Off', ROUTINE, 'SC'],
        ['StartActive', 'False', B, 'S'],
        ['AllStarted', 'False', B, 'S'],
      ],
    }),
    device({
      uuid: UUID.mood,
      name: 'Soirée',
      model: 'comfort',
      props: [
        ['MoodActive', 'False', B, 'S'],
        ['AllStarted', 'False', B, 'S'],
        ['BasicState', 'Off', ROUTINE, 'SC'],
      ],
    }),
    device({
      uuid: UUID.alloff,
      name: 'Tout éteint',
      model: 'alloff',
      location: 'Entrée',
      props: [
        ['AllOffActive', 'False', B, 'S'],
        ['BasicState', 'Off', ROUTINE, 'SC'],
      ],
    }),
    device({
      uuid: UUID.pir,
      name: 'Détecteur couloir',
      model: 'pir',
      location: 'Couloir',
      props: [['BasicState', 'On', ROUTINE, 'SC']],
    }),
    device({
      uuid: UUID.bell,
      name: 'Sonnette',
      model: 'bellbutton',
      location: 'Entrée',
      params: [['Ringtone', 'Dunes']],
      props: [
        ['BasicState', 'Off', ROUTINE, 'SC'],
        ['Doorlock', 'Closed', 'Choice(Open,Closed)', 'SC'],
        ['CallPending', 'False', B, 'S'],
      ],
    }),
    device({
      uuid: UUID.fan,
      name: 'VMC',
      model: 'fan',
      location: 'Buanderie',
      props: [['FanSpeed', 'Low', 'Choice(Low,Medium,High,Boost)', 'SC']],
    }),
    device({
      uuid: UUID.flag,
      name: 'Mode vacances',
      type: 'virtual',
      model: 'flag',
      props: [['Status', 'False', B, 'SC']],
    }),
    device({
      uuid: UUID.thermostat,
      name: 'Thermostat',
      type: 'thermostat',
      model: 'thermostat',
      traits: [['MacAddress', '00a1b2c3']],
      props: [
        ['Program', 'Day', 'Choice(Day,Night,Eco,Off,Cool,Prog1,Prog2,Prog3)', 'SC'],
        ['AmbientTemperature', '20.5', 'Range(-5,45,0.5)', 'S'],
        ['SetpointTemperature', '21', 'Range(5,30,0.5)', 'S'],
        ['OverruleActive', 'False', B, 'SC'],
        ['OverruleSetpoint', '0', 'Range(5,30,0.5)', 'SC'],
        ['OverruleTime', '0', 'Range(1,1439,1)', 'SC'],
        ['EcoSave', 'False', B, 'SC'],
        ['Demand', 'Heating', 'Choice(Heating,Cooling,None)', 'S'],
      ],
    }),
    device({
      uuid: UUID.hvac,
      name: 'Climatisation',
      type: 'hvac',
      model: 'hvacthermostat',
      location: 'Chambre',
      props: [
        ['Program', 'Custom', 'Choice(Day,Night,Custom,Prog1,Prog2)', 'SC'],
        ['AmbientTemperature', '23.4', 'Range(0,50,0.1)', 'SC'],
        ['SetpointTemperature', '22', 'Range(5,30,1)', 'S'],
        ['OverruleActive', 'False', B, 'SC'],
        ['OverruleSetpoint', '22', 'Range(5,30,1)', 'SC'],
        ['OverruleTime', '60', 'Range(1,1439,1)', 'SC'],
        ['EcoSave', 'False', B, 'SC'],
        ['ProtectMode', 'False', B, 'SC'],
        ['OperationMode', 'Cooling', 'Choice(Heating,Cooling)', 'SC'],
        ['FanSpeed', 'Medium', 'Choice(Low,Medium,High)', 'SC'],
        ['ThermostatOn', 'On', ONOFF, 'SC'],
        ['HvacOn', 'On', ONOFF, 'S'],
      ],
    }),
    device({
      uuid: UUID.meter,
      name: 'Compteur général',
      type: 'centralmeter',
      model: 'electricity-clamp',
      location: 'Garage',
      traits: [['MeterType', 'Electricity']],
      params: [
        ['Flow', 'Consumer'],
        ['Segment', 'Central'],
        ['ClampType', '63A'],
        ['Inverted', 'false'],
      ],
      props: [
        ['ElectricalEnergy', undefined, 'Range(-5461,5461,0.001)', ''],
        ['ElectricalPower', '', 'Range(-201326,201326,0.001)', 'S'],
        ['ReportInstantUsage', 'False', B, 'SC'],
      ],
    }),
    device({
      uuid: UUID.solar,
      name: 'Panneaux solaires',
      type: 'centralmeter',
      technology: 'zigbee',
      model: 'electricity-clamp',
      location: 'Garage',
      params: [
        ['Flow', 'Producer'],
        ['Segment', 'Central'],
        ['InverterType', 'Production'],
      ],
      props: [
        ['ElectricalPower', '-1520.5', 'Range(-201326,201326,0.001)', 'S'],
        ['ReportInstantUsage', 'True', B, 'SC'],
      ],
    }),
    device({
      uuid: UUID.plug,
      name: 'Lave-linge',
      type: 'smartplug',
      technology: 'zigbee',
      model: 'naso',
      location: 'Buanderie',
      params: [
        ['MeasuringOnly', 'false'],
        ['SwitchingOnly', 'false'],
      ],
      props: [
        ['Status', 'On', ONOFF, 'SC'],
        ['ElectricalPower', '1980.000', 'Range(-201326,201326,0.001)', 'S'],
        ['ReportInstantUsage', 'False', B, 'SC'],
      ],
    }),
    device({
      uuid: UUID.thermometer,
      name: 'Sonde',
      type: 'thermometer',
      model: 'generic',
      location: 'Cave',
      props: [['AmbientTemperature', '13.2', 'Range(-50,100,0.1)', 'S']],
    }),
    // Hardware: no properties in the Hobby API (left out).
    device({ uuid: UUID.panel, name: 'Poussoir quadruple', type: 'panel', model: 'pushbuttonx4' }),
    // A device with a state of a kind not supported yet.
    device({
      uuid: UUID.audio,
      name: 'Enceinte',
      model: 'audiocontrol',
      props: [
        ['Status', 'On', ONOFF, 'SC'],
        ['Volume', '30', 'Range(0,100,1)', 'SC'],
      ],
    }),
    // An action whose module does not answer (Online "False").
    device({
      uuid: UUID.offline,
      name: 'Applique',
      model: 'light',
      location: 'Chambre',
      online: 'False',
      props: [['Status', 'Off', ONOFF, 'SC']],
    }),
    // The firmware of the controller: not a device for Gladys.
    device({
      uuid: UUID.firmware,
      name: 'Firmware',
      type: 'gatewayfw',
      technology: 'firmware',
      model: 'generic',
      props: [['UpgradeStatus', 'Idle', 'Choice(Idle,Installing)', 'SC']],
    }),
  ];
}

/** The answer to systeminfo.publish (shape of the documentation, values invented). */
export const SYSTEM_INFO = {
  Method: 'systeminfo.publish',
  Params: [
    {
      SystemInfo: [
        {
          LastConfig: '20261012183000',
          WaterTariff: '0',
          Currency: 'EUR',
          Units: '0',
          Language: 'FR',
          SWversions: [{ NhcVersion: '2.27.1.0' }, { CocoImage: '2026.3-20261001093000' }],
          ElectricityTariff: '0.25',
          GasTariff: '0',
        },
      ],
    },
  ],
};

/** time.published, every 30 s on hobby/system/evt. */
export const timeEvent = (date = new Date(NOW)) => ({
  Method: 'time.published',
  Params: [
    {
      TimeInfo: [
        {
          GMTOffset: '7200',
          Timezone: 'Europe/Brussels',
          IsDST: '1',
          UTCTime: date.toISOString().replace(/\D/g, '').slice(0, 14),
        },
      ],
    },
  ],
});

/**
 * A 25-byte reply to the UDP discovery, as the references read it (byte 0
 * 0x44, bytes 0-5 the id, 6-9 the IPv4 address, byte 15 the generation, then
 * four uint16 LE of version).
 */
export function discoveryReply(ip, { generation = 2, version = [2, 27, 1, 0] } = {}) {
  const buffer = Buffer.alloc(25);
  buffer[0] = 0x44;
  buffer[1] = 0x3b;
  buffer.writeUInt32BE(0x00870a12, 2);
  ip.split('.').forEach((octet, i) => {
    buffer[6 + i] = Number(octet);
  });
  [255, 255, 255, 0].forEach((octet, i) => {
    buffer[10 + i] = octet;
  });
  buffer[15] = generation === 2 ? 2 : 1;
  version.forEach((part, i) => buffer.writeUInt16LE(part, 17 + 2 * i));
  return buffer;
}
