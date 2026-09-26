import Link from "next/link";
import type { Product, StoreOffer } from "@/lib/types";
import { getStore } from "@/lib/data/stores";
import { getAffiliateUrl } from "@/lib/api/affiliate";
import { isEligibleCurrentOffer } from "@/lib/pricing";
import { formatDiff, formatPeso } from "@/lib/utils/format";
import { formatRelativeTime, getFreshness } from "@/lib/utils/freshness";
import { StoreLogo } from "@/components/ui/StoreLogo";

type StoreComparisonProps = {
  product: Product;
  variant?: "table" | "stack";
  showCta?: boolean;
};

const CONDITION_LABELS: Record<NonNullable<StoreOffer["condition"]>, string> = {
  bundle: "Bundle",
  different_variant: "Different variant",
};

/**
 * Whether an offer may claim this product's lowest price.
 *
 * Delegated to the one eligibility funnel in lib/pricing rather than
 * re-stated here: a listing that is out of stock, a different variant or a
 * bundle, stale past the freshness window, or pointing somewhere we cannot
 * safely send a shopper cannot be crowned the lowest current price — and this
 * table must agree with the hero, the cards, and the search sort about that.
 */
function canRank(offer: StoreOffer): boolean {
  return isEligibleCurrentOffer(offer);
}

export function StoreComparison({
  product,
  variant = "table",
  showCta = true,
}: StoreComparisonProps) {
  const sorted = [...product.offers].sort(
    (a, b) => Number(canRank(b)) - Number(canRank(a)) || a.price - b.price,
  );
  const bestPrice = sorted.find(canRank)?.price ?? 0;

  if (sorted.length === 0) {
    return (
      <div
        className="rounded-2xl border border-dashed border-line bg-cream/40 px-4 py-8 text-center"
        role="status"
      >
        <p className="text-[15px] font-semibold text-ink">No store listings yet</p>
        <p className="mt-1 text-[13px] text-ink-2">
          We haven&apos;t found this product at any tracked store. Set a price
          alert and we&apos;ll watch it for you.
        </p>
      </div>
    );
  }

  if (variant === "stack") {
    return (
      <ul className="flex flex-col gap-3">
        {sorted.map((offer, index) => (
          <li key={`${offer.storeId}:${offer.listingId ?? offer.url}`}>
            <StoreOfferRow
              offer={offer}
              bestPrice={bestPrice}
              product={product}
              isBest={index === 0 && canRank(offer)}
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
            <li key={`${offer.storeId}:${offer.listingId ?? offer.url}`}>
              <StoreOfferRow
                offer={offer}
                bestPrice={bestPrice}
                product={product}
                isBest={index === 0 && canRank(offer)}
                stacked
              />
            </li>
          ))}
        </ul>
        {showCta && (
          <p className="mt-3 text-[13px] text-ink-2">
            Sorted by lowest listed price. Shipping and fees are not included.
            TagPricePH does not sell these products.
          </p>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white sm:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Store offers for {product.name}, sorted from lowest listed price
          </caption>
          <thead>
            <tr className="border-b border-line bg-cream/70 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              <th scope="col" className="px-3 py-3">
                Store
              </th>
              <th scope="col" className="px-3 py-3 text-right">
                Price
              </th>
              {/* Centered so the header sits on the same axis as the pill
                  values below it — right-aligning text against padded pills
                  reads as a misalignment even when the boxes match. */}
              <th scope="col" className="px-3 py-3 text-center">
                Difference
              </th>
              <th scope="col" className="px-3 py-3 text-right">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((offer, index) => (
              <tr
                key={`${offer.storeId}:${offer.listingId ?? offer.url}`}
                className="border-b border-line/80 last:border-b-0"
              >
                <td className="px-3 py-3.5">
                  <StoreOfferIdentity offer={offer} isBest={index === 0 && canRank(offer)} />
                </td>
                <td className="px-3 py-3.5 text-right text-[16px] font-bold text-ink">
                  {formatPeso(offer.price)}
                </td>
                <td className="px-3 py-3.5 text-center">
                  {canRank(offer) ? (
                    <DifferenceChip diff={offer.price - bestPrice} />
                  ) : (
                    <span className="text-[13px] text-ink-3">—</span>
                  )}
                </td>
                <td className="px-3 py-3.5 text-right">
                  <DealLink product={product} offer={offer} compact />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {showCta && (
          <div className="border-t border-line bg-cream/50 px-4 py-3 text-[13px] text-ink-2">
            Sorted by lowest listed price. Shipping and fees are not included.
            TagPricePH does not sell these products.
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Per-offer freshness.
 *
 * Only rendered for observed (live) readings: a demo offer's `updatedAt` is
 * generated, so printing "checked 2 hours ago" underneath it would be inventing
 * a check that never happened.
 */
function OfferFreshness({ offer }: { offer: StoreOffer }) {
  if (offer.source !== "live") return null;
  const stale = getFreshness(offer.updatedAt) !== "fresh";
  return (
    <p className="text-[12px] leading-snug text-ink-3">
      {stale && <span className="font-semibold text-wait">May be out of date · </span>}
      Checked {formatRelativeTime(offer.updatedAt)}
    </p>
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
    <div className="flex items-center gap-2">
      <StoreLogo storeId={offer.storeId} />
      <div>
        <p className="text-[15px] font-semibold text-ink">{store.name}</p>
        <div className="flex flex-wrap items-center gap-2">
          {isBest && (
            <span className="whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink">
              Lowest listed price
            </span>
          )}
          {!offer.inStock && (
            <span className="rounded-full border border-line bg-cream px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink-3">
              Out of stock
            </span>
          )}
          {offer.condition && (
            <span className="rounded-full border border-line bg-cream px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink-3">
              {CONDITION_LABELS[offer.condition]}
            </span>
          )}
        </div>
        <OfferFreshness offer={offer} />
      </div>
    </div>
  );
}

/**
 * The difference column. The best row already carries the "Lowest listed
 * price" badge under its store name — repeating it here as a wide pill is
 * what made the column wrap — so the baseline just shows an em dash, the
 * same convention the homepage list uses.
 */
function DifferenceChip({ diff }: { diff: number; inline?: boolean }) {
  if (diff <= 0) {
    return <span className="text-[13px] text-ink-3">—</span>;
  }
  return (
    <span className="inline-flex whitespace-nowrap rounded-full border border-line bg-cream px-2.5 py-1 text-[13px] font-semibold text-ink-2">
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
        className={`inline-flex items-center justify-center whitespace-nowrap rounded-full font-semibold text-ink-3 ${
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
      className={`inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full font-semibold transition ${
        compact
          ? "border border-line bg-white px-4 py-2 text-[13px] text-ink hover:border-ink"
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
              <span className="shrink-0 whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold uppercase">
                Lowest listed price
              </span>
            )}
            {offer.condition && (
              <span className="shrink-0 rounded-full border border-line bg-cream px-2 py-0.5 text-[11px] font-bold uppercase text-ink-3">
                {CONDITION_LABELS[offer.condition]}
              </span>
            )}
          </div>
          <p className="text-[16px] font-bold text-ink">{formatPeso(offer.price)}</p>
          <OfferFreshness offer={offer} />
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {canRank(offer) && diff > 0 && (
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
