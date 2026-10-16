// -----------------------------------------------------------------------------
// The Hobby API messages, as pure functions (no network here).
//
// Every message is JSON `{ "Method": "...", "Params": [ { "<Key>": [...] } ] }`
// on `hobby/<service>/[<class>/]<cmd|rsp|evt|err>`. Devices, their Traits,
// Parameters, Properties and PropertyDefinitions are lists of single-key
// objects; every value is a string ("True"/"False", "" = unknown yet).
// Written from Niko's Hobby API documentation (PDF v1.4 and the "Motiv
// Building Control API" pages, catalog 2.27.1) and checked against the
// openHAB binding and joleys/niko-home-control-II; nothing is copied from them.
// -----------------------------------------------------------------------------

import { HOBBY_USER } from '../constants.js';

const P = HOBBY_USER;

export const TOPICS = {
  devicesCmd: `${P}/control/devices/cmd`,
  devicesRsp: `${P}/control/devices/rsp`,
  devicesEvt: `${P}/control/devices/evt`,
  devicesErr: `${P}/control/devices/err`,
  systemCmd: `${P}/system/cmd`,
  systemRsp: `${P}/system/rsp`,
  systemEvt: `${P}/system/evt`,
};

/** The topics the integration listens to (it publishes on the `cmd` ones only). */
export const SUBSCRIPTIONS = [
  TOPICS.devicesRsp,
  TOPICS.devicesEvt,
  TOPICS.devicesErr,
  TOPICS.systemRsp,
  TOPICS.systemEvt,
];

export const METHODS = {
  LIST: 'devices.list',
  CONTROL: 'devices.control',
  STATUS: 'devices.status',
  ADDED: 'devices.added',
  REMOVED: 'devices.removed',
  RENAMED: 'devices.displayname_changed',
  CHANGED: 'devices.changed',
  PARAMS: 'devices.param_changed',
  SYSINFO: 'systeminfo.publish',
  SYSINFO_EVENT: 'systeminfo.published',
  TIME: 'time.published',
};

/** `"True"`, `"true"`, `true` -> true. */
export const isTrue = (value) => String(value ?? '').toLowerCase() === 'true';

/** A list of single-key objects (or an object) -> one plain object; later keys win. */
export function toMap(list) {
  const out = {};
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        Object.assign(out, entry);
      }
    }
  } else if (list && typeof list === 'object') {
    Object.assign(out, list);
  }
  return out;
}

/**
 * A message received on a topic, or null when it is not one.
 * @returns {{ method: string, params: object, errCode?: string, errMessage?: string } | null}
 */
export function parseMessage(payload) {
  let message;
  try {
    message = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload));
  } catch {
    return null;
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }
  // Niko's own examples carry stray spaces (" systeminfo.publish ").
  const method = String(message.Method ?? '').trim();
  const params = toMap(Array.isArray(message.Params) ? message.Params : [message.Params]);
  const parsed = { method, params };
  if (message.ErrCode !== undefined) {
    parsed.errCode = String(message.ErrCode);
    parsed.errMessage = String(message.ErrMessage ?? '').slice(0, 300);
  }
  return parsed;
}

/** The `Devices` of a message, or []. */
export function devicesOf(message) {
  const devices = message?.params?.Devices;
  return Array.isArray(devices) ? devices.filter((d) => d && typeof d === 'object') : [];
}

/**
 * A device of `devices.list` / `devices.added`, parsed defensively (an empty or
 * partial definition must never stop the others: openHAB issue 21302).
 * @returns {object|null} null without a Uuid
 */
export function parseDevice(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.Uuid !== 'string' || raw.Uuid === '') {
    return null;
  }
  const definitions = {};
  for (const [name, definition] of Object.entries(toMap(raw.PropertyDefinitions))) {
    if (definition && typeof definition === 'object') {
      definitions[name] = {
        grammar: parseGrammar(definition.Description),
        status: isTrue(definition.HasStatus),
        control: isTrue(definition.CanControl),
      };
    }
  }
  return {
    uuid: raw.Uuid,
    name: String(raw.Name ?? '').trim() || raw.Uuid,
    type: String(raw.Type ?? '').toLowerCase(),
    technology: String(raw.Technology ?? '').toLowerCase(),
    model: String(raw.Model ?? '').toLowerCase(),
    identifier: raw.Identifier === undefined ? undefined : String(raw.Identifier),
    // Absent means online (Niko's documentation).
    online: raw.Online === undefined ? true : isTrue(raw.Online),
    traits: stringValues(toMap(raw.Traits)),
    parameters: stringValues(toMap(raw.Parameters)),
    properties: stringValues(toMap(raw.Properties)),
    definitions,
  };
}

