import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

export const metadata: Metadata = {
  title: "Help",
  description:
    "How TagPricePH comparisons, price history, buy timing, and alerts work — plus privacy and terms notes.",
  alternates: { canonical: "/help" },
};

const faqs = [
  {
    q: "Does TagPricePH sell products?",
    a: "No. TagPricePH compares prices and links you to the retailer. We do not process orders or payments.",
  },
  {
    q: "Are the prices live?",
    a: "This build uses demo data for illustration. When live marketplace or partner feeds are connected, demo labels will be removed.",
  },
  {
    q: "How is “Good time to buy” decided?",
    a: "We compare the current lowest price with the product's average over recent history. Significantly below average = good time; near average = fair; above average = consider waiting.",
  },
  {
    q: "Do price alerts send emails?",
    a: "Not yet. Alerts in this demo are stored only in your browser (localStorage). A backend is required before notifications can be delivered.",
  },
  {
    q: "How does TagPricePH make money?",
    a: "Eventually through affiliate commissions when you open a retailer link, and clearly labeled sponsored placements. Sponsored items never replace the true lowest price.",
  },
];

export default function HelpPage() {
  return (
    <div className="container-page py-8 sm:py-10">
      <div className="max-w-2xl">
        <h1 className="text-[28px] font-extrabold tracking-tight text-ink sm:text-[34px]">
          Help
        </h1>
        <p className="mt-2 text-[16px] text-ink-2">
          Quick answers about how TagPricePH works.
        </p>
      </div>

      <div className="mt-8 grid max-w-3xl gap-3">
        {faqs.map((item) => (
          <details key={item.q} className="card group p-4 sm:p-5">
            <summary className="group flex cursor-pointer list-none items-start justify-between gap-3 py-2 text-[16px] font-semibold text-ink marker:hidden">
              {item.q}
              <ChevronDown
                className="mt-0.5 h-4 w-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{item.a}</p>
          </details>
        ))}
      </div>

      <div className="mt-10 grid max-w-3xl gap-6 md:grid-cols-2">
        <section id="privacy" className="card p-5">
          <h2 className="text-[18px] font-bold text-ink">Privacy</h2>
          <p className="mt-2 text-[15px] text-ink-2">
            This demo stores price alerts locally in your browser. Nothing is sent to a
            server. Clear site data to remove them. A production privacy policy will be
            added when accounts and analytics are connected.
          </p>
        </section>
        <section id="terms" className="card p-5">
          <h2 className="text-[18px] font-bold text-ink">Terms</h2>
          <p className="mt-2 text-[15px] text-ink-2">
            Prices and availability shown here are samples for product demonstration
            only. Always confirm the final price on the retailer&apos;s website before
            purchasing. Trademarks belong to their respective owners.
          </p>
        </section>
      </div>

      <div className="mt-8">
        <Link href="/search" className="btn-primary">
          Search for a product
        </Link>
      </div>
    </div>
  );
}
