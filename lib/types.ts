export type Store = {
  id: string;
  name: string;
  color: string;
  short: string;
};

/**
 * Where a piece of price data came from.
 * "demo"  — generated sample data, never presented as live.
 * "live"  — observed from an authorized source.
 */
export type DataSource = "demo" | "live";

export type Availability = "in_stock" | "out_of_stock";

export type FreshnessState = "fresh" | "stale" | "unavailable";

export type PricePoint = {
  date: string;
  price: number;
};

/**
 * A single timestamped price reading for one offer.
 * Append-only: current price = latest observation, history = the series.
 */
export type PriceObservation = {
  id: string;
  offerId: string;
  price: number;
  observedAt: string;
  availability: Availability;
  source: DataSource;
};

export type StoreOffer = {
  storeId: string;
  price: number;
  url: string;
  updatedAt: string;
  inStock: boolean;
  source: DataSource;
  seller?: string;
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
