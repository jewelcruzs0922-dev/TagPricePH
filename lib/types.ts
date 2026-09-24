export type Store = {
  id: string;
  name: string;
  color: string;
  short: string;
};

export type PricePoint = {
  date: string;
  price: number;
};

export type StoreOffer = {
  storeId: string;
  price: number;
  url: string;
  updatedAt: string;
  inStock: boolean;
};

export type BuyTiming = {
  status: "good" | "fair" | "wait";
  label: string;
  detail: string;
  percentVsAverage: number;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: string;
  sku?: string;
  tagline?: string;
  keywords?: string[];
  image: string;
  specs?: string[];
  offers: StoreOffer[];
  priceHistory: PricePoint[];
  dropPercent?: number;
  previousPrice?: number;
  reviewCount?: number;
  rating?: number;
};

export type Category = {
  slug: string;
  name: string;
  icon: string;
  blurb: string;
};

export type SearchFilters = {
  category?: string;
  brand?: string;
  store?: string;
  maxPrice?: number;
  priceDropOnly?: boolean;
  inStockOnly?: boolean;
};

export type SearchSort =
  | "lowest-price"
  | "biggest-savings"
  | "biggest-drop"
  | "recently-updated";
