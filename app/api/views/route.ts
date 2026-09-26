import { NextResponse } from "next/server";
import { getActiveProvider } from "@/lib/api/registry";
import {
  clientIp,
  rateLimitResponse,
  rejectUnsafeJsonPost,
} from "@/lib/api/request-guard";
import { parseProductView } from "@/lib/data/view-events";
import { recordProductView } from "@/lib/db/views";
import { logEvent } from "@/lib/log";
import { consumeRateLimit, type RateLimitState } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Anonymous product-view beacon.
 *
 * The product page is statically generated, so there is no server render to
 * count a view in — this endpoint is the only place the top of the funnel can
 * be recorded.
 *
 * Public by necessity, and safe to be: the payload is validated before it
 * reaches the database, unknown products are ignored, the referrer has
 * already been reduced to a hostname by parseProductView, and nothing
 * identifying the visitor is accepted or stored. A per-IP budget, a
 * cross-site/Content-Type guard, and a body-size cap keep the write path from
 * being turned into an unbounded flood.
 */
const POST_LIMIT = { limit: 60, windowMs: 60_000 };
const viewBuckets: RateLimitState = new Map();

export async function POST(request: Request) {
  const rejected = rejectUnsafeJsonPost(request);
  if (rejected) return rejected;

  const limited = rateLimitResponse(
    consumeRateLimit(viewBuckets, `views:${clientIp(request)}`, POST_LIMIT),
    "too many requests",
  );
  if (limited) return limited;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const event = parseProductView(payload);
  if (!event) return new NextResponse(null, { status: 400 });

  try {
    const product = await getActiveProvider().getProduct(event.productSlug);
    if (!product) return new NextResponse(null, { status: 404 });
    await recordProductView(event);
  } catch (error) {
    // Structured for the log drain; the HTTP response carries no detail —
    // this is a public endpoint.
    logEvent("error", "views.record-failed", {
      slug: event.productSlug,
      reason: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse(null, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
