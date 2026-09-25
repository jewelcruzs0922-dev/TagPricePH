import type { Metadata } from "next";
import { listCatalog } from "@/lib/data/catalog";
import { buildPriceDropFeed } from "@/lib/data/price-drops";
import { PriceDropCard } from "@/components/products/PriceDropCard";
import { EmptyState } from "@/components/ui/States";

export const metadata: Metadata = {
  title: "Price Drops Today",
  description:
    "See which products dropped in price across Philippine stores — sample feed for the TagPricePH demo.",
  alternates: { canonical: "/price-drops" },
};

export default async function PriceDropsPage() {
  // One feed definition for this page and the homepage (lib/data/price-drops):
  // verified drops from recorded observations first, the sample catalog's
  // reference price only while the catalog itself is sample, and nothing when
  // neither supports a claim.
  const feed = await buildPriceDropFeed(await listCatalog());
  const hasRecorded = feed.hasRecorded;

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

      {feed.products.length === 0 ? (
        <EmptyState
          title="No price drops right now."
          supporting="A drop is only shown when an actual observation is lower than the one before it. Nothing in the catalog qualifies yet."
          actionLabel="Browse categories"
          actionHref="/categories"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {feed.products.map((product) => (
            <PriceDropCard
              key={product.id}
              product={product}
              recorded={feed.recorded.get(product.slug)}
            />
          ))}
        </div>
      )}

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
