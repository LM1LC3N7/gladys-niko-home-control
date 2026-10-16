// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../src/config.js';
import {
  ACTIONS,
  DISCOVERY,
  LANGUAGES,
  OVERRULE_MINUTES,
  SCENE_TRIGGERS,
  SENSOR_INTERVAL,
} from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const app = read('src/app.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  // scene_triggers need Gladys 5.1.0 (udp-active-broadcast exists since 4.84).
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.equal(
    manifest.docker_image,
    `ghcr.io/lm1lc3n7/gladys-niko-home-control:${manifest.version}`,
  );
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['lighting', 'climate', 'energy']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('unofficial, and said so', () => {
  const intro = manifest.config_schema.find((f) => f.key === 'intro');
  assert.match(intro.description.en, /Unofficial, not affiliated with Niko\./);
  assert.match(intro.description.fr, /Non officiel, sans lien avec Niko\./);
  assert.match(read('README.md'), /not affiliated with Niko/);
  assert.match(JSON.parse(read('package.json')).description, /not affiliated with Niko/);
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    if (fields[key].default !== undefined || !['', null].includes(value)) {
      assert.deepEqual(fields[key].default, value, key);
    }
  }
  for (const [key, field] of Object.entries(fields)) {
    if (field.type !== 'section') {
      assert.ok(key in DEFAULTS, `${key} is not read by src/config.js`);
    }
  }
  assert.equal(fields.hobby_token.type, 'secret');
  for (const [key, bounds] of [
    ['sensor_interval', SENSOR_INTERVAL],
    ['overrule_minutes', OVERRULE_MINUTES],
  ]) {
    assert.deepEqual([fields[key].min, fields[key].max], [bounds.min, bounds.max], key);
  }
  assert.deepEqual(fields.language.options.map((o) => o.value).sort(), [...LANGUAGES].sort());
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const lang of ['en', 'fr']) {
      const length = section.description[lang].length;
      assert.ok(length <= 1000, `${section.key}.${lang}: ${length} characters`);
    }
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
    assert.ok((section.links ?? []).length <= 5);
    assert.equal(section.required, undefined);
  }
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: multi-language placeholder`);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key),
    Object.values(SCENE_TRIGGERS),
  );
  const trigger = manifest.scene_triggers[0];
  for (const key of [...trigger.fields, ...trigger.variables].map((f) => f.key)) {
    assert.match(app, new RegExp(`\\b${key}:`), `the scene event carries ${key}`);
  }
});

test('the network discovery declared is the one used', () => {
  assert.deepEqual(manifest.network_discovery, [
    { type: 'udp-active-broadcast', ports: [DISCOVERY.port] },
  ]);
  assert.match(app, /scanNetwork\('udp-active-broadcast'/);
});
