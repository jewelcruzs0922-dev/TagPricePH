import type { Product } from "@/lib/types";

/**
 * Product matching — decides whether an incoming marketplace listing refers to
 * one of our canonical products.
 *
 * This is the piece that makes live data safe to compare: a Shopee title like
 * "🔥 Brand New Apple iPhone 16 128GB - Free Shipping PH" has to land on the
 * right canonical product, or on none at all.
 *
 * The guiding rule is borrowed from Phase 1's honesty principle: **never
 * guess**. A confident match, an explicitly ambiguous result, or an explicit
 * refusal — those are the only three outcomes. Silently attaching a listing to
 * the wrong product would corrupt every price comparison downstream.
 */

export const MATCH_THRESHOLD = 0.72;
export const AMBIGUITY_MARGIN = 0.06;

export type MatchInput = {
  title: string;
  brand?: string;
  sku?: string;
};

export type MatchResult =
  | { status: "match"; product: Product; score: number; reason: string }
  | {
      status: "ambiguous";
      candidates: Product[];
      scores: number[];
      margin: number;
      reason: string;
    }
  | { status: "no_match"; reason: string };

export type MatchOptions = {
  threshold?: number;
  margin?: number;
};

/** Words marketplaces and sellers append that carry no identity. */
const NOISE_TOKENS = new Set([
  "original", "official", "authentic", "genuine", "authenticity", "brand",
  "new", "sealed", "seal", "box", "fullbox", "free", "shipping", "ship",
  "ph", "philippines", "manila", "sale", "discount", "promo", "price",
  "cheap", "hot", "best", "top", "shop", "store", "seller", "dealer",
  "supplier", "authorized", "officialstore", "unit", "pcs", "pc", "set",
  "lot", "item", "items", "product", "products", "ready", "stock", "stocks",
  "available", "delivery", "cod", "warranty", "month", "months", "w/",
  "includes", "include", "come", "comes", "only", "now", "today", "mega",
  "double", "digit", "days", "day", "100", "1000", "plusdelivery",
]);

/** Grammatical filler that says nothing about which product this is. */
const STOP_TOKENS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "to", "is", "for",
  "with", "by", "at", "from", "that", "this", "it", "its",
]);

/**
 * Known colour words. Only colours resolved from this list take part in the
 * variant-conflict rule — marketplace colour names are too inconsistent to
 * reject anything we are not sure about.
 */
const COLOR_TOKENS = new Set([
  "black", "white", "blue", "red", "green", "pink", "purple", "gray", "grey",
  "silver", "gold", "natural", "midnight", "starlight", "graphite",
  "titanium", "cream", "yellow", "orange", "beige", "brown", "mint",
  "lavender", "navy", "coral", "plum", "lime", "charcoal", "sand", "pearl",
  "bronze", "rose", "sky", "cyan", "magenta",
]);

type Variant = {
  storageGb?: number;
  color?: string;
};

/**
 * Lowercase, strip accents and punctuation, collapse whitespace.
 * "iPhone 16, 128 GB!" → "iphone 16 128 gb"
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Tokenise into comparable identity tokens.
 *
 * Two normalisations matter because marketplaces are inconsistent about them:
 *  - "128 GB" and "128gb" become the same token
 *  - "gen 2", "2nd gen" and "series 2" all become "gen2"
 *
 * Noise and grammatical filler are dropped so seller padding cannot inflate
 * or deflate the score.
 */
export function tokenize(input: string): string[] {
  const words = normalizeText(input).split(" ").filter(Boolean);
  const merged: string[] = [];

  for (let i = 0; i < words.length; i += 1) {
    const current = words[i];
    const next = words[i + 1];

    if (next && /^\d+$/.test(current) && (next === "gb" || next === "tb")) {
      merged.push(`${current}${next}`);
      i += 1;
      continue;
    }

    if (
      (current === "gen" || current === "generation" || current === "series") &&
      next &&
      /^\d+$/.test(next)
    ) {
      merged.push(`gen${next}`);
      i += 1;
      continue;
    }

    if (/^\d+(st|nd|rd|th)$/.test(current) && next === "gen") {
      merged.push(`gen${parseInt(current, 10)}`);
      i += 1;
      continue;
    }

    merged.push(current);
  }

  return merged.filter((token) => !NOISE_TOKENS.has(token) && !STOP_TOKENS.has(token));
}

