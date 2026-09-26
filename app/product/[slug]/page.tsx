import type { Metadata } from "next";
import type { Product } from "@/lib/types";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Star } from "lucide-react";
import { getActiveProvider } from "@/lib/api/registry";
import { getCategory } from "@/lib/data/categories";
import { baseUrl } from "@/lib/utils/seo";
import {
  evaluateBuyTiming,
  getEligibleCurrentOffers,
  getLowestOffer,
  getRecordedPriceDrop,
  getSavings,
} from "@/lib/pricing";
import { formatPeso } from "@/lib/utils/format";
import { formatRelativeTime, getFreshness } from "@/lib/utils/freshness";
import { getStore } from "@/lib/data/stores";
import { getAffiliateUrl } from "@/lib/api/affiliate";
import { buildMetaDescription, buildProductJsonLd, isSampleClaim } from "@/lib/trust";
import { serializeJsonLd } from "@/lib/utils/jsonld";
import { resolveBuyTimings, resolvePriceSeries } from "@/lib/db/observations";
import { StoreComparison } from "@/components/comparison/StoreComparison";
import { ProductViewTracker } from "@/components/analytics/ProductViewTracker";
import { SavingsBadge } from "@/components/comparison/SavingsBadge";
import { BuyTimingIndicator } from "@/components/products/BuyTimingIndicator";
import { PriceHistoryChart } from "@/components/price-history/PriceHistoryChart";
import { PriceAlertForm } from "@/components/price-alert/PriceAlert";
import { ProductCard } from "@/components/products/ProductCard";

type ProductPageProps = {
  params: Promise<{ slug: string }>;
};

const SAMPLE_DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** The date shown beside a sample label: this product's own newest reading. */
function formatSampleDate(product: Product): string {
  const newest = product.offers.reduce(
    (max, offer) => Math.max(max, Date.parse(offer.updatedAt)),
    0,
  );
  return Number.isFinite(newest) && newest > 0
    ? SAMPLE_DATE_FORMAT.format(newest)
    : "an earlier run";
}

/**
 * Freshness contract (Live Data Readiness §2):
 *
 * - ISR with a 60-second window: a price updated in the database is on the
 *   public page within a minute of the next visit, with no deployment. Every
 *   product is still prerendered at build (fast first hit, crawlable HTML),
 *   and `generateStaticParams` stays for the same reason.
 * - `dynamicParams` defaults to true, so a product introduced by an
 *   authorized ingestion job after build resolves on demand instead of
 *   404-ing until the next deploy.
 * - An *unknown* slug answers with a real HTTP 404: `notFound()` fires in
 *   `generateMetadata` / the page before anything streams. This segment has
 *   NO `loading.tsx` on purpose — a file-based loading boundary streams its
 *   fallback (and with it a committed 200) before `notFound()` can throw,
 *   which is exactly the soft-404 the old `dynamicParams = false` guard
 *   existed to prevent. Do not add one back without another way to keep the
 *   status honest.
 * - After ingestion, `app/api/ingest/route.ts` revalidates the affected
 *   paths explicitly (on-demand), so a live provider's writes show up
 *   immediately rather than waiting out the window.
 */
export const revalidate = 60;

