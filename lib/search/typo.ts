/**
 * Typo tolerance for search (Phase 11).
 *
 * Kept pure and dependency-free so scripts can import it directly, the same
 * way lib/data/alert-events.ts is imported by alerts-verify.mjs.
 *
 * The rule it implements is deliberately conservative:
 *
 *  - a query token first has to fail exact (substring) matching before any
 *    fuzzy rule may apply — and at the set level, a single exact match
 *    anywhere switches off the fuzzy pass entirely (see search-core), so a
 *    query that works today keeps exactly the same results;
 *  - only tokens of 4+ characters may match with edits (1 edit for 4–6
 *    letters, 2 for 7+), so "tv", "led", "ps5" can never drag in a wrong
 *    product through a near-miss;
 *  - distance is Damerau–Levenshtein (optimal string alignment), because the
 *    most common real typo is a swapped pair — "iphoen" is 1 edit from
 *    "iphone", not 2.
 *
 * This is search only. Listing-to-product matching (lib/matching) keeps its
 * refuse/ambiguous contract untouched: search may widen, a price match may
 * never guess.
 */

export type QueryMatch = "exact" | "fuzzy" | "none";

/**
 * Optimal string alignment distance: insertions, deletions, substitutions,
 * and adjacent transpositions, each costing 1.
 *
 * "iphoen" → "iphone" = 1 (transposition), not 2 (two substitutions).
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  let curr: number[] = new Array<number>(n + 1);

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        best = Math.min(best, prev2[j - 2] + 1);
      }
      curr[j] = best;
    }
    prev2 = prev;
    prev = curr;
    curr = new Array<number>(n + 1);
  }

  return prev[n];
}

/**
 * How many edits a token of this length is allowed.
 *
 * 1–3 letters: exact only — too short to absorb an edit safely ("ps5" must
 * never near-match something else). 4–6: one edit covers the common slips.
 * 7+: two edits, which is still under a third of the word.
 */
export function maxEditsFor(tokenLength: number): number {
  if (tokenLength <= 3) return 0;
  if (tokenLength <= 6) return 1;
  return 2;
}

/**
 * Classifies one product's text against a tokenised query.
 *
 * "exact"  — every token appears as a substring, i.e. today's behaviour
 *            unchanged, including short tokens like "tv" or prefix hits
 *            like "phone" inside "iphone".
 * "fuzzy"  — exact failed, but every token matches some word of the haystack
 *            within its edit budget.
 * "none"   — at least one token has no acceptable match either way.
 *
 * An empty token list is "exact": no constraint to fail.
 */
export function matchQueryIn(haystack: string, tokens: string[]): QueryMatch {
  if (tokens.length === 0) return "exact";

  const exact = tokens.every((token) => haystack.includes(token));
  if (exact) return "exact";

  const words = haystack.split(/\s+/);
  const fuzzy = tokens.every((token) => {
    if (haystack.includes(token)) return true;
    const max = maxEditsFor(token.length);
    if (max === 0) return false;
    return words.some((word) => {
      if (Math.abs(word.length - token.length) > max) return false;
      const distance = editDistance(word, token);
      return distance > 0 && distance <= max;
    });
  });

  return fuzzy ? "fuzzy" : "none";
}
