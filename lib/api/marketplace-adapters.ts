import type { DataSource } from "@/lib/types";
import type { MarketplaceProvider, ProviderId } from "@/lib/api/provider";

/**
 * The marketplace adapter layer: the seam's concrete side.
 *
 * Phase 2/8 of the plan — Shopee, Lazada, and TikTok Shop each get an adapter
 * so any one of them can be enabled independently the moment an authorized
 * data source exists, without a single page changing. Until then each is
 * registered as "unavailable" with a reason.
 *
 * Deliberately free of value imports (only types are imported, which are
 * erased) and free of `server-only`, because scripts/providers-verify.mjs
 * imports this module from plain Node to assert its state. `registry.ts` is
 * the only module that hands an adapter to the app, and it carries
 * `server-only`, so an adapter still cannot reach a client bundle.
 *
 * When a marketplace is authorized: implement the four methods here or extract
 * them to their own file, set `status: "ready"`, and delete the reason.
 */

/**
 * Thrown when an unavailable provider is asked for data, or when the registry
 * is asked to hand one out as the app's active provider.
 */
export class ProviderUnavailableError extends Error {
  readonly providerId: string;
  readonly reason: string;

  constructor(providerId: string, reason: string) {
    super(`Provider "${providerId}" is unavailable: ${reason}`);
    this.name = "ProviderUnavailableError";
    this.providerId = providerId;
    this.reason = reason;
  }
}

/** Refuses to let an unavailable provider become the app's data source. */
export function assertUsableProvider(provider: MarketplaceProvider): void {
  if (provider.status === "unavailable") {
    throw new ProviderUnavailableError(
      provider.id,
      provider.unavailableReason ?? "no reason recorded",
    );
  }
}

export type UnavailableProviderSpec = {
  id: ProviderId;
  /**
   * The source it would report once connected. Never read while unavailable —
   * every method refuses first.
   */
  source: DataSource;
  /** Why we cannot read it yet, in one sentence. Surfaced verbatim on refusal. */
  reason: string;
};

/**
 * Builds an adapter that is registered but cannot answer.
 *
 * Returning `[]` was the alternative and is exactly wrong: an empty catalog
 * renders as a working site claiming a marketplace has no products, a claim
 * this codebase has no way to support.
 */
export function unavailableProvider(spec: UnavailableProviderSpec): MarketplaceProvider {
  const refuse = (): never => {
    throw new ProviderUnavailableError(spec.id, spec.reason);
  };

  return {
    id: spec.id,
    source: spec.source,
    status: "unavailable",
    unavailableReason: spec.reason,
    listProducts: refuse,
    searchProducts: refuse,
    getProduct: refuse,
    getRelatedProducts: refuse,
  };
}

/**
 * Shopee Philippines — reserved, not connected.
 *
 * TagPricePH has no authorized way to read Shopee listings: no official API
 * credentials, no affiliate-network product feed, and no permission to fetch
 * pages on our behalf. Scraping it would violate Shopee's terms, so we do
 * not. Set `status: "ready"` when an approved source exists.
 */
export const shopeeProvider: MarketplaceProvider = unavailableProvider({
  id: "shopee",
  source: "live",
  reason:
    "TagPricePH has no authorized Shopee data source yet — no API credentials and no permitted product feed.",
});

/**
 * Lazada Philippines — reserved, not connected. Same position as Shopee:
 * no official API credentials and no permitted feed, and no scraping.
 */
export const lazadaProvider: MarketplaceProvider = unavailableProvider({
  id: "lazada",
  source: "live",
  reason:
    "TagPricePH has no authorized Lazada data source yet — no API credentials and no permitted product feed.",
});

/**
 * TikTok Shop Philippines — reserved, not connected. No approved TikTok Shop
 * API access or partner feed yet, so the adapter refuses rather than guessing.
 */
export const tiktokShopProvider: MarketplaceProvider = unavailableProvider({
  id: "tiktok",
  source: "live",
  reason:
    "TagPricePH has no authorized TikTok Shop data source yet — no API credentials and no permitted product feed.",
});
