"use client";

import { useEffect } from "react";

/**
 * Records that a product page was actually seen.
 *
 * Product pages are statically generated, so there is no server render to
 * count a view in; this beacon is the only way the top of the funnel
 * (search → product view → outbound click) can be measured.
 *
 * Anonymous and best-effort: no cookies, no identifiers, and a failure is
 * swallowed — analytics must never change what the shopper sees. Same-origin
 * navigations send no referrer here, so only external sites, the ones that
 * answer "where did this traffic come from", are ever reported.
 */
export function ProductViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    const referrer =
      document.referrer && !document.referrer.startsWith(window.location.origin)
        ? document.referrer
        : null;

    void fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, referrer }),
      keepalive: true,
    }).catch(() => {
      // A missed view is a missed data point, never an error to surface.
    });
  }, [slug]);

  return null;
}
