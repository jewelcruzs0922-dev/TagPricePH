import type { Store, StoreOffer } from "@/lib/types";

export type AffiliateContext = {
  campaign?: string;
  source?: string;
};

/**
 * Per-marketplace affiliate configuration.
 *
 * `params` stays empty until real credentials exist. Never invent tracking
 * parameters — a fabricated affiliate param is worse than none, because it
 * silently breaks attribution and misrepresents the link as tracked.
 */
export type AffiliateConfig = {
  enabled: boolean;
  params: Record<string, string>;
};

export const affiliateConfig: Record<string, AffiliateConfig> = {
  shopee: { enabled: false, params: {} },
  lazada: { enabled: false, params: {} },
  tiktok: { enabled: false, params: {} },
  abensons: { enabled: false, params: {} },
  sm: { enabled: false, params: {} },
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
 * Resolves the outbound destination for an offer and validates it.
 * Returns null when the destination is missing, malformed, or not on
 * the allowlist — callers must treat null as "no deal available".
 */
export function resolveOfferDestination(offer: StoreOffer): string | null {
  if (!offer.url) return null;
  if (!isSafeRedirectUrl(offer.url)) return null;
  return offer.url;
}

/**
 * Builds the outbound retailer URL for a store offer.
 * Affiliate parameters belong here — never inside UI components.
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
