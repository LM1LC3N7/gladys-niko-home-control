// -----------------------------------------------------------------------------
// Niko devices -> Gladys devices and routing tables (pure).
//
// One Gladys device per Niko "device" that has a state: the actions
// (routines) of the installation (lights, dimmers, motors, free functions,
// moods, all-off...), virtual flags, thermostats, meters, smart plugs and
// sensors. The hardware itself (modules, push buttons, detectors) has no
// properties in the Hobby API and is left out. External ids:
//   device  ext:<selector>:nhc:<Niko Uuid>
//   feature <device>:<key>
// Which features a device gets depends on its Type/Model AND on the properties
// it declares (PropertyDefinitions), so a partial or newer device still maps.
// Value conventions: Gladys core server/utils/constants.js (src/constants.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  BUTTON_PUSH,
  COVER_STATE,
  DOORBELL_RING,
  LIMITS,
  LOCK_STATE,
  OPENING_SENSOR_STATE,
  THERMOSTAT_MODE,
  THERMOSTAT_OPERATING_STATE,
} from './constants.js';
import { choiceLabel, nameOf } from './i18n.js';
import { isTrue } from './nhc2/protocol.js';

const RELAYS = new Set(['light', 'socket', 'switched-generic', 'switched-fan']);
const MOTORS = new Set([
  'rolldownshutter',
  'sunblind',
  'venetianblind',
  'gate',
  'velux',
  'reynaers',
]);
/** Routines whose BasicState is toggled by "Triggered"; true: also a "Run" push button. */
const ROUTINES = {
  generic: true,
  comfort: true,
  alloff: true,
  overallcomfort: true,
  simulation: false,
  condition: false,
  pir: false,
  peakmode: false,
  solarmode: false,
  alarms: false,
};
/** The controller's own firmware (upgrade status): not a device for Gladys. */
const IGNORED_TYPES = new Set(['gatewayfw']);
const THERMOSTAT_TYPES = new Set(['thermostat', 'thermostatpanel', 'hvacthermostatpanel']);
const METER_TYPES = new Set(['centralmeter', 'smartplug', 'energyhome']);
/** Device types that carry measurements only (read when they report them). */
const SENSOR_TYPES = new Set([
  'thermometer',
  'multisensor',
  'togglerocker',
  'humiditysensor',
  'sensors',
]);

const cut = (text, max = 100) => String(text ?? '').slice(0, max);
const num = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** A Gladys value -> a Niko number string on the property's grid, within its bounds. */
export function toNikoNumber(value, grammar = {}) {
  let n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`not a number: ${value}`);
  }
  const step = grammar.step > 0 ? grammar.step : 1;
  if (Number.isFinite(grammar.min)) {
    n = Math.max(grammar.min, n);
  }
  if (Number.isFinite(grammar.max)) {
    n = Math.min(grammar.max, n);
  }
  n = Math.round(n / step) * step;
  const decimals = (String(step).split('.')[1] ?? '').length;
  return String(Number(n.toFixed(decimals)));
}

/** The name of a device in Gladys: Niko names repeat from room to room ("Light"). */
export function deviceName(device) {
  const location = device.parameters.LocationName?.trim();
  return cut(location && location !== device.name ? `${device.name} (${location})` : device.name);
}

/** "type/technology/model", how the logs and the counters name a kind of device. */
export const kindOf = (device) => `${device.type}/${device.technology}/${device.model}`;

class Mapper {
  constructor(device, { language, overruleMinutes }) {
    this.d = device;
    this.language = language;
    this.overruleMinutes = overruleMinutes;
    this.features = [];
    this.readers = [];
    this.writers = {};
    this.throttled = new Set();
    this.instantUsage = false;
  }

  name(key) {
    return nameOf(key, this.language);
  }

  /** The property exists (declared, or at least reported). */
  has(prop) {
    return prop in this.d.definitions || prop in this.d.properties;
  }

