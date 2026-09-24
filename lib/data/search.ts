import type { Product, SearchFilters, SearchSort } from "@/lib/types";
import { products } from "@/lib/data/products";
import {
  filterAndSortProducts,
  filterSuggestions,
  getBrandsFrom,
  isProductUrl,
} from "@/lib/data/search-core";

/**
 * Sample-catalog bindings for the catalog-free primitives in search-core.
 *
 * Server code and the demo provider read through this. Client components that
 * are handed a result set by the server should import search-core directly so
 * they do not drag the sample catalog into the browser bundle.
 */
export { filterAndSortProducts, isProductUrl };

export function searchProducts(
  query: string,
  filters: SearchFilters = {},
  sort: SearchSort = "lowest-price",
): Product[] {
  return filterAndSortProducts(products, query, filters, sort);
}

export function getSuggestions(query: string): Product[] {
  return filterSuggestions(products, query);
}

export function getPopularSearches(): string[] {
  return ["iPhone 16", "AirPods Pro", "PS5", "RTX 5060", "Samsung TV"];
}

export function getBrands(): string[] {
  return getBrandsFrom(products);
}
