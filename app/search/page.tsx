import type { Metadata } from "next";
import { SearchBar } from "@/components/search/SearchBar";
import { SearchResults } from "@/components/search/SearchResults";
import { getCatalogBrands } from "@/lib/data/catalog";
import { capQuery } from "@/lib/data/search-url";
import { isProductUrl, toClientProducts } from "@/lib/data/search-core";
import { isSampleClaim } from "@/lib/trust";
import { resolveBuyTimings } from "@/lib/db/observations";
import { DEFAULT_FILTERS, DEFAULT_SORT, SEARCH_PAGE_SIZE, runSearch } from "@/lib/search/run-search";

type SearchPageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export async function generateMetadata({
  searchParams,
}: SearchPageProps): Promise<Metadata> {
  const params = await searchParams;
  const q = capQuery(
    Array.isArray(params.q) ? (params.q[0] ?? "") : (params.q ?? ""),
  );
  if (!q) {
    return {
      title: "Search products",
      description: "Search products and compare prices across Philippine stores.",
      alternates: { canonical: "/search" },
    };
  }
  if (isProductUrl(q)) {
    // A pasted marketplace URL is not readable copy — don't put it in a title.
    return {
      title: "Product link",
      description: "Compare prices for the product link you pasted across Philippine stores.",
      alternates: { canonical: `/search?q=${encodeURIComponent(q)}` },
    };
  }
  return {
    title: `Results for “${q}”`,
    description: `Compare the lowest prices for ${q} across Shopee, Lazada, TikTok Shop, and more.`,
    alternates: { canonical: `/search?q=${encodeURIComponent(q)}` },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const q = capQuery(
    Array.isArray(params.q) ? (params.q[0] ?? "") : (params.q ?? ""),
  );

  const { results, note } = await runSearch({
    q,
    filters: DEFAULT_FILTERS,
    sort: DEFAULT_SORT,
  });
  const brands = await getCatalogBrands();
  const pastedLink = isProductUrl(q);
  // Conservative: the caveat shows if any result is sample data, so a mixed
  // result set can never read as a page of live prices.
  const sampleShown = results.some((product) => isSampleClaim(product));
  // The count is the full result set; the first paint only carries a window
  // of it. "Show more" asks the server for the next slice.
  const window = results.slice(0, SEARCH_PAGE_SIZE);
  const timings = await resolveBuyTimings(window);

  return (
    <div className="container-page py-8 sm:py-10">
      <div className="mb-6 max-w-2xl">
        <h1 className="text-[26px] font-extrabold tracking-tight text-ink break-words sm:text-[30px]">
          {pastedLink ? (
            "Product link"
          ) : q ? (
            <>
              Results for <span className="text-ink">“{q}”</span>
            </>
          ) : (
            "Compare prices"
          )}
        </h1>
        <p className="mt-1 text-[15px] text-ink-2">
          {pastedLink
            ? "We read the product out of the link you pasted. Use the filters below to narrow it down."
            : "Filter by category, brand, store, and price. Sorted so the lowest price is easy to spot."}
        </p>
        <div className="mt-4">
          <SearchBar size="md" initialQuery={q} />
        </div>
      </div>

      {sampleShown && (
        <p className="mb-4 text-[13px] text-ink-2">
          Sample data — prices shown are illustrative, not live retailer prices.
        </p>
      )}

      <SearchResults
        key={q}
        initialQuery={q}
        initialResults={toClientProducts(window)}
        initialNote={note}
        initialTimings={timings}
        initialTotal={results.length}
        brands={brands}
      />
    </div>
  );
}
