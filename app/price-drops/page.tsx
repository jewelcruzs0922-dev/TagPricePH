import type { Metadata } from "next";
import { priceDrops, products } from "@/lib/data/products";
import { getPriceDropPercent, getLowestOffer } from "@/lib/pricing";
import { PriceDropCard } from "@/components/products/PriceDropCard";

export const metadata: Metadata = {
  title: "Price Drops Today",
  description:
    "See which products dropped in price across Philippine stores — sample feed for the TagPricePH demo.",
  alternates: { canonical: "/price-drops" },
};

export default function PriceDropsPage() {
  const dropped = products
    .map((product) => ({ product, drop: getPriceDropPercent(product) ?? 0 }))
    .filter((item) => item.drop > 0)
    .sort((a, b) => b.drop - a.drop);

  const feed = dropped.length > 0 ? dropped.map((item) => item.product) : priceDrops;
  const example = products.find(
    (product) => product.previousPrice && getLowestOffer(product.offers),
  );

  return (
    <div className="container-page py-8 sm:py-10">
      <div className="mb-6 max-w-2xl">
        <p className="eyebrow">Updated from demo catalog</p>
        <h1 className="mt-3 text-[28px] font-extrabold tracking-tight text-ink sm:text-[34px]">
          Price drops today
        </h1>
        <p className="mt-2 text-[16px] text-ink-2">
          Products whose sample lowest price is under their previous listed price. These
          are demonstration figures, not live retailer feeds.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {feed.map((product) => (
          <PriceDropCard key={product.id} product={product} />
        ))}
      </div>

      <div className="card mt-8 p-5">
        <h2 className="text-[17px] font-bold text-ink">How drop percentages work</h2>
        <p className="mt-1 text-[15px] text-ink-2">
          We compare the current lowest offer with the product&apos;s previous reference
          price
          {example?.previousPrice ? (
            <>
              {" "}
              (example: was ₱{example.previousPrice.toLocaleString("en-PH")}, lowest now{" "}
              {formatLowest(example.id)})
            </>
          ) : null}
          . Always confirm the final price on the retailer&apos;s site.
        </p>
      </div>
    </div>
  );
}

function formatLowest(productId: string): string {
  const product = products.find((item) => item.id === productId);
  const lowest = product ? getLowestOffer(product.offers) : null;
  return lowest ? `₱${lowest.price.toLocaleString("en-PH")}` : "—";
}
