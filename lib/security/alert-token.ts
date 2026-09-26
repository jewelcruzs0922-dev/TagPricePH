import { createHash } from "node:crypto";
import { timingSafeStringEqual } from "./timing-safe.ts";

/**
 * Mailbox access tokens for price alerts (§25), in their stored form.
 *
 * The database never holds the plaintext (Live Data Readiness §6): a row
 * stores 'sha256:' + hex digest of the token, the plaintext is handed to the
 * filer exactly once, and every later `x-alert-token` header is digested
 * before it is compared — in constant time, through timingSafeStringEqual.
 *
 * sha256 rather than a slow KDF on purpose: the input is a 192-bit random
 * token, not a human-chosen secret, so there is nothing to enumerate.
 *
 * Kept out of lib/db/alerts.ts so verification scripts can import it in
 * plain Node (that module carries `server-only`).
 */

const PREFIX = "sha256:";

/** What the database stores for a mailbox token. */
export function hashAlertToken(token: string): string {
  return PREFIX + createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time check of a presented token against what the column holds.
 * Rows written before migration 0014 still hold plaintext, so a legacy value
 * is compared directly — after 0014 every row is hashed and only the hashed
 * branch can match. A missing side is never authorization.
 */
export function alertTokenMatches(
  presented: string | null | undefined,
  stored: string | null | undefined,
): boolean {
  if (presented == null || stored == null) return false;
  if (stored.startsWith(PREFIX)) {
    return timingSafeStringEqual(hashAlertToken(presented), stored);
  }
  return timingSafeStringEqual(presented, stored);
}
