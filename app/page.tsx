import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { LowestPriceSection } from "@/components/home/LowestPriceSection";
import {
  PriceDropsSection,
  CategoriesSection,
  SavingsCta,
} from "@/components/home/HomeSections";
import { featuredProduct, priceDrops } from "@/lib/data/products";
import { categories } from "@/lib/data/categories";
import { getSavings } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "TagPricePH — Find the Lowest Price. Know When to Buy.",
  description:
    "Compare prices across Philippine online stores, track price history, find price drops, and know when it's a good time to buy.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  const savings = getSavings(featuredProduct.offers);

  return (
    <>
      <Hero />
      <div className="space-y-14 pb-4 sm:space-y-16">
        <LowestPriceSection product={featuredProduct} />
        <PriceDropsSection products={priceDrops} />
        <CategoriesSection categories={categories} />
        <SavingsCta savings={savings} />
      </div>
    </>
  );
}
