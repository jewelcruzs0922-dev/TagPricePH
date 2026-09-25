/**
 * Structured logging — one JSON object per line on stdout/stderr so a log
 * drain (Vercel's, or anything downstream) can parse events instead of
 * regexing prose (§30).
 *
 * Contract:
 *   - `event` names are dotted, stable, and past-tense for completions
 *     ("ingest.complete") — dashboards filter on them, so renaming breaks
 *     queries.
 *   - `fields` are flat and small: counts, slugs, provider ids, durations.
 *   - Never pass secrets, access tokens, or full email addresses. Debugging
 *     an alert run needs the slug and a count, not who was mailed — PII and
 *     credentials do not belong in log lines even on a private drain.
 *
 * No `server-only`: verification scripts log through this too, and a log
 * line cannot leak anything by itself — the rules above do the protecting.
 */
export type LogFields = Record<
  string,
  string | number | boolean | null | undefined | readonly string[] | readonly number[]
>;

export type LogLevel = "debug" | "info" | "warn" | "error";

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);
}
