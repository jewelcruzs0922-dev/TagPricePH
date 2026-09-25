import type { DataSource, Product, StoreOffer } from "@/lib/types";
import { getDataSource } from "@/lib/data/observations";
import { getStore } from "@/lib/data/stores";
import { formatPeso } from "@/lib/utils/format";

/**
 * Truth gates — every outward claim about a price must declare its basis.
 *
 * Sample data is allowed to be shown. It is never allowed to be shown *as* a
 * live price, and that includes the two audiences that cannot see a page-level
 * disclaimer: search engines reading JSON-LD, and shoppers reading a SERP
 * snippet.
 *
 * The gate reads the product's own data source rather than DEMO_MODE, so a
 * flag can never launder generated figures into something presented as current.
 * When a real provider starts emitting source:"live" readings, these gates open
 * on their own — no call site has to be revisited.
 */

export const SAMPLE_DISCLAIMER = "Sample data — not live retailer prices.";

export function getClaimSource(product: Product): DataSource {
  return getDataSource(product);
}

/** True when this product's figures are illustrative rather than observed. */
export function isSampleClaim(product: Product): boolean {
  return getClaimSource(product) !== "live";
}

/** On-page qualifier for a price surface, or null when no caveat is needed. */
export function claimQualifier(product: Product): string | null {
  return isSampleClaim(product) ? SAMPLE_DISCLAIMER : null;
}

/**
 * Product structured data.
 *
 * `offers` states what a product costs right now, in a vocabulary search
 * engines treat as fact. Sample figures cannot be softened into "illustrative"
 * inside schema.org, so they are omitted entirely — the page stays indexable
 * under its own name, brand, and SKU, and the on-page comparison still carries
 * the sample labels.
 */
export function buildProductJsonLd(product: Product): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    brand: { "@type": "Brand", name: product.brand },
  };

  if (!isSampleClaim(product)) {
    jsonLd.offers = product.offers.map((offer: StoreOffer) => ({
      "@type": "Offer",
      price: offer.price,
      priceCurrency: "PHP",
      availability: offer.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: getStore(offer.storeId).name },
      ...(offer.url ? { url: offer.url } : {}),
    }));
  }

  return jsonLd;
}

/**
 * Meta description / Open Graph description.
 *
 * The SERP snippet has no room for a page-level disclaimer, so the sample
 * qualifier leads the sentence rather than trailing it — truncation must never
 * be able to cut the caveat off a fabricated price.
 */
export function buildMetaDescription(
  product: Product,
  lowestPrice: number | null,
): string {
  const comparison =
    `Compare ${product.name} across Philippine stores, see its price history, ` +
    `and check whether it is a good time to buy.`;

  if (isSampleClaim(product)) {
    return `Sample data. ${comparison}`;
  }

  if (lowestPrice === null) return comparison;
  return `${product.name} lowest price is ${formatPeso(lowestPrice)}. ${comparison}`;
}