  /** The property reports its value. */
  reports(prop) {
    const definition = this.d.definitions[prop];
    return definition ? definition.status : prop in this.d.properties;
  }

  /** The property can be set. */
  controls(prop) {
    const definition = this.d.definitions[prop];
    return definition ? definition.control : false;
  }

  grammar(prop) {
    return this.d.definitions[prop]?.grammar ?? {};
  }

  choices(prop, fallback = []) {
    const grammar = this.grammar(prop);
    return grammar.kind === 'choice' && grammar.options.length > 0 ? grammar.options : fallback;
  }

  /**
   * @param {string} key feature key (frozen: part of the external id)
   * @param {string} name feature name
   * @param {object} spec category, type, min, max, unit, supported_options
   * @param {object} handlers
   *   read(device) -> { state } | { text } | null, from the properties `props`;
   *   event(device) -> value | null, a press (never at the device list);
   *   write(value, device) -> [[property, value]...]
   */
  add(key, name, spec, { props = [], read, event, write, throttle = false, text = false } = {}) {
    if (this.features.some((f) => f.key === key)) {
      return;
    }
    const feature = {
      key,
      name: cut(name),
      category: spec.category,
      type: spec.type,
      min: spec.min ?? 0,
      max: spec.max ?? 1,
      read_only: !write,
      has_feedback: Boolean(write && (read || event)),
      keep_history: !text && !spec.noHistory,
    };
    if (spec.unit) {
      feature.unit = spec.unit;
    }
    if (spec.supported_options) {
      feature.supported_options = spec.supported_options;
    }
    this.features.push(feature);
    if (read || event) {
      this.readers.push({ key, props, read, event });
    }
    if (write) {
      this.writers[key] = { write, text };
    }
    if (throttle) {
      this.throttled.add(key);
    }
  }

  onOff(key, name, category, type, prop, on = 'On', off = 'Off') {
    this.add(
      key,
      name,
      { category, type, min: 0, max: 1 },
      {
        props: [prop],
        read: (d) => {
          // Booleans are "True"/"False", sometimes in lower case.
          const v = String(d.properties[prop] ?? '').toLowerCase();
          if (v === on.toLowerCase()) {
            return { state: 1 };
          }
          return v === off.toLowerCase() ? { state: 0 } : null;
        },
        write: this.controls(prop) ? (value) => [[prop, Number(value) ? on : off]] : undefined,
      },
    );
  }

  /** A measurement reported by the device (W, °C, %). */
  measure(key, name, spec, prop, transform = (n) => n) {
    if (!this.reports(prop)) {
      return;
    }
    const grammar = this.grammar(prop);
    this.add(
      key,
      name,
      {
        min: Number.isFinite(grammar.min) ? transform(grammar.min) : 0,
        max: Number.isFinite(grammar.max) ? transform(grammar.max) : 100,
        ...spec,
      },
      {
        props: [prop],
        read: (d) => {
          const n = num(d.properties[prop]);
          return n === undefined ? null : { state: transform(n) };
        },
        throttle: true,
      },
    );
  }

  /** A choice of strings (programs, fan speeds): a select with Niko's options. */
  select(key, name, prop, fallback, writeProps = (value) => [[prop, value]]) {
    const options = this.choices(prop, fallback);
    if (options.length === 0 || !this.has(prop)) {
      return;
    }
    this.add(
      key,
      name,
      {
        category: C.TEXT,
        type: T.TEXT.SELECT,
        min: 0,
        max: 0,
        supported_options: options.map((value) => ({
          value,
          label: choiceLabel(value, this.language),
        })),
      },
      {
        props: [prop],
        text: true,
        read: (d) => (d.properties[prop] ? { text: cut(d.properties[prop], LIMITS.text) } : null),
        write: this.controls(prop)
          ? (value) => {
              const wanted = String(value);
              if (!options.includes(wanted)) {
                throw new Error(`${wanted} is not one of ${options.join(', ')}`);
              }
              return writeProps(wanted);
            }
          : undefined,
      },
    );
  }

