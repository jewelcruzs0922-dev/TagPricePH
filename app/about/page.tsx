import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "TagPricePH helps Filipino shoppers compare prices, understand price history, and decide when to buy.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div className="container-page py-8 sm:py-10">
      <div className="max-w-2xl">
        <h1 className="text-[28px] font-extrabold tracking-tight text-ink sm:text-[34px]">
          About TagPricePH
        </h1>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-2">
          TagPricePH is a price comparison tool built for Filipino shoppers. The idea is
          simple: before you buy online, you should be able to see the lowest price,
          how much you could save, how the price has been moving, and whether now is a
          sensible time to purchase.
        </p>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-2">
          This site is currently a <strong className="text-ink">demo</strong> with sample
          products and sample price history. It is designed so real marketplace data,
          partner feeds, and affiliate links can plug in later without redesigning the
          experience.
        </p>

        <h2 className="mt-8 text-[20px] font-extrabold text-ink">What we believe</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[16px] text-ink-2">
          <li>
            <strong className="text-ink">Trust first.</strong> Rankings show the real
            lowest price — not who pays us the most.
          </li>
          <li>
            <strong className="text-ink">Plain language.</strong> No jargon. You should
            understand the recommendation in seconds.
          </li>
          <li>
            <strong className="text-ink">Free to compare.</strong> Searching and
            comparing stays free for shoppers.
          </li>
        </ul>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/search" className="btn-primary">
            Start comparing
          </Link>
          <Link href="/help" className="btn-ghost">
            Visit help
          </Link>
        </div>
      </div>
    </div>
  );
}
