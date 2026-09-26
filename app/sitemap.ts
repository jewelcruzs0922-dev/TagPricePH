import type { MetadataRoute } from "next";
import { listCatalog } from "@/lib/data/catalog";
import { categories } from "@/lib/data/categories";
import { baseUrl } from "@/lib/utils/seo";

// Product URLs come from the catalog, so the sitemap must not stay frozen at
// build: a product introduced after deployment reaches crawlers within five
// minutes, with no rebuild (Live Data Readiness §9).
export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/search`, changeFrequency: "daily", priority: 0.7 },
    { url: `${baseUrl}/price-drops`, changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/categories`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${baseUrl}/alerts`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${baseUrl}/about`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/help`, changeFrequency: "monthly", priority: 0.3 },
  ];

  const categoryRoutes: MetadataRoute.Sitemap = categories.map((category) => ({
    url: `${baseUrl}/categories/${category.slug}`,
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  // Enumerated from the active provider, never from the sample seed: a
  // sitemap that lists pages the site does not serve sends crawlers after
  // URLs that 404 (or worse, after sample products in a production build).
  const products = await listCatalog();
  const productRoutes: MetadataRoute.Sitemap = products.map((product) => ({
    url: `${baseUrl}/product/${product.slug}`,
    changeFrequency: "daily" as const,
    priority: 0.9,
  }));

  return [...staticRoutes, ...categoryRoutes, ...productRoutes];
}