  // --- Kinds of devices -------------------------------------------------------------

  map() {
    const d = this.d;
    if (d.type === 'action' || d.type === 'relay' || d.type === 'virtual') {
      if (RELAYS.has(d.model) || (d.type === 'relay' && this.has('Status'))) {
        this.relay();
      } else if (d.model === 'flag') {
        this.onOff(
          'binary',
          this.name('binary'),
          C.SWITCH,
          T.SWITCH.BINARY,
          'Status',
          'True',
          'False',
        );
      } else if (d.model === 'dimmer') {
        this.dimmer();
      } else if (MOTORS.has(d.model)) {
        this.motor();
      } else if (d.model === 'garagedoor') {
        this.garageDoor();
      } else if (d.model === 'bellbutton' || d.model === 'accesscontrol') {
        this.access();
      } else if (d.model in ROUTINES) {
        this.routine(ROUTINES[d.model]);
      } else if (d.model === 'fan') {
        this.select('speed', this.name('speed'), 'FanSpeed', ['Low', 'Medium', 'High', 'Boost']);
      }
    } else if (THERMOSTAT_TYPES.has(d.type) || d.type === 'hvac') {
      this.thermostat();
    } else if (METER_TYPES.has(d.type)) {
      this.meter();
    } else if (SENSOR_TYPES.has(d.type)) {
      this.sensors();
    }
    return this;
  }

  relay() {
    const light = this.d.model === 'light';
    this.onOff(
      'binary',
      this.name('binary'),
      light ? C.LIGHT : C.SWITCH,
      light ? T.LIGHT.BINARY : T.SWITCH.BINARY,
      'Status',
    );
  }

  dimmer() {
    this.onOff('binary', this.name('binary'), C.LIGHT, T.LIGHT.BINARY, 'Status');
    if (!this.has('Brightness')) {
      return;
    }
    const grammar = this.grammar('Brightness');
    this.add(
      'brightness',
      this.name('brightness'),
      { category: C.LIGHT, type: T.LIGHT.BRIGHTNESS, min: 0, max: 100, unit: U.PERCENT },
      {
        props: ['Brightness'],
        read: (d) => {
          const n = num(d.properties.Brightness);
          return n === undefined ? null : { state: Math.round(n) };
        },
        // Brightness 0 is "no visible light", not off (Niko). A dimmer that is
        // off is switched on first, in the same message (openHAB's order).
        write: this.controls('Brightness')
          ? (value, d) => {
              const level = toNikoNumber(value, { min: 0, max: 100, ...grammar });
              return d.properties.Status === 'On' || Number(level) === 0
                ? [['Brightness', level]]
                : [
                    ['Status', 'On'],
                    ['Brightness', level],
                  ];
            }
          : undefined,
      },
    );
  }

  motor() {
    const category = this.d.model === 'sunblind' ? C.CURTAIN : C.SHUTTER;
    const types = category === C.CURTAIN ? T.CURTAIN : T.SHUTTER;
    if (this.has('Action')) {
      this.add(
        'state',
        this.name('state'),
        { category, type: types.STATE, min: -1, max: 1, noHistory: true },
        {
          props: ['Moving', 'LastDirection'],
          // While moving, the direction; at rest, stopped. No Moving: write only.
          read: this.has('Moving')
            ? (d) => {
                if (d.properties.Moving === undefined || d.properties.Moving === '') {
                  return null;
                }
                if (!isTrue(d.properties.Moving)) {
                  return { state: COVER_STATE.STOP };
                }
                if (d.properties.LastDirection === 'Open') {
                  return { state: COVER_STATE.OPEN };
                }
                return d.properties.LastDirection === 'Close' ? { state: COVER_STATE.CLOSE } : null;
              }
            : undefined,
          write: (value) => {
            const wanted = Number(value);
            if (wanted === COVER_STATE.OPEN) {
              return [['Action', 'Open']];
            }
            if (wanted === COVER_STATE.CLOSE) {
              return [['Action', 'Close']];
            }
            if (wanted === COVER_STATE.STOP) {
              return [['Action', 'Stop']];
            }
            throw new Error(`unknown cover command ${value}`);
          },
        },
      );
    }
    if (this.has('Position')) {
      const grammar = this.grammar('Position');
      this.add(
        'position',
        this.name('position'),
        // Niko: 100 = open, 0 = closed, as Gladys.
        { category, type: types.POSITION, min: 0, max: 100, unit: U.PERCENT },
        {
          props: ['Position'],
          read: (d) => {
            const n = num(d.properties.Position);
            return n === undefined ? null : { state: Math.round(n) };
          },
          write: this.controls('Position')
            ? (value) => [['Position', toNikoNumber(value, { min: 0, max: 100, ...grammar })]]
            : undefined,
        },
      );
    }
  }

