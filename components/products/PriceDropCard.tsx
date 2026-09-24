import Link from "next/link";
import type { Product } from "@/lib/types";
import { getLowestOffer, getPriceDropPercent } from "@/lib/pricing";
import { getStore } from "@/lib/data/stores";
import { formatPeso } from "@/lib/utils/format";
import { StoreLogo } from "@/components/ui/StoreLogo";
import { ChevronRight } from "lucide-react";

export function PriceDropCard({ product }: { product: Product }) {
  const lowest = getLowestOffer(product.offers);
  const drop = getPriceDropPercent(product) ?? 0;
  const storeId = lowest?.storeId ?? product.offers[0]?.storeId ?? "shopee";

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white transition hover:border-[#d9d4c4] hover:shadow-[0_8px_24px_rgba(23,32,51,0.06)]">
      <div className="relative h-48 overflow-hidden bg-[#F6F4EC]">
        <span className="absolute left-3 top-3 z-10 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-bold text-ink">
          -{drop}%
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          className="h-full w-full object-cover transition group-hover:scale-[1.03]"
        />
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <h3 className="line-clamp-2 min-h-[42px] text-[15px] font-semibold leading-snug text-ink">
          <Link href={`/product/${product.slug}`} className="hover:underline">
            {product.name}
          </Link>
        </h3>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-[22px] font-extrabold tracking-tight text-ink">
            {lowest ? formatPeso(lowest.price) : "—"}
          </p>
          {product.previousPrice && (
            <p className="text-[14px] text-ink-3 line-through">
              {formatPeso(product.previousPrice)}
            </p>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="flex min-w-0 items-center gap-2 text-[14px] font-medium text-ink-2">
            <StoreLogo storeId={storeId} size={26} />
            <span className="truncate">{getStore(storeId).name}</span>
          </span>
          <Link
            href={`/product/${product.slug}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink transition group-hover:border-ink"
            aria-label={`View ${product.name}`}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
