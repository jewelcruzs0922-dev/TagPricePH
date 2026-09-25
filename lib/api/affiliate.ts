import type { Store, StoreOffer } from "@/lib/types";

export type AffiliateContext = {
  campaign?: string;
  source?: string;
};

/**
 * Hosts we are allowed to redirect to. Anything else is refused.
 * This matters the moment offer URLs stop coming from static seed data.
 */
export const ALLOWED_REDIRECT_HOSTS: readonly string[] = [
  "shopee.ph",
  "www.shopee.ph",
  "lazada.com.ph",
  "www.lazada.com.ph",
  "tiktok.com",
  "www.tiktok.com",
  "abenson.com",
  "www.abenson.com",
  "smstore.com",
  "www.smstore.com",
];

export function isSafeRedirectUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return ALLOWED_REDIRECT_HOSTS.includes(url.hostname);
}

/**
 * The single place that decides where an outbound click goes.
 *
 *   offer.affiliates a real affiliate link → use it
 *   otherwise                     → use the retailer's normal product URL
 *   neither is a safe, allowlisted https URL → null ("no deal available")
 *
 * Two rules this exists to keep:
 *
 *  1. A normal marketplace URL is not an affiliate URL. `affiliateUrl` is
 *     present only when a provider stored the link that marketplace's own
 *     programme issued; nothing here ever derives one, and a missing
 *     affiliate URL is a perfectly good outcome rather than a gap to fill.
 *  2. Destinations are allowlisted. A stored URL is attacker-controlled the
 *     moment a provider or a database write is, so `/go/...` must never be
 *     able to redirect to an arbitrary host, a `javascript:` scheme, or a
 *     `data:` payload.
 *
 * Marketplace-specific construction does not belong anywhere else: no
 * component, route, or helper may assemble an outbound URL itself.
 */
export function resolveOutboundUrl(offer: StoreOffer): string | null {
  if (offer.affiliateUrl && isSafeRedirectUrl(offer.affiliateUrl)) {
    return offer.affiliateUrl;
  }
  if (offer.url && isSafeRedirectUrl(offer.url)) {
    return offer.url;
  }
  return null;
}

/**
 * Builds the outbound retailer URL for a store offer.
 *
 * This is TagPricePH's own redirect path, not the retailer's URL — the
 * affiliate link, when one exists, is stored on the offer and resolved by
 * `resolveOutboundUrl` at click time. No tracking parameter is appended
 * anywhere: a fabricated `?ref=` would misrepresent an untracked link as a
 * tracked one.
 */
export function getAffiliateUrl(
  store: Pick<Store, "id" | "name">,
  product: { id: string; slug: string },
  context: AffiliateContext = {},
): string {
  const params = new URLSearchParams();
  if (context.campaign) params.set("campaign", context.campaign);
  if (context.source) params.set("source", context.source);
  const query = params.toString();
  return `/go/${store.id}/${product.slug}${query ? `?${query}` : ""}`;
}

export function getRedirectPath(storeId: string, productSlug: string): string {
  return `/go/${storeId}/${productSlug}`;
}