  garageDoor() {
    if (this.controls('BasicState')) {
      this.add(
        'run',
        this.name('operate'),
        { category: C.BUTTON, type: T.BUTTON.PUSH, min: 0, max: 1, noHistory: true },
        { write: () => [['BasicState', 'Triggered']] },
      );
    }
    const portClosed = this.reports('PortClosed');
    this.add(
      'closed',
      this.name('closed'),
      { category: C.OPENING_SENSOR, type: T.SENSOR.BINARY, min: 0, max: 1 },
      {
        props: [portClosed ? 'PortClosed' : 'BasicState'],
        read: (d) => {
          if (portClosed) {
            const v = d.properties.PortClosed;
            if (v === undefined || v === '') {
              return null;
            }
            return { state: isTrue(v) ? OPENING_SENSOR_STATE.CLOSE : OPENING_SENSOR_STATE.OPEN };
          }
          // On = open, Off = closed, Intermediate = moving (kept as it was).
          if (d.properties.BasicState === 'On') {
            return { state: OPENING_SENSOR_STATE.OPEN };
          }
          return d.properties.BasicState === 'Off' ? { state: OPENING_SENSOR_STATE.CLOSE } : null;
        },
      },
    );
  }

  /** Bell buttons and access control: the ring (an event) and the door lock. */
  access() {
    const bell = this.d.model === 'bellbutton';
    const prop = bell ? 'BasicState' : 'CallPending';
    if (this.reports(prop)) {
      this.add(
        'ring',
        this.name('ring'),
        { category: C.DOORBELL, type: T.DOORBELL.RING, min: 0, max: 1, noHistory: true },
        {
          props: [prop],
          // "On" while the bell button is pressed (CallPending True: a call waits).
          event: (d) =>
            (bell ? d.properties.BasicState === 'On' : isTrue(d.properties.CallPending))
              ? DOORBELL_RING
              : null,
        },
      );
    }
    if (this.has('Doorlock')) {
      this.add(
        'doorlock',
        this.name('doorlock'),
        { category: C.LOCK, type: T.LOCK.BINARY, min: 0, max: 1 },
        {
          props: ['Doorlock'],
          read: (d) => {
            if (d.properties.Doorlock === 'Closed') {
              return { state: LOCK_STATE.LOCKED };
            }
            return d.properties.Doorlock === 'Open' ? { state: LOCK_STATE.UNLOCKED } : null;
          },
          // The door locks again by itself after the delay of the routine.
          write: this.controls('Doorlock')
            ? (value) => (Number(value) === LOCK_STATE.UNLOCKED ? [['Doorlock', 'Open']] : [])
            : undefined,
        },
      );
    }
  }

