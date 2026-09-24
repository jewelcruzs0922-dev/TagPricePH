"use client";

import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { BellRing, Check, Trash2 } from "lucide-react";
import { formatPeso } from "@/lib/utils/format";

export type StoredAlert = {
  id: string;
  productSlug: string;
  productName: string;
  targetPrice: number;
  createdAt: string;
};

const STORAGE_KEY = "tagpriceph-alerts-v1";
const EVENT_NAME = "tagpriceph-alerts-changed";
const LEGACY_STORAGE_KEY = "priceph-alerts-v1";

if (typeof window !== "undefined") {
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === null) {
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy !== null) {
        window.localStorage.setItem(STORAGE_KEY, legacy);
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
  } catch {
    // localStorage unavailable
  }
}

function parseAlerts(raw: string): StoredAlert[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredAlert[]) : [];
  } catch {
    return [];
  }
}

function subscribe(onStoreChange: () => void) {
  const handler = () => onStoreChange();
  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener("storage", handler);
  };
}

function getAlertsSnapshot(): string {
  return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
}

function getServerAlertsSnapshot(): string {
  return "[]";
}

function getHydratedSnapshot(): boolean {
  return true;
}

function getServerHydratedSnapshot(): boolean {
  return false;
}

function noopSubscribe() {
  return () => {};
}

function readAlerts(): StoredAlert[] {
  return parseAlerts(getAlertsSnapshot());
}

function writeAlerts(alerts: StoredAlert[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function usePriceAlerts() {
  const raw = useSyncExternalStore(
    subscribe,
    getAlertsSnapshot,
    getServerAlertsSnapshot,
  );
  const alerts = useMemo(() => parseAlerts(raw), [raw]);
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    getHydratedSnapshot,
    getServerHydratedSnapshot,
  );

  const addAlert = useCallback((input: Omit<StoredAlert, "id" | "createdAt">) => {
    const next: StoredAlert = {
      ...input,
      id: `${input.productSlug}-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    const current = readAlerts();
    writeAlerts([
      next,
      ...current.filter((alert) => alert.productSlug !== input.productSlug),
    ]);
  }, []);

  const removeAlert = useCallback((id: string) => {
    writeAlerts(readAlerts().filter((alert) => alert.id !== id));
  }, []);

  return { alerts, hydrated, addAlert, removeAlert };
}

export function PriceAlertForm({
  productSlug,
  productName,
  suggestedPrice,
}: {
  productSlug: string;
  productName: string;
  suggestedPrice: number;
}) {
  const { alerts, hydrated, addAlert, removeAlert } = usePriceAlerts();
  const [target, setTarget] = useState(String(Math.round(suggestedPrice * 0.9)));
  const [saved, setSaved] = useState(false);

  const existing = useMemo(
    () => alerts.find((alert) => alert.productSlug === productSlug),
    [alerts, productSlug],
  );
  const targetNumber = Number(target.replace(/[^0-9]/g, ""));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!targetNumber || targetNumber <= 0) return;
    addAlert({ productSlug, productName, targetPrice: targetNumber });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  return (
    <section
      aria-labelledby="price-alert-heading"
      className="rounded-2xl border border-line bg-white p-5"
    >
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-ink">
          <BellRing className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 id="price-alert-heading" className="text-[17px] font-bold text-ink">
            Price alerts
          </h2>
          <p className="text-[14px] text-ink-2">
            Saved on this device only. No account or email is sent in this demo.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label
          htmlFor={`alert-price-${productSlug}`}
          className="block text-[14px] font-semibold text-ink"
        >
          Alert me when this reaches
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center rounded-full border border-line bg-cream/60 px-4 focus-within:border-ink focus-within:ring-4 focus-within:ring-accent/30">
            <span className="text-ink-3" aria-hidden="true">
              ₱
            </span>
            <input
              id={`alert-price-${productSlug}`}
              type="text"
              inputMode="numeric"
              value={target}
              onChange={(event) =>
                setTarget(event.target.value.replace(/[^0-9,]/g, ""))
              }
              className="h-12 w-full bg-transparent px-2 text-[16px] font-semibold text-ink outline-none"
              aria-describedby={`alert-hint-${productSlug}`}
            />
          </div>
          <button type="submit" className="btn-primary h-12 w-full sm:w-auto">
            {saved ? (
              <>
                <Check className="h-4 w-4" aria-hidden="true" /> Saved
              </>
            ) : (
              "Set price alert"
            )}
          </button>
        </div>
        <p id={`alert-hint-${productSlug}`} className="text-[13px] text-ink-3">
          Current lowest is around {formatPeso(suggestedPrice)}.
        </p>
      </form>

      {hydrated && existing && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-success-soft px-4 py-3">
          <p className="text-[14px] text-ink">
            Watching for <strong>{formatPeso(existing.targetPrice)}</strong> on{" "}
            {existing.productName}.
          </p>
          <button
            type="button"
            onClick={() => removeAlert(existing.id)}
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-2 hover:text-ink"
            aria-label={`Remove price alert for ${existing.productName}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Remove
          </button>
        </div>
      )}
    </section>
  );
}

export function PriceAlertList() {
  const { alerts, hydrated, removeAlert } = usePriceAlerts();

  if (!hydrated) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="skeleton h-20 w-full" />
        <div className="skeleton h-20 w-full" />
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-[17px] font-bold text-ink">No price alerts yet.</p>
        <p className="mt-1 text-[15px] text-ink-2">
          Open any product and set a target price to watch it from this device.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {alerts.map((alert) => (
        <li
          key={alert.id}
          className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="break-words text-[16px] font-semibold text-ink">{alert.productName}</p>
            <p className="text-[14px] text-ink-2">
              Target: <strong>{formatPeso(alert.targetPrice)}</strong>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a href={`/product/${alert.productSlug}`} className="btn-ghost text-[14px]">
              View product
            </a>
            <button
              type="button"
              onClick={() => removeAlert(alert.id)}
              className="btn-ghost text-[14px] text-ink-2"
              aria-label={`Remove alert for ${alert.productName}`}
            >
              Remove
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
