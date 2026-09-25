import type { FreshnessState } from "@/lib/types";

/**
 * Freshness thresholds are configurable — tune per provider cadence.
 * A provider that checks hourly has a very different "stale" to one
 * that checks weekly.
 */
export const FRESHNESS_THRESHOLDS = {
  /** Checked within this window → confident "current price". */
  freshMs: 48 * 60 * 60 * 1000, // 48 hours (daily cadence + one missed cycle)
  /** Beyond this → contextual history only, never a current price. */
  staleMs: 14 * 24 * 60 * 60 * 1000, // 14 days
} as const;

/**
 * Four states, because ranking needs to tell "past its cadence" apart from
 * "too old to claim as current":
 *
 *   fresh    ≤ 48h    — a confident current price
 *   aging    ≤ 14d    — still rankable, shown with a may-be-out-of-date note
 *   stale    > 14d    — history, not a current price
 *   unknown  unreadable timestamp — the age is unknowable, so treated as stale
 */
export function getFreshness(
  checkedAt: string,
  now: number = Date.now(),
): FreshnessState {
  const parsed = Date.parse(checkedAt);
  if (Number.isNaN(parsed)) return "unknown";
  const age = now - parsed;
  if (age < 0) return "fresh";
  if (age <= FRESHNESS_THRESHOLDS.freshMs) return "fresh";
  if (age <= FRESHNESS_THRESHOLDS.staleMs) return "aging";
  return "stale";
}

/** Whether an offer checked at this time may still claim to be current. */
export function isCurrentFreshness(state: FreshnessState): boolean {
  return state === "fresh" || state === "aging";
}

/** Human-readable age of a reading: "just now", "8 minutes ago", "5 days ago". */
export function formatRelativeTime(
  checkedAt: string,
  now: number = Date.now(),
): string {
  const parsed = Date.parse(checkedAt);
  if (Number.isNaN(parsed)) return "unknown";
  const seconds = Math.max(0, Math.floor((now - parsed) / 1000));
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}
