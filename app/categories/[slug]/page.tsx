import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft } from "lucide-react";
import { categories, getCategory } from "@/lib/data/categories";
import { getCategoryProducts } from "@/lib/data/catalog";
import { baseUrl } from "@/lib/utils/seo";
import { serializeJsonLd } from "@/lib/utils/jsonld";
import { ProductCard } from "@/components/products/ProductCard";
import { resolveBuyTimings } from "@/lib/db/observations";
import { isSampleClaim } from "@/lib/trust";
import { EmptyState } from "@/components/ui/States";

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
};

// 5 minutes of ISR: the grid shows current prices (Live Data Readiness §9),
// and ingestion revalidates these paths on write.
export const revalidate = 300;

/**
 * One request-cached read shared by `generateMetadata` and the page, so the
 * description and the grid answer from the same catalog snapshot.
 */
const loadCategoryItems = cache((slug: string) => getCategoryProducts(slug));

export function generateStaticParams() {
  return categories.map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = getCategory(slug);
  if (!category) return { title: "Category not found" };
  const title = `${category.name} Price Philippines — TagPricePH`;
  // The description names what the prices ARE (Live Data Readiness §8):
  // "sample prices" only while a sample row is actually shown here.
  const items = await loadCategoryItems(slug);
  const sample = items.some((product) => isSampleClaim(product));
  const description = sample
    ? `${category.blurb} Compare sample prices in ${category.name} on TagPricePH.`
    : `${category.blurb} Compare prices in ${category.name} on TagPricePH.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/categories/${category.slug}` },
    openGraph: {
      title,
      description,
      url: `/categories/${category.slug}`,
      type: "website",
    },
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const category = getCategory(slug);
  if (!category) notFound();

  const items = await loadCategoryItems(slug);
  const timings = await resolveBuyTimings(items);
  // Conservative: the caveat shows unless *every* product here is observed,
  // so one sample row can never be read as a page of live prices.
  const sampleShown = items.some((product) => isSampleClaim(product));

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
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbLd) }}
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
        {sampleShown && (
          <p className="mt-2 text-[13px] text-ink-2">
            Sample data — prices shown are illustrative, not live retailer prices.
          </p>
        )}
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
            <ProductCard
              key={product.id}
              product={product}
              timing={timings[product.slug]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