  /** A routine: its state (On/Off), set by "Triggered" when it differs, and a Run button. */
  routine(withRun) {
    if (!this.has('BasicState')) {
      return;
    }
    const control = this.controls('BasicState');
    this.add(
      'active',
      this.name(this.d.model === 'pir' ? 'detection' : 'active'),
      { category: C.SWITCH, type: T.SWITCH.BINARY, min: 0, max: 1 },
      {
        props: ['BasicState'],
        read: (d) => {
          if (d.properties.BasicState === 'On') {
            return { state: 1 };
          }
          return d.properties.BasicState === 'Off' ? { state: 0 } : null;
        },
        write: control
          ? (value, d) => {
              const wanted = Number(value) ? 'On' : 'Off';
              return d.properties.BasicState === wanted ? [] : [['BasicState', 'Triggered']];
            }
          : undefined,
      },
    );
    if (withRun && control) {
      this.add(
        'run',
        this.name('run'),
        { category: C.BUTTON, type: T.BUTTON.PUSH, min: 0, max: 1, noHistory: true },
        {
          write: (value) =>
            Number(value) === BUTTON_PUSH.PRESSED ? [['BasicState', 'Triggered']] : [],
        },
      );
    }
  }

  thermostat() {
    this.measure(
      'temperature',
      this.name('temperature'),
      { category: C.TEMPERATURE_SENSOR, type: T.SENSOR.DECIMAL, unit: U.CELSIUS },
      'AmbientTemperature',
    );
    this.measure(
      'humidity',
      this.name('humidity'),
      { category: C.HUMIDITY_SENSOR, type: T.SENSOR.DECIMAL, unit: U.PERCENT, min: 0, max: 100 },
      'Humidity',
    );
    this.setpoint();
    this.thermostatMode();
    this.operatingState();
    if (this.has('Program')) {
      this.select('program', this.name('program'), 'Program', [], (value) =>
        this.controls('OverruleActive')
          ? [
              ['OverruleActive', 'False'],
              ['Program', value],
            ]
          : [['Program', value]],
      );
    }
    if (this.controls('OverruleActive')) {
      this.add(
        'overrule',
        this.name('overrule'),
        { category: C.SWITCH, type: T.SWITCH.BINARY, min: 0, max: 1 },
        {
          props: ['OverruleActive'],
          read: (d) =>
            d.properties.OverruleActive
              ? { state: isTrue(d.properties.OverruleActive) ? 1 : 0 }
              : null,
          write: (value) =>
            Number(value)
              ? [
                  ['OverruleActive', 'True'],
                  ['OverruleTime', String(this.overruleMinutes)],
                ]
              : [['OverruleActive', 'False']],
        },
      );
    }
    if (this.has('EcoSave')) {
      this.onOff('eco', this.name('eco'), C.SWITCH, T.SWITCH.BINARY, 'EcoSave', 'True', 'False');
    }
    if (this.has('FanSpeed')) {
      this.select('fan', this.name('fan'), 'FanSpeed', ['Low', 'Medium', 'High']);
    }
  }

  setpoint() {
    const overrule = this.controls('OverruleSetpoint');
    if (!this.has('SetpointTemperature') && !overrule) {
      return;
    }
    const grammar = overrule
      ? this.grammar('OverruleSetpoint')
      : this.grammar('SetpointTemperature');
    const bounds = {
      min: Number.isFinite(grammar.min) ? grammar.min : 5,
      max: Number.isFinite(grammar.max) ? grammar.max : 30,
      step: grammar.step > 0 ? grammar.step : 0.5,
    };
    let write;
    if (overrule) {
      // A setpoint from Gladys is a temporary one (the "overrule" of the
      // thermostat), for the configured duration, as openHAB does.
      write = (value) => [
        ['OverruleActive', 'True'],
        ['OverruleSetpoint', toNikoNumber(value, bounds)],
        ['OverruleTime', String(this.overruleMinutes)],
      ];
    } else if (this.controls('SetpointTemperature')) {
      write = (value) => [['SetpointTemperature', toNikoNumber(value, bounds)]];
    }
    this.add(
      'setpoint',
      this.name('setpoint'),
      {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.TARGET_TEMPERATURE,
        min: bounds.min,
        max: bounds.max,
        unit: U.CELSIUS,
      },
      {
        props: ['SetpointTemperature'],
        read: (d) => {
          const n = num(d.properties.SetpointTemperature);
          return n === undefined ? null : { state: n };
        },
        write,
      },
    );
  }

