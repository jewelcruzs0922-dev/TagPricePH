#!/usr/bin/env node
/**
 * Phase 18 verification: catalog data quality.
 *
 * The catalog is generated from the `seeds` array in lib/data/products.ts,
 * which Node cannot import directly (it uses @/ aliases), so the suite parses
 * the source the same way perf-verify fingerprints it — and asserts the parse
 * count matches the literal count so a formatting change fails loudly instead
 * of silently checking nothing.
 *
 * What it gates, in the order the honesty rules depend on it:
 *
 *   1. Identity: unique ids, unique names, and unique *slugified* names — a
 *      slug collision would silently merge two products' canonical URLs.
 *   2. Money: every offer has a known store, a positive integer price, and a
 *      non-negative days-ago stamp; the recorded history ends at exactly the
 *      current lowest price, so a chart can never show a stale end state as
 *      if it were now (the Phase 1 "never show stale as current" rule at the
 *      data level).
 *   3. Registry discipline: every category and store referenced exists in
 *      the registries; store colors are real hex.
 *   4. Ratings: present only as a pair, in range — absent means absent, and
 *      the UI already renders nothing (17 products rely on this).
 *   5. Images: every referenced file exists under public/, and the curated
 *      price-drop / featured slugs actually resolve to catalog entries.
 *   6. The built site agrees with the data: one prerendered product page
 *      per product, including every curated price-drop slug.
 *
 * Usage: node scripts/data-verify.mjs   (built half expects npm run build)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slugify } from "../lib/utils/format.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const productsSource = readFileSync(
  path.join(root, "lib", "data", "products.ts"),
  "utf8",
);

/* -------------------------------------------------------------------------- *
 * Parse the seeds array.
 * -------------------------------------------------------------------------- */

const seedsStart = productsSource.indexOf("const seeds: ProductSeed[] = [");
const seedsEnd = productsSource.indexOf("export const products");
check("the seeds array is located in products.ts", seedsStart > 0 && seedsEnd > seedsStart);
const seedsRegion = productsSource.slice(seedsStart, seedsEnd);

