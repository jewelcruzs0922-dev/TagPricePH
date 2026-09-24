import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { categories, getCategory } from "@/lib/data/categories";
import { products } from "@/lib/data/products";
import { baseUrl } from "@/lib/utils/seo";
import { ProductCard } from "@/components/products/ProductCard";
import { EmptyState } from "@/components/ui/States";

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return categories.map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = getCategory(slug);
  if (!category) return { title: "Category not found" };
  const title = `${category.name} Price Philippines — TagPricePH`;
  return {
    title: { absolute: title },
    description: `${category.blurb} Compare sample prices in ${category.name} on TagPricePH.`,
    alternates: { canonical: `/categories/${category.slug}` },
    openGraph: {
      title,
      description: `${category.blurb} Compare sample prices in ${category.name} on TagPricePH.`,
      url: `/categories/${category.slug}`,
      type: "website",
    },
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const category = getCategory(slug);
  if (!category) notFound();

  const items = products.filter((product) => product.category === category.slug);

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${baseUrl}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Categories",
        item: `${baseUrl}/categories`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: category.name,
        item: `${baseUrl}/categories/${category.slug}`,
      },
    ],
  };

  return (
    <div className="container-page py-8 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <nav aria-label="Breadcrumb" className="mb-5">
        <Link
          href="/categories"
          className="inline-flex items-center gap-1.5 text-[14px] text-ink-2 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All categories
        </Link>
      </nav>

      <div className="mb-6">
        <h1 className="text-[28px] font-extrabold tracking-tight text-ink sm:text-[34px]">
          {category.name}
        </h1>
        <p className="mt-1 text-[16px] text-ink-2">{category.blurb}</p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing in this category yet."
          supporting="Try another category while we grow the catalog."
          actionLabel="Browse categories"
          actionHref="/categories"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
