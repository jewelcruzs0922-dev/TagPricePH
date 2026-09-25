/**
 * TagPricePH's data model — Phase 3's normalized concept as this codebase
 * expresses it ("Do not blindly copy these types if the existing
 * architecture already has a better equivalent"):
 *
 *   Product identity      → Product (id/slug/brand/category/sku) and the
 *                           `products` table (db/migrations/0006_catalog.sql)
 *   Product variants      → separate Products at slug level: iPhone 16 128GB
 *                           ≠ 256GB is Phase 7's matching contract, so each
 *                           purchasable configuration gets its own identity.
 *                           `product_variants` exists for feeds that express
 *                           options as one product with attributes.
 *   Marketplace listing / → StoreOffer: one row per store's listing of a
 *   Store offer             product (unique per product+store+external listing
 *                           id in `offers`), carrying price, availability, url,
 *                           freshness, and — when a marketplace actually
 *                           issues one — a separate affiliate URL
 *   Price observation     → PriceObservation + the price_observations table —
 *                           strictly separate from current price: current =
 *                           latest observation, history = the series. The TS
 *                           priceHistory field is the demo series only.
 *   Store                 → Store + the `stores` table
 *   Affiliate information → StoreOffer.affiliateUrl, set only when a provider
 *                           hands us that marketplace's real affiliate link.
 *                           Never assembled in components and never guessed:
 *                           affiliate_url stays NULL until real credentials
 *                           exist (Phase 9 — never fabricate parameters).
 *                           A normal product URL is not an affiliate URL.
 */

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

/**
 * How old an offer's last check is, in four states rather than three.
 *
 * "fresh"    — within the provider's normal cadence: a confident current price.
 * "aging"    — past cadence but inside the freshness window: rankable, shown
 *              with a "may be out of date" note.
 * "stale"    — past the freshness window: contextual data only. It may still
 *              be displayed, but it must never win a current-price ranking.
 * "unknown"  — the timestamp cannot be read, so its age is unknowable. Treated
 *              like stale for ranking: we do not rank what we cannot date.
 */
export type FreshnessState = "fresh" | "aging" | "stale" | "unknown";

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
  /** The retailer's own page for this listing — what we fall back to. */
  url: string;
  /**
   * That marketplace's real affiliate link for this listing, when the
   * affiliate programme has actually issued one. Null/absent is the normal
   * state and the system works without it; an affiliate URL is never
   * synthesised from the product URL.
   */
  affiliateUrl?: string;
  /** `marketplace_listings.id` this offer is the current state of, when known. */
  listingId?: number;
  updatedAt: string;
  inStock: boolean;
  source: DataSource;
  seller?: string;
  /**
   * Set only when a provider reports that this listing is not the plain
   * single-item product the comparison assumes. Rendered as a label and used
   * to keep the listing out of the ranking — never inferred, because a
   * guessed "Bundle" is exactly as damaging as a guessed price.
   */
  condition?: "bundle" | "different_variant";
};

export type BuyTiming = {
  status: "good" | "fair" | "wait";
  label: string;
  detail: string;
  percentVsAverage: number;
  /**
   * Set when there is not yet enough recorded history to compare against, so
   * the label reads "Not enough history yet" instead of asserting a verdict
   * the data cannot support.
   */
  insufficient?: boolean;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: string;
  sku?: string;
  /** Manufacturer model number, when the catalog knows it — matches by it first. */
  modelNumber?: string;
  /** GTIN/EAN/UPC, when the catalog knows it — the strongest identity we have. */
  gtin?: string;
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
