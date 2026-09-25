#!/usr/bin/env node
/**
 * Phase 22 verification: the performance guarantees.
 *
 * Three things this phase promised, each checked where it can actually break:
 *
 *   1. Product imagery goes through next/image — checked in source (no raw
 *      `<img`) and in the built product pages (responsive candidates present,
 *      no unoptimized `/images` sources).
 *   2. The sample catalog never reaches the browser — checked against the
 *      emitted client chunks themselves, fingerprinted from the catalog source
 *      so a renamed product cannot silently un-break the check.
 *   3. Search hands the client a window, not the catalog — checked over real
 *      HTTP against a freshly started `next start`: page size, pagination
 *      overlap, empty price history, the typeahead endpoint, and the image
 *      optimizer.
 *
 * The HTTP half spawns its own server on port 3999 so it cannot collide with
 * a dev server already on 3000, and kills it afterwards.
 *
 * Usage: node scripts/perf-verify.mjs   (expects `npm run build` to have run)
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSearchUrl, parsePage } from "../lib/data/search-url.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
/** Comfortably above the current ~290 KB, far below the old 1.15 MB. */
const SEARCH_PAGE_BUDGET = 400_000;

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

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
    return out;
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  return { status: response.status, body: await response.text() };
}

function startServer() {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  return spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
    cwd: root,
    stdio: "ignore",
  });
}

