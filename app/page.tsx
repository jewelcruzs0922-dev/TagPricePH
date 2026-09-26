import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { LowestPriceSection } from "@/components/home/LowestPriceSection";
import {
  PriceDropsSection,
  CategoriesSection,
  SavingsCta,
} from "@/components/home/HomeSections";
import { getFeaturedProduct, getHomePriceDrops } from "@/lib/data/catalog";
import { categories } from "@/lib/data/categories";
import { isSampleClaim } from "@/lib/trust";
import { getSavings } from "@/lib/pricing";

// The homepage is built from live catalog rows (featured product, drop feed,
// prices) — 5 minutes of ISR keeps it fresh without a deploy (Live Data
// Readiness §9), and ingestion revalidates it on write.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "TagPricePH — Find the Lowest Price. Know When to Buy.",
  description:
    "Compare prices across Philippine online stores, track price history, find price drops, and know when it's a good time to buy.",
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const [featuredProduct, dropFeed] = await Promise.all([
    getFeaturedProduct(),
    getHomePriceDrops(),
  ]);
  const priceDrops = dropFeed.products;

  if (!featuredProduct) {
    // No catalog to speak for. Saying so is the only honest option — a
    // homepage built from a stale copy of the sample seed is what this read
    // path exists to prevent.
    return (
      <div className="container-page py-16">
        <h1 className="text-[26px] font-extrabold tracking-tight text-ink">
          No products yet
        </h1>
        <p className="mt-3 max-w-xl text-[16px] text-ink-2">
          The catalog is empty, so there is nothing to compare right now. In
          demo mode, run the sample seed; in production, run{" "}
          <code className="rounded bg-cream px-1.5 py-0.5 text-[14px]">
            npm run catalog:seed
          </code>{" "}
          before serving from the database.
        </p>
      </div>
    );
  }

  const savings = getSavings(featuredProduct.offers);

  return (
    <>
      <Hero />
      <div className="space-y-14 pb-4 sm:space-y-16">
        <LowestPriceSection product={featuredProduct} />
        {priceDrops.length > 0 && (
          <PriceDropsSection
            products={priceDrops}
            recorded={dropFeed.recorded}
            sample={priceDrops.some((item) => isSampleClaim(item))}
          />
        )}
        <CategoriesSection categories={categories} />
        {/* Only worth shouting about when there is a real gap to claim —
            "You could save ₱0" is noise, not a selling point. */}
        {savings > 0 && <SavingsCta savings={savings} />}
      </div>
    </>
  );
}
