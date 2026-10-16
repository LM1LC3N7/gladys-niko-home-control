// -----------------------------------------------------------------------------
// A simulated Niko Home Control II controller, as the Hobby API documentation
// describes it: devices.list answered on .../rsp, devices.control applied and
// confirmed by devices.status events carrying the changed properties only (no
// event when nothing changes, nothing for an offline device), errors on
// .../err, systeminfo.publish answered on hobby/system/rsp. Shared by the unit
// tests (in-memory broker) and the end-to-end check against Mosquitto
// (~/gladys-integrations/e2e/niko-sim.mjs). Independent of src/ on purpose.
// -----------------------------------------------------------------------------

import { SYSTEM_INFO, installation, timeEvent } from '../fixtures/niko.js';

const first = (object) => Object.entries(object ?? {})[0] ?? [];

export class SimController {
  /** @param {{ devices?: object[], publish: (topic: string, message: object) => void }} options */
  constructor({ devices = installation(), publish }) {
    this.devices = new Map(devices.map((d) => [d.Uuid, structuredClone(d)]));
    this.publish = publish;
    /** devices.control messages received */
    this.controls = [];
    /** errors published */
    this.errors = [];
    /** Motors reach their target at once (false: they stay moving). */
    this.motorsArrive = true;
  }

  get(uuid, prop) {
    const device = this.devices.get(uuid);
    const entry = (device?.Properties ?? []).find((p) => prop in p);
    return entry ? entry[prop] : undefined;
  }

  definition(uuid, prop) {
    const device = this.devices.get(uuid);
    const entry = (device?.PropertyDefinitions ?? []).find((p) => prop in p);
    return entry ? entry[prop] : undefined;
  }

  /** Sets properties of a device; publishes devices.status with the changed ones. */
  status(uuid, values) {
    const device = this.devices.get(uuid);
    device.Properties ??= [];
    const changed = [];
    for (const [key, value] of Object.entries(values)) {
      const entry = device.Properties.find((p) => key in p);
      if (entry && entry[key] === value) {
        continue;
      }
      if (entry) {
        entry[key] = value;
      } else {
        device.Properties.push({ [key]: value });
      }
      changed.push({ [key]: value });
    }
    if (changed.length > 0) {
      this.event('devices.status', [{ Uuid: uuid, Properties: changed }]);
    }
    return changed.length;
  }

  setOnline(uuid, online) {
    this.devices.get(uuid).Online = online ? 'True' : 'False';
    this.event('devices.status', [{ Uuid: uuid, Online: online ? 'True' : 'False' }]);
  }

  event(method, devices) {
    this.publish('hobby/control/devices/evt', { Method: method, Params: [{ Devices: devices }] });
  }

  time() {
    this.publish('hobby/system/evt', timeEvent());
  }

  /** The configuration was uploaded (Niko's event). */
  configurationChanged() {
    this.publish('hobby/system/evt', { ...SYSTEM_INFO, Method: 'systeminfo.published' });
  }

  error(topic, method, code, message) {
    const error = { ErrMessage: message, ErrCode: code, Method: method };
    this.errors.push(error);
    this.publish(topic.replace(/\/cmd$/, '/err'), error);
  }

  /** A message a client published on a `cmd` topic. */
  handle(topic, payload) {
    let message;
    try {
      message = JSON.parse(String(payload));
    } catch {
      this.error(
        topic,
        'unknown',
        'INVALID_JSON_STRING',
        'Method-field not found within json string',
      );
      return;
    }
    const method = String(message.Method ?? '').trim();
    if (topic === 'hobby/control/devices/cmd' && method === 'devices.list') {
      this.publish('hobby/control/devices/rsp', {
        Method: 'devices.list',
        Params: [{ Devices: [...this.devices.values()].map((d) => structuredClone(d)) }],
      });
    } else if (topic === 'hobby/control/devices/cmd' && method === 'devices.control') {
      this.controls.push(message);
      this.control(topic, message);
    } else if (topic === 'hobby/system/cmd' && method === 'systeminfo.publish') {
      this.publish('hobby/system/rsp', SYSTEM_INFO);
    } else if (topic === 'hobby/system/cmd' && method === 'time.publish') {
      this.time();
    } else {
      this.error(
        topic,
        method || 'unknown',
        'UNKNOWN_METHOD',
        `Method '${method}' not supported for topic '${topic}'`,
      );
    }
  }

