import type { Metadata } from "next";
import { priceDrops, products } from "@/lib/data/products";
import type { Product } from "@/lib/types";
import {
  getLowestOffer,
  getPriceDropPercent,
  getRecordedPriceDrop,
  type RecordedDrop,
} from "@/lib/pricing";
import { resolvePriceSeriesFor } from "@/lib/db/observations";
import { PriceDropCard } from "@/components/products/PriceDropCard";

export const metadata: Metadata = {
  title: "Price Drops Today",
  description:
    "See which products dropped in price across Philippine stores — sample feed for the TagPricePH demo.",
  alternates: { canonical: "/price-drops" },
};

export default async function PriceDropsPage() {
  // A drop is only reported from recorded readings when there are any. With an
  // empty observation store every row below falls back to the sample reference
  // price, and the copy says so.
  const seriesBySlug = await resolvePriceSeriesFor(products);

  const recorded: { product: Product; drop: RecordedDrop }[] = [];
  for (const product of products) {
    const series = seriesBySlug.get(product.slug);
    const lowest = getLowestOffer(product.offers);
    if (!series || !lowest) continue;
    const drop = getRecordedPriceDrop(series, lowest.price);
    if (drop) recorded.push({ product, drop });
  }
  recorded.sort((a, b) => b.drop.percent - a.drop.percent);

  const hasRecorded = recorded.length > 0;

  const sample = products
    .map((product) => ({ product, drop: getPriceDropPercent(product) ?? 0 }))
    .filter((item) => item.drop > 0)
    .sort((a, b) => b.drop - a.drop);

  const feed: Product[] = hasRecorded
    ? recorded.map((item) => item.product)
    : sample.length > 0
      ? sample.map((item) => item.product)
      : priceDrops;

  const recordedBySlug = new Map(recorded.map((item) => [item.product.slug, item.drop]));

  return (
    <div className="container-page py-8 sm:py-10">
      <div className="mb-6 max-w-2xl">
        <p className="eyebrow">
          {hasRecorded ? "Updated from recorded prices" : "Updated from demo catalog"}
        </p>
        <h1 className="mt-3 text-[28px] font-extrabold tracking-tight text-ink sm:text-[34px]">
          Price drops today
        </h1>
        <p className="mt-2 text-[16px] text-ink-2">
          {hasRecorded
            ? "Products whose current price is below their most recent recorded price observation. Each figure names the readings it came from."
            : "Products whose sample lowest price is under their previous listed price. These are demonstration figures, not live retailer feeds."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {feed.map((product) => (
          <PriceDropCard
            key={product.id}
            product={product}
            recorded={recordedBySlug.get(product.slug)}
          />
        ))}
      </div>

      <div className="card mt-8 p-5">
        <h2 className="text-[17px] font-bold text-ink">How drop percentages work</h2>
        <p className="mt-1 text-[15px] text-ink-2">
          {hasRecorded ? (
            <>
              We compare today&apos;s lowest offer with this product&apos;s most recent
              recorded price observation, and — once there are enough readings — with its
              recorded average. Nothing is derived from a listed &quot;was&quot; price.
              Always confirm the final price on the retailer&apos;s site.
            </>
          ) : (
            <>
              We compare the current lowest offer with the product&apos;s previous reference
              price. These are demonstration figures, not recorded observations. Always
              confirm the final price on the retailer&apos;s site.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
