import type { MetadataRoute } from "next";
import { baseUrl } from "@/lib/utils/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: "/go/",
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
