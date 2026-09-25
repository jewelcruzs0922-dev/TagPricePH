import type { Product, SearchFilters, SearchSort } from "@/lib/types";
import { getLowestOffer, getPriceDropPercent } from "@/lib/pricing";

/**
 * Catalog-free search primitives.
 *
 * Kept separate from `lib/data/search.ts` so client components can filter a
 * result set handed to them by the server without pulling the whole sample
 * catalog into the browser bundle.
 */

const marketplaceHosts = ["shopee.", "lazada.", "tiktok."];

export function isProductUrl(query: string): boolean {
  const value = query.trim().toLowerCase();
  return /^https?:\/\//.test(value) && marketplaceHosts.some((host) => value.includes(host));
}

/** The landing state of the filters panel — shared so SSR and client agree. */
export const DEFAULT_FILTERS: SearchFilters = { inStockOnly: true };
export const DEFAULT_SORT: SearchSort = "lowest-price";

export function filterAndSortProducts(
  products: Product[],
  query: string,
  filters: SearchFilters = {},
  sort: SearchSort = "lowest-price",
): Product[] {
  const normalized = query.trim().toLowerCase();

  // Pasted marketplace links never reach this function with their URL intact:
  // `runSearch` resolves them through the Phase 5 matcher first and passes an
  // already-resolved product set with an empty query.
  let results = products.filter((product) => {
    if (!normalized) return true;
    const haystack = `${product.name} ${product.brand} ${product.category} ${product.sku ?? ""} ${(product.keywords ?? []).join(" ")}`.toLowerCase();
    return normalized.split(/\s+/).every((token) => haystack.includes(token));
  });

  if (filters.category) {
    results = results.filter((product) => product.category === filters.category);
  }
  if (filters.brand) {
    results = results.filter(
      (product) => product.brand.toLowerCase() === filters.brand!.toLowerCase(),
    );
  }
  if (filters.store) {
    results = results.filter((product) =>
      product.offers.some((offer) => offer.storeId === filters.store),
    );
  }
  if (typeof filters.maxPrice === "number") {
    results = results.filter((product) => {
      const lowest = getLowestOffer(product.offers);
      return lowest ? lowest.price <= filters.maxPrice! : false;
    });
  }
  if (filters.priceDropOnly) {
    results = results.filter((product) => (getPriceDropPercent(product) ?? 0) > 0);
  }
  if (filters.inStockOnly) {
    results = results.filter((product) =>
      product.offers.some((offer) => offer.inStock),
    );
  }

  const lowestPrice = (product: Product) => getLowestOffer(product.offers)?.price ?? 0;

  results = [...results].sort((a, b) => {
    switch (sort) {
      case "biggest-savings": {
        const saveA = Math.max(...a.offers.map((o) => o.price)) - lowestPrice(a);
        const saveB = Math.max(...b.offers.map((o) => o.price)) - lowestPrice(b);
        return saveB - saveA;
      }
      case "biggest-drop": {
        const dropA = getPriceDropPercent(a) ?? 0;
        const dropB = getPriceDropPercent(b) ?? 0;
        return dropB - dropA;
      }
      case "recently-updated": {
        const updatedA = Math.max(...a.offers.map((o) => Date.parse(o.updatedAt)));
        const updatedB = Math.max(...b.offers.map((o) => Date.parse(o.updatedAt)));
        return updatedB - updatedA;
      }
      case "lowest-price":
      default:
        return lowestPrice(a) - lowestPrice(b);
    }
  });

  return results;
}

export function filterSuggestions(products: Product[], query: string): Product[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return products
    .filter((product) => {
      const haystack = `${product.name} ${product.brand} ${(product.keywords ?? []).join(" ")}`.toLowerCase();
      return normalized.split(/\s+/).every((token) => haystack.includes(token));
    })
    .slice(0, 5);
}

export function getBrandsFrom(products: Product[]): string[] {
  return Array.from(new Set(products.map((product) => product.brand))).sort();
}
