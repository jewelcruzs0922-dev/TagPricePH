import Link from "next/link";
import Image from "next/image";
import type { BuyTiming, Product } from "@/lib/types";
import { getLowestOffer, getPriceDropPercent, evaluateBuyTiming } from "@/lib/pricing";
import { getStore } from "@/lib/data/stores";
import { formatPeso } from "@/lib/utils/format";
import { isSampleClaim } from "@/lib/trust";
import { StoreLogo } from "@/components/ui/StoreLogo";
import { ArrowRight } from "lucide-react";

/**
 * `timing` is supplied by the page so a list can base every card on the same
 * recorded series the product page uses (lib/db/observations.ts →
 * resolveBuyTimings). Without it the card falls back to the catalog series,
 * which is the honest default while nothing has been recorded.
 */
export function ProductCard({
  product,
  timing,
}: {
  product: Product;
  timing?: BuyTiming;
}) {
  const lowest = getLowestOffer(product.offers);
  const drop = getPriceDropPercent(product);
  const verdict = timing ?? evaluateBuyTiming(product);
  const storeId = lowest?.storeId ?? product.offers[0]?.storeId ?? "shopee";
  // The reference ("was") price only exists in the sample catalog — showing it
  // on a live-sourced product would publish a number nobody observed.
  const previousPrice = isSampleClaim(product) ? product.previousPrice : null;

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white transition hover:border-[#d9d4c4]">
      <Link
        href={`/product/${product.slug}`}
        className="relative block h-48 overflow-hidden bg-cream/70"
        tabIndex={-1}
        aria-hidden="true"
      >
        {drop !== null && drop > 0 && (
          <span className="absolute left-3 top-3 z-10 rounded-full bg-accent px-2.5 py-1 text-[12px] font-bold text-ink">
            -{drop}%
          </span>
        )}
        <Image
          src={product.image}
          alt=""
          fill
          sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover transition group-hover:scale-[1.02]"
        />
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4 pt-3">
        <Link
          href={`/product/${product.slug}`}
          className="line-clamp-2 min-h-[42px] text-[15px] font-semibold leading-snug text-ink hover:underline"
        >
          {product.name}
        </Link>

        <div className="flex min-h-[46px] flex-wrap items-end justify-between gap-x-2 gap-y-1">
          <div>
            <p className="text-[20px] font-extrabold leading-tight text-ink">
              {lowest ? formatPeso(lowest.price) : "—"}
            </p>
            <p
              className={`text-[13px] ${
                previousPrice ? "text-ink-2 line-through" : "invisible"
              }`}
              aria-hidden={!previousPrice}
            >
              {previousPrice
                ? formatPeso(previousPrice)
                : formatPeso(lowest?.price ?? 0)}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${
              verdict.status === "good"
                ? "bg-success-soft text-success"
                : verdict.status === "fair"
                  ? "bg-accent-soft text-ink"
                  : "bg-wait-soft text-wait"
            }`}
          >
            {verdict.label}
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="flex min-w-0 items-center gap-2 text-[13px] text-ink-2">
            <StoreLogo storeId={storeId} size={24} />
            <span className="truncate">{getStore(storeId).name}</span>
          </span>
          <Link
            href={`/product/${product.slug}`}
            className="hidden items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold text-ink transition group-hover:border-ink sm:inline-flex"
            aria-label={`Compare prices for ${product.name}`}
          >
            Compare
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
