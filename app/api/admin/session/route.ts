import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_MAX_AGE,
  hashToken,
  verifyAdminToken,
} from "@/lib/admin/token";
import {
  clientIp,
  rateLimitResponse,
  rejectUnsafeJsonPost,
} from "@/lib/api/request-guard";
import {
  clearFailures,
  failureBudgetVerdict,
  recordFailure,
  type RateLimitState,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The only session endpoint: exchange the admin token for an httpOnly
 * session cookie, and end the session again.
 *
 * The cookie stores a SHA-256 of the token, never the token itself. A wrong
 * token gets 401, an unconfigured deployment gets 503 — there is no default
 * token anywhere, so an installation that has not set ADMIN_TOKEN simply has
 * no admin area to find.
 *
 * Wrong guesses count against a per-IP failure budget (429 with Retry-After
 * once it runs out), and a correct token clears the budget — so a person who
 * mistypes is slowed down, never locked out, while unattended guessing is
 * throttled. The constant-time comparison in lib/admin/token.ts stops timing
 * probes; this stops volume.
 */

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

const AUTH_LIMIT = { limit: 10, windowMs: 60_000 };
const authFailures: RateLimitState = new Map();

export async function POST(request: NextRequest) {
  const rejected = rejectUnsafeJsonPost(request);
  if (rejected) return rejected;

  const key = `admin-login:${clientIp(request)}`;
  const budget = failureBudgetVerdict(authFailures, key, AUTH_LIMIT);
  if (!budget.allowed) {
    return rateLimitResponse(budget, "too many attempts — wait a moment")!;
  }

  let payload: { token?: unknown } | null = null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid session request" }, { status: 400 });
  }

  const token = typeof payload?.token === "string" ? payload.token : null;
  const verdict = verifyAdminToken(token);

  if (verdict === "disabled") {
    return NextResponse.json({ error: "admin is not configured" }, { status: 503 });
  }
  if (verdict === "mismatch" || !token) {
    recordFailure(authFailures, key, AUTH_LIMIT);
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  clearFailures(authFailures, key);
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(ADMIN_COOKIE, hashToken(token), {
    ...cookieOptions,
    maxAge: ADMIN_SESSION_MAX_AGE,
  });
  return response;
}

/** End the session. Safe to call whether or not one exists. */
export async function DELETE() {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(ADMIN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return response;
}
