import type { MetadataRoute } from "next";
import { products } from "@/lib/data/products";
import { categories } from "@/lib/data/categories";
import { baseUrl } from "@/lib/utils/seo";

export default function sitemap(): MetadataRoute.Sitemap {
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

  const productRoutes: MetadataRoute.Sitemap = products.map((product) => ({
    url: `${baseUrl}/product/${product.slug}`,
    changeFrequency: "daily" as const,
    priority: 0.9,
  }));

  return [...staticRoutes, ...categoryRoutes, ...productRoutes];
}