async function waitForServer(child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const { status } = await fetchText(`${BASE}/`);
      if (status === 200) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function staticChecks() {
  console.log("\nImagery (next/image)");
  const sources = [
    ...walk(path.join(root, "components")),
    ...walk(path.join(root, "app")),
    ...walk(path.join(root, "lib")),
  ].filter((file) => file.endsWith(".tsx"));
  const rawImgs = sources.filter((file) =>
    readFileSync(file, "utf8").includes("<img"),
  );
  check(
    "no raw <img> elements left in source",
    rawImgs.length === 0,
    rawImgs.map((file) => path.relative(root, file)).join(", "),
  );

  const builtProducts = walk(path.join(root, ".next", "server", "app", "product"))
    .filter((file) => file.endsWith(".html"))
    .slice(0, 5);
  check(
    "built product pages exist to inspect",
    builtProducts.length > 0,
    "run npm run build first",
  );
  for (const file of builtProducts) {
    const html = readFileSync(file, "utf8");
    check(
      `${path.basename(file)} renders through /_next/image`,
      html.includes("/_next/image"),
    );
    check(
      `${path.basename(file)} ships no unoptimized product src`,
      !html.includes('<img src="/images'),
    );
  }

  console.log("\nCatalog stays out of the client bundle");
  const catalogSource = readFileSync(
    path.join(root, "lib", "data", "products.ts"),
    "utf8",
  );
  const fingerprints = [...catalogSource.matchAll(/name: "([^"]{12,})"/g)]
    .map((match) => match[1])
    .slice(0, 8);
  check(
    "catalog fingerprints extracted from lib/data/products.ts",
    fingerprints.length >= 3,
    `found ${fingerprints.length}`,
  );

  const chunks = walk(path.join(root, ".next", "static", "chunks")).filter(
    (file) => file.endsWith(".js"),
  );
  const leaked = [];
  for (const chunk of chunks) {
    const code = readFileSync(chunk, "utf8");
    for (const name of fingerprints) {
      if (code.includes(name)) {
        leaked.push(`${path.basename(chunk)}: ${name}`);
      }
    }
  }
  check(
    "no client chunk contains catalog product data",
    leaked.length === 0,
    leaked.slice(0, 3).join("; "),
  );

  console.log("\nSearch paging wire format (lib/data/search-url.ts)");
  check("an absent page means page 1", parsePage(new URLSearchParams("")) === 1);
  check(
    "page is encoded into the search URL",
    buildSearchUrl("tv", {}, "lowest-price", 3).includes("page=3"),
  );
  check(
    "page 1 omits the parameter entirely",
    buildSearchUrl("tv", {}, "lowest-price", 1).includes("page=") === false,
  );
  check(
    "a malformed page falls back to 1",
    parsePage(new URLSearchParams("page=abc")) === 1,
  );
  check(
    "page 0 falls back to 1",
    parsePage(new URLSearchParams("page=0")) === 1,
  );
  check(
    "an absurd page is clamped",
    parsePage(new URLSearchParams("page=999999")) === 1000,
  );

  return fingerprints;
}

async function httpChecks(fingerprints) {
  console.log("\nRuntime (next start on a scratch port)");
  const child = startServer();
  let up = false;
  try {
    up = await waitForServer(child);
    check("server starts", up, "next start never became ready");
    if (!up) return;

    // --- windowed search results
    const page1 = await fetchText(`${BASE}/api/search?q=`).then((r) =>
      JSON.parse(r.body),
    );
    check(
      "the first page carries a full window, not the catalog",
      page1.results.length === 48,
      `${page1.results.length} results`,
    );
    check(
      "the server reports how many results exist in total",
      page1.total > page1.results.length,
      `total=${page1.total} window=${page1.results.length}`,
    );
    check(
      "page 1 says there is more to fetch",
      page1.hasMore === true && page1.page === 1,
      `page=${page1.page} hasMore=${page1.hasMore}`,
    );
    check(
      "no price history crosses to the browser",
      page1.results.every((product) => product.priceHistory.length === 0),
      `${page1.results.filter((p) => p.priceHistory.length > 0).length} with history`,
    );

    const page2 = await fetchText(
      `${BASE}/api/search?q=&page=2`,
    ).then((r) => JSON.parse(r.body));
    check("page 2 advances the window", page2.page === 2 && page2.results.length > 0);
    const page1Ids = new Set(page1.results.map((product) => product.id));
    const overlap = page2.results.filter((product) => page1Ids.has(product.id));
    check(
      "pages never repeat a product",
      overlap.length === 0,
      overlap.map((product) => product.slug).join(", "),
    );

    // --- the search page itself
    const searchPage = await fetchText(`${BASE}/search`);
    check("the search page renders", searchPage.status === 200);
    check(
      "the search page stays inside its payload budget",
      searchPage.body.length < SEARCH_PAGE_BUDGET,
      `${searchPage.body.length} bytes (budget ${SEARCH_PAGE_BUDGET})`,
    );
    check(
      "the search page offers the next window",
      searchPage.body.includes("Show more"),
    );

    // --- typeahead
    const term = (fingerprints[0] ?? "iphone").split(" ")[0].toLowerCase();
    const suggestions = await fetchText(
      `${BASE}/api/suggestions?q=${encodeURIComponent(term)}`,
    ).then((r) => JSON.parse(r.body));
    check(
      "suggestions answer with a bounded list",
      Array.isArray(suggestions) && suggestions.length >= 1 && suggestions.length <= 5,
      JSON.stringify(suggestions).slice(0, 120),
    );
    check(
      "suggestions carry no price history",
      suggestions.every((product) => product.priceHistory.length === 0),
    );
    const empty = await fetchText(`${BASE}/api/suggestions?q=`).then((r) => r.body);
    check("an empty query suggests nothing", empty.trim() === "[]", empty.slice(0, 60));

    // --- the optimizer actually serves the image the page asks for
    // Pull a single optimizer URL out of an `src="…"` attribute (not a srcSet,
    // which carries several candidates) and ask the server for it.
    const src = /src="(\/_next\/image\?url=[^"]+)"/.exec(searchPage.body)?.[1];
    check("the search page references optimized images", Boolean(src));
    if (src) {
      const target = `${BASE}${src.replace(/&amp;/g, "&")}`;
      const image = await fetch(target, {
        signal: AbortSignal.timeout(20_000),
      });
      check(
        "the image optimizer returns the image",
        image.status === 200,
        `HTTP ${image.status}`,
      );
      await image.arrayBuffer();
    }

    // --- a product page renders responsive candidates for its main image
    const firstSlug = page1.results[0]?.slug;
    const product = await fetchText(`${BASE}/product/${firstSlug}`);
    check("a product page renders", product.status === 200, firstSlug ?? "");
    check(
      "its main image ships responsive candidates",
      /srcset=/i.test(product.body),
    );
    // The tracker ships as a client component: the page references it, and the
    // beacon URL lives in the JS chunk that fires it — neither alone proves it
    // is wired up.
    check(
      "the product page mounts the view tracker",
      product.body.includes("ProductViewTracker"),
    );
    const beaconInBundle = walk(path.join(root, ".next", "static", "chunks"))
      .filter((file) => file.endsWith(".js"))
      .some((file) => readFileSync(file, "utf8").includes("/api/views"));
    check("the view beacon ships in the client bundle", beaconInBundle);
  } finally {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(resolve, 5_000);
    });
  }
}

async function main() {
  if (!existsSync(path.join(root, ".next"))) {
    console.error("No .next directory — run npm run build first.");
    process.exit(1);
  }
  const fingerprints = staticChecks();
  await httpChecks(fingerprints);
  console.log(`\n${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nPerformance verification failed: ${error.message}`);
  process.exit(1);
});
