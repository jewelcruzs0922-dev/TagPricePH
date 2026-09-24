import type { Product, SearchFilters, SearchSort } from "@/lib/types";
import { products } from "@/lib/data/products";
import { getLowestOffer, getPriceDropPercent } from "@/lib/pricing";

const marketplaceHosts = ["shopee.", "lazada.", "tiktok."];

export function isProductUrl(query: string): boolean {
  const value = query.trim().toLowerCase();
  return /^https?:\/\//.test(value) && marketplaceHosts.some((host) => value.includes(host));
}

export function searchProducts(
  query: string,
  filters: SearchFilters = {},
  sort: SearchSort = "lowest-price",
): Product[] {
  const normalized = query.trim().toLowerCase();
  const urlSearch = isProductUrl(query);

  let results = products.filter((product) => {
    if (urlSearch) {
      const haystack = `${product.brand} ${product.name}`.toLowerCase();
      return haystack.includes("iphone") || haystack.includes("airpods");
    }
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

export function getSuggestions(query: string): Product[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return products
    .filter((product) => {
      const haystack = `${product.name} ${product.brand} ${(product.keywords ?? []).join(" ")}`.toLowerCase();
      return normalized.split(/\s+/).every((token) => haystack.includes(token));
    })
    .slice(0, 5);
}

export function getPopularSearches(): string[] {
  return ["iPhone 16", "AirPods Pro", "PS5", "RTX 5060", "Samsung TV"];
}

export function getBrands(): string[] {
  return Array.from(new Set(products.map((product) => product.brand))).sort();
}
