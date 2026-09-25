import type { SearchFilters, SearchSort } from "@/lib/types";

/**
 * The wire format between the search UI and `/api/search`.
 *
 * Deliberately has no runtime dependencies: both the browser and the Node
 * verifier import it, so `@/` aliases and catalog imports are not allowed here.
 * Keeping encode and decode in one file is what stops the client from sending
 * a key the server doesn't read — a mismatch that fails silently by returning
 * an unfiltered result set.
 */

const SORTS: readonly SearchSort[] = [
  "lowest-price",
  "biggest-savings",
  "biggest-drop",
  "recently-updated",
];

const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);
const FALSE_VALUES = new Set(["0", "false", "off", "no"]);

/**
 * Booleans are always sent — as `0` when unchecked — so an unchecked box
 * travels as an explicit value rather than an absent key that the server would
 * replace with a default.
 */
export function buildSearchUrl(
  query: string,
  filters: SearchFilters,
  sort: SearchSort,
): string {
  const params = new URLSearchParams();
  params.set("q", query);
  if (filters.category) params.set("category", filters.category);
  if (filters.brand) params.set("brand", filters.brand);
  if (filters.store) params.set("store", filters.store);
  if (typeof filters.maxPrice === "number") {
    params.set("maxPrice", String(filters.maxPrice));
  }
  params.set("priceDropOnly", filters.priceDropOnly ? "1" : "0");
  params.set("inStockOnly", filters.inStockOnly ? "1" : "0");
  params.set("sort", sort);
  return `/api/search?${params.toString()}`;
}

function readBool(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

function readText(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return undefined;
  return trimmed;
}

function readPrice(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000) return undefined;
  return Math.round(parsed);
}

/** Tolerant by design: unknown, missing, or malformed keys are simply dropped. */
export function parseSearchParams(params: URLSearchParams): {
  q: string;
  filters: SearchFilters;
  sort: SearchSort;
} {
  const filters: SearchFilters = {};

  const category = readText(params.get("category"));
  if (category) filters.category = category;

  const brand = readText(params.get("brand"));
  if (brand) filters.brand = brand;

  const store = readText(params.get("store"));
  if (store) filters.store = store;

  const maxPrice = readPrice(params.get("maxPrice"));
  if (maxPrice !== undefined) filters.maxPrice = maxPrice;

  const priceDropOnly = readBool(params.get("priceDropOnly"));
  if (priceDropOnly !== undefined) filters.priceDropOnly = priceDropOnly;

  const inStockOnly = readBool(params.get("inStockOnly"));
  if (inStockOnly !== undefined) filters.inStockOnly = inStockOnly;

  const rawSort = params.get("sort");
  const sort = SORTS.includes(rawSort as SearchSort)
    ? (rawSort as SearchSort)
    : "lowest-price";

  return { q: params.get("q") ?? "", filters, sort };
}
