import Link from "next/link";
import type { Product } from "@/lib/types";
import {
  evaluateBuyTiming,
  getLowestOffer,
  getSavings,
} from "@/lib/pricing";
import { formatCount, formatPeso } from "@/lib/utils/format";
import { getStore } from "@/lib/data/stores";
import { StoreLogo } from "@/components/ui/StoreLogo";
import { PriceHistoryChart } from "@/components/price-history/PriceHistoryChart";
import {
  Star,
  ArrowRight,
  CheckCircle2,
  Zap,
  HardDrive,
  Monitor,
  Cpu,
  Smartphone,
} from "lucide-react";

function specIcon(spec: string) {
  const lower = spec.toLowerCase();
  if (lower.includes("display") || lower.includes("inch") || lower.includes('"')) {
    return Monitor;
  }
  if (lower.includes("gb") || lower.includes("ssd") || lower.includes("tb")) {
    return HardDrive;
  }
  if (lower.includes("chip") || lower.includes("cpu") || lower.includes("ram")) {
    return Cpu;
  }
  if (lower.includes("phone") || lower.includes("5g")) {
    return Smartphone;
  }
  return null;
}

function AppleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

export function LowestPriceSection({ product }: { product: Product }) {
  const lowest = getLowestOffer(product.offers);
  const savings = getSavings(product.offers);
  const timing = evaluateBuyTiming(product);
  const sorted = [...product.offers].sort((a, b) => a.price - b.price);
  const bestPrice = sorted[0]?.price ?? 0;

  return (
    <section
      id="lowest-price"
      aria-labelledby="lowest-price-heading"
      className="container-page scroll-mt-24"
    >
      <div className="rounded-[28px] bg-accent-panel p-4 sm:p-6 lg:p-7">
        <div className="mb-4">
          <span className="eyebrow-yellow">
            Today&apos;s Best Deal
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[0.85fr_1.1fr_1fr] lg:gap-5">
          {/* Product card */}
          <div className="card flex flex-col p-5">
            <div className="h-64 overflow-hidden rounded-2xl bg-[#F3F1EA]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={product.image}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            </div>
            <h2
              id="lowest-price-heading"
              className="mt-5 text-[22px] font-extrabold tracking-tight text-ink"
            >
              {product.name}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] font-medium text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                {product.brand === "Apple" ? (
                  <AppleMark className="h-4 w-4 text-ink" />
                ) : (
                  <span className="text-ink">●</span>
                )}
                {product.brand !== "Apple" && product.brand}
              </span>
              {product.specs?.map((spec) => {
                const Icon = specIcon(spec);
                return (
                  <span key={spec} className="inline-flex items-center gap-1.5">
                    {Icon && <Icon className="h-4 w-4 text-ink-3" strokeWidth={1.8} aria-hidden="true" />}
                    {spec}
                  </span>
                );
              })}
            </div>
            {product.rating && (
              <p className="mt-4 flex items-center gap-1.5 text-[14px] text-ink-2">
                <Star className="h-4 w-4 fill-accent text-accent" aria-hidden="true" />
                <strong className="text-ink">{product.rating.toFixed(1)}</strong>
                ({formatCount(product.reviewCount ?? 0)} reviews)
              </p>
            )}
          </div>

          {/* Price + comparison card */}
          <div className="card flex flex-col gap-4 p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success text-white">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[15px] font-bold text-ink">{timing.label}</p>
                <p className="text-[14px] leading-snug text-ink-2">{timing.detail}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[40px] font-extrabold leading-none tracking-tight text-ink sm:text-[44px]">
                {lowest ? formatPeso(lowest.price) : "—"}
              </p>
              <p className="text-[18px] font-bold text-success">
                ↓ {formatPeso(savings)}
              </p>
            </div>

            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-success-soft px-3.5 py-2 text-[14px] font-bold text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              You save {formatPeso(savings)}
            </span>

            <div>
              <h3 className="mb-3 text-[15px] font-bold text-ink">
                Compare prices across stores
              </h3>
              <ul className="overflow-hidden rounded-xl border border-line">
                {sorted.map((offer, index) => {
                  const isBest = index === 0;
                  const diff = offer.price - bestPrice;
                  const store = getStore(offer.storeId);
                  return (
                    <li
                      key={offer.storeId}
                      className="flex items-center gap-2 border-b border-line bg-white px-3.5 py-3 last:border-b-0"
                    >
                      <StoreLogo storeId={offer.storeId} size={32} />
                      <span className="min-w-0 flex-1 text-[14px] font-semibold text-ink">
                        {store.name}
                      </span>
                      {isBest ? (
                        <span className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-[11px] font-bold text-ink">
                          Best price
                        </span>
                      ) : (
                        <span className="hidden sm:inline" />
                      )}
                      <span className="shrink-0 text-[15px] font-extrabold text-ink">
                        {formatPeso(offer.price)}
                      </span>
                      <span className="hidden w-16 shrink-0 text-right text-[13px] font-semibold text-ink-2 sm:block">
                        {isBest ? "—" : `+${formatPeso(diff)}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <Link
              href={`/product/${product.slug}`}
              className="btn-primary mt-auto w-full py-3.5 text-[15px]"
            >
              View full comparison
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {/* Chart card */}
          <div className="flex flex-col gap-4 md:col-span-2 lg:col-span-1">
            <PriceHistoryChart
              history={product.priceHistory}
              currentPrice={lowest?.price ?? 0}
              timing={timing}
              compact
            />
            <div className="flex items-start gap-3 rounded-2xl border border-success/20 bg-success-soft px-4 py-4">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success text-white">
                <Zap className="h-4 w-4 fill-white" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[15px] font-bold text-success">{timing.label}</p>
                <p className="text-[14px] leading-snug text-ink-2">
                  This price is{" "}
                  {Math.abs(timing.percentVsAverage) || 17}% lower than its recent
                  average.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
