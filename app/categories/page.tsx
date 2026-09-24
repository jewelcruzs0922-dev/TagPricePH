import type { Metadata } from "next";
import { categories } from "@/lib/data/categories";
import { products } from "@/lib/data/products";
import { CategoryCard } from "@/components/categories/CategoryCard";

export const metadata: Metadata = {
  title: "Browse Categories",
  description:
    "Browse TagPricePH sample products by category — electronics, gaming, phones, home, and more.",
  alternates: { canonical: "/categories" },
};

export default function CategoriesPage() {
  return (
    <div className="container-page py-8 sm:py-10">
      <div className="mb-6 max-w-2xl">
        <h1 className="text-[28px] font-extrabold tracking-tight text-ink sm:text-[34px]">
          Browse by category
        </h1>
        <p className="mt-2 text-[16px] text-ink-2">
          Pick a category to see sample products and their lowest prices.
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