  valid(definition, value) {
    const grammar = String(definition.Description ?? '');
    const choice = grammar.match(/^Choice\((.*)\)$/);
    if (choice) {
      return choice[1]
        .split(',')
        .map((o) => o.trim())
        .includes(value);
    }
    const range = grammar.match(/^Range\(([-\d.]+),([-\d.]+),([-\d.]+)\)$/);
    if (range) {
      const n = Number(value);
      return value !== '' && Number.isFinite(n) && n >= Number(range[1]) && n <= Number(range[2]);
    }
    if (grammar === 'Boolean') {
      return value === 'True' || value === 'False';
    }
    return true;
  }

  control(topic, message) {
    for (const entry of message.Params?.[0]?.Devices ?? []) {
      const uuid = entry.Uuid;
      const device = this.devices.get(uuid);
      if (!device) {
        this.error(
          topic,
          'devices.control',
          'INTERNAL_ERROR',
          `No device found with uuid = '${uuid}'`,
        );
        continue;
      }
      if (device.Online === 'False') {
        continue; // Niko: no error and no event for an offline device
      }
      const values = {};
      for (const property of entry.Properties ?? []) {
        const [key, value] = first(property);
        const definition = this.definition(uuid, key);
        if (!definition || definition.CanControl !== 'true' || !this.valid(definition, value)) {
          this.error(
            topic,
            'devices.control',
            'INTERNAL_ERROR',
            `Failed to set property '${key}' to '${value}' for device '${uuid}'`,
          );
          continue;
        }
        values[key] = value;
      }
      this.apply(uuid, values);
    }
  }

  apply(uuid, values) {
    const device = this.devices.get(uuid);
    const next = {};
    for (const [key, value] of Object.entries(values)) {
      if (key === 'Action') {
        if (value === 'Stop') {
          next.Moving = 'False';
        } else {
          this.status(uuid, { Moving: 'True', LastDirection: value });
          if (this.motorsArrive) {
            next.Position = value === 'Open' ? '100' : '0';
            next.Moving = 'False';
          }
        }
      } else if (key === 'Position') {
        const current = Number(this.get(uuid, 'Position'));
        if (current !== Number(value)) {
          this.status(uuid, {
            Moving: 'True',
            LastDirection: Number(value) > current ? 'Open' : 'Close',
          });
          next.Position = value;
          next.Moving = 'False';
        }
      } else if (key === 'BasicState' && value === 'Triggered') {
        if (device.Model === 'garagedoor') {
          const open = this.get(uuid, 'BasicState') === 'On';
          next.BasicState = open ? 'Off' : 'On';
          next.PortClosed = open ? 'True' : 'False';
        } else {
          next.BasicState = this.get(uuid, 'BasicState') === 'On' ? 'Off' : 'On';
        }
      } else if (key === 'Program') {
        next.Program = value;
        if (this.definition(uuid, 'OverruleActive')) {
          next.OverruleActive = 'False';
        }
      } else {
        next[key] = value;
      }
    }
    // The thermostat follows its temporary setpoint while it is active.
    const overrule = next.OverruleActive ?? this.get(uuid, 'OverruleActive');
    if (overrule === 'True' && (next.OverruleSetpoint ?? this.get(uuid, 'OverruleSetpoint'))) {
      next.SetpointTemperature = next.OverruleSetpoint ?? this.get(uuid, 'OverruleSetpoint');
    }
    // A meter asked for live power reports it.
    if (values.ReportInstantUsage === 'True' && this.get(uuid, 'ElectricalPower') === '') {
      next.ElectricalPower = '850.000';
    }
    this.status(uuid, next);
  }
}
