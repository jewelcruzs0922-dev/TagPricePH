import Link from "next/link";
import type { Product, StoreOffer } from "@/lib/types";
import { getStore } from "@/lib/data/stores";
import { getAffiliateUrl } from "@/lib/api/affiliate";
import { formatDiff, formatPeso } from "@/lib/utils/format";
import { formatRelativeTime, getFreshness } from "@/lib/utils/freshness";
import { StoreLogo } from "@/components/ui/StoreLogo";

type StoreComparisonProps = {
  product: Product;
  variant?: "table" | "stack";
  showCta?: boolean;
};

export function StoreComparison({
  product,
  variant = "table",
  showCta = true,
}: StoreComparisonProps) {
  const sorted = [...product.offers].sort(
    (a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price,
  );
  const bestPrice = sorted.find((offer) => offer.inStock)?.price ?? 0;

  if (variant === "stack") {
    return (
      <ul className="flex flex-col gap-3">
        {sorted.map((offer, index) => (
          <li key={offer.storeId}>
            <StoreOfferRow
              offer={offer}
              bestPrice={bestPrice}
              product={product}
              isBest={index === 0 && offer.inStock}
              stacked
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="sm:hidden">
        <ul className="flex flex-col gap-3">
          {sorted.map((offer, index) => (
            <li key={offer.storeId}>
              <StoreOfferRow
                offer={offer}
                bestPrice={bestPrice}
                product={product}
                isBest={index === 0 && offer.inStock}
                stacked
              />
            </li>
          ))}
        </ul>
        {showCta && (
          <p className="mt-3 text-[13px] text-ink-2">
            Sorted by lowest price. TagPricePH does not sell these products.
          </p>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white sm:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Store offers for {product.name}, sorted from lowest price
          </caption>
          <thead>
            <tr className="border-b border-line bg-cream/70 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              <th scope="col" className="px-4 py-3">
                Store
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Price
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Difference
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((offer, index) => (
              <tr
                key={offer.storeId}
                className="border-b border-line/80 last:border-b-0"
              >
                <td className="px-4 py-3.5">
                  <StoreOfferIdentity offer={offer} isBest={index === 0 && offer.inStock} />
                </td>
                <td className="px-4 py-3.5 text-right text-[16px] font-bold text-ink">
                  {formatPeso(offer.price)}
                </td>
                <td className="px-4 py-3.5 text-right">
                  {offer.inStock ? (
                    <DifferenceChip diff={offer.price - bestPrice} />
                  ) : (
                    <span className="text-[13px] text-ink-3">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-right">
                  <DealLink product={product} offer={offer} compact />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {showCta && (
          <div className="border-t border-line bg-cream/50 px-4 py-3 text-[13px] text-ink-2">
            Sorted by lowest price. TagPricePH does not sell these products.
          </div>
        )}
      </div>
    </>
  );
}

function StoreOfferIdentity({
  offer,
  isBest,
}: {
  offer: StoreOffer;
  isBest: boolean;
}) {
  const store = getStore(offer.storeId);
  return (
    <div className="flex items-center gap-3">
      <StoreLogo storeId={offer.storeId} />
      <div>
        <p className="text-[15px] font-semibold text-ink">{store.name}</p>
        <div className="flex flex-wrap items-center gap-2">
          {isBest && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink">
              Best price
            </span>
          )}
          {!offer.inStock && (
            <span className="rounded-full border border-line bg-cream px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink-3">
              Out of stock
            </span>
          )}
        </div>
        <FreshnessNote offer={offer} />
      </div>
    </div>
  );
}

/**
 * Shows when this offer's price was last checked, and warns when the
 * reading is too old to be presented as a current price.
 */
function FreshnessNote({ offer }: { offer: StoreOffer }) {
  const state = getFreshness(offer.updatedAt);
  const demo = offer.source === "demo";
  const tone =
    state === "fresh" ? "text-ink-3" : "text-wait";

  return (
    <p className={`mt-1 text-[12px] ${tone}`}>
      {demo ? "Sample · " : ""}
      checked {formatRelativeTime(offer.updatedAt)}
      {state === "stale" ? " · may be out of date" : ""}
      {state === "unavailable" ? " · price unavailable" : ""}
    </p>
  );
}

function DifferenceChip({ diff, inline = false }: { diff: number; inline?: boolean }) {
  if (diff <= 0) {
    return (
      <span className="inline-flex rounded-full bg-accent px-2.5 py-1 text-[12px] font-bold text-ink">
        Best price
      </span>
    );
  }
  return (
    <span
      className={`inline-flex rounded-full bg-cream border border-line px-2.5 py-1 text-[13px] font-semibold text-ink-2 ${
        inline ? "" : ""
      }`}
    >
      {formatDiff(diff)}
    </span>
  );
}

function DealLink({
  product,
  offer,
  compact = false,
  label,
}: {
  product: Product;
  offer: StoreOffer;
  compact?: boolean;
  label?: string;
}) {
  const store = getStore(offer.storeId);
  const href = getAffiliateUrl(store, product, { source: "comparison" });
  const text = label ?? (compact ? "View deal" : `View deal at ${store.name}`);
  if (!offer.inStock) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full font-semibold text-ink-3 ${
          compact
            ? "border border-line bg-cream px-3.5 py-2 text-[13px]"
            : "btn-primary w-full opacity-60"
        }`}
        aria-disabled="true"
      >
        Out of stock
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center rounded-full font-semibold transition ${
        compact
          ? "border border-line bg-white px-5 py-2 text-[13px] text-ink hover:border-ink"
          : "btn-primary w-full"
      }`}
      rel="nofollow sponsored noopener"
      target="_blank"
      aria-label={`${text} — opens ${store.name} in a new tab`}
    >
      {text}
    </Link>
  );
}

export function StoreOfferCard({
  product,
  offer,
  isBest,
}: {
  product: Product;
  offer: StoreOffer;
  isBest: boolean;
}) {
  return (
    <StoreOfferRow offer={offer} bestPrice={offer.price} product={product} isBest={isBest} stacked />
  );
}

function StoreOfferRow({
  offer,
  bestPrice,
  product,
  isBest,
  stacked = false,
}: {
  offer: StoreOffer;
  bestPrice: number;
  product: Product;
  isBest: boolean;
  stacked?: boolean;
}) {
  const store = getStore(offer.storeId);
  const diff = offer.price - bestPrice;

  if (stacked) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-3.5 py-3">
        <StoreLogo storeId={offer.storeId} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-ink">{store.name}</p>
            {isBest && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold uppercase">
                Best
              </span>
            )}
          </div>
          <p className="text-[16px] font-bold text-ink">{formatPeso(offer.price)}</p>
          <FreshnessNote offer={offer} />
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {offer.inStock && diff > 0 && (
            <span className="text-[13px] font-semibold text-ink-2">
              {formatDiff(diff)}
            </span>
          )}
          <DealLink product={product} offer={offer} compact />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <StoreOfferIdentity offer={offer} isBest={isBest} />
    </div>
  );
}
