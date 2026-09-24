import "server-only";
import type { PricePoint, Product, StoreOffer } from "@/lib/types";
import type { MarketplaceProvider } from "@/lib/api/provider";
import { products, getProductBySlug } from "@/lib/data/products";
import { searchProducts } from "@/lib/data/search";

/**
 * Demo provider backed by local sample data.
 * Replace with a marketplace API / partner feed implementation later.
 */
export const demoProvider: MarketplaceProvider = {
  async searchProducts(query: string): Promise<Product[]> {
    return searchProducts(query);
  },
  async getProduct(id: string): Promise<Product | null> {
    return getProductBySlug(id) ?? products.find((product) => product.id === id) ?? null;
  },
  async getOffers(productId: string): Promise<StoreOffer[]> {
    const product = products.find((item) => item.id === productId || item.slug === productId);
    return product?.offers ?? [];
  },
  async getPriceHistory(productId: string): Promise<PricePoint[]> {
    const product = products.find((item) => item.id === productId || item.slug === productId);
    return product?.priceHistory ?? [];
  },
};
