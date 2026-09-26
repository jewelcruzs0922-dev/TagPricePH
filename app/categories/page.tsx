import type { Metadata } from "next";
import { categories } from "@/lib/data/categories";
import { listCatalog } from "@/lib/data/catalog";
import { CategoryCard } from "@/components/categories/CategoryCard";
import { isSampleClaim } from "@/lib/trust";

// 5 minutes of ISR: counts and cards come from the catalog, so the page must
// not stay frozen at build (Live Data Readiness §9).
export const revalidate = 300;

/**
 * True while any product in the catalog is sample — computed from the rows
 * themselves, never from a global flag, so metadata and the body agree.
 * `listCatalog` is request-cached, so both calls read the catalog once.
 */
const catalogIsSample = async (): Promise<boolean> =>
  (await listCatalog()).some((product) => isSampleClaim(product));

/**
 * The description names the data's state — "sample products" while any row
 * here is sample, plain "products" once the catalog is fully live — so a live
 * deployment never describes itself as a demo (Live Data Readiness §8).
 */
export async function generateMetadata(): Promise<Metadata> {
  const sample = await catalogIsSample();
  return {
    title: "Browse Categories",
    description: sample
      ? "Browse TagPricePH sample products by category — electronics, gaming, phones, home, and more."
      : "Browse TagPricePH products by category — electronics, gaming, phones, home, and more.",
    alternates: { canonical: "/categories" },
  };
}

export default async function CategoriesPage() {
  const products = await listCatalog();
  const sample = products.some((product) => isSampleClaim(product));

  return (
    <div className="container-page py-8 sm:py-10">
      <div className="mb-6 max-w-2xl">
        <h1 className="text-[28px] font-extrabold tracking-tight text-ink sm:text-[34px]">
          Browse by category
        </h1>
        <p className="mt-2 text-[16px] text-ink-2">
          {sample
            ? "Pick a category to see sample products and their lowest prices."
            : "Pick a category to see products and their lowest prices."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {categories.map((category) => {
          const count = products.filter((product) => product.category === category.slug).length;
          return (
            <div key={category.slug} className="flex flex-col gap-2">
              <CategoryCard category={category} />
              <p className="text-center text-[13px] text-ink-3">
                {count} {count === 1 ? "product" : "products"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