/** Storage capacity and colour, when the text states them confidently. */
export function extractVariant(tokens: string[]): Variant {
  const variant: Variant = {};

  for (const token of tokens) {
    const match = /^(\d+)(gb|tb)$/.exec(token);
    if (match) {
      variant.storageGb = Number(match[1]) * (match[2] === "tb" ? 1000 : 1);
      break;
    }
  }

  for (const token of tokens) {
    if (COLOR_TOKENS.has(token)) {
      variant.color = token;
      break;
    }
  }

  return variant;
}

/** Identity tokens for a canonical product: brand + name only, never keywords. */
function tokensFor(product: Product): string[] {
  return tokenize(`${product.brand} ${product.name}`);
}

/**
 * F1 over token sets. Recall is weighted by construction (a listing title is
 * usually longer than the canonical name), so noise removal in `tokenize`
 * is what keeps precision honest.
 */
function scoreTokens(inputTokens: string[], candidateTokens: string[]): number {
  const input = new Set(inputTokens);
  const candidate = new Set(candidateTokens);
  if (input.size === 0 || candidate.size === 0) return 0;

  let shared = 0;
  for (const token of input) if (candidate.has(token)) shared += 1;
  if (shared === 0) return 0;

  const recall = shared / candidate.size;
  const precision = shared / input.size;
  return (2 * recall * precision) / (recall + precision);
}

/**
 * Finds the canonical product a listing refers to.
 *
 * @param input      the raw listing (title always required)
 * @param candidates the canonical products to choose among
 */
export function matchProduct(
  input: MatchInput,
  candidates: Product[],
  options: MatchOptions = {},
): MatchResult {
  const threshold = options.threshold ?? MATCH_THRESHOLD;
  const margin = options.margin ?? AMBIGUITY_MARGIN;

  // An explicit SKU is decisive — it is the one signal sellers cannot pad.
  const sku = input.sku?.trim().toLowerCase();
  if (sku) {
    const bySku = candidates.find(
      (product) => product.sku?.trim().toLowerCase() === sku,
    );
    if (bySku) {
      return {
        status: "match",
        product: bySku,
        score: 1,
        reason: `SKU "${input.sku}" matched exactly`,
      };
    }
  }

  const inputTokens = tokenize(input.title);
  if (inputTokens.length === 0) {
    return {
      status: "no_match",
      reason: "listing title produced no usable identity tokens",
    };
  }

  const inputVariant = extractVariant(inputTokens);
  let brandRejected = 0;
  let variantRejected = 0;

  const scored: { product: Product; score: number }[] = [];

  for (const product of candidates) {
    if (
      input.brand &&
      product.brand.trim().toLowerCase() !== input.brand.trim().toLowerCase()
    ) {
      brandRejected += 1;
      continue;
    }

    const candidateTokens = tokensFor(product);
    const candidateVariant = extractVariant(candidateTokens);

    // Storage is unambiguous: a 256GB listing is simply not a 128GB product.
    if (
      inputVariant.storageGb &&
      candidateVariant.storageGb &&
      inputVariant.storageGb !== candidateVariant.storageGb
    ) {
      variantRejected += 1;
      continue;
    }

    // Same rule for colour, but only when both sides resolved a known colour.
    if (inputVariant.color && candidateVariant.color && inputVariant.color !== candidateVariant.color) {
      variantRejected += 1;
      continue;
    }

    scored.push({ product, score: scoreTokens(inputTokens, candidateTokens) });
  }

  if (scored.length === 0) {
    const reasons: string[] = [];
    if (variantRejected > 0) {
      reasons.push(
        `${variantRejected} candidate(s) rejected on variant conflict` +
          (inputVariant.storageGb ? ` (listing is ${inputVariant.storageGb}GB)` : ""),
      );
    }
    if (brandRejected > 0) reasons.push(`${brandRejected} rejected on brand`);
    return {
      status: "no_match",
      reason: reasons.length > 0 ? reasons.join("; ") : "no candidates to compare against",
    };
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1];

  if (best.score < threshold) {
    return {
      status: "no_match",
      reason: `best candidate "${best.product.name}" scored ${best.score.toFixed(2)}, below the ${threshold.toFixed(2)} threshold`,
    };
  }

  if (runnerUp && best.score - runnerUp.score < margin) {
    return {
      status: "ambiguous",
      candidates: [best.product, runnerUp.product],
      scores: [best.score, runnerUp.score],
      margin: best.score - runnerUp.score,
      reason: `"${best.product.name}" (${best.score.toFixed(2)}) and "${runnerUp.product.name}" (${runnerUp.score.toFixed(2)}) are only ${(best.score - runnerUp.score).toFixed(2)} apart`,
    };
  }

  return {
    status: "match",
    product: best.product,
    score: best.score,
    reason: `scored ${best.score.toFixed(2)} against "${best.product.name}"`,
  };
}
