import type { PricePoint, Product, StoreOffer } from "@/lib/types";

export interface MarketplaceProvider {
  searchProducts(query: string): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  getOffers(productId: string): Promise<StoreOffer[]>;
  getPriceHistory(productId: string): Promise<PricePoint[]>;
}