export async function generateStaticParams() {
  const products = await getActiveProvider().listProducts();
  return products.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getActiveProvider().getProduct(slug);
  // A hard 404 for a slug that does not exist — including one introduced
  // after build, which now renders on demand (see `revalidate` above).
  if (!product) notFound();
  const lowest = getLowestOffer(product.offers);
  const description = buildMetaDescription(product, lowest?.price ?? null);
  const title = `${product.name} Price Philippines — TagPricePH`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      title,
      description,
      url: `/product/${product.slug}`,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const provider = getActiveProvider();
  const product = await provider.getProduct(slug);
  if (!product) notFound();

  const lowest = getLowestOffer(product.offers);
  const savings = getSavings(product.offers);
  const series = await resolvePriceSeries(product);
  const timing = evaluateBuyTiming(product, series.points);
  // Sample status comes from this product's own offers, not from a global
  // flag about the seed catalog: with DATA_PROVIDER=db a live row must not be
  // labelled sample, and a sample row must never be labelled live.
  const sampleShown = isSampleClaim(product);
  // The date beside a sample label is this product's own newest reading, so
  // the stamp always describes the figures on screen.
  const sampleAsOf = formatSampleDate(product);
  // One eligibility funnel for the whole page: the "Highest" a shopper could
  // actually buy today, so it can never sit beside a "You could save" figure
  // computed from a different set of offers.
  const eligibleOffers = getEligibleCurrentOffers(product.offers);
  const eligibleHighest = eligibleOffers.length
    ? Math.max(...eligibleOffers.map((item) => item.price))
    : null;
  // Null while the observation store is empty — the demo reference price must
  // never be dressed up as a recorded drop.
  const recordedDrop = getRecordedPriceDrop(series, lowest?.price ?? 0);
  const related = await provider.getRelatedProducts(product, 4);
  const relatedTimings = await resolveBuyTimings(related);
  const bestStore = lowest ? getStore(lowest.storeId) : null;
  const bestHref = lowest && bestStore ? getAffiliateUrl(bestStore, product, { source: "product-hero" }) : "#";

  const jsonLd = buildProductJsonLd(product);

  const category = getCategory(product.category);
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${baseUrl}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: category?.name ?? "Categories",
        item: `${baseUrl}/categories/${product.category}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: product.name,
        item: `${baseUrl}/product/${product.slug}`,
      },
    ],
  };

  return (
    <div className="container-page py-6 sm:py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbLd) }}
      />
      <ProductViewTracker slug={product.slug} />

      <nav aria-label="Breadcrumb" className="mb-5">
        <ol className="flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
          <li>
            <Link href="/" className="inline-flex items-center gap-1 py-1 hover:text-ink">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href={`/categories/${product.category}`}
              className="inline-block py-1 hover:text-ink"
            >
              {category?.name ?? product.category.replace(/-/g, " ")}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="min-w-0 max-w-[60%] truncate text-ink" aria-current="page">
            {product.name}
          </li>
        </ol>
      </nav>

      <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
        <div className="card p-5">
          <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-cream">
            <Image
              src={product.image}
              alt={product.name}
              className="h-full w-full object-contain"
              width={900}
              height={675}
              priority
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {product.specs?.map((spec) => (
              <span
                key={spec}
                className="rounded-full border border-line bg-cream px-3 py-1 text-[13px] text-ink-2"
              >
                {spec}
              </span>
            ))}
          </div>
          {!sampleShown && product.rating && (
            <p className="mt-3 flex items-center gap-1.5 text-[14px] text-ink-2">
              <Star className="h-4 w-4 fill-accent text-accent" aria-hidden="true" />
              <strong className="text-ink">{product.rating.toFixed(1)}</strong>
              ({(product.reviewCount ?? 0).toLocaleString("en-PH")} reviews)
            </p>
          )}
          {/* One sample caveat per page is enough: the note under the price
              already says the data is not live, and repeating it here put the
              same warning twice within a screen. */}
        </div>

        <div className="flex flex-col gap-4">
          <div className="card p-5 sm:p-6">
            <p className="text-[14px] font-semibold uppercase tracking-wide text-ink-3 break-words">
              {product.brand}
              {product.sku ? ` · ${product.sku}` : ""}
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold leading-tight tracking-tight text-ink sm:text-[32px]">
              {product.name}
            </h1>
            {product.tagline && (
              <p className="mt-1 text-[15px] text-ink-2">{product.tagline}</p>
            )}

            <div className="mt-5">
              <BuyTimingIndicator timing={timing} />
            </div>

            <div className="mt-5 flex flex-wrap items-end gap-4">
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
                  Lowest listed price
                </p>
                <p className="text-[40px] font-extrabold leading-none tracking-tight text-ink">
                  {lowest ? formatPeso(lowest.price) : "—"}
                </p>
                {lowest && (
                  <p className="mt-1.5 text-[14px] font-semibold text-ink-2">
                    at {getStore(lowest.storeId).name}
                  </p>
                )}
              </div>
              {savings > 0 && <SavingsBadge amount={savings} />}
            </div>
            {recordedDrop && (
              <p className="mt-2 text-[14px] font-semibold text-success">
                {recordedDrop.detail}
                {recordedDrop.averageDetail ? ` · ${recordedDrop.averageDetail}` : ""}
              </p>
            )}
            <p className="mt-2 text-[13px] text-ink-2">
              {sampleShown ? (
                <>
                  Sample data · last updated {sampleAsOf} — not live prices
                </>
              ) : lowest ? (
                <>
                  {getFreshness(lowest.updatedAt) !== "fresh" && (
                    <span className="text-wait">
                      This price may be out of date ·{" "}
                    </span>
                  )}
                  Last checked {formatRelativeTime(lowest.updatedAt)}
                </>
              ) : (
                "Price unavailable"
              )}
            </p>

            {lowest && bestStore && (
              <a
                href={bestHref}
                target="_blank"
                rel="nofollow sponsored noopener"
                className="btn-primary mt-5 w-full text-[16px]"
                aria-label={`View best deal at ${bestStore.name} — opens in a new tab`}
              >
                View best deal at {bestStore.name}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            )}

            <p className="mt-3 text-[13px] text-ink-2">
              Opens {bestStore?.name ?? "the retailer"} in a new tab. TagPricePH does not
              sell products.
            </p>
          </div>

          <PriceAlertForm
            productSlug={product.slug}
            productName={product.name}
            suggestedPrice={lowest?.price ?? null}
          />
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section aria-labelledby="compare-heading" className="card p-5 sm:p-6">
          <h2 id="compare-heading" className="text-[20px] font-extrabold text-ink">
            Compare prices
          </h2>
          <p className="mb-4 mt-1 text-[15px] text-ink-2">
            {eligibleHighest !== null
              ? `Highest ${formatPeso(eligibleHighest)}`
              : "Highest unavailable"}
            {lowest ? ` · Lowest ${formatPeso(lowest.price)}` : " · Lowest unavailable"}
            {savings > 0 && (
              <>
                {" "}
                · You could save{" "}
                <strong className="text-success">{formatPeso(savings)}</strong>
              </>
            )}
          </p>
          <StoreComparison product={product} />
        </section>

        <PriceHistoryChart
          history={series.points}
          currentPrice={lowest?.price ?? null}
          timing={timing}
          source={series.source}
        />
      </div>

      <section aria-labelledby="worth-heading" className="card mt-6 p-5 sm:p-6">
        <h2 id="worth-heading" className="text-[20px] font-extrabold text-ink">
          Is it worth buying now?
        </h2>
        {series.source !== "live" && series.points.length > 0 && (
          <p className="mt-1 text-[13px] text-ink-2">
            Sample verdict — drawn from demonstration history, not recorded
            retailer prices.
          </p>
        )}
        <div className="mt-3 grid gap-4 md:grid-cols-[1.2fr_1fr]">
          <p className="text-[16px] leading-relaxed text-ink-2">
            {timing.insufficient ? (
              <>
                We do not have enough recorded price history for this product yet,
                so we will not guess whether now is a good time to buy. The
                comparison below still shows today&apos;s prices across stores.
              </>
            ) : timing.status === "good" ? (
              <>
                Yes — this looks like a solid moment. The current lowest price is{" "}
                <strong className="text-ink">{formatPeso(lowest?.price ?? 0)}</strong>.{" "}
                {timing.detail.replace(/^Price is/, "It is")} If it fits your budget,
                you are not buying at a spike.
              </>
            ) : timing.status === "fair" ? (
              <>
                It is priced within its usual range at{" "}
                <strong className="text-ink">{formatPeso(lowest?.price ?? 0)}</strong>.
                Not a standout deal, but also not inflated. Buy if you need it now, or set
                an alert if you can wait for a drop.
              </>
            ) : (
              <>
                You may want to hold off. The lowest price (
                <strong className="text-ink">{formatPeso(lowest?.price ?? 0)}</strong>){" "}
                {timing.detail.replace(/^Price is /, "is ")} Set a price alert and we
                will keep this product on your watchlist on this device.
              </>
            )}
          </p>
          <div className="rounded-xl border border-line bg-cream p-4 text-[14px] text-ink-2">
            <p className="font-semibold text-ink">Plain-language summary</p>
            <ul className="mt-2 space-y-1.5">
              <li>• Lowest now: {lowest ? formatPeso(lowest.price) : "Unavailable"}</li>
              <li>• You could save: {formatPeso(savings)}</li>
              <li>• Verdict: {timing.label}</li>
            </ul>
          </div>
        </div>
      </section>

      {related.length > 0 && (
        <section aria-labelledby="related-heading" className="mt-10">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="related-heading" className="text-[20px] font-extrabold text-ink">
              You might also compare
            </h2>
            <Link href="/search" className="text-[15px] font-semibold hover:underline">
              Browse all
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {related.map((item) => (
              <ProductCard
                key={item.id}
                product={item}
                timing={relatedTimings[item.slug]}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
