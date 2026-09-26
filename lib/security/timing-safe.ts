import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secrets and bearer values — the same
 * rule lib/admin/token.ts states, generalized so ingest, cron, and alert
 * mailbox checks follow it instead of contradicting it with `===`.
 *
 * Both sides are SHA-256 hashed first, so the comparison always runs over two
 * fixed 32-byte buffers: input length cannot leak through timing, and neither
 * value ever has to be padded. No dependencies, no Next APIs — the verify
 * suite imports this file directly.
 */
export function timingSafeStringEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  // Two missing values are equal (a NULL token against a missing header is
  // not an authorization); everything else falls through to the hashed path.
  if (a == null || b == null) return a === b;
  if (a === b) return true;
  return timingSafeEqual(digest(a), digest(b));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
