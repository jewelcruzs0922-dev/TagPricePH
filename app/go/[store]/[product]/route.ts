import { NextRequest, NextResponse } from "next/server";
import { getProductBySlug } from "@/lib/data/products";
import {
  affiliateConfig,
  resolveOfferDestination,
} from "@/lib/api/affiliate";

type RouteContext = {
  params: Promise<{ store: string; product: string }>;
};

/**
 * Outbound redirect for retailer deals.
 *
 * Responsibilities:
 *  1. identify the offer
 *  2. resolve + validate the destination (host allowlist, https only)
 *  3. attach affiliate parameters ONLY when that marketplace is configured
 *  4. forward our own internal attribution (campaign/source)
 *
 * Click logging is intentionally not stubbed here — it needs persistence
 * (Phase: click tracking) and must not pretend to record anything before then.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { store: storeId, product: productSlug } = await context.params;
  const product = getProductBySlug(productSlug);

  if (!product) {
    return NextResponse.redirect(new URL("/search", request.url), 302);
  }

  const offer = product.offers.find((item) => item.storeId === storeId);
  if (!offer) {
    return NextResponse.redirect(new URL(`/product/${productSlug}`, request.url), 302);
  }

  const destination = resolveOfferDestination(offer);
  if (!destination) {
    return NextResponse.redirect(new URL(`/product/${productSlug}`, request.url), 302);
  }

  const url = new URL(destination);

  const config = affiliateConfig[offer.storeId];
  if (config?.enabled) {
    for (const [key, value] of Object.entries(config.params)) {
      url.searchParams.set(key, value);
    }
  }

  const campaign = request.nextUrl.searchParams.get("campaign");
  const source = request.nextUrl.searchParams.get("source");
  if (campaign) url.searchParams.set("campaign", campaign);
  if (source) url.searchParams.set("source", source);

  return NextResponse.redirect(url.toString(), 302);
}
