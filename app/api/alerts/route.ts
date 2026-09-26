import { NextRequest, NextResponse } from "next/server";
import { getActiveProvider } from "@/lib/api/registry";
import {
  clientIp,
  rateLimitResponse,
  rejectUnsafeJsonPost,
} from "@/lib/api/request-guard";
import {
  parseAlertEmail,
  parseAlertId,
  parseAlertRequest,
  shouldTriggerAlert,
  type PriceAlertView,
} from "@/lib/data/alert-events";
import {
  cancelAlert,
  createAlert,
  getAlertOwner,
  getMailboxToken,
  listAlerts,
  newAlertToken,
  triggerAlert,
  type AlertRow,
} from "@/lib/db/alerts";
import { toCents } from "@/lib/db/money";
import { logEvent } from "@/lib/log";
import { getLowestOffer } from "@/lib/pricing";
import { consumeRateLimit, type RateLimitState } from "@/lib/rate-limit";
import { timingSafeStringEqual } from "@/lib/security/timing-safe";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Price alerts, stored server-side.
 *
 * POST files one (creating it, or retargeting the active alert for the same
 * email and product), GET lists what an email is watching with the current
 * price beside each target, and DELETE cancels a row the caller owns.
 *
 * Authorization (§25): the email alone authorizes nothing. The mailbox's
 * access token — minted on the first POST, returned exactly once, stored by
 * the client — must be presented as `x-alert-token` on every later call:
 *   - POST on a mailbox that already exists without it → 403;
 *   - GET on a mailbox that exists without it → 403;
 *   - DELETE without it → 403 (after the row is found and its email
 *     matches, so an id guessing probe still learns nothing).
 * Format validation runs first (400), so a malformed request never depends on
 * a token, and a fresh mailbox (no rows) needs none to file its first alert.
 * POST is additionally rate-limited per IP (429 with Retry-After).
 *
 * GET is also where the check runs: every still-active alert is compared with
 * the current lowest price, and one that has been reached is flipped to
 * `triggered` there and then. The status a client sees is therefore the
 * database's, not a guess — close the tab and reopen it and the alert is still
 * triggered, with the time it was observed.
 *
 * There is no mail provider, so nothing here sends email. The email field is
 * an identity — it is how a shopper finds their alerts on any device — and
 * the UI says so in those words.
 */

const TOKEN_HEADER = "x-alert-token";
/** Per-IP POST budget: filing an alert is rare; 10/min is generous to humans. */
const POST_LIMIT = { limit: 10, windowMs: 60_000 };
const postBuckets: RateLimitState = new Map();

type AlertView = PriceAlertView;