function stringValues(map) {
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    if (value === null || value === undefined || typeof value === 'object') {
      continue;
    }
    out[key] = String(value);
  }
  return out;
}

/**
 * Applies an event entry (`devices.status`, `devices.changed`,
 * `devices.param_changed`, `devices.displayname_changed`) to a parsed device.
 * @returns {string[]} the names of the properties whose value changed
 */
export function applyChange(device, entry) {
  const changed = [];
  for (const [key, value] of Object.entries(stringValues(toMap(entry.Properties)))) {
    if (device.properties[key] !== value) {
      device.properties[key] = value;
      changed.push(key);
    }
  }
  if (entry.Online !== undefined) {
    device.online = isTrue(entry.Online);
  }
  for (const [name, definition] of Object.entries(toMap(entry.PropertyDefinitions))) {
    if (definition && typeof definition === 'object') {
      device.definitions[name] = {
        grammar: parseGrammar(definition.Description),
        status: isTrue(definition.HasStatus),
        control: isTrue(definition.CanControl),
      };
    }
  }
  Object.assign(device.parameters, stringValues(toMap(entry.Parameters)));
  if (typeof entry.DisplayName === 'string' && entry.DisplayName.trim() !== '') {
    device.name = entry.DisplayName.trim();
  }
  return changed;
}

/**
 * The grammar of a property: `Range(min,max,step)`, `Choice(a,b,...)`,
 * `Boolean`, `Text`, `DateTime`, `Color(...)`; partner devices may leave the
 * bounds open (`Range(...)`, `Choice(...)`).
 */
export function parseGrammar(description) {
  const text = String(description ?? '').trim();
  const range = text.match(/^Range\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/i);
  if (range) {
    const [min, max, step] = range.slice(1).map(Number);
    if ([min, max, step].every(Number.isFinite)) {
      return { kind: 'range', min, max, step };
    }
  }
  if (/^Range\(/i.test(text)) {
    return { kind: 'range' };
  }
  const choice = text.match(/^Choice\((.*)\)$/i);
  if (choice) {
    const options = choice[1]
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o !== '' && o !== '...');
    return { kind: 'choice', options };
  }
  if (/^Boolean$/i.test(text)) {
    return { kind: 'boolean' };
  }
  return { kind: text === '' ? 'unknown' : text.replace(/\(.*$/, '').toLowerCase() };
}

/**
 * A `devices.control` message.
 * @param {Array<{ uuid: string, properties: Array<[string, string]> }>} devices
 */
export function controlMessage(devices) {
  return {
    Method: METHODS.CONTROL,
    Params: [
      {
        Devices: devices.map(({ uuid, properties }) => ({
          Uuid: uuid,
          // One key per object, in order (the documented form).
          Properties: properties.map(([key, value]) => ({ [key]: String(value) })),
        })),
      },
    ],
  };
}

/** The system information of `systeminfo.publish(ed)`. */
export function systemInfoOf(message) {
  const info = toMap(message?.params?.SystemInfo);
  const versions = toMap(info.SWversions);
  return {
    nhcVersion: versions.NhcVersion === undefined ? undefined : String(versions.NhcVersion),
    cocoImage: versions.CocoImage === undefined ? undefined : String(versions.CocoImage),
    lastConfig: info.LastConfig === undefined ? undefined : String(info.LastConfig),
    language: info.Language === undefined ? undefined : String(info.Language),
  };
}

/**
 * A reply to the UDP discovery (one byte 0x44 broadcast to port 10000), as
 * openHAB, nhc2-coco and node-red-contrib-nhc2 read it: byte 0 is 0x44, bytes
 * 0-5 identify the controller, 6-9 are its IPv4 address, byte 15 is 2 or more
 * for Niko Home Control II (below: an NHC I IP interface), and a 25-byte reply
 * ends with the version (four uint16 little endian).
 * @returns {{ id: string, ip: string, generation: 1 | 2, version?: string } | null}
 */
export function parseDiscoveryReply(buffer, sourceIp) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer[0] !== 0x44) {
    return null;
  }
  const id = buffer.subarray(0, 6).toString('hex');
  const ip = [...buffer.subarray(6, 10)].join('.');
  const valid = /^(?!0\.)(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip !== '255.255.255.255';
  const reply = {
    id,
    ip: valid ? ip : String(sourceIp ?? ''),
    generation: buffer[15] >= 2 ? 2 : 1,
  };
  if (buffer.length >= 25) {
    reply.version = [17, 19, 21, 23].map((offset) => buffer.readUInt16LE(offset)).join('.');
  }
  return reply.ip ? reply : null;
}
