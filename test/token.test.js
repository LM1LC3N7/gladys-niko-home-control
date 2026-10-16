import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt, tokenInfo } from '../src/token.js';
import { jwt } from './fixtures/niko.js';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const DAY = 86_400_000;

test('the claims of a JWT are read without its key', () => {
  const token = jwt({ exp: 1_800_000_000, sub: 'hobby' });
  assert.deepEqual(decodeJwt(token), { exp: 1_800_000_000, sub: 'hobby' });
  assert.deepEqual(decodeJwt(` ${token}\n`), { exp: 1_800_000_000, sub: 'hobby' });
});

test('anything else is not a token', () => {
  for (const value of [undefined, '', 'password', 'a.b', 'a.b.c.d', 'a.%%%.c', 'x.bm90IGpzb24.y']) {
    assert.equal(decodeJwt(value), null, String(value));
  }
  assert.equal(decodeJwt(`x.${Buffer.from('[1]').toString('base64url')}.y`), null);
});

test('days left, expiring soon from 14 days, expired', () => {
  const at = (days) => tokenInfo(jwt({ exp: Math.floor((NOW + days * DAY) / 1000) }), NOW);
  assert.deepEqual(
    { ...at(200), expiresAt: undefined },
    {
      valid: true,
      expiresAt: undefined,
      daysLeft: 200,
      expired: false,
      expiringSoon: false,
    },
  );
  assert.equal(at(14).expiringSoon, false);
  assert.equal(at(14).daysLeft, 14);
  // Rounded up while valid: 13.5 days left are "14 days", already in the warning period.
  assert.equal(at(13.5).daysLeft, 14);
  assert.equal(at(13.5).expiringSoon, true);
  assert.equal(at(199.99).daysLeft, 200);
  assert.equal(at(0.2).daysLeft, 1, 'the last day');
  assert.equal(at(0.2).expiringSoon, true);
  assert.equal(at(-1).expired, true);
  assert.equal(at(-1).expiringSoon, false);
  assert.equal(at(-1).daysLeft, -1);
  assert.equal(at(-0.5).daysLeft, -1);
  assert.equal(at(30).expiresAt.toISOString(), new Date(NOW + 30 * DAY).toISOString());
});

test('a token without an expiry, or not a token', () => {
  assert.deepEqual(tokenInfo(jwt({ sub: 'hobby' }), NOW), { valid: true });
  assert.deepEqual(tokenInfo('secret', NOW), { valid: false });
});
