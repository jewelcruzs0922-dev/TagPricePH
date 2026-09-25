import type { Metadata } from "next";
import { BellRing } from "lucide-react";
import { PriceAlertList } from "@/components/price-alert/PriceAlert";

export const metadata: Metadata = {
  title: "Price Alerts",
  description:
    "Look up the target prices you have saved with TagPricePH and see which ones have been reached.",
  alternates: { canonical: "/alerts" },
};

export default function AlertsPage() {
  return (
    <div className="container-page py-8 sm:py-10">
      <div className="mb-6 max-w-2xl">
        <p className="eyebrow">
          <BellRing className="h-4 w-4" aria-hidden="true" />
          Stored on the server
        </p>
        <h1 className="mt-3 text-[28px] font-extrabold tracking-tight text-ink sm:text-[34px]">
          Your price alerts
        </h1>
        <p className="mt-2 text-[16px] text-ink-2">
          Enter the email you saved them with — alerts live on the server, so
          they show up on any device. Each one is checked against current
          prices and flagged here the moment the target is reached. Email
          delivery is not connected yet: nothing is sent, the address only
          finds your alerts.
        </p>
      </div>

      <PriceAlertList />

      <section aria-labelledby="alerts-how" className="card mt-6 p-5">
        <h2 id="alerts-how" className="text-[17px] font-bold text-ink">
          How alerts work
        </h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px] text-ink-2">
          <li>Enter your email and a target price on any product page.</li>
          <li>The alert is stored server-side and checked against current prices.</li>
          <li>
            When a price reaches your target, it is flagged here with the date
            it was observed.
          </li>
        </ol>
      </section>
    </div>
  );
}
