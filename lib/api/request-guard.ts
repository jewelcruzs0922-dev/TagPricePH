import { NextResponse } from "next/server";
import type { RateLimitVerdict } from "@/lib/rate-limit";

/**
 * Shared request hardening for the JSON APIs — client identification for
 * rate-limit keys, the 429 response shape, and a CSRF/content-type/size guard
 * for state-changing POSTs. No route-specific logic lives here.
 */

/**
 * The client address for rate-limit keys.
 *
 * X-Forwarded-For's right-most hop is the one appended by the proxy closest
 * to us — the only position a client cannot pre-fill. Older code took the
 * left-most hop, which is attacker-controlled behind any proxy that appends
 * (rotate the header, get a fresh bucket, defeat the limit). x-real-ip is the
 * fallback for deployments that set it instead. On a direct server with no
 * proxy headers everything collapses to "unknown": a single shared bucket,
 * which is the honest answer — without a trusted proxy there is no per-client
 * identity to read, and pretending otherwise would be worse than documented.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    const nearest = hops[hops.length - 1];
    if (nearest) return nearest;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** The uniform 429 body: opaque error plus Retry-After. Null while allowed. */
export function rateLimitResponse(
  verdict: RateLimitVerdict,
  message: string,
): NextResponse | null {
  if (verdict.allowed) return null;
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: { "Retry-After": String(verdict.retryAfterSeconds) },
    },
  );
}

/** Largest JSON body these endpoints ever need; bigger ones are abuse. */
const MAX_JSON_BODY_BYTES = 64 * 1024;

/**
 * Guard for state-changing JSON POSTs that carry no ambient authority.
 *
 *  - Origin: a browser that sends an Origin at all and it does not match the
 *    request's own origin is a cross-site call — refuse it. Server-side
 *    callers (node fetch, Vercel cron) send no Origin and pass untouched.
 *  - Content-Type: anything present but not JSON (a cross-site form's
 *    text/plain, a multipart upload) is refused before the body is read.
 *  - Size: a Content-Length beyond the guard's budget is refused early.
 *
 * Returns null when the request may proceed, otherwise the response to send.
 */
export function rejectUnsafeJsonPost(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    const sameOrigin =
      origin !== "null" && safeOrigin(origin) === safeRequestOrigin(request);
    if (!sameOrigin) {
      return NextResponse.json(
        { error: "cross-origin request rejected" },
        { status: 403 },
      );
    }
  }

  const contentType = request.headers.get("content-type");
  if (
    contentType !== null &&
    !contentType.trim().toLowerCase().startsWith("application/json")
  ) {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 415 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    return NextResponse.json({ error: "body too large" }, { status: 413 });
  }

  return null;
}

function safeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function safeRequestOrigin(request: Request): string | null {
  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}
