import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { logEvent } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for uptime monitoring (Phase 9/10). Answers with a
 * bare status only — no versions, no connection details, no environment
 * values. A database that cannot answer marks the instance down (503) so an
 * external monitor notices; the body says nothing about why.
 */
export async function GET() {
  try {
    await query("SELECT 1");
    return NextResponse.json(
      { ok: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    logEvent("error", "health.db-unreachable", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
