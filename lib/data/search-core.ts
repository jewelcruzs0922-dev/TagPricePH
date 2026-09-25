import type { Product, SearchFilters, SearchSort } from "@/lib/types";
import { getLowestOffer, getPriceDropPercent, getSavings } from "@/lib/pricing";
import { matchQueryIn, type QueryMatch } from "@/lib/search/typo";

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

/** The text a search query is matched against, lowercased. */
function searchHaystack(product: Product): string {
  return [
    product.name,
    product.brand,
    product.category,
    product.sku ?? "",
    product.modelNumber ?? "",
    product.gtin ?? "",
    (product.keywords ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Selects query matches in two passes: every exact (substring) match first,
 * and the typo-tolerant pass only when the exact pass found nothing. A query
 * that works today therefore returns exactly what it returned before Phase
 * 11; fuzzy results only ever appear where the query used to come up empty.
 */
function selectByQuery(products: Product[], normalized: string): Product[] {
  if (!normalized) return [...products];
  const tokens = normalized.split(/\s+/);
  const exact: Product[] = [];
  const fuzzy: Product[] = [];
  for (const product of products) {
    const match = matchQueryIn(searchHaystack(product), tokens);
    if (match === "exact") exact.push(product);
    else if (match === "fuzzy") fuzzy.push(product);
  }
  return exact.length > 0 ? exact : fuzzy;
}

/**
 * How a whole result set was matched, for the note the search page shows.
 *
 * "fuzzy" means nothing in the candidate set matched exactly — the query
 * came up empty before Phase 11 — so the page can say so instead of silently
 * showing near-misses as if they were the answer.
 */
export function queryMatchMode(products: Product[], query: string): QueryMatch {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return "exact";
  const tokens = normalized.split(/\s+/);
  let sawFuzzy = false;
  for (const product of products) {
    const match = matchQueryIn(searchHaystack(product), tokens);
    if (match === "exact") return "exact";
    if (match === "fuzzy") sawFuzzy = true;
  }
  return sawFuzzy ? "fuzzy" : "none";
}

/** The landing state of the filters panel — shared so SSR and client agree. */
export const DEFAULT_FILTERS: SearchFilters = { inStockOnly: true };
export const DEFAULT_SORT: SearchSort = "lowest-price";

/**
 * The browser-facing form of a result set.
 *
 * `priceHistory` is server-only bulk: 150 products × 90 points serialized to
 * the client turned an empty search into over a megabyte of HTML, and the
 * client never reads it — filtering sorts on name/brand/sku/keywords/offers,
 * the drop uses `previousPrice`, and the verdict arrives separately as
 * `timings` (resolved from the recorded series before this runs). The array
 * is emptied rather than removed so `evaluateBuyTiming(product)` still
 * answers honestly ("not enough history") if a card renders without a timing.
 */
export function toClientProducts(products: Product[]): Product[] {
  return products.map((product) => ({ ...product, priceHistory: [] }));
}

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
  let results = selectByQuery(products, normalized);

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

  // Ranking runs on eligible current offers only (lib/pricing). A product
  // with no valid current price has no lowest price to sort by, so it sinks
  // to the end rather than floating to the top on a price of 0.
  const lowestPrice = (product: Product) => getLowestOffer(product.offers)?.price ?? null;

  results = [...results].sort((a, b) => {
    switch (sort) {
      case "biggest-savings":
        return getSavings(b.offers) - getSavings(a.offers);
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
      default: {
        const priceA = lowestPrice(a);
        const priceB = lowestPrice(b);
        if (priceA === priceB) return 0;
        if (priceA === null) return 1;
        if (priceB === null) return -1;
        return priceA - priceB;
      }
    }
  });

  return results;
}

export function filterSuggestions(products: Product[], query: string): Product[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/);
  const exact: Product[] = [];
  const fuzzy: Product[] = [];
  for (const product of products) {
    const haystack = `${product.name} ${product.brand} ${(product.keywords ?? []).join(" ")}`.toLowerCase();
    const match = matchQueryIn(haystack, tokens);
    if (match === "exact") exact.push(product);
    else if (match === "fuzzy") fuzzy.push(product);
  }
  return (exact.length > 0 ? exact : fuzzy).slice(0, 5);
}

export function getBrandsFrom(products: Product[]): string[] {
  return Array.from(new Set(products.map((product) => product.brand))).sort();
}
