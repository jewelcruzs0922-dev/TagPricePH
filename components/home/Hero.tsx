import Link from "next/link";
import { SearchBar } from "@/components/search/SearchBar";
import { HeroMedia } from "@/components/home/HeroMedia";
import { getPopularSearches } from "@/lib/data/search";

export function Hero() {
  const popular = getPopularSearches();

  return (
    <section aria-labelledby="hero-heading" className="relative">
      <div className="container-page relative grid items-center gap-8 pb-14 pt-6 lg:grid-cols-[1.02fr_0.98fr] lg:gap-6 lg:pb-20 lg:pt-8">
        <div className="relative z-10 max-w-xl">
          <h1
            id="hero-heading"
            className="text-[32px] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[48px] lg:text-[56px]"
          >
            Find the lowest price.
            <span className="mt-0.5 block text-accent-deep">Know when to buy.</span>
          </h1>

          <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">
            TagPricePH helps you compare prices across top stores, see price history,
            and get smart recommendations — so you always get the best deal.
          </p>

          <div className="mt-7">
            <SearchBar />
          </div>

          <div className="mt-5 flex flex-wrap gap-2.5">
            {popular.map((term) => (
              <Link
                key={term}
                href={`/search?q=${encodeURIComponent(term)}`}
                className="chip"
              >
                {term}
              </Link>
            ))}
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[560px] overflow-hidden lg:mx-0">
          <HeroMedia />
        </div>
      </div>
    </section>
  );
}
