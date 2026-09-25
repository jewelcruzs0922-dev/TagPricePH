"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The only door into the admin area. The token is posted straight to the
 * session endpoint and never persisted anywhere by this component — on
 * success the server sets an httpOnly cookie and the page refreshes into the
 * dashboard.
 */
export function AdminLogin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const token = String(form.get("token") ?? "");

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (response.status === 204) {
        router.refresh();
        return;
      }
      if (response.status === 503) {
        setError("Admin access is not configured on this deployment.");
      } else if (response.status === 401) {
        setError("That token was not accepted.");
      } else {
        setError("Sign-in failed. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <div className="card p-6 sm:p-8" data-admin="login">
        <h1 className="mb-2 text-2xl font-bold text-ink">Admin access</h1>
        <p className="mb-6 text-sm text-ink-3">
          This area is not linked from anywhere on the site. It is gated by the
          deployment&apos;s <code className="font-mono text-ink">ADMIN_TOKEN</code>.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="admin-token"
              className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-ink-3"
            >
              Admin token
            </label>
            <input
              id="admin-token"
              name="token"
              type="password"
              autoComplete="current-password"
              required
              className="h-11 w-full rounded-xl border border-line bg-white px-4 text-[16px] text-ink outline-none focus:border-ink"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-wait">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
