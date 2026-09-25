"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { BellRing, Check, Trash2 } from "lucide-react";
import type { PriceAlertView } from "@/lib/data/alert-events";
import { fromCents } from "@/lib/db/money";
import { formatPeso } from "@/lib/utils/format";

/**
 * Price alerts against the server API.
 *
 * There is no account system: the email a shopper types is the entire
 * identity, stored only so the same alerts can be found from another device.
 * The address is remembered on this device for convenience, and the copy says
 * plainly that nothing is emailed — an alert is *flagged on the alerts page*
 * when the price reaches the target, which is what the server actually does.
 */

const EMAIL_KEY = "tagpriceph-alert-email";
/**
 * Mailbox access tokens, keyed by email (§25): the server returns a token
 * exactly once — on the POST that created the mailbox — and every later call
 * must present it as `x-alert-token`. Storing per email means filing under a
 * second address on this device cannot evict the first mailbox's key.
 */
const TOKENS_KEY = "tagpriceph-alert-tokens";

function rememberEmail(email: string) {
  try {
    window.localStorage.setItem(EMAIL_KEY, email);
  } catch {
    // localStorage unavailable — the alerts themselves live on the server
  }
}

function recallEmail(): string {
  try {
    return window.localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function readTokens(): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TOKENS_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function rememberToken(email: string, token: string) {
  try {
    window.localStorage.setItem(
      TOKENS_KEY,
      JSON.stringify({ ...readTokens(), [email]: token }),
    );
  } catch {
    // Storage unavailable: the next call will 403 and the UI will say so.
  }
}

function alertHeaders(email: string): Record<string, string> {
  const token = readTokens()[email];
  return token ? { "x-alert-token": token } : {};
}

/**
 * The remembered email, read through the store hook so the server render and
 * the first client render agree (both see "") and the stored value arrives on
 * the update pass — no effect writes state synchronously, and no hydration
 * mismatch.
 */
function subscribeEmail(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function useRememberedEmail(): string {
  return useSyncExternalStore(
    subscribeEmail,
    recallEmail,
    () => "",
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Editable email state that falls back to the remembered address: the input
 * shows the stored value until the visitor types something, then follows
 * their text without ever needing to push the store value into state.
 */
function useEmailField() {
  const remembered = useRememberedEmail();
  const [typed, setTyped] = useState<string | null>(null);
  return {
    email: typed ?? remembered,
    setEmail: setTyped,
  };
}

export function PriceAlertForm({
  productSlug,
  productName,
  suggestedPrice,
}: {
  productSlug: string;
  productName: string;
  /** Today's price, or null when the product has no qualifying current price. */
  suggestedPrice: number | null;
}) {
  const { email, setEmail } = useEmailField();
  // Prefill only from a real price: guessing a default from nothing would
  // put a target on screen that nobody has any reason to believe in.
  const [target, setTarget] = useState(
    suggestedPrice ? String(Math.round(suggestedPrice * 0.9)) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Carries the email it was fetched under: switching accounts hides a watch
  // that belongs to someone else without needing a synchronous reset.
  const [saved, setSaved] = useState<{ email: string; alert: PriceAlertView } | null>(null);

  const normalized = email.trim().toLowerCase();
  const visible = saved && saved.email === normalized ? saved.alert : null;
  const targetNumber = Number(target.replace(/[^0-9]/g, ""));

  // A returning visitor with a remembered email sees the watch they already
  // have for this product instead of silently overwriting it on submit. The
  // write lands in a callback, so it never races the render.
  useEffect(() => {
    if (!looksLikeEmail(normalized)) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(
          `/api/alerts?email=${encodeURIComponent(normalized)}`,
          { signal: controller.signal, headers: alertHeaders(normalized) },
        );
        if (!response.ok) return;
        const data = (await readJson(response)) as { alerts?: PriceAlertView[] } | null;
        const existing = data?.alerts?.find((alert) => alert.slug === productSlug);
        // Only ever upgrades the view: a stale empty response must not clear
        // a watch this page just saved.
        if (existing && !controller.signal.aborted) {
          setSaved({ email: normalized, alert: existing });
        }
      } catch {
        /* aborted or offline — the form still works */
      }
    })();
    return () => controller.abort();
  }, [normalized, productSlug]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!looksLikeEmail(email)) {
      setError("Enter the email your alerts should be filed under.");
      return;
    }
    if (!targetNumber) {
      setError("Enter a target price.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...alertHeaders(email.trim().toLowerCase()),
        },
        body: JSON.stringify({
          email: email.trim(),
          slug: productSlug,
          targetPrice: targetNumber,
        }),
      });
      if (!response.ok) {
        await readJson(response);
        setError(
          response.status === 400
            ? "Check the email address and target price."
            : response.status === 403
              ? "That email's alerts are locked to the device that created them."
              : response.status === 404
                ? "That product isn't in the catalog."
                : response.status === 429
                  ? "Too many attempts — wait a moment and try again."
                  : "Couldn't save the alert. Try again.",
        );
        return;
      }
      const data = (await readJson(response)) as {
        alert?: PriceAlertView;
        accessToken?: string;
      } | null;
      if (data?.alert) {
        const normalizedEmail = email.trim().toLowerCase();
        setSaved({ email: normalizedEmail, alert: data.alert });
        rememberEmail(normalizedEmail);
        if (data.accessToken) rememberToken(normalizedEmail, data.accessToken);
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!visible || !saved) return;
    try {
      const response = await fetch(
        `/api/alerts?email=${encodeURIComponent(saved.email)}&id=${visible.id}`,
        { method: "DELETE", headers: alertHeaders(saved.email) },
      );
      if (response.ok) setSaved(null);
    } catch {
      setError("Couldn't remove the alert. Try again.");
    }
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
            Filed with your email so it follows you to any device. We flag it on
            the alerts page when the price reaches your target — no email is
            sent yet.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label
          htmlFor={`alert-email-${productSlug}`}
          className="block text-[14px] font-semibold text-ink"
        >
          Email
        </label>
        <input
          id={`alert-email-${productSlug}`}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="h-12 w-full rounded-full border border-line bg-cream/60 px-4 text-[16px] text-ink outline-none focus:border-ink focus:ring-4 focus:ring-accent/30"
          aria-describedby={`alert-hint-${productSlug}`}
        />

        <label
          htmlFor={`alert-price-${productSlug}`}
          className="block text-[14px] font-semibold text-ink"
        >
          Alert me when this reaches
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center rounded-full border border-line bg-cream/60 px-4 focus-within:border-ink focus-within:ring-4 focus:ring-accent/30">
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
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary h-12 w-full disabled:opacity-60 sm:w-auto"
          >
            {saving ? (
              "Saving…"
            ) : (
              <>
                {visible && <Check className="h-4 w-4" aria-hidden="true" />}
                {visible ? "Update alert" : "Set price alert"}
              </>
            )}
          </button>
        </div>
        <p id={`alert-hint-${productSlug}`} className="text-[13px] text-ink-3">
          {suggestedPrice
            ? `Current lowest is around ${formatPeso(suggestedPrice)}.`
            : "No current price is available for this product right now — enter any target you want to watch."}
        </p>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-[14px] font-medium text-[#B54708]">
          {error}
        </p>
      )}

      {visible && (
        <div className="mt-4 rounded-xl border border-line bg-success-soft px-4 py-3">
          <p className="text-[14px] text-ink">
            Watching for <strong>{formatPeso(fromCents(visible.targetPriceCents))}</strong>{" "}
            on {visible.productName ?? productName}.
          </p>
          <p className="mt-1 text-[13px] text-ink-2">
            {visible.status === "triggered" && visible.triggeredAt
              ? `Reached on ${formatDate(visible.triggeredAt)} — flagged on your alerts page.`
              : "We'll flag it on your alerts page when the price reaches it. No email is sent."}
          </p>
          <button
            type="button"
            onClick={handleRemove}
            className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-2 hover:text-ink"
            aria-label={`Remove price alert for ${visible.productName ?? productName}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Remove
          </button>
        </div>
      )}
    </section>
  );
}

type LookupPhase = "idle" | "loading" | "ready" | "error";

export function PriceAlertList() {
  const { email, setEmail } = useEmailField();
  const [lookupKey, setLookupKey] = useState("");
  const [phase, setPhase] = useState<LookupPhase>("idle");
  const [alerts, setAlerts] = useState<PriceAlertView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!looksLikeEmail(normalized)) {
      setPhase("error");
      setError("Enter the email your alerts are filed under.");
      return;
    }
    setPhase("loading");
    setError(null);
    try {
      const response = await fetch(
        `/api/alerts?email=${encodeURIComponent(normalized)}`,
        { headers: alertHeaders(normalized) },
      );
      if (!response.ok) {
        setPhase("error");
        setError(
          response.status === 400
            ? "That doesn't look like a valid email address."
            : response.status === 403
              ? "These alerts are locked to the device that created them."
              : "Couldn't load alerts. Try again.",
        );
        return;
      }
      const data = (await readJson(response)) as { alerts?: PriceAlertView[] } | null;
      setAlerts(data?.alerts ?? []);
      setLookupKey(normalized);
      rememberEmail(normalized);
      setPhase("ready");
    } catch {
      setPhase("error");
      setError("Couldn't reach the server. Try again.");
    }
  }, []);

  const remembered = useRememberedEmail();

  // A returning visitor's alerts are simply there on arrival: auto-load the
  // remembered address once, until something has been looked up deliberately.
  // Scheduled rather than called inline so the effect body itself writes no
  // state — the load is work the effect schedules, not a render it forces.
  useEffect(() => {
    if (!remembered || lookupKey) return;
    const timer = window.setTimeout(() => void lookup(remembered), 0);
    return () => window.clearTimeout(timer);
  }, [remembered, lookupKey, lookup]);

  async function remove(alert: PriceAlertView) {
    try {
      const response = await fetch(
        `/api/alerts?email=${encodeURIComponent(lookupKey)}&id=${alert.id}`,
        { method: "DELETE", headers: alertHeaders(lookupKey) },
      );
      if (response.ok) {
        setAlerts((previous) => previous.filter((item) => item.id !== alert.id));
      }
    } catch {
      setError("Couldn't remove the alert. Try again.");
    }
  }

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void lookup(email);
        }}
        className="card mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
      >
        <label htmlFor="alerts-email" className="sr-only">
          Email for your alerts
        </label>
        <input
          id="alerts-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="h-12 w-full rounded-full border border-line bg-cream/60 px-4 text-[16px] text-ink outline-none focus:border-ink focus:ring-4 focus:ring-accent/30"
        />
        <button
          type="submit"
          disabled={phase === "loading"}
          className="btn-primary h-12 shrink-0 disabled:opacity-60"
        >
          {phase === "loading" ? "Loading…" : "Find my alerts"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mb-4 text-[14px] font-medium text-[#B54708]">
          {error}
        </p>
      )}

      {phase === "loading" && (
        <div className="space-y-3" aria-busy="true">
          <div className="skeleton h-20 w-full" />
          <div className="skeleton h-20 w-full" />
        </div>
      )}

      {phase === "idle" && (
        <div className="card p-8 text-center">
          <p className="text-[17px] font-bold text-ink">See your price alerts.</p>
          <p className="mt-1 text-[15px] text-ink-2">
            Enter the email you used on a product page to load what you&apos;re
            watching.
          </p>
        </div>
      )}

      {phase === "ready" && alerts.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-[17px] font-bold text-ink">No price alerts for this email.</p>
          <p className="mt-1 text-[15px] text-ink-2">
            Open any product and set a target price — it will show up here.
          </p>
        </div>
      )}

      {phase === "ready" && alerts.length > 0 && (
        <ul className="flex flex-col gap-3">
          {alerts.map((alert) => {
            const target = formatPeso(fromCents(alert.targetPriceCents));
            const reached = alert.status === "triggered";
            return (
              <li
                key={alert.id}
                className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-words text-[16px] font-semibold text-ink">
                      {alert.productName ?? alert.slug}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        reached
                          ? "bg-success-soft text-success"
                          : "bg-accent-soft text-ink"
                      }`}
                    >
                      {reached ? "Reached" : "Watching"}
                    </span>
                  </div>
                  <p className="mt-1 text-[14px] text-ink-2">
                    Target: <strong>{target}</strong>
                    {alert.currentPriceCents !== null && (
                      <>
                        {" · now "}
                        <strong>{formatPeso(fromCents(alert.currentPriceCents))}</strong>
                      </>
                    )}
                  </p>
                  {reached && alert.triggeredAt && (
                    <p className="text-[13px] font-medium text-success">
                      Reached on {formatDate(alert.triggeredAt)} — flagged here, no
                      email sent.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <a href={`/product/${alert.slug}`} className="btn-ghost text-[14px]">
                    View product
                  </a>
                  <button
                    type="button"
                    onClick={() => void remove(alert)}
                    className="btn-ghost text-[14px] text-ink-2"
                    aria-label={`Remove alert for ${alert.productName ?? alert.slug}`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