function currentPriceCents(product: Product | null): number | null {
  if (!product) return null;
  const lowest = getLowestOffer(product.offers);
  return lowest ? toCents(lowest.price) : null;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function toView(
  alert: AlertRow,
  product: Product | null,
  currentPrice: number | null,
): AlertView {
  return {
    id: alert.id,
    slug: alert.product_slug,
    targetPriceCents: alert.target_price_cents,
    status: alert.status === "triggered" ? "triggered" : "active",
    createdAt: iso(alert.created_at),
    triggeredAt: alert.triggered_at ? iso(alert.triggered_at) : null,
    currentPriceCents: currentPrice,
    productName: product?.name ?? null,
  };
}

/** List one email's alerts, refreshing triggers against current prices. */
export async function GET(request: NextRequest) {
  const email = parseAlertEmail(request.nextUrl.searchParams.get("email"));
  if (!email) {
    return NextResponse.json({ error: "a valid email is required" }, { status: 400 });
  }

  // A mailbox that exists is readable only with its token; a mailbox with no
  // rows answers with an empty list, because there is nothing to protect and
  // no token could exist yet.
  const mailboxToken = await getMailboxToken(email);
  if (
    mailboxToken !== null &&
    !timingSafeStringEqual(request.headers.get(TOKEN_HEADER), mailboxToken)
  ) {
    return NextResponse.json(
      { error: "a valid alert token is required" },
      { status: 403 },
    );
  }

  try {
    const alerts = await listAlerts(email);
    const provider = getActiveProvider();
    const slugs = [...new Set(alerts.map((alert) => alert.product_slug))];
    const products = await Promise.all(
      slugs.map((slug) => provider.getProduct(slug)),
    );
    const bySlug = new Map(
      slugs.map((slug, index) => [slug, products[index] ?? null]),
    );

    const views: AlertView[] = [];
    for (const alert of alerts) {
      const product = bySlug.get(alert.product_slug) ?? null;
      const currentPrice = currentPriceCents(product);
      let status = alert.status;
      let triggeredAt = alert.triggered_at;

      if (status === "active" && shouldTriggerAlert(alert.target_price_cents, currentPrice)) {
        const flipped = await triggerAlert(alert.id);
        if (flipped) {
          status = "triggered";
          triggeredAt = flipped.triggered_at;
        }
        // A null flip means another run triggered or cancelled this row first.
        // Reporting it as still active would be wrong either way, so the next
        // read shows the authoritative status; a race this narrow is not worth
        // a second round trip for every request.
      }

      views.push(toView({ ...alert, status, triggered_at: triggeredAt }, product, currentPrice));
    }

    return NextResponse.json({ alerts: views });
  } catch (error) {
    logEvent("error", "alerts.list-failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "alerts unavailable" }, { status: 500 });
  }
}

/** File an alert for a product that actually exists in the catalog. */
export async function POST(request: NextRequest) {
  const rejected = rejectUnsafeJsonPost(request);
  if (rejected) return rejected;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid alert" }, { status: 400 });
  }

  const alert = parseAlertRequest(payload);
  if (!alert) {
    return NextResponse.json({ error: "invalid alert" }, { status: 400 });
  }

  const limited = rateLimitResponse(
    consumeRateLimit(postBuckets, `alerts:${clientIp(request)}`, POST_LIMIT),
    "too many alerts — wait a moment",
  );
  if (limited) return limited;

  try {
    const product = await getActiveProvider().getProduct(alert.productSlug);
    if (!product) {
      return NextResponse.json({ error: "unknown product" }, { status: 404 });
    }

    // §25: a mailbox that already exists opens only with its token; a fresh
    // one mints one here, which this response returns exactly once.
    const existingToken = await getMailboxToken(alert.email);
    let accessToken: string;
    if (existingToken !== null) {
      if (!timingSafeStringEqual(request.headers.get(TOKEN_HEADER), existingToken)) {
        return NextResponse.json(
          { error: "a valid alert token is required" },
          { status: 403 },
        );
      }
      accessToken = existingToken;
    } else {
      accessToken = newAlertToken();
    }

    const row = await createAlert({ ...alert, accessToken });
    logEvent("info", "alerts.created", {
      id: row.id,
      slug: row.product_slug,
      existingMailbox: existingToken !== null,
    });
    return NextResponse.json({
      alert: toView(row, product, currentPriceCents(product)),
      // The token as INSERT returned it — under a concurrent first POST the
      // conflict path keeps the stored token, and a locally minted copy could
      // silently differ, handing this caller a token that opens nothing.
      accessToken: row.access_token,
    });
  } catch (error) {
    logEvent("error", "alerts.create-failed", {
      slug: alert.productSlug,
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "alert not saved" }, { status: 500 });
  }
}

/** Cancel an alert — the owning email plus its token may do this. */
export async function DELETE(request: NextRequest) {
  const email = parseAlertEmail(request.nextUrl.searchParams.get("email"));
  const id = parseAlertId(request.nextUrl.searchParams.get("id"));
  if (!email || !id) {
    return NextResponse.json({ error: "email and id are required" }, { status: 400 });
  }

  try {
    // Ownership is read first: an id that does not exist, or belongs to a
    // different mailbox, is a 404 either way — the token check only runs for
    // a row the caller's email already matches, so probing ids with guesses
    // reveals nothing about which ids exist.
    const owner = await getAlertOwner(id);
    if (!owner || owner.email !== email) {
      return NextResponse.json({ error: "alert not found" }, { status: 404 });
    }
    if (!timingSafeStringEqual(request.headers.get(TOKEN_HEADER), owner.access_token)) {
      return NextResponse.json(
        { error: "a valid alert token is required" },
        { status: 403 },
      );
    }

    const cancelled = await cancelAlert(id, email);
    if (!cancelled) {
      return NextResponse.json({ error: "alert not found" }, { status: 404 });
    }
    logEvent("info", "alerts.cancelled", { id });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logEvent("error", "alerts.cancel-failed", {
      id,
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "alert not cancelled" }, { status: 500 });
  }
}
