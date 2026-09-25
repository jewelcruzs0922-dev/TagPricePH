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
  /** Manufacturer part number / model code, when the source gives us one. */
  modelNumber?: string;
  sku?: string;
  /** GTIN/EAN/UPC — the strongest identity a product has. */
  gtin?: string;
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

/**
 * Model-discriminating tokens: the words that turn one model into another.
 *
 * Their rule is symmetric — a token present on exactly one side means the two
 * sides are talking about different products, which is what stops
 * "iPhone 16 Pro" from landing on "iPhone 16" and "RTX 5060 Ti" from landing
 * on "RTX 5060". Generation tokens (`gen2`, `3rd gen` after tokenisation) are
 * included for the same reason.
 */
const MODEL_TRIM_TOKENS = new Set([
  "pro", "max", "plus", "ultra", "mini", "se", "fe", "ti", "lite", "air",
  "note", "edition", "base", "art", "prime",
]);

const GENERATION_TOKEN = /^gen\d+$/;

/**
 * Words that only ever appear on a bundled listing. A bundle is a different
 * purchasable from the standalone product, so "iPhone 16 128GB + Case Bundle"
 * must never satisfy a query for "iPhone 16 128GB".
 */
const BUNDLE_TOKENS = new Set(["bundle", "combo", "kit", "pack"]);

/**
 * "+ <accessory>": the second shape a bundle title takes — "+ Case",
 * "+ Charger", "+ PSU". Deliberately an accessory list rather than any "+"
 * at all: marketplace titles are full of specification pluses
 * ("Bluetooth + USB-C", "10% + Zinc", "5000mAh + 70W charging") that say
 * nothing about bundling, and refusing those would throw away good matches.
 */
const BUNDLE_PLUS =
  /\+\s*(bundle|case|cover|charger|adapter|earphones?|earbuds|headset|stylus|pencil|psu|cables?|screen|protector|tempered|pouch|bag|stand|holder|mount|freebie|gift|insurance)\b/i;

/**
 * Whether a raw listing/product title describes a bundle rather than the
 * standalone item.
 *
 * Applied to both sides: a product that genuinely *is* a bundle still matches
 * a listing of the same bundle.
 */
export function isBundleTitle(raw: string): boolean {
  const tokens = tokenize(raw.toLowerCase());
  if (tokens.some((token) => BUNDLE_TOKENS.has(token))) return true;
  return BUNDLE_PLUS.test(raw);
}

/**
 * Whether a title states that the item is not new.
 *
 * A second-hand or refurbished unit at ₱15,000 sitting beside a new one at
 * ₱45,000 would otherwise become this product's "lowest price" — a comparison
 * of two different things. Read from the raw title, because tokenisation
 * strips exactly the words ("new", "sealed") that mark the other side.
 *
 * One-sided knowledge is not enough to reject: only an explicit claim on one
 * side and not the other is a conflict, so a title that simply says nothing
 * about condition still matches.
 */
const USED_TITLE =
  /\b(used|refurbished|refurb|pre[- ]?owned|preloved|second[- ]?hand|open[- ]?box|for parts|no box|display unit)\b/i;

export function isUsedTitle(raw: string): boolean {
  return USED_TITLE.test(raw);
}

/** Apparel letter sizes, compared only when both sides state one. */
const LETTER_SIZES = new Set(["xxs", "xs", "s", "m", "l", "xl", "xxl", "3xl"]);