  thermostatMode() {
    const programs = this.choices('Program');
    const add = (props, read, write) =>
      this.add(
        'mode',
        this.name('mode'),
        { category: C.THERMOSTAT, type: T.THERMOSTAT.MODE, min: 0, max: 3 },
        { props, read, write },
      );
    if (this.has('ThermostatOn')) {
      // HVAC thermostats: on/off and heating or cooling.
      add(
        ['ThermostatOn', 'OperationMode'],
        (d) => {
          if (d.properties.ThermostatOn === 'Off') {
            return { state: THERMOSTAT_MODE.OFF };
          }
          if (d.properties.OperationMode === 'Heating') {
            return { state: THERMOSTAT_MODE.HEATING };
          }
          return d.properties.OperationMode === 'Cooling'
            ? { state: THERMOSTAT_MODE.COOLING }
            : null;
        },
        this.controls('ThermostatOn')
          ? (value) => {
              const mode = Number(value);
              if (mode === THERMOSTAT_MODE.OFF) {
                return [['ThermostatOn', 'Off']];
              }
              if (mode === THERMOSTAT_MODE.HEATING || mode === THERMOSTAT_MODE.COOLING) {
                return [
                  ['ThermostatOn', 'On'],
                  ['OperationMode', mode === THERMOSTAT_MODE.HEATING ? 'Heating' : 'Cooling'],
                ];
              }
              throw new Error('this thermostat has no automatic mode: use its program');
            }
          : undefined,
      );
      return;
    }
    if (programs.includes('Off')) {
      // NHC thermostats: the mode is the program. Off; Cool; a weekly program
      // (ProgN) = automatic; any other one (Day, Night, Eco) = heating.
      const weekly = programs.find((p) => /^Prog\d$/.test(p));
      const heating = programs.includes('Day')
        ? 'Day'
        : programs.find((p) => !/^(Off|Cool|Prog\d)$/.test(p));
      const modeOf = (program) => {
        if (!program) {
          return undefined;
        }
        if (program === 'Off') {
          return THERMOSTAT_MODE.OFF;
        }
        if (program === 'Cool') {
          return THERMOSTAT_MODE.COOLING;
        }
        return /^Prog\d$/.test(program) ? THERMOSTAT_MODE.AUTO : THERMOSTAT_MODE.HEATING;
      };
      add(
        ['Program'],
        (d) => {
          const mode = modeOf(d.properties.Program);
          return mode === undefined ? null : { state: mode };
        },
        this.controls('Program')
          ? (value, d) => {
              const mode = Number(value);
              const program = {
                [THERMOSTAT_MODE.OFF]: 'Off',
                [THERMOSTAT_MODE.HEATING]: heating,
                [THERMOSTAT_MODE.COOLING]: programs.includes('Cool') ? 'Cool' : undefined,
                [THERMOSTAT_MODE.AUTO]: weekly,
              }[mode];
              if (!program) {
                throw new Error('this thermostat has no program for this mode');
              }
              // Already in the mode (Night is heating too): keep its program.
              if (modeOf(d.properties.Program) === mode) {
                return [];
              }
              return this.controls('OverruleActive')
                ? [
                    ['OverruleActive', 'False'],
                    ['Program', program],
                  ]
                : [['Program', program]];
            }
          : undefined,
      );
      return;
    }
    if (this.has('Status') && this.has('OperationMode')) {
      // Zigbee and partner HVAC: on/off, the mode is read only.
      add(
        ['Status', 'OperationMode'],
        (d) => {
          if (d.properties.Status === 'Off') {
            return { state: THERMOSTAT_MODE.OFF };
          }
          if (/^Heat/.test(d.properties.OperationMode ?? '')) {
            return { state: THERMOSTAT_MODE.HEATING };
          }
          return /^Cool/.test(d.properties.OperationMode ?? '')
            ? { state: THERMOSTAT_MODE.COOLING }
            : null;
        },
        this.controls('Status')
          ? (value) => [['Status', Number(value) === THERMOSTAT_MODE.OFF ? 'Off' : 'On']]
          : undefined,
      );
    }
  }