const idLiterals = seedsRegion.match(/id: "p-/g) ?? [];
const segments = seedsRegion.split(/(?=id: "p-)/).slice(1);
check(
  "every seed parsed",
  segments.length === idLiterals.length && segments.length > 0,
  `parsed ${segments.length} of ${idLiterals.length} literals`,
);
check(
  "the catalog holds at least the MVP floor of 20 products",
  idLiterals.length >= 20,
  `${idLiterals.length} products`,
);

// Seeds quote strings with " or ' depending on whether the value itself
// carries inch marks ('Samsung 55" QLED 4K'), so both forms are read.
const field = (block, key) => {
  const match = new RegExp(`${key}:\\s*(['"])((?:\\\\.|(?!\\1).)*)\\1`).exec(block);
  return match ? match[2].replace(/\\(['"])/g, "$1") : null;
};

const parsed = segments.map((block) => {
  const offers = [...block.matchAll(/offer\("([^"]+)",\s*(\d+),\s*"([^"]+)"(?:,\s*(-?\d+))?/g)].map(
    (m) => ({
      storeId: m[1],
      price: Number(m[2]),
      url: m[3],
      daysAgo: m[4] === undefined ? 0 : Number(m[4]),
    }),
  );
  const endMatch = /endPrice:\s*(\d+)/.exec(block);
  const ratingMatch = /rating:\s*([\d.]+)/.exec(block);
  const reviewMatch = /reviewCount:\s*(\d+)/.exec(block);
  return {
    id: field(block, "id"),
    name: field(block, "name"),
    brand: field(block, "brand"),
    category: field(block, "category"),
    sku: field(block, "sku"),
    image: field(block, "image"),
    slug: field(block, "slug"),
    offers,
    endPrice: endMatch ? Number(endMatch[1]) : null,
    rating: ratingMatch ? Number(ratingMatch[1]) : null,
    reviewCount: reviewMatch ? Number(reviewMatch[1]) : null,
    hasRatingLiteral: /rating:/.test(block),
    hasReviewLiteral: /reviewCount:/.test(block),
  };
});

check(
  "every product carries an id, name, brand, category, and image",
  parsed.every((p) => p.id && p.name && p.brand && p.category && p.image),
  parsed
    .filter((p) => !p.id || !p.name || !p.brand || !p.category || !p.image)
    .map((p) => p.id ?? "?")
    .join(", "),
);

/* -------------------------------------------------------------------------- *
 * 1. Identity
 * -------------------------------------------------------------------------- */

console.log("\nIdentity");
for (const key of ["id", "name", "sku"]) {
  const values = parsed.map((p) => p[key]).filter(Boolean);
  const dupes = values.filter((v, i) => values.indexOf(v) !== i);
  check(
    `${key}s are unique`,
    dupes.length === 0,
    [...new Set(dupes)].join(", "),
  );
}

const slugs = parsed.map((p) => p.slug ?? slugify(p.name ?? ""));
const slugDupes = slugs.filter((v, i) => slugs.indexOf(v) !== i);
check(
  "slugified names are unique (no canonical URL collisions)",
  slugDupes.length === 0,
  [...new Set(slugDupes)].join(", "),
);
check(
  "every slug is URL-shaped",
  slugs.every((slug) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)),
  slugs.filter((slug) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)).join(", "),
);

/* -------------------------------------------------------------------------- *
 * 2. Money: offers and history
 * -------------------------------------------------------------------------- */

console.log("\nOffers and recorded history");
check(
  "every product has at least one offer",
  parsed.every((p) => p.offers.length > 0),
  parsed.filter((p) => p.offers.length === 0).map((p) => p.id).join(", "),
);

const storeSource = readFileSync(path.join(root, "lib", "data", "stores.ts"), "utf8");
const storeIds = [...storeSource.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]);
check(
  "the store registry parses with at least two stores",
  storeIds.length >= 2 && new Set(storeIds).size === storeIds.length,
  storeIds.join(", "),
);

const badStore = [];
const badPrice = [];
const badDays = [];
const badEnd = [];
for (const p of parsed) {
  for (const offer of p.offers) {
    if (!storeIds.includes(offer.storeId)) badStore.push(`${p.id}:${offer.storeId}`);
    if (!Number.isInteger(offer.price) || offer.price <= 0) badPrice.push(`${p.id}:${offer.price}`);
    if (!Number.isInteger(offer.daysAgo) || offer.daysAgo < 0) badDays.push(`${p.id}:${offer.daysAgo}`);
  }
  const lowest = Math.min(...p.offers.map((offer) => offer.price));
  if (p.endPrice !== lowest) badEnd.push(`${p.id}: history ends ${p.endPrice}, lowest offer ${lowest}`);
}
check("every offer points at a registered store", badStore.length === 0, badStore.slice(0, 5).join("; "));
check("every offer price is a positive integer", badPrice.length === 0, badPrice.slice(0, 5).join("; "));
check("every offer's age is a non-negative day count", badDays.length === 0, badDays.slice(0, 5).join("; "));
check(
  "each price history ends at exactly the current lowest offer",
  badEnd.length === 0,
  badEnd.slice(0, 5).join("; "),
);

/* -------------------------------------------------------------------------- *
 * 3. Registries
 * -------------------------------------------------------------------------- */

console.log("\nRegistries");
const categorySource = readFileSync(path.join(root, "lib", "data", "categories.ts"), "utf8");
const categorySlugs = [...categorySource.matchAll(/slug: "([^"]+)"/g)].map((m) => m[1]);
check(
  "the category registry parses with unique slugs",
  categorySlugs.length >= 2 && new Set(categorySlugs).size === categorySlugs.length,
  categorySlugs.join(", "),
);
const unknownCategories = parsed
  .map((p) => p.category)
  .filter((category) => !categorySlugs.includes(category));
check(
  "every product belongs to a registered category",
  unknownCategories.length === 0,
  [...new Set(unknownCategories)].join(", "),
);
const storesStart = storeSource.indexOf("export const stores: Store[] = [");
const storesEnd = storeSource.indexOf("];", storesStart);
const storesRegion = storeSource.slice(storesStart, storesEnd);
const storeColors = [...storesRegion.matchAll(/color: "([^"]+)"/g)].map((m) => m[1]);
const validColors = storeColors.filter((color) => /^#[0-9A-Fa-f]{6}$/.test(color)).length;
check(
  "every store color is six-digit hex",
  validColors === storeColors.length && storeColors.length === storeIds.length,
  `${validColors}/${storeColors.length} valid`,
);

/* -------------------------------------------------------------------------- *
 * 4. Ratings: present only as an in-range pair, else absent
 * -------------------------------------------------------------------------- */

console.log("\nRatings");
const ratingMismatches = parsed
  .filter((p) => p.hasRatingLiteral !== p.hasReviewLiteral)
  .map((p) => p.id);
check(
  "rating and reviewCount always appear together",
  ratingMismatches.length === 0,
  ratingMismatches.join(", "),
);
const ratingOutOfRange = parsed
  .filter((p) => p.rating !== null && (p.rating < 0 || p.rating > 5))
  .map((p) => `${p.id}:${p.rating}`);
check(
  "ratings are within 0–5 when present",
  ratingOutOfRange.length === 0,
  ratingOutOfRange.join(", "),
);

/* -------------------------------------------------------------------------- *
 * 5. Images and curated lists
 * -------------------------------------------------------------------------- */

console.log("\nImages and curated lists");
const missingImages = parsed
  .map((p) => p.image)
  .filter((image) => !existsSync(path.join(root, "public", image)));
check(
  "every referenced image file exists under public/",
  missingImages.length === 0,
  [...new Set(missingImages)].join(", "),
);

const imagePaths = parsed.map((p) => p.image);
const sharedImages = [...new Set(imagePaths.filter((v, i) => imagePaths.indexOf(v) !== i))];

// Known, accepted exception: the 16 Pro and 16 Pro Max share the Pro's photo
// — no dedicated Pro Max asset has ever existed in this repository. Listing
// it here keeps any *other* sharing loud; delete this entry the moment a
// real Pro Max photo is added in products.ts.
const SHARED_IMAGE_ALLOWANCE = new Map([
  ["/images/products/iphone-16-pro.jpg", "p-iphone-16-pro,p-iphone-16-pro-max"],
]);

const offendingShares = sharedImages.filter((image) => {
  const users = parsed
    .filter((p) => p.image === image)
    .map((p) => p.id)
    .sort()
    .join(",");
  return SHARED_IMAGE_ALLOWANCE.get(image) !== users;
});
check(
  "no two products share one photo",
  offendingShares.length === 0,
  offendingShares.join(", "),
);
if (sharedImages.length > 0 && offendingShares.length === 0) {
  console.log(
    `  NOTE  documented shared photo(s): ${sharedImages.join(", ")} (allowed in this suite)`,
  );
}

const dropsMatch = /priceDropSlugs = \[([\s\S]*?)\]/.exec(productsSource);
const dropSlugs = dropsMatch
  ? [...dropsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  : [];
check(
  "the curated price-drop list parses and is non-empty",
  dropSlugs.length > 0,
  `${dropSlugs.length} slugs`,
);
const unresolvedDrops = dropSlugs.filter((slug) => !slugs.includes(slug));
check(
  "every curated price-drop slug resolves to a catalog product",
  unresolvedDrops.length === 0,
  unresolvedDrops.join(", "),
);
const featuredMatch = /slug === "([^"]+)"/.exec(productsSource);
check(
  "the featured product slug resolves to a catalog product",
  Boolean(featuredMatch) && slugs.includes(featuredMatch[1]),
  featuredMatch ? featuredMatch[1] : "no featured slug found",
);

/* -------------------------------------------------------------------------- *
 * 6. The built site agrees with the data
 * -------------------------------------------------------------------------- */

console.log("\nBuilt site");
const productDir = path.join(root, ".next", "server", "app", "product");
const builtPages = existsSync(productDir)
  ? readdirSync(productDir).filter((file) => file.endsWith(".html"))
  : [];
check(
  "one prerendered product page exists per product",
  builtPages.length === parsed.length,
  `${builtPages.length} pages for ${parsed.length} products — run npm run build`,
);
const missingBuilt = dropSlugs.filter(
  (slug) => !builtPages.includes(`${slug}.html`),
);
check(
  "every curated price-drop product has a built page",
  missingBuilt.length === 0,
  missingBuilt.join(", "),
);

console.log(`\n${passed}/${passed + failed} checks passed.\n`);
process.exit(failed === 0 ? 0 : 1);
