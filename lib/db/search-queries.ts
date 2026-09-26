import "server-only";

import { query } from "@/lib/db";
import { logEvent } from "@/lib/log";

/**
 * Search analytics (Phase 8): record what shoppers search for so the owner
 * can see which products people want and which searches come up empty.
 *
 * Privacy: the normalized query text and a result count only. Queries are
 * capped and never carry identifiers. Failures are logged, never thrown —
 * analytics must not be able to break the search page it is measuring.
 */

const MAX_RECORDED_LENGTH = 300;

export type SearchQueryRow = {
  query: string;
  total: number;
};

function normalizeQuery(raw: string): string | null {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) return null;
  return collapsed.slice(0, MAX_RECORDED_LENGTH);
}

const INSERT_SEARCH_QUERY_SQL = `
  INSERT INTO search_queries (query, result_count)
  VALUES ($1, $2)
`;

/** Fire-and-forget from the search page. Never throws. */
export async function recordSearchQuery(
  rawQuery: string,
  resultCount: number,
): Promise<void> {
  const normalized = normalizeQuery(rawQuery);
  if (!normalized) return;
  try {
    await query(INSERT_SEARCH_QUERY_SQL, [normalized, resultCount]);
  } catch (error) {
    logEvent("error", "search.query-record-failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

const SEARCH_TOTAL_SQL = "SELECT COUNT(*)::int AS total FROM search_queries";

const TOP_SEARCHES_SQL = `
  SELECT query, COUNT(*)::int AS total
  FROM search_queries
  GROUP BY query
  ORDER BY total DESC, MAX(created_at) DESC
  LIMIT 10
`;

/** Lifetime search count plus the ten most common queries, for the admin. */
export async function searchStats(): Promise<{
  total: number;
  top: SearchQueryRow[];
}> {
  try {
    const [totalRows, topRows] = await Promise.all([
      query<{ total: number }>(SEARCH_TOTAL_SQL),
      query<SearchQueryRow>(TOP_SEARCHES_SQL),
    ]);
    return { total: totalRows[0]?.total ?? 0, top: topRows };
  } catch (error) {
    logEvent("error", "search.stats-failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { total: 0, top: [] };
  }
}
