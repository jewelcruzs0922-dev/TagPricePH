/**
 * Validation for anonymous product-view events.
 *
 * Lives in lib/ rather than inside the route so the exact rules the API
 * enforces can be exercised by scripts/views-verify.mjs without booting a
 * server — the same arrangement as lib/data/ingest.ts.
 *
 * Nothing here accepts free text: the slug must look like one of ours and the
 * referrer is reduced to a hostname before it is stored, so a request can
 * never write arbitrary content into the table.
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 80;
const MAX_REFERRER_LENGTH = 512;

export type ProductViewEvent = {
  productSlug: string;
  /** Hostname of the external site that sent the shopper, or null for a direct visit. */
  referrerHost: string | null;
};

export function parseProductView(payload: unknown): ProductViewEvent | null {
  if (typeof payload !== "object" || payload === null) return null;

  const { slug, referrer } = payload as { slug?: unknown; referrer?: unknown };
  if (typeof slug !== "string") return null;
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH) return null;
  if (!SLUG_PATTERN.test(slug)) return null;

  return { productSlug: slug, referrerHost: parseReferrerHost(referrer) };
}

/** Reduces a full referrer URL to its hostname, or null when unusable. */
function parseReferrerHost(referrer: unknown): string | null {
  if (typeof referrer !== "string") return null;
  if (referrer.length === 0 || referrer.length > MAX_REFERRER_LENGTH) return null;

  try {
    const url = new URL(referrer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.length > 0 ? url.hostname : null;
  } catch {
    return null;
  }
}
