#!/usr/bin/env node
/**
 * Phase 11 verification: search typo tolerance.
 *
 * Two halves, like the other suites:
 *   - the rules themselves, imported straight from lib/search/typo.ts, so the
 *     exact distance and edit-budget logic the search runs is checked without
 *     booting a server: transpositions count as one edit, short tokens can
 *     never match fuzzily, exact matching is never displaced;
 *   - the live pipeline over HTTP against a freshly started `next start`: a
 *     transposed query finds the product it meant and carries the honest
 *     close-matches note, exact queries keep their plain answer, nonsense
 *     finds nothing, and the typeahead widens the same way.
 *
 * The HTTP half spawns its own server on port 3998 (perf-verify uses 3999)
 * so it cannot collide with a dev server on 3000, and kills it afterwards.
 *
 * Usage: node scripts/typo-verify.mjs   (expects `npm run build` to have run)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  editDistance,
  maxEditsFor,
  matchQueryIn,
} from "../lib/search/typo.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3998;
const BASE = `http://localhost:${PORT}`;

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

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  return { status: response.status, body: await response.text() };
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  return response.json();
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

function unitChecks() {
  console.log("\nEdit distance (lib/search/typo.ts)");
  check("identical strings are 0 edits", editDistance("iphone", "iphone") === 0);
  check(
    "a transposition is 1 edit, not 2",
    editDistance("iphoen", "iphone") === 1,
    `got ${editDistance("iphoen", "iphone")}`,
  );
  check("a deletion is 1 edit", editDistance("samsng", "samsung") === 1);
  check("a substitution is 1 edit", editDistance("sony", "sonx") === 1);
  check(
    "the classic distance still holds",
    editDistance("kitten", "sitting") === 3,
    `got ${editDistance("kitten", "sitting")}`,
  );
  check("empty against a word is its length", editDistance("", "abc") === 3);

  console.log("\nEdit budget by token length");
  check("3-letter tokens require exact matches", maxEditsFor(3) === 0);
  check("4-letter tokens allow one edit", maxEditsFor(4) === 1);
  check("6-letter tokens allow one edit", maxEditsFor(6) === 1);
  check("7-letter tokens allow two edits", maxEditsFor(7) === 2);
  check("long tokens stop at two edits", maxEditsFor(15) === 2);

  console.log("\nQuery classification");
  const hay = "iphone 16 128gb apple phones smartphone";
  check(
    "substring matching still wins exactly",
    matchQueryIn(hay, ["phone"]) === "exact",
  );
  check(
    "an exact token is never downgraded to fuzzy",
    matchQueryIn(hay, ["iphone"]) === "exact",
  );
  check(
    "a transposed typo matches fuzzily",
    matchQueryIn(hay, ["iphoen"]) === "fuzzy",
    `got ${matchQueryIn(hay, ["iphoen"])}`,
  );
  check(
    "a deleted letter matches fuzzily",
    matchQueryIn("samsung galaxy s24 phone", ["samsng"]) === "fuzzy",
    `got ${matchQueryIn("samsung galaxy s24 phone", ["samsng"])}`,
  );
  check(
    "short tokens match exactly when present",
    matchQueryIn("samsung tv 65 inch", ["tv"]) === "exact",
  );
  check(
    "short tokens never match fuzzily",
    matchQueryIn("samsung tv 65 inch", ["tx"]) === "none",
  );
  check(
    "a genuinely wrong token is none",
    matchQueryIn(hay, ["zzzzzz"]) === "none",
  );
  check(
    "every token has to match",
    matchQueryIn(hay, ["iphoen", "zzzzzz"]) === "none",
  );
  check(
    "mixed exact and fuzzy tokens still count as fuzzy",
    matchQueryIn(hay, ["iphoen", "128"]) === "fuzzy",
  );
  check(
    "no tokens means no constraint",
    matchQueryIn(hay, []) === "exact",
  );
  check(
    "a two-edit slip on a 7-letter word still matches",
    matchQueryIn("samsung galaxy", ["samusng"]) === "fuzzy",
    `got ${matchQueryIn("samsung galaxy", ["samusng"])}`,
  );
}

async function httpChecks() {
  console.log("\nRuntime (next start on a scratch port)");
  const child = startServer();
  let up = false;
  try {
    up = await waitForServer(child);
    check("server starts", up, "next start never became ready");
    if (!up) return;

    // --- a typo query finds the product it meant, and says why
    const typo = await fetchJson(
      `${BASE}/api/search?q=${encodeURIComponent("iphoen")}`,
    );
    check(
      "a transposed typo still returns results",
      Array.isArray(typo.results) && typo.results.length > 0,
      `${typo.results?.length ?? "n/a"} results`,
    );
    check(
      "and they are the iPhone it meant",
      typo.results.some((product) => product.name.includes("iPhone 16")),
      typo.results.map((product) => product.name).slice(0, 3).join("; "),
    );
    check(
      "the result carries the honest close-matches note",
      typeof typo.note === "string" && typo.note.includes("close matches"),
      JSON.stringify(typo.note),
    );

    // --- an exact query is untouched: no note, same plain answer
    const exact = await fetchJson(
      `${BASE}/api/search?q=${encodeURIComponent("iphone 16")}`,
    );
    check(
      "an exact query keeps its plain answer",
      exact.note === null && exact.results.length > 0,
      `note=${JSON.stringify(exact.note)} results=${exact.results?.length}`,
    );

    // --- nonsense finds nothing rather than near-misses
    const nonsense = await fetchJson(
      `${BASE}/api/search?q=${encodeURIComponent("xyzzq")}`,
    );
    check(
      "a nonsense query finds nothing and notes nothing",
      nonsense.results.length === 0 && nonsense.note === null,
      `results=${nonsense.results?.length} note=${JSON.stringify(nonsense.note)}`,
    );

    // --- short tokens stay exact
    const tv = await fetchJson(`${BASE}/api/search?q=tv`);
    check(
      "short tokens keep exact matching",
      tv.results.length > 0 && tv.note === null,
      `results=${tv.results?.length} note=${JSON.stringify(tv.note)}`,
    );

    // --- a typo'd brand plus an exact word still lands on the right catalog
    const brand = await fetchJson(
      `${BASE}/api/search?q=${encodeURIComponent("samsng tv")}`,
    );
    check(
      "a typo'd brand still lands on its products",
      brand.results.length > 0 &&
        brand.results.some((product) => product.brand.toLowerCase() === "samsung") &&
        brand.note !== null,
      `results=${brand.results?.length} note=${JSON.stringify(brand.note)}`,
    );

    // --- the server-rendered page shows the same note
    const page = await fetchText(`${BASE}/search?q=${encodeURIComponent("iphoen")}`);
    check(
      "the search page renders the close-match note",
      page.status === 200 && page.body.includes("close matches"),
      `status=${page.status}`,
    );

    // --- the typeahead widens the same way
    const suggestions = await fetchJson(
      `${BASE}/api/suggestions?q=${encodeURIComponent("iphoen")}`,
    );
    check(
      "typeahead is typo-tolerant too",
      Array.isArray(suggestions) &&
        suggestions.length >= 1 &&
        suggestions.length <= 5 &&
        suggestions.some((product) => product.name.includes("iPhone")),
      JSON.stringify(suggestions.map((product) => product.name)).slice(0, 120),
    );
    const blank = await fetchJson(
      `${BASE}/api/suggestions?q=${encodeURIComponent("xyzzq")}`,
    );
    check(
      "nonsense suggests nothing",
      Array.isArray(blank) && blank.length === 0,
      JSON.stringify(blank).slice(0, 60),
    );
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
  unitChecks();
  await httpChecks();
  console.log(`\n${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nTypo-tolerance verification failed: ${error.message}`);
  process.exit(1);
});
