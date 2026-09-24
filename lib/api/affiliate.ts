import type { Store } from "@/lib/types";

export type AffiliateContext = {
  campaign?: string;
  source?: string;
};

/**
 * Builds the outbound retailer URL for a store offer.
 * Affiliate parameters belong here — never inside UI components.
 * Swap the body for a real affiliate-network mapping when credentials exist.
 */
export function getAffiliateUrl(
  store: Pick<Store, "id" | "name">,
  product: { id: string; slug: string },
  context: AffiliateContext = {},
): string {
  const params = new URLSearchParams();
  params.set("ref", "tagpriceph");
  if (context.campaign) params.set("campaign", context.campaign);
  if (context.source) params.set("source", context.source);
  return `/go/${store.id}/${product.slug}?${params.toString()}`;
}

export function getRedirectPath(storeId: string, productSlug: string): string {
  return `/go/${storeId}/${productSlug}`;
}
