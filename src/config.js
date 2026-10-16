// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
//
// The Connected Controller (or the Wireless Smart Hub) of a Niko Home Control II
// installation, reached on the local network, and the Hobby API token: the
// password of the MQTT user "hobby" on its TLS port 8884.
// -----------------------------------------------------------------------------

import { HOBBY_PORT, LANGUAGES, OVERRULE_MINUTES, SENSOR_INTERVAL } from './constants.js';
import { decodeJwt } from './token.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  controller_host: '',
  hobby_token: '',
  sensor_interval: SENSOR_INTERVAL.default,
  overrule_minutes: OVERRULE_MINUTES.default,
  language: 'fr',
};

/**
 * The controller from what the user typed: "192.168.1.50", "nhc.lan",
 * "mqtts://192.168.1.50:8884", "192.168.1.50:8884". The port is the Hobby
 * API's (8884); another one typed is kept (a test broker).
 * @returns {{ host: string, port: number } | { error: 'empty' | 'invalid' | 'credentials' }}
 */
export function parseHost(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { error: 'empty' };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `mqtts://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (!['mqtts:', 'ssl:', 'tls:', 'mqtt:', 'tcp:', 'https:', 'http:'].includes(url.protocol)) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    return { error: 'credentials' };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || (url.pathname !== '' && url.pathname !== '/')) {
    return { error: 'invalid' };
  }
  // http(s):// is the address of a web page: the MQTT port stays the Hobby API's.
  const web = url.protocol === 'http:' || url.protocol === 'https:';
  const port = !web && url.port ? Number(url.port) : HOBBY_PORT;
  return { host, port };
}

const bounded = (raw, { min, max, default: fallback }) => {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n))) : fallback;
};

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined),
  );
  const c = { ...DEFAULTS, ...given };
  const target = parseHost(c.controller_host);
  // A pasted token often carries spaces or line breaks: a JWT has none.
  const token = String(c.hobby_token ?? '').replace(/\s+/g, '');
  let error = target.error;
  if (!error && token === '') {
    error = 'no-token';
  } else if (!error && !decodeJwt(token)) {
    error = 'bad-token';
  }
  return {
    host: target.host,
    port: target.port,
    token,
    error,
    sensorInterval: bounded(c.sensor_interval, SENSOR_INTERVAL),
    overruleMinutes: bounded(c.overrule_minutes, OVERRULE_MINUTES),
    language: LANGUAGES.includes(c.language) ? c.language : DEFAULTS.language,
  };
}
