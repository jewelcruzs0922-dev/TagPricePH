import "server-only";

import type { Product } from "@/lib/types";
import type { MarketplaceProvider } from "@/lib/api/provider";
import { getProductBySlug, getRelatedProducts, products } from "@/lib/data/products";
import { searchProducts } from "@/lib/data/search";

/**
 * Sample catalog served through the demo provider.
 *
 * Every reading it yields carries source:"demo" — that tag is what keeps the
 * "Sample data" labels truthful once a live provider exists alongside it.
 */
export const demoProvider: MarketplaceProvider = {
  id: "demo",
  source: "demo",

  async listProducts(): Promise<Product[]> {
    return products;
  },

  /** Query match only; facet filters and sorting are applied by the caller. */
  async searchProducts(query: string): Promise<Product[]> {
    return searchProducts(query);
  },

  async getProduct(slug: string): Promise<Product | null> {
    return getProductBySlug(slug) ?? null;
  },

  async getRelatedProducts(product: Product, limit = 4): Promise<Product[]> {
    return getRelatedProducts(product, limit);
  },
};
