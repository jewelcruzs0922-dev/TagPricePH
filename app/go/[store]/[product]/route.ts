import { NextRequest, NextResponse } from "next/server";
import { getProductBySlug } from "@/lib/data/products";

type RouteContext = {
  params: Promise<{ store: string; product: string }>;
};

/**
 * Outbound redirect for retailer deals.
 * Affiliate parameters, click logging, and store URL mapping live here — not in UI code.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { store: storeId, product: productSlug } = await context.params;
  const product = getProductBySlug(productSlug);

  if (!product) {
    return NextResponse.redirect(new URL("/search", request.url), 302);
  }

  const offer = product.offers.find((item) => item.storeId === storeId);
  const destination = offer?.url;

  if (!destination) {
    return NextResponse.redirect(new URL(`/product/${productSlug}`, request.url), 302);
  }

  const url = new URL(destination);
  url.searchParams.set("ref", "tagpriceph");
  const campaign = request.nextUrl.searchParams.get("campaign");
  const source = request.nextUrl.searchParams.get("source");
  if (campaign) url.searchParams.set("campaign", campaign);
  if (source) url.searchParams.set("source", source);

  // Future: record click events (store, product, campaign) before redirecting.
  return NextResponse.redirect(url.toString(), 302);
}
