// -----------------------------------------------------------------------------
// The TLS trust of the integration, against a real local TLS server (no
// network: 127.0.0.1). The controller certificates of test/fixtures/tls are
// TEST certificates made for these tests (a test CA, a "controller" issued
// for the name nhc-controller, a self-signed "rogue"): they protect nothing.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import tls from 'node:tls';
import { NIKO_CA, splitPem, tlsOptions } from '../src/nhc2/tls.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/tls/${name}`, import.meta.url), 'utf8');

test('the Niko CA bundle: the root and the intermediate shipped by openHAB and nhc2-coco', () => {
  const certificates = splitPem(NIKO_CA).map((pem) => new X509Certificate(pem));
  assert.deepEqual(
    certificates.map((c) => c.fingerprint256),
    [
      // CN=Niko Intermediate CA, until 2037-01-01
      '01:29:3E:D0:5F:2A:CF:43:23:77:0C:0A:BD:6A:52:E8:6C:DB:B2:4F:BD:70:6C:7D:0C:4F:B8:C1:CB:C9:5A:49',
      // O=Niko, OU=Home Control (root), until 2037-01-29
      '1A:E1:B5:72:A3:24:92:D0:BB:A7:64:FA:8F:4A:F8:07:F1:71:3C:E1:24:1B:C4:E8:5D:80:FB:01:C3:11:0B:FC',
    ],
  );
  assert.ok(certificates.every((c) => c.ca));
  assert.ok(certificates[0].checkIssued(certificates[1]), 'the intermediate is issued by the root');
});

test('the options never turn the verification off', () => {
  const options = tlsOptions();
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.ca.length, 2);
  assert.equal(options.checkServerIdentity('192.168.1.50', {}), undefined);
  assert.equal(tlsOptions([fixture('ca.crt')]).ca.length, 3);
});

/** Connects to a local TLS server presenting `cert`; resolves 'ok' or the error code. */
async function handshake(cert, key, options) {
  const server = tls.createServer({ cert, key }, (socket) => socket.end());
  server.on('tlsClientError', () => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await new Promise((resolve) => {
      const socket = tls.connect({ host: '127.0.0.1', port: server.address().port, ...options });
      socket.once('secureConnect', () => {
        socket.destroy();
        resolve('ok');
      });
      socket.once('error', (err) => resolve(err.code ?? err.message));
    });
  } finally {
    server.close();
  }
}

test('a controller certificate from the trusted CA is accepted by IP address', async () => {
  // Issued for "nhc-controller", reached at 127.0.0.1: only the name check is skipped.
  const result = await handshake(
    fixture('controller.crt'),
    fixture('controller.key'),
    tlsOptions([fixture('ca.crt')]),
  );
  assert.equal(result, 'ok');
});

test('a certificate from another CA is refused', async () => {
  // Only Niko's CA: the test controller is not trusted.
  assert.match(
    await handshake(fixture('controller.crt'), fixture('controller.key'), tlsOptions()),
    /UNABLE_TO_GET_ISSUER_CERT_LOCALLY|UNABLE_TO_VERIFY_LEAF_SIGNATURE/,
  );
  // A self-signed certificate with the right name: refused too.
  assert.match(
    await handshake(fixture('rogue.crt'), fixture('rogue.key'), tlsOptions([fixture('ca.crt')])),
    /SELF_SIGNED|UNABLE_TO/,
  );
});
