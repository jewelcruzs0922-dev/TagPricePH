import type { MetadataRoute } from "next";
import { baseUrl } from "@/lib/utils/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /go/ keeps outbound hops out of the index; /admin is the gated
        // operator dashboard and is never linked from the public site.
        disallow: ["/go/", "/admin"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