  operatingState() {
    if (this.reports('Demand')) {
      this.add(
        'activity',
        this.name('activity'),
        { category: C.THERMOSTAT, type: T.THERMOSTAT.OPERATING_STATE, min: 0, max: 2 },
        {
          props: ['Demand'],
          read: (d) => {
            const state = {
              Heating: THERMOSTAT_OPERATING_STATE.HEATING,
              Cooling: THERMOSTAT_OPERATING_STATE.COOLING,
              None: THERMOSTAT_OPERATING_STATE.IDLE,
            }[d.properties.Demand];
            return state === undefined ? null : { state };
          },
        },
      );
    } else if (this.reports('HvacOn')) {
      this.add(
        'activity',
        this.name('activity'),
        { category: C.THERMOSTAT, type: T.THERMOSTAT.OPERATING_STATE, min: 0, max: 2 },
        {
          props: ['HvacOn', 'OperationMode'],
          read: (d) => {
            if (d.properties.HvacOn === 'Off') {
              return { state: THERMOSTAT_OPERATING_STATE.IDLE };
            }
            if (d.properties.HvacOn !== 'On') {
              return null;
            }
            return {
              state:
                d.properties.OperationMode === 'Cooling'
                  ? THERMOSTAT_OPERATING_STATE.COOLING
                  : THERMOSTAT_OPERATING_STATE.HEATING,
            };
          },
        },
      );
    }
  }

  meter() {
    const d = this.d;
    if (d.type === 'smartplug' && this.has('Status')) {
      const measuringOnly = isTrue(d.parameters.MeasuringOnly);
      this.onOff('binary', this.name('binary'), C.SWITCH, T.SWITCH.BINARY, 'Status');
      if (measuringOnly) {
        // Always on, not switchable (Niko).
        delete this.writers.binary;
        this.features.find((f) => f.key === 'binary').read_only = true;
      }
    }
    const power = { type: T.ENERGY_SENSOR.POWER, unit: U.WATT };
    if (d.type === 'energyhome') {
      this.measure(
        'from-grid',
        this.name('fromGrid'),
        { category: C.GRID_SENSOR, type: T.GRID_SENSOR.INPUT_POWER, unit: U.WATT },
        'ElectricalPowerFromGrid',
      );
      this.measure(
        'to-grid',
        this.name('toGrid'),
        { category: C.GRID_SENSOR, type: T.GRID_SENSOR.OUTPUT_POWER, unit: U.WATT },
        'ElectricalPowerToGrid',
      );
      this.measure(
        'power',
        this.name('power'),
        { category: C.ENERGY_SENSOR, ...power },
        'ElectricalPowerConsumption',
      );
      this.measure(
        'production',
        this.name('production'),
        { category: C.ENERGY_PRODUCTION_SENSOR, ...power },
        'ElectricalPowerProduction',
      );
    } else if (!isTrue(d.parameters.SwitchingOnly)) {
      if (d.parameters.Flow === 'Producer') {
        // A production clamp (solar inverter): Gladys wants a positive power.
        this.measure(
          'power',
          this.name('production'),
          { category: C.ENERGY_PRODUCTION_SENSOR, ...power, min: 0 },
          'ElectricalPower',
          Math.abs,
        );
      } else {
        this.measure(
          'power',
          this.name('power'),
          { category: C.ENERGY_SENSOR, ...power },
          'ElectricalPower',
        );
      }
    }
    // Live power stops 30 s after it was asked: the app asks again while the device exists.
    this.instantUsage = this.controls('ReportInstantUsage') && this.throttled.size > 0;
  }

