"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** End the admin session and drop back to the login form. */
export function AdminLogout() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      await fetch("/api/admin/session", { method: "DELETE" });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={busy}
      className="btn-ghost"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
