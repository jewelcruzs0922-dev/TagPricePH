/**
 * The single source of truth for the site's absolute origin. Every canonical
 * link, og:url, sitemap entry, robots sitemap, and breadcrumb JSON-LD is
 * derived from here — one configurable value, not a domain sprinkled around.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_SITE_URL — the production override (baked in at
 *      `next build`, so set it in the environment BEFORE building).
 *   2. Vercel's own production URL — only on Vercel production deployments,
 *      so preview URLs never become canonical.
 *   3. The current deployment URL as a last resort — local builds keep
 *      working with no configuration.
 *
 * A custom domain must never be hardcoded here: set NEXT_PUBLIC_SITE_URL
 * in the deployment environment instead.
 */
function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

export function resolveBaseUrl(env: {
  siteUrl?: string | undefined;
  productionUrl?: string | undefined;
} = {}): string {
  const configured = normalizeBaseUrl(env.siteUrl ?? "");
  if (configured) return configured;
  const production = normalizeBaseUrl(env.productionUrl ?? "");
  if (production) return production;
  return "https://tagpriceph.vercel.app";
}

export const baseUrl = resolveBaseUrl({
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  productionUrl:
    process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : undefined,
});

export const metadataConfig = {
  title: "TagPricePH — Find the Lowest Price. Know When to Buy.",
  description:
    "Compare prices across Philippine online stores, track price history, find price drops, and know when it's a good time to buy.",
};