  sensors() {
    this.measure(
      'temperature',
      this.name('temperature'),
      { category: C.TEMPERATURE_SENSOR, type: T.SENSOR.DECIMAL, unit: U.CELSIUS },
      'AmbientTemperature',
    );
    this.measure(
      'humidity',
      this.name('humidity'),
      { category: C.HUMIDITY_SENSOR, type: T.SENSOR.DECIMAL, unit: U.PERCENT, min: 0, max: 100 },
      'Humidity',
    );
  }
}

/** The features of one Niko device (pure; exported for the tests). */
export function mapDevice(device, options = {}) {
  return new Mapper(device, {
    language: options.language ?? 'en',
    overruleMinutes: options.overruleMinutes ?? 60,
  }).map();
}

const paramsOf = (device) =>
  [
    { name: 'NIKO_UUID', value: device.uuid },
    { name: 'NIKO_MODEL', value: kindOf(device) },
    { name: 'NIKO_LOCATION', value: device.parameters.LocationName },
  ]
    .filter((p) => p.value !== undefined && p.value !== null && String(p.value) !== '')
    .map((p) => ({ name: p.name, value: cut(p.value, 255) }));

export function emptyModel() {
  return {
    devices: [],
    /** uuid -> [{ featureId, props, read, event }] */
    readers: new Map(),
    /** feature id -> { uuid, write, text } */
    writers: new Map(),
    throttled: new Set(),
    /** device external id -> uuid */
    deviceUuid: new Map(),
    /** uuids of the meters whose live power has to be asked again and again */
    instantUsage: new Set(),
    /** "type/technology/model" -> count, of the devices with a state that do not map */
    unsupported: new Map(),
    counts: { devices: 0, offered: 0, empty: 0, overflow: 0 },
  };
}

/**
 * @param {(uuid: string) => { device: string, feature: (key: string) => string }} idsOf
 *   the external ids of one device (gladys.externalIds('nhc', uuid))
 * @param {Iterable<object>} devices parsed Niko devices (protocol.js parseDevice)
 * @param {{ language?: string, overruleMinutes?: number }} options
 */
export function buildModel(idsOf, devices, options = {}) {
  const model = emptyModel();
  for (const device of devices) {
    model.counts.devices += 1;
    if (IGNORED_TYPES.has(device.type)) {
      model.counts.empty += 1;
      continue;
    }
    const mapped = mapDevice(device, options);
    if (mapped.features.length === 0) {
      if (Object.keys(device.properties).length > 0 || Object.keys(device.definitions).length > 0) {
        const kind = kindOf(device);
        model.unsupported.set(kind, (model.unsupported.get(kind) ?? 0) + 1);
      } else {
        model.counts.empty += 1;
      }
      continue;
    }
    if (model.devices.length >= LIMITS.devices) {
      model.counts.overflow += 1;
      continue;
    }
    const ids = idsOf(device.uuid);
    model.devices.push({
      name: deviceName(device),
      external_id: ids.device,
      should_poll: false,
      params: paramsOf(device),
      features: mapped.features.map(({ key, ...feature }) => ({
        ...feature,
        external_id: ids.feature(key),
      })),
    });
    model.deviceUuid.set(ids.device, device.uuid);
    model.readers.set(
      device.uuid,
      mapped.readers.map(({ key, ...reader }) => ({ ...reader, featureId: ids.feature(key) })),
    );
    for (const [key, writer] of Object.entries(mapped.writers)) {
      model.writers.set(ids.feature(key), { ...writer, uuid: device.uuid });
    }
    for (const key of mapped.throttled) {
      model.throttled.add(ids.feature(key));
    }
    if (mapped.instantUsage) {
      model.instantUsage.add(device.uuid);
    }
  }
  model.counts.offered = model.devices.length;
  return model;
}
