import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The admin gate: one shared token from the ADMIN_TOKEN environment variable.
 *
 * Nothing here is Next-specific on purpose — the verify suite imports this
 * file directly. Three rules hold throughout:
 *
 *   1. The token is never stored or logged; the session cookie carries only
 *      its SHA-256, so a leaked cookie jar does not reveal the token.
 *   2. Every comparison runs in constant time (hash first, then
 *      timingSafeEqual), so response timing cannot confirm token prefixes.
 *   3. With no ADMIN_TOKEN configured, the admin area is disabled outright —
 *      there is no default token, no fallback, and nothing to brute-force.
 */

export const ADMIN_COOKIE = "tp_admin";

/** A session lasts eight hours; after that the token must be typed again. */
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 8;

export function getAdminToken(): string | null {
  const token = process.env.ADMIN_TOKEN?.trim();
  return token ? token : null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function equalsHex(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type TokenCheck = "ok" | "mismatch" | "disabled";

/** Compare a submitted token with the configured one. */
export function verifyAdminToken(input: string | null): TokenCheck {
  const expected = getAdminToken();
  if (!expected) return "disabled";
  if (!input) return "mismatch";
  return equalsHex(hashToken(input), hashToken(expected)) ? "ok" : "mismatch";
}

/** The only value a session cookie may hold: a hash of the configured token. */
export function expectedSessionValue(): string | null {
  const token = getAdminToken();
  return token ? hashToken(token) : null;
}

export function isValidSessionValue(value: string | null | undefined): boolean {
  const expected = expectedSessionValue();
  if (!expected || !value) return false;
  return equalsHex(value, expected);
}
