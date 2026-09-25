/**
 * Validation for price alerts.
 *
 * Lives in lib/ rather than inside the route so scripts/alerts-verify.mjs can
 * exercise the exact rules the API enforces without booting a server — the
 * same arrangement as lib/data/view-events.ts.
 *
 * The email is the only identity an alert has (there is no account system):
 * it is normalised to lowercase so the same address always refers to the same
 * rows, and nothing else about the sender is accepted or stored. Prices are
 * converted to integer centavos here, at the boundary, so a float never
 * reaches the database.
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;
/** Deliberately simple: the schema only demands a single `@` with something on both sides. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_TARGET_CENTS = 100; // ₱1
const MAX_TARGET_CENTS = 100_000_000; // ₱1,000,000

export type PriceAlertRequest = {
  /** Lowercased and trimmed — the key an alert is filed under. */
  email: string;
  productSlug: string;
  targetPriceCents: number;
};

/** What the API returns for one alert, shared by the routes and the UI. */
export type PriceAlertView = {
  id: number;
  slug: string;
  targetPriceCents: number;
  status: "active" | "triggered";
  createdAt: string;
  triggeredAt: string | null;
  /** Lowest listed price at the moment the list was read, or null if unknown. */
  currentPriceCents: number | null;
  productName: string | null;
};

/** Normalises an email for storage and lookup, or null when unusable. */
export function parseAlertEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  if (!EMAIL_PATTERN.test(email)) return null;
  return email;
}

/** Accepts a number or a formatted string ("₱40,491") and returns centavos. */
export function parseAlertTarget(value: unknown): number | null {
  let pesos: number;
  if (typeof value === "number") {
    pesos = value;
  } else if (typeof value === "string") {
    pesos = Number(value.replace(/[^0-9.]/g, ""));
  } else {
    return null;
  }
  if (!Number.isFinite(pesos) || pesos <= 0) return null;
  const cents = Math.round(pesos * 100);
  if (cents < MIN_TARGET_CENTS || cents > MAX_TARGET_CENTS) return null;
  return cents;
}

/** An alert id is a positive integer — never free text. */
export function parseAlertId(value: unknown): number | null {
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

/** The create payload: `{ email, slug, targetPrice }`. */
export function parseAlertRequest(payload: unknown): PriceAlertRequest | null {
  if (typeof payload !== "object" || payload === null) return null;

  const { email, slug, targetPrice } = payload as {
    email?: unknown;
    slug?: unknown;
    targetPrice?: unknown;
  };

  if (typeof slug !== "string") return null;
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH) return null;
  if (!SLUG_PATTERN.test(slug)) return null;

  const parsedEmail = parseAlertEmail(email);
  const targetPriceCents = parseAlertTarget(targetPrice);
  if (!parsedEmail || !targetPriceCents) return null;

  return { email: parsedEmail, productSlug: slug, targetPriceCents };
}

/**
 * The whole of the server-side check: an alert fires when the current lowest
 * price has come down to — or through — the target. Equality counts, because
 * "tell me when it reaches ₱44,990" should fire at exactly ₱44,990.
 */
export function shouldTriggerAlert(
  targetPriceCents: number,
  currentPriceCents: number | null,
): boolean {
  if (currentPriceCents === null) return false;
  return currentPriceCents <= targetPriceCents;
}
