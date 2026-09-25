#!/usr/bin/env node
/**
 * Phase 5 verification: exercises lib/matching against fixtures that model
 * the awkward ways marketplaces write listings.
 *
 * The point is not that everything matches — it is that refusals are as
 * reliable as matches. A wrong match silently corrupts every price comparison
 * downstream; a refused match just means we show no price.
 *
 * Usage: node scripts/match-verify.mjs
 */
import { matchProduct, tokenize } from "../lib/matching/index.ts";

const product = (id, slug, name, brand, sku) => ({
  id,
  slug,
  name,
  brand,
  category: "phones",
  sku,
  image: "",
  offers: [],
  priceHistory: [],
});

const iphone128 = product("1", "iphone-16-128gb", "iPhone 16 128GB", "Apple", "MPTR3ZA/A");
const iphone256 = product("2", "iphone-16-256gb", "iPhone 16 256GB", "Apple");
const airpods = product("3", "airpods-pro-2nd-gen", "AirPods Pro 2nd Gen", "Apple");
const s24128 = product("4", "galaxy-s24-128", "Galaxy S24 128GB", "Samsung");
const s24256 = product("5", "galaxy-s24-256", "Galaxy S24 256GB", "Samsung");
const iphoneMidnight = product("6", "iphone-16-128gb-midnight", "iPhone 16 128GB Midnight", "Apple");

const catalog = [iphone128, iphone256, airpods, s24128, s24256, iphoneMidnight];

const results = [];
function check(label, condition, detail = "") {
  results.push({ label, ok: Boolean(condition) });
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("\nTokenisation");
check(
  "'128 GB' and '128gb' collapse to one token",
  tokenize("iPhone 16, 128 GB!").includes("128gb") && tokenize("iPhone16 128gb").includes("128gb"),
  tokenize("iPhone 16, 128 GB!").join(" | "),
);
check(
  "'gen 2' / '2nd gen' / 'series 2' all become gen2",
  tokenize("AirPods Pro Gen 2").includes("gen2") &&
    tokenize("AirPods Pro 2nd Gen").includes("gen2") &&
    tokenize("AirPods Pro Series 2").includes("gen2"),
);
check(
  "seller padding is stripped",
  !tokenize("Brand New Original Free Shipping PH Apple iPhone 16").some((t) =>
    ["brand", "new", "original", "free", "shipping", "ph"].includes(t),
  ),
  tokenize("Brand New Original Free Shipping PH Apple iPhone 16").join(" | "),
);

console.log("\nConfident matches");
{
  const r = matchProduct(
    { title: "🔥 Brand New Apple iPhone 16 128GB - Free Shipping PH" },
    catalog,
  );
  check("noisy seller title lands on the right product", r.status === "match" && r.product.slug === "iphone-16-128gb", `${r.status} · ${r.reason}`);
}
{
  const r = matchProduct({ title: "IPHONE 16 256 GB NEW" }, catalog);
  check("spaced storage unit still resolves the 256GB variant", r.status === "match" && r.product.slug === "iphone-16-256gb", `${r.status} · ${r.reason}`);
}
{
  const r = matchProduct({ title: "Some totally unrelated listing words", sku: "MPTR3ZA/A" }, catalog);
  check("exact SKU wins regardless of title", r.status === "match" && r.product.slug === "iphone-16-128gb", `${r.status} · ${r.reason}`);
}
{
  const r = matchProduct({ title: "Apple AirPods Pro Gen 2" }, catalog);
  check("'Gen 2' matches '2nd Gen' canonical name", r.status === "match" && r.product.slug === "airpods-pro-2nd-gen", `${r.status} · ${r.reason}`);
}
{
  const r = matchProduct({ title: "Apple iPhone 16 128GB Midnight" }, catalog);
  check("stated colour picks the colour-specific variant", r.status === "match" && r.product.slug === "iphone-16-128gb-midnight", `${r.status} · ${r.reason}`);
}

console.log("\nRefusals (never guess)");
{
  const r = matchProduct({ title: "Apple iPhone 16 128GB Starlight" }, [iphoneMidnight]);
  check("conflicting colour refuses to match", r.status === "no_match", `${r.status} · ${r.reason}`);
}
{
  const r = matchProduct({ title: "Samsung Galaxy S24 512GB", brand: "Samsung" }, catalog);
  check("512GB listing matches nothing we carry", r.status === "no_match", `${r.status} · ${r.reason}`);
}
{
  const r = matchProduct({ title: "Wireless Earbuds TWS Bluetooth 5.3" }, catalog);
  check("generic title is refused, not force-matched", r.status === "no_match", `${r.status} · ${r.reason}`);
}
{
  const r = matchProduct({ title: "   " }, catalog);
  check("empty title is refused", r.status === "no_match", `${r.status} · ${r.reason}`);
}

console.log("\nAmbiguity (say so rather than pick)");
{
  const r = matchProduct({ title: "Samsung Galaxy S24" }, catalog);
  check(
    "listing omitting storage is flagged ambiguous between the two variants",
    r.status === "ambiguous",
    `${r.status} · ${r.status === "ambiguous" ? r.reason : r.reason}`,
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  failed.forEach((f) => console.error(`  FAILED: ${f.label}`));
  process.exit(1);
}
