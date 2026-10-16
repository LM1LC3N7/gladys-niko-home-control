// -----------------------------------------------------------------------------
// The Hobby API token: a JWT the user creates on mynikohomecontrol.com when
// adding the "Hobby API" connected service, valid one year. It is the MQTT
// password of the user "hobby". Only its payload is read here (the expiry):
// the controller checks the signature, the integration never has the key.
// The openHAB binding warns 14 days before the expiry; so do we.
// -----------------------------------------------------------------------------

const DAY = 86_400_000;

/** Days before the expiry from which the user is warned (as the openHAB binding). */
export const EXPIRY_WARNING_DAYS = 14;

/**
 * The claims of a JWT, without checking the signature.
 * @returns {{ exp?: number, iat?: number, sub?: string } | null} null when it is not a JWT
 */
export function decodeJwt(token) {
  const parts = String(token ?? '')
    .trim()
    .split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+={0,2}$/.test(p))) {
    return null;
  }
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

/**
 * What the integration knows about the token's validity.
 * @returns {{ valid: boolean, expiresAt?: Date, daysLeft?: number, expired?: boolean,
 *   expiringSoon?: boolean }}
 *   `valid`: it looks like a JWT; `daysLeft`: days before the expiry, rounded
 *   up while valid ("1 day" on the last day, "10 days" with 9 days and 23
 *   hours left), 0 or less once expired; unknown without an `exp` claim.
 */
export function tokenInfo(token, now = Date.now()) {
  const claims = decodeJwt(token);
  if (!claims) {
    return { valid: false };
  }
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp <= 0) {
    return { valid: true };
  }
  const expiresAt = new Date(exp * 1000);
  const left = expiresAt.getTime() - now;
  return {
    valid: true,
    expiresAt,
    daysLeft: left > 0 ? Math.ceil(left / DAY) : Math.floor(left / DAY),
    expired: left <= 0,
    expiringSoon: left > 0 && left < EXPIRY_WARNING_DAYS * DAY,
  };
}
