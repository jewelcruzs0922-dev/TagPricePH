#!/usr/bin/env node
/**
 * Phase 1 trust gate verification.
 *
 * Runs against the *built* HTML, not the source, so it proves what a shopper
 * and a search engine actually receive:
 *
 *   1. Product pages publish no price, availability, or rating to search
 *      engines while the catalog is sample data.
 *   2. Every product page carries an on-page sample label.
 *   3. The homepage neither shows a review count nor omits its sample label.
 *   4. The meta description leads with the sample qualifier, so search-result
 *      truncation cannot cut the caveat off.
 *
 * Usage:  npm run build && npm run trust:verify
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, ".next", "server", "app");

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

function readPage(relative) {
  return readFileSync(path.join(appDir, relative), "utf8");
}

function productPages() {
  const dir = path.join(appDir, "product");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".html"))
    .map((file) => ({ file, html: readFileSync(path.join(dir, file), "utf8") }));
}

function categoryPages() {
  const dir = path.join(appDir, "categories");
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  return files
    .filter((file) => file.endsWith(".html"))
    .map((file) => ({ file, html: readFileSync(path.join(dir, file), "utf8") }));
}

/** The built files must exist, or every check below would pass vacuously. */
function assertBuildExists() {
  let ok = true;
  try {
    statSync(path.join(appDir, "index.html"));
  } catch {
    ok = false;
  }
  if (!ok) {
    console.error(
      "\nNo build output found at .next/server/app.\nRun `npm run build` first.\n",
    );
    process.exit(1);
  }
}

assertBuildExists();
const pages = productPages();
const categories = categoryPages();
const indexHtml = readPage("index.html");

console.log(`\nSample-data catalog → ${pages.length} product pages\n`);

console.log("Structured data");
check(
  "no Offer / priceCurrency is published to search engines",
  pages.every((page) => !page.html.includes("priceCurrency")),
);
check(
  "no availability claim is published",
  pages.every((page) => !page.html.includes("schema.org/InStock")),
);
check(
  "no aggregateRating is published",
  pages.every((page) => !page.html.includes("aggregateRating")),
);
check(
  "Product JSON-LD is still emitted (name/brand kept for indexing)",
  pages.every((page) => page.html.includes('"@type":"Product"')),
);

console.log("\nMeta descriptions");
check(
  "every product description leads with the sample qualifier",
  pages.every((page) =>
    page.html.includes('<meta name="description" content="Sample data.'),
  ),
  pages.find((page) => !page.html.includes("Sample data."))?.file ?? "");

console.log("\nOn-page labels");
check(
  "every product page carries a sample label",
  pages.every(
    (page) =>
      page.html.includes("Sample listing for demonstration") ||
      page.html.includes("not live prices"),
  ),
);
check(
  "every product page labels its history chart",
  pages.every((page) =>
    page.html.includes("Sample history for demonstration"),
  ),
);
check(
  "homepage labels the featured comparison as sample data",
  indexHtml.includes("Sample data — demonstration catalog"),
);
check(
  "homepage labels the price-drop section as sample data",
  indexHtml.includes("sample price sits below"),
);
check(
  "every category page carries a sample label",
  categories.length > 0 &&
    categories.every((page) =>
      page.html.includes("Sample data — prices shown are illustrative"),
    ),
  `${categories.length} category page(s) found`,
);

console.log("\nUnsupported claims");
check(
  "homepage shows no review count",
  !/ reviews\)/.test(indexHtml),
);
check(
  "homepage publishes no price to search engines",
  !indexHtml.includes("priceCurrency"),
);
check(
  "product pages publish no review count",
  pages.every((page) => !/ reviews\)/.test(page.html)),
);

console.log(`\n${passed}/${passed + failed} checks passed.\n`);
process.exit(failed === 0 ? 0 : 1);
