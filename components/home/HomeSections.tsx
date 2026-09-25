import Link from "next/link";
import { ArrowRight, Tag } from "lucide-react";
import type { Product, Category } from "@/lib/types";
import { PriceDropCard } from "@/components/products/PriceDropCard";
import { CategoryCard } from "@/components/categories/CategoryCard";
import { formatPeso } from "@/lib/utils/format";
import { getSavings, getLowestOffer } from "@/lib/pricing";

export function PriceDropsSection({ products }: { products: Product[] }) {
  return (
    <section aria-labelledby="price-drops-heading" className="container-page">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="price-drops-heading"
            className="flex items-center gap-2 text-[26px] font-extrabold tracking-tight text-ink sm:text-[30px]"
          >
            Price Drops Today
          </h2>
          <p className="mt-1 text-[15px] text-ink-2">
            Products whose sample price sits below the product&apos;s previous
            listed price.
          </p>
        </div>
        <Link
          href="/price-drops"
          className="inline-flex items-center gap-1.5 py-1.5 text-[15px] font-semibold text-ink hover:underline"
        >
          View all price drops
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {products.map((product) => (
          <PriceDropCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}

export function CategoriesSection({ categories }: { categories: Category[] }) {
  return (
    <section aria-labelledby="categories-heading" className="container-page">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="categories-heading"
            className="text-[26px] font-extrabold tracking-tight text-ink sm:text-[30px]"
          >
            Shop by Category
          </h2>
          <p className="mt-1 text-[15px] text-ink-2">
            Find the best deals in your favorite categories.
          </p>
        </div>
        <Link
          href="/categories"
          className="inline-flex items-center gap-1.5 py-1.5 text-[15px] font-semibold text-ink hover:underline"
        >
          View all categories
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {categories.map((category) => (
          <CategoryCard key={category.slug} category={category} />
        ))}
      </div>
    </section>
  );
}

export function SavingsCta({ savings }: { savings: number }) {
  return (
    <section aria-labelledby="savings-cta-heading" className="container-page">
      <div className="relative overflow-hidden rounded-[24px] bg-accent px-5 py-7 sm:px-8 sm:py-8">
        <svg
          className="pointer-events-none absolute -right-8 -top-12 h-56 w-56 text-white/20"
          viewBox="0 0 200 200"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M40 40c30-30 90-40 130-10 35 25 40 80 10 120-25 35-80 45-120 20C20 145 5 100 15 65c5-15 15-15 25-25z" />
        </svg>
        <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-ink shadow-sm">
              <Tag className="h-7 w-7" strokeWidth={2} aria-hidden="true" />
            </span>
            <div>
              <h2
                id="savings-cta-heading"
                className="text-[26px] font-extrabold leading-tight tracking-tight text-ink sm:text-[30px]"
              >
                You could save {formatPeso(savings)}
              </h2>
              <p className="mt-1 max-w-xl text-[15px] text-ink/75">
                on this product compared to the highest price.
              </p>
            </div>
          </div>
          <Link href="/search" className="btn-dark shrink-0">
            Start Comparing
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

export function getSavingsFor(product: Product): number {
  const lowest = getLowestOffer(product.offers);
  if (!lowest) return 0;
  return getSavings(product.offers);
}
