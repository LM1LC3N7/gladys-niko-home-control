// -----------------------------------------------------------------------------
// TLS towards the Connected Controller.
//
// The controller presents a certificate issued by Niko's own CA ("Niko
// Intermediate CA", under the Niko Home Control root), valid until 2037, for a
// name that is not its IP address. As the openHAB binding and the Home
// Assistant integration (joleys/niko-home-control-II) do, the chain is
// verified against these two certificates ONLY (not the public CAs), and only
// the host name check is skipped: the user types an IP address. Verification
// is never turned off. niko-ca.pem is the coco_ca.pem of
// joleys/niko-home-control-II (MIT); openHAB embeds the very same two
// certificates (checked by fingerprint in test/tls.test.js).
// -----------------------------------------------------------------------------

import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The Niko root and intermediate CA certificates (PEM). */
export const NIKO_CA = readFileSync(new URL('./niko-ca.pem', import.meta.url), 'utf8');

/** One PEM text -> its certificates, one PEM string each. */
export function splitPem(text) {
  return (
    String(text ?? '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []
  );
}

/**
 * The TLS options of the MQTT connection.
 * @param {string[]} [extraCa] more CA certificates (PEM), for a test broker only
 */
export function tlsOptions(extraCa = []) {
  return {
    ca: [...splitPem(NIKO_CA), ...extraCa.flatMap(splitPem)],
    rejectUnauthorized: true,
    // The certificate names the controller, not the address the user typed.
    checkServerIdentity: () => undefined,
  };
}

/** A short description of the controller's certificate, for the logs. */
export function describeCertificate(socket) {
  try {
    const raw = socket?.getPeerX509Certificate?.();
    if (!raw) {
      return undefined;
    }
    const cert = raw instanceof X509Certificate ? raw : new X509Certificate(raw.raw ?? raw);
    const cn = cert.subject.split('\n').find((l) => l.startsWith('CN='));
    return `${cn ?? cert.subject.replace(/\n/g, ', ')}, valid until ${cert.validTo}`;
  } catch {
    return undefined;
  }
}
