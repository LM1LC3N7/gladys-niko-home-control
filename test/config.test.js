import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseHost } from '../src/config.js';
import { TOKEN } from './fixtures/niko.js';

test('the address of the controller, as users type it', () => {
  for (const [typed, host, port] of [
    ['192.168.1.50', '192.168.1.50', 8884],
    [' 192.168.1.50 ', '192.168.1.50', 8884],
    ['192.168.1.50:8884', '192.168.1.50', 8884],
    ['mqtts://192.168.1.50:8885', '192.168.1.50', 8885],
    ['Niko870A.local', 'Niko870A.local', 8884],
    ['https://192.168.1.50/', '192.168.1.50', 8884],
    ['http://192.168.1.50:8080', '192.168.1.50', 8884],
    ['[fd00::50]', 'fd00::50', 8884],
  ]) {
    assert.deepEqual(parseHost(typed), { host, port }, typed);
  }
  assert.deepEqual(parseHost(''), { error: 'empty' });
  assert.deepEqual(parseHost('mqtts://hobby:secret@192.168.1.50'), { error: 'credentials' });
  for (const bad of ['ftp://host', 'http://192.168.1.50/page', 'a b']) {
    assert.deepEqual(parseHost(bad), { error: 'invalid' }, bad);
  }
});

test('the defaults', () => {
  const config = normalizeConfig();
  assert.equal(config.error, 'empty');
  assert.equal(config.sensorInterval, DEFAULTS.sensor_interval);
  assert.equal(config.overruleMinutes, 60);
  assert.equal(config.language, 'fr');
});

test('a complete configuration', () => {
  const config = normalizeConfig({
    controller_host: '192.168.1.50',
    hobby_token: `  ${TOKEN.slice(0, 40)}\n${TOKEN.slice(40)} `,
    sensor_interval: '30',
    overrule_minutes: 5000,
    language: 'nl',
    GLADYS_PREFER_LOCAL: true,
  });
  assert.deepEqual(config, {
    host: '192.168.1.50',
    port: 8884,
    token: TOKEN,
    error: undefined,
    sensorInterval: 30,
    overruleMinutes: 1439,
    language: 'nl',
  });
});

test('what is missing or wrong', () => {
  assert.equal(normalizeConfig({ controller_host: '192.168.1.50' }).error, 'no-token');
  assert.equal(
    normalizeConfig({ controller_host: '192.168.1.50', hobby_token: 'password' }).error,
    'bad-token',
  );
  assert.equal(
    normalizeConfig({ controller_host: 'ftp://x', hobby_token: TOKEN }).error,
    'invalid',
  );
  const odd = normalizeConfig({
    controller_host: '192.168.1.50',
    hobby_token: TOKEN,
    sensor_interval: 'abc',
    overrule_minutes: null,
    language: 'de',
  });
  assert.equal(odd.error, undefined);
  assert.equal(odd.sensorInterval, 10);
  assert.equal(odd.overruleMinutes, 60);
  assert.equal(odd.language, 'fr');
});