type Variant = {
  /** The first capacity stated, for readable refusal reasons. */
  storageGb?: number;
  /** Every capacity stated (storage, RAM, VRAM) — compared as a set. */
  capacities: number[];
  /** Standalone numbers: model numbers, screen sizes, apparel sizes. */
  numbers: number[];
  /** Apparel letter sizes (s/m/l/…), kept apart from numeric sizes. */
  letters: string[];
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

/**
 * Storage capacity(s), standalone numbers, apparel sizes and colour, when the
 * text states them confidently.
 *
 * Every capacity is collected, not just the first: "16GB RAM 512GB SSD" and
 * "512GB SSD 16GB RAM" describe the same machine, and a matcher that read
 * only the first number would refuse them.
 *
 * Standalone numbers are kept separately because they carry a different kind
 * of identity — a model number, a screen diagonal, an apparel size. They are
 * compared only when *both* sides state one, and by sharing at least one
 * rather than by equality, so a listing that adds an unrelated figure
 * ("…2023 model") still matches while "Size 8" and "Size 10" do not.
 *
 * Letter sizes are kept apart from numeric ones so a side that says "Size 10"
 * and a side that says "Size L" are not compared against each other.
 */
export function extractVariant(tokens: string[]): Variant {
  const variant: Variant = { capacities: [], numbers: [], letters: [] };

  for (const token of tokens) {
    const capacity = /^(\d+)(gb|tb)$/.exec(token);
    if (capacity) {
      const value = Number(capacity[1]) * (capacity[2] === "tb" ? 1000 : 1);
      variant.capacities.push(value);
      if (variant.storageGb === undefined) variant.storageGb = value;
      continue;
    }
    if (/^\d+$/.test(token)) {
      variant.numbers.push(Number(token));
      continue;
    }
    if (LETTER_SIZES.has(token)) {
      variant.letters.push(token);
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

/** The model-discriminating tokens present in a token list. */
export function extractModelTokens(tokens: string[]): Set<string> {
  const model = new Set<string>();
  for (const token of tokens) {
    if (MODEL_TRIM_TOKENS.has(token) || GENERATION_TOKEN.test(token)) {
      model.add(token);
    }
  }
  return model;
}

/** True when the two sides disagree about a model-discriminating token. */
function modelConflicts(a: Set<string>, b: Set<string>): boolean {
  for (const token of a) if (!b.has(token)) return true;
  for (const token of b) if (!a.has(token)) return true;
  return false;
}

/**
 * True when two sides genuinely disagree: each states at least one value the
 * other does not.
 *
 * The asymmetry matters. A listing that omits the size ("Pegasus 40" against
 * "Pegasus 40 Size 8") is *ambiguous*, not wrong, so it must survive to be
 * scored; a listing that states a different one ("Size 10" against "Size 8")
 * is wrong even when both share a model number. A side that states nothing,
 * or states only what the other also states, is never a disagreement.
 */
function conflicts<T>(a: readonly T[], b: readonly T[]): boolean {
  const onlyInA = a.some((value) => !b.includes(value));
  const onlyInB = b.some((value) => !a.includes(value));
  return onlyInA && onlyInB;
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
 * Identifier priority, strongest first: GTIN/EAN/UPC, then the manufacturer's
 * model number, then the SKU — the recommended order, and the signals a
 * seller cannot pad.
 *
 * Each is a *positive* accelerator rather than a gate: a hit is decisive and
 * returns immediately, while a miss falls through to the title path. Our
 * catalog does not yet carry every product's barcode, so a listing whose
 * identifier we have never recorded must still be allowed to match on its
 * name — the absence of a barcode in our data is not evidence of a different
 * product. A confident title match beside a *conflicting* identifier never
 * happens: identifiers are checked before any fuzzy score is computed.
 */
function matchByIdentifier(input: MatchInput, candidates: Product[]): MatchResult | null {
  const gtin = input.gtin?.trim().toLowerCase();
  if (gtin) {
    const hit = candidates.find((product) => product.gtin?.trim().toLowerCase() === gtin);
    if (hit) {
      return {
        status: "match",
        product: hit,
        score: 1,
        reason: `GTIN "${input.gtin}" matched exactly`,
      };
    }
  }

  const modelNumber = input.modelNumber?.trim().toLowerCase();
  if (modelNumber) {
    const hit = candidates.find(
      (product) => product.modelNumber?.trim().toLowerCase() === modelNumber,
    );
    if (hit) {
      return {
        status: "match",
        product: hit,
        score: 1,
        reason: `model number "${input.modelNumber}" matched exactly`,
      };
    }
  }

  const sku = input.sku?.trim().toLowerCase();
  if (sku) {
    const hit = candidates.find((product) => product.sku?.trim().toLowerCase() === sku);
    if (hit) {
      return {
        status: "match",
        product: hit,
        score: 1,
        reason: `SKU "${input.sku}" matched exactly`,
      };
    }
  }

  return null;
}

/** Bundle-ness of a canonical product, memoised across a candidate sweep. */
const bundleCache = new WeakMap<Product, boolean>();
function candidateIsBundle(product: Product): boolean {
  const cached = bundleCache.get(product);
  if (cached !== undefined) return cached;
  const value = isBundleTitle(`${product.brand} ${product.name}`);
  bundleCache.set(product, value);
  return value;
}

/** Condition of a canonical product, memoised across a candidate sweep. */
const usedCache = new WeakMap<Product, boolean>();
function candidateIsUsed(product: Product): boolean {
  const cached = usedCache.get(product);
  if (cached !== undefined) return cached;
  const value = isUsedTitle(`${product.brand} ${product.name}`);
  usedCache.set(product, value);
  return value;
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

  const identifier = matchByIdentifier(input, candidates);
  if (identifier) return identifier;

  const inputTokens = tokenize(input.title);
  if (inputTokens.length === 0) {
    return {
      status: "no_match",
      reason: "listing title produced no usable identity tokens",
    };
  }

  const inputVariant = extractVariant(inputTokens);
  const inputModel = extractModelTokens(inputTokens);
  const inputBundle = isBundleTitle(input.title);
  const inputUsed = isUsedTitle(input.title);
  let brandRejected = 0;
  let variantRejected = 0;
  let modelRejected = 0;
  let bundleRejected = 0;
  let conditionRejected = 0;

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

    // Capacity: a 128GB listing is not a 256GB product, and an 8GB graphics
    // card is not a 16GB one. A title that states fewer capacities than the
    // product ("Laptop 16GB" against "16GB / 512GB") is ambiguous rather than
    // wrong, so only a genuine disagreement refuses.
    if (conflicts(inputVariant.capacities, candidateVariant.capacities)) {
      variantRejected += 1;
      continue;
    }

    // Size: standalone numbers (model numbers, screen diagonals, apparel
    // sizes) and letter sizes, each on its own so "Size 10" is never compared
    // with "Size L".
    if (
      conflicts(inputVariant.numbers, candidateVariant.numbers) ||
      conflicts(inputVariant.letters, candidateVariant.letters)
    ) {
      variantRejected += 1;
      continue;
    }

    // Same rule for colour, but only when both sides resolved a known colour.
    if (inputVariant.color && candidateVariant.color && inputVariant.color !== candidateVariant.color) {
      variantRejected += 1;
      continue;
    }

    // Model-discriminating tokens are compared on both sides: "Pro", "Ti",
    // "Max", "FE" or a differing generation on either side means the two
    // titles are not the same product, whichever way round they are written.
    if (modelConflicts(inputModel, extractModelTokens(candidateTokens))) {
      modelRejected += 1;
      continue;
    }

    // A bundle is a different purchasable from the standalone product.
    if (inputBundle !== candidateIsBundle(product)) {
      bundleRejected += 1;
      continue;
    }

    // A used or refurbished unit is a different purchasable from a new one —
    // comparing them would crown whichever is cheaper as this product's price.
    if (inputUsed !== candidateIsUsed(product)) {
      conditionRejected += 1;
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
    if (modelRejected > 0) {
      reasons.push(`${modelRejected} rejected on model/generation mismatch`);
    }
    if (bundleRejected > 0) {
      reasons.push(`${bundleRejected} rejected: bundle status differs`);
    }
    if (conditionRejected > 0) {
      reasons.push(`${conditionRejected} rejected: condition differs (new vs used/refurbished)`);
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

/* -------------------------------------------------------------------------- *
 * Marketplace URL paste
 *
 * Pasting a Shopee/Lazada/TikTok link is the fastest way to name a product,
 * but the three sites expose very different URLs:
 *
 *  - Lazada puts the product title in the path
 *    (/products/iphone-16-128gb-1234567890.html) → we can read it.
 *  - Shopee and TikTok only put a numeric listing id in the path → we cannot
 *    resolve it at all without marketplace API access, and must say so.
 *
 * Guessing at the id-only case would be the exact fabrication Phase 1 banned,
 * so the resolver returns an honest note for every branch.
 * -------------------------------------------------------------------------- */

export type Marketplace = "shopee" | "lazada" | "tiktok";

export type ListingUrl = {
  marketplace: Marketplace | null;
  host: string;
  /** Title text recoverable from the URL path, when the path carries one. */
  slugTitle: string | null;
  /** Numeric listing id, when the URL carries one. */
  listingId: string | null;
};

export type UrlResolution = {
  url: ListingUrl | null;
  result: MatchResult;
  /** Copy to show the user explaining how their link was interpreted. */
  note: string;
};

const MARKETPLACE_NAMES: Record<Marketplace, string> = {
  shopee: "Shopee",
  lazada: "Lazada",
  tiktok: "TikTok Shop",
};

/** Structural path segments that are never a product title. */
const PATH_NOISE = new Set([
  "products", "product", "items", "item", "shop", "store", "stores",
  "p", "i", "s", "dp", "search", "category", "collections", "collection",
]);

/** Lazada/TikTok paths end with a long numeric id appended to the slug. */
const TRAILING_ID = /[-_]\d{6,}$/;

function readMarketplace(host: string): Marketplace | null {
  const value = host.toLowerCase().replace(/^www\./, "");
  if (value.includes("shopee")) return "shopee";
  if (value.includes("lazada")) return "lazada";
  if (value.includes("tiktok")) return "tiktok";
  return null;
}

export function parseListingUrl(raw: string): ListingUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = parsed.hostname;
  const marketplace = readMarketplace(host);

  const segments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

  // The title-bearing segment is the last one containing letters, walking
  // backwards so a Lazada `/products/<slug>` never picks the collection name.
  const slugSegment = [...segments]
    .reverse()
    .find((segment) => /[a-z]/i.test(segment) && !PATH_NOISE.has(segment.toLowerCase()));

  let slugTitle: string | null = null;
  if (slugSegment) {
    const cleaned = slugSegment
      .replace(/-i\.\d+(\.\d+)?$/, "") // Shopee "-i.1234567890.987654"
      .replace(/\.[a-z]{2,5}$/i, "") // ".html" / ".php"
      .replace(TRAILING_ID, "");
    const words = cleaned.split(/[-_~]+/).filter(Boolean);
    if (words.some((word) => /[a-z]/i.test(word))) {
      // Join with spaces so "128-gb" and "128gb" tokenise identically.
      slugTitle = words.join(" ");
    }
  }

  let listingId: string | null = null;
  for (const segment of segments) {
    const id = /\d{6,}/.exec(segment);
    if (id) {
      listingId = id[0];
      break;
    }
  }
  if (!listingId) {
    for (const value of parsed.searchParams.values()) {
      const id = /^\d{6,}$/.exec(value.trim());
      if (id) {
        listingId = id[0];
        break;
      }
    }
  }

  return { marketplace, host, slugTitle, listingId };
}

/**
 * Resolves a pasted marketplace link against the catalog.
 *
 * Every branch returns a user-facing `note` — including the branches where
 * nothing matched — so the UI never has to invent an explanation.
 */
export function resolveListingUrl(raw: string, candidates: Product[]): UrlResolution {
  const url = parseListingUrl(raw);

  if (!url) {
    return {
      url: null,
      result: { status: "no_match", reason: "pasted value is not a readable URL" },
      note: "That doesn't look like a link we can read. Paste a full Shopee, Lazada, or TikTok Shop product link, or search by the product's name.",
    };
  }

  if (!url.marketplace) {
    return {
      url,
      result: { status: "no_match", reason: `unsupported host "${url.host}"` },
      note: `We can only read links from Shopee, Lazada, and TikTok Shop — “${url.host}” isn't one of them.`,
    };
  }

  if (!url.slugTitle) {
    const name = MARKETPLACE_NAMES[url.marketplace];
    return {
      url,
      result: {
        status: "no_match",
        reason: `${name} link carries only a listing id (${url.listingId ?? "unknown"}), no readable title`,
      },
      note: "That link only carries a listing ID, which we can't look up without marketplace API access. Search by the product's name instead.",
    };
  }

  const result = matchProduct({ title: url.slugTitle }, candidates);

  if (result.status === "match") {
    return { url, result, note: `Matched your pasted link to “${result.product.name}”.` };
  }

  if (result.status === "ambiguous") {
    const names = result.candidates.map((product) => `“${product.name}”`).join(" or ");
    return {
      url,
      result,
      note: `Your link could be either ${names} — we couldn't tell which one you meant, so both are shown.`,
    };
  }

  return {
    url,
    result,
    note: "We couldn't match that link to a product we track. Search by its name instead.",
  };
}
