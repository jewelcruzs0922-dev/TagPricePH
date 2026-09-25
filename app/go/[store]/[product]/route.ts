import { NextRequest, NextResponse, after } from "next/server";
import { getActiveProvider } from "@/lib/api/registry";
import { resolveOutboundUrl } from "@/lib/api/affiliate";
import { isEligibleCurrentOffer } from "@/lib/pricing";
import { recordClick } from "@/lib/db/clicks";

type RouteContext = {
  params: Promise<{ store: string; product: string }>;
};

/**
 * Outbound redirect for retailer deals.
 *
 * Responsibilities, in order:
 *  1. identify the offer — an unknown product, store, or listing never
 *     leaves the app;
 *  2. resolve + validate the destination through the one centralized
 *     resolver (affiliate URL when the offer carries a real one, the
 *     retailer's normal URL otherwise, allowlisted https hosts only);
 *  3. record which offer the visitor left for, then redirect.
 *
 * Nothing is appended to the destination. `campaign`/`source` are our own
 * attribution: they are recorded on the click row and never forwarded as
 * query parameters onto a marketplace URL, because a parameter no programme
 * asked for is a fabricated affiliate signal.
 *
 * Clicks are logged after the response is sent (see `after` below), so
 * analytics never adds latency to the redirect and can never block it.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { store: storeId, product: productSlug } = await context.params;
  const product = await getActiveProvider().getProduct(productSlug);

  if (!product) {
    return NextResponse.redirect(new URL("/search", request.url), 302);
  }

  // One store can hold many listings for the same product (FIX 2), so the
  // offer we leave for has to be chosen, not assumed: prefer one that still
  // qualifies as a current offer, and fall back to the store's first listing
  // — which `resolveOutboundUrl` will validate either way.
  const candidates = product.offers.filter((item) => item.storeId === storeId);
  const offer =
    candidates.find((item) => isEligibleCurrentOffer(item)) ?? candidates[0];
  if (!offer) {
    return NextResponse.redirect(new URL(`/product/${productSlug}`, request.url), 302);
  }

  const destination = resolveOutboundUrl(offer);
  if (!destination) {
    return NextResponse.redirect(new URL(`/product/${productSlug}`, request.url), 302);
  }

  const campaign = request.nextUrl.searchParams.get("campaign");
  const source = request.nextUrl.searchParams.get("source");

  // Scheduled after the response is flushed: the visitor is never kept waiting
  // on Postgres, and a logging failure can never break the redirect.
  after(async () => {
    try {
      await recordClick({
        productSlug,
        storeId,
        listingId: offer.listingId ?? null,
        placement: source || "unknown",
        campaign,
        destination,
        referrer: request.headers.get("referer"),
        userAgent: request.headers.get("user-agent"),
      });
    } catch (error) {
      console.error(
        "Failed to record click_events row:",
        error instanceof Error ? error.message : error,
      );
    }
  });

  return NextResponse.redirect(destination, 302);
}
