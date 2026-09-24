import type { Metadata } from "next";
import { BellRing } from "lucide-react";
import { PriceAlertList } from "@/components/price-alert/PriceAlert";

export const metadata: Metadata = {
  title: "Price Alerts",
  description:
    "Set target prices for products and keep them on this device with TagPricePH demo alerts.",
  alternates: { canonical: "/alerts" },
};

export default function AlertsPage() {
  return (
    <div className="container-page py-8 sm:py-10">
      <div className="mb-6 max-w-2xl">
        <p className="eyebrow">
          <BellRing className="h-4 w-4" aria-hidden="true" />
          Saved on this device
        </p>
        <h1 className="mt-3 text-[28px] font-extrabold tracking-tight text-ink sm:text-[34px]">
          Your price alerts
        </h1>
        <p className="mt-2 text-[16px] text-ink-2">
          Alerts are stored in your browser&apos;s local storage for this demo. Email and
          push notifications are not enabled yet — no account system is connected.
        </p>
      </div>

      <PriceAlertList />

      <section aria-labelledby="alerts-how" className="card mt-6 p-5">
        <h2 id="alerts-how" className="text-[17px] font-bold text-ink">
          How alerts will work later
        </h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px] text-ink-2">
          <li>Create an account (coming when a backend is connected).</li>
          <li>Choose a target price on any product page.</li>
          <li>Get notified when the tracked price reaches your target.</li>
        </ol>
      </section>
    </div>
  );
}
