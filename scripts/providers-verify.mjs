#!/usr/bin/env node
/**
 * Phases 2/8 verification: the marketplace adapter layer.
 *
 * Proves three things the plan asks for:
 *   - each marketplace has an adapter that is explicitly marked unavailable
 *     with a reason, rather than quietly absent or quietly empty;
 *   - every method on those adapters refuses with ProviderUnavailableError
 *     instead of returning no products;
 *   - nothing outside lib/api reaches for a marketplace-specific adapter, so
 *     the rest of the app stays written against the interface alone.
 *
 * The adapters are imported directly from lib/api/marketplace-adapters.ts,
 * which is deliberately free of value imports: lib/api/registry.ts carries
 * `server-only`, which plain Node cannot resolve, so registration itself is
 * asserted by reading the file (below) rather than by importing it.
 *
 * Usage: node scripts/providers-verify.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProviderUnavailableError,
  assertUsableProvider,
  shopeeProvider,
  lazadaProvider,
  tiktokShopProvider,
} from "../lib/api/marketplace-adapters.ts";

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

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

const adapters = [shopeeProvider, lazadaProvider, tiktokShopProvider];
const expectedIds = ["shopee", "lazada", "tiktok"];
const methods = ["listProducts", "searchProducts", "getProduct", "getRelatedProducts"];

console.log("\nAdapter state");
for (const adapter of adapters) {
  const reason = adapter.unavailableReason;
  check(
    `${adapter.id} marks itself unavailable with a reason`,
    adapter.status === "unavailable" &&
      typeof reason === "string" &&
      reason.trim().length > 20,
    `status=${adapter.status} reason=${JSON.stringify(reason)}`,
  );
}
check(
  "each adapter declares the id it would register under",
  adapters.map((adapter) => adapter.id).join(",") === expectedIds.join(","),
  adapters.map((adapter) => adapter.id).join(","),
);
check(
  "every reason names what is actually missing (no vague 'coming soon')",
  adapters.every((adapter) => /no authorized/i.test(adapter.unavailableReason ?? "")),
);

console.log("\nRefusal (never an empty catalog)");
for (const adapter of adapters) {
  const refusals = [];
  const problems = [];

  for (const method of methods) {
    try {
      await adapter[method]();
      problems.push(`${method} returned instead of refusing`);
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) {
        problems.push(`${method} threw ${error?.constructor?.name}`);
      } else {
        refusals.push(error);
      }
    }
  }

  check(
    `${adapter.id}: all four methods refuse`,
    problems.length === 0,
    problems.join("; "),
  );
  check(
    `${adapter.id}: the refusal names the provider and the reason`,
    refusals.length === methods.length &&
      refusals.every(
        (error) =>
          error.message.includes(adapter.id) &&
          error.message.includes(adapter.unavailableReason ?? "\u0000"),
      ),
    refusals[0]?.message ?? "no refusal captured",
  );
}

console.log("\nSelection guard");
const readyProvider = {
  id: "ready-fixture",
  source: "demo",
  status: "ready",
  listProducts: async () => [],
  searchProducts: async () => [],
  getProduct: async () => null,
  getRelatedProducts: async () => [],
};
let readyPassed = true;
try {
  assertUsableProvider(readyProvider);
} catch {
  readyPassed = false;
}
check("a ready provider is handed to the app", readyPassed);

for (const adapter of adapters) {
  let refused = null;
  try {
    assertUsableProvider(adapter);
  } catch (error) {
    refused = error;
  }
  check(
    `the registry refuses to activate ${adapter.id}`,
    refused instanceof ProviderUnavailableError &&
      refused.message.includes(adapter.unavailableReason ?? "\u0000"),
    refused?.message ?? "no error thrown",
  );
}

console.log("\nIndependence (Phase 8)");
const registrySource = readFileSync(path.join(root, "lib", "api", "registry.ts"), "utf8");
check(
  "the registry registers all three marketplace adapters",
  ["shopeeProvider", "lazadaProvider", "tiktokShopProvider"].every((name) =>
    registrySource.includes(`registerProvider(${name})`),
  ),
);

const offenders = [];
for (const dir of ["app", "components", "lib"]) {
  const base = path.join(root, dir);
  if (!existsSync(base)) continue;
  for (const file of walk(base)) {
    if (path.normalize(file).startsWith(path.normalize(path.join(root, "lib", "api")))) {
      continue;
    }
    if (/marketplace-adapters/.test(readFileSync(file, "utf8"))) {
      offenders.push(path.relative(root, file));
    }
  }
}
check(
  "no module outside lib/api reaches for a marketplace-specific adapter",
  offenders.length === 0,
  offenders.join(", "),
);

console.log(`\n${passed}/${passed + failed} checks passed.\n`);
process.exit(failed === 0 ? 0 : 1);
