import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Star } from "lucide-react";
import { getProductBySlug, products, getRelatedProducts } from "@/lib/data/products";
import { getCategory } from "@/lib/data/categories";
import { baseUrl } from "@/lib/utils/seo";
import {
  evaluateBuyTiming,
  getLowestOffer,
  getSavings,
} from "@/lib/pricing";
import { formatPeso } from "@/lib/utils/format";
import { getStore } from "@/lib/data/stores";
import { getAffiliateUrl } from "@/lib/api/affiliate";
import { StoreComparison } from "@/components/comparison/StoreComparison";
import { SavingsBadge } from "@/components/comparison/SavingsBadge";
import { BuyTimingIndicator } from "@/components/products/BuyTimingIndicator";
import { PriceHistoryChart } from "@/components/price-history/PriceHistoryChart";
import { PriceAlertForm } from "@/components/price-alert/PriceAlert";
import { ProductCard } from "@/components/products/ProductCard";
import { isDemoData, DEMO_AS_OF } from "@/lib/data/products";

type ProductPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return products.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) return { title: "Product not found" };
  const lowest = getLowestOffer(product.offers);
  const description = lowest
    ? `${product.name} lowest price is ${formatPeso(lowest.price)}. Compare stores, see price history, and check if it's a good time to buy.`
    : `Compare prices for ${product.name} across Philippine stores.`;
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
  const product = getProductBySlug(slug);
  if (!product) notFound();

  const lowest = getLowestOffer(product.offers);
  const savings = getSavings(product.offers);
  const timing = evaluateBuyTiming(product);
  const related = getRelatedProducts(product, 4);
  const bestStore = lowest ? getStore(lowest.storeId) : null;
  const bestHref = lowest && bestStore ? getAffiliateUrl(bestStore, product, { source: "product-hero" }) : "#";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    brand: { "@type": "Brand", name: product.brand },
    offers: product.offers.map((offer) => ({
      "@type": "Offer",
      price: offer.price,
      priceCurrency: "PHP",
      availability: offer.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: getStore(offer.storeId).name },
    })),
  };

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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      <nav aria-label="Breadcrumb" className="mb-5">
        <ol className="flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
          <li>
            <Link href="/" className="inline-flex items-center gap-1 hover:text-ink">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href={`/categories/${product.category}`} className="hover:text-ink">
              {product.category.replace("-", " ")}
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image}
              alt={product.name}
              className="h-full w-full object-contain"
              width={900}
              height={675}
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
          {product.rating && (
            <p className="mt-3 flex items-center gap-1.5 text-[14px] text-ink-2">
              <Star className="h-4 w-4 fill-accent text-accent" aria-hidden="true" />
              <strong className="text-ink">{product.rating.toFixed(1)}</strong>
              ({(product.reviewCount ?? 0).toLocaleString("en-PH")} reviews)
            </p>
          )}
          {isDemoData && (
            <p className="mt-4 text-[13px] text-ink-3">
              Sample listing for demonstration. Images and prices are illustrative.
            </p>
          )}
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
                  Lowest price
                </p>
                <p className="text-[40px] font-extrabold leading-none tracking-tight text-ink">
                  {lowest ? formatPeso(lowest.price) : "—"}
                </p>
              </div>
              {savings > 0 && <SavingsBadge amount={savings} />}
            </div>
            <p className="mt-2 text-[13px] text-ink-3">
              Sample data · last updated {DEMO_AS_OF} — not live prices
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
            suggestedPrice={lowest?.price ?? 0}
          />
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section aria-labelledby="compare-heading" className="card p-5 sm:p-6">
          <h2 id="compare-heading" className="text-[20px] font-extrabold text-ink">
            Compare prices
          </h2>
          <p className="mb-4 mt-1 text-[15px] text-ink-2">
            Highest {formatPeso(Math.max(...product.offers.map((o) => o.price)))} ·
            Lowest {formatPeso(lowest?.price ?? 0)}
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
          history={product.priceHistory}
          currentPrice={lowest?.price ?? 0}
          timing={timing}
        />
      </div>

      <section aria-labelledby="worth-heading" className="card mt-6 p-5 sm:p-6">
        <h2 id="worth-heading" className="text-[20px] font-extrabold text-ink">
          Is it worth buying now?
        </h2>
        <div className="mt-3 grid gap-4 md:grid-cols-[1.2fr_1fr]">
          <p className="text-[16px] leading-relaxed text-ink-2">
            {timing.status === "good" && (
              <>
                Yes — this looks like a solid moment. The current lowest price is{" "}
                <strong className="text-ink">{formatPeso(lowest?.price ?? 0)}</strong>,{" "}
                {timing.detail.replace("Price is", "which is").replace(/\.$/, "")} compared
                with the usual price over the last three months. If it fits your budget,
                you are not buying at a spike.
              </>
            )}
            {timing.status === "fair" && (
              <>
                It is priced within its usual range at{" "}
                <strong className="text-ink">{formatPeso(lowest?.price ?? 0)}</strong>.
                Not a standout deal, but also not inflated. Buy if you need it now, or set
                an alert if you can wait for a drop.
              </>
            )}
            {timing.status === "wait" && (
              <>
                You may want to hold off. The lowest price (
                <strong className="text-ink">{formatPeso(lowest?.price ?? 0)}</strong>)
                sits above its recent average. Set a price alert and we will keep this
                product on your watchlist on this device.
              </>
            )}
          </p>
          <div className="rounded-xl border border-line bg-cream p-4 text-[14px] text-ink-2">
            <p className="font-semibold text-ink">Plain-language summary</p>
            <ul className="mt-2 space-y-1.5">
              <li>• Lowest now: {formatPeso(lowest?.price ?? 0)}</li>
              <li>• You could save: {formatPeso(savings)}</li>
              <li>• Verdict: {timing.label}</li>
            </ul>
          </div>
        </div>
      </section>

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
            <ProductCard key={item.id} product={item} />
          ))}
        </div>
      </section>
    </div>
  );
}
