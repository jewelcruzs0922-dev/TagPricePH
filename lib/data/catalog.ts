import "server-only";

import type { Product } from "@/lib/types";
import { getActiveProvider } from "@/lib/api/registry";
import { priceDropSlugs } from "@/lib/data/products";
import { getBrandsFrom } from "@/lib/data/search-core";
import { buildPriceDropFeed } from "@/lib/data/price-drops";

/**
 * The catalog, read through the active provider.
 *
 * Every list surface used to reach straight into `lib/data/products.ts` for
 * its homepage, category, price-drop, sitemap and brand reads. That file is
 * the sample seed: with `NEXT_PUBLIC_DEMO_MODE=false` search and product pages
 * served the database while those pages silently kept serving the static demo
 * catalog — a production build quietly falling back to sample data is exactly
 * what §18 forbids.
 *
 * This module is the seam that fixes it without changing how anything looks:
 * the provider decides (sample seed, database, or a marketplace adapter the
 * day one is authorized), and an empty or unusable catalog surfaces as an
 * empty state rather than as someone else's rows.
 */

export const FEATURED_PRODUCT_SLUG = "iphone-16-128gb";

/** Every product the active provider serves. */
export function listCatalog(): Promise<Product[]> {
  return getActiveProvider().listProducts();
}

/** The active catalog restricted to one category, for the category grid. */
export async function getCategoryProducts(categorySlug: string): Promise<Product[]> {
  const products = await listCatalog();
  return products.filter((product) => product.category === categorySlug);
}

/**
 * The homepage's hero product, resolved against the active catalog. Falls
 * back to the first product rather than to a hardcoded slug, so a catalog
 * that no longer carries the demo's headline item still has a hero.
 */
export async function getFeaturedProduct(): Promise<Product | null> {
  const products = await listCatalog();
  return (
    products.find((product) => product.slug === FEATURED_PRODUCT_SLUG) ??
    products[0] ??
    null
  );
}

/**
 * The homepage's drop row — drawn from the same feed the /price-drops page
 * shows, so the two surfaces cannot disagree, and capped at five so the
 * homepage keeps its shape.
 *
 * The demo's curated picks are preferred when this catalog still carries them
 * and they really do have a drop; a production catalog that shares none of
 * those slugs falls back to the strongest drops it actually has. Empty when
 * nothing dropped, which hides the section rather than decorating products
 * that have not.
 */
export async function getHomePriceDrops(): Promise<Product[]> {
  const products = await listCatalog();
  const feed = await buildPriceDropFeed(products);
  if (feed.products.length === 0) return [];

  const inFeed = new Map(feed.products.map((product) => [product.slug, product]));
  const curated = priceDropSlugs
    .map((slug) => inFeed.get(slug))
    .filter((product): product is Product => product !== undefined);

  return (curated.length > 0 ? curated : feed.products).slice(0, 5);
}

/** Distinct brands in the active catalog, for the search facet. */
export async function getCatalogBrands(): Promise<string[]> {
  return getBrandsFrom(await listCatalog());
}
