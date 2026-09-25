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
import { matchProduct, parseListingUrl, resolveListingUrl, tokenize } from "../lib/matching/index.ts";

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

console.log("\nMarketplace link paste");
{
  const parsed = parseListingUrl("https://www.lazada.com.ph/products/iphone-16-128gb-1234567890.html?scm=1");
  check(
    "Lazada path yields a title and an id",
    parsed?.slugTitle === "iphone 16 128gb" && parsed?.listingId === "1234567890",
    `${parsed?.slugTitle} / ${parsed?.listingId}`,
  );
}
{
  const parsed = parseListingUrl("https://shopee.ph/Apple-iPhone-16-256GB-i.987654321.1234567");
  check(
    "Shopee '-i.id.shopid' suffix is stripped from the title",
    parsed?.slugTitle === "Apple iPhone 16 256GB",
    String(parsed?.slugTitle),
  );
}
{
  const r = resolveListingUrl(
    "https://www.lazada.com.ph/products/iphone-16-128gb-1234567890.html",
    catalog,
  );
  check("Lazada link resolves to the right product", r.result.status === "match" && r.result.product.slug === "iphone-16-128gb", `${r.result.status} · ${r.note}`);
}
{
  const r = resolveListingUrl("https://shopee.ph/Apple-iPhone-16-256GB-i.987654321.1234567", catalog);
  check("Shopee slug link resolves to the right product", r.result.status === "match" && r.result.product.slug === "iphone-16-256gb", `${r.result.status} · ${r.note}`);
}
{
  const r = resolveListingUrl("https://shopee.ph/product/987654321/1234567", catalog);
  check(
    "id-only link is refused rather than guessed",
    r.result.status === "no_match" && r.note.includes("listing ID"),
    `${r.result.status} · ${r.note}`,
  );
}
{
  const r = resolveListingUrl("https://www.tiktok.com/product/7345678901234567890", catalog);
  check("TikTok id-only link is refused", r.result.status === "no_match", `${r.result.status} · ${r.note}`);
}
{
  const r = resolveListingUrl("https://www.amazon.com/dp/B0C1234567", catalog);
  check(
    "non-marketplace host is named honestly",
    r.result.status === "no_match" && r.note.includes("Shopee, Lazada, and TikTok Shop"),
    r.note,
  );
}
{
  const r = resolveListingUrl("not a link at all", catalog);
  check("unparseable input is refused", r.result.status === "no_match", r.note);
}
{
  const r = resolveListingUrl("https://www.lazada.com.ph/products/samsung-galaxy-s24-111222333.html", catalog);
  check(
    "link omitting storage is flagged ambiguous, not resolved",
    r.result.status === "ambiguous",
    `${r.result.status} · ${r.note}`,
  );
}
{
  const r = resolveListingUrl("https://www.lazada.com.ph/products/completely-generic-item-111222333.html", catalog);
  check("unrecognisable slug is refused", r.result.status === "no_match", `${r.result.status} · ${r.note}`);
}

console.log("\nVariant identity (backend fix pass, FIX 3)");
{
  const r = matchProduct({ title: "Apple iPhone 16 128GB" }, [iphone256]);
  check(
    "a 128GB listing never lands on a 256GB product",
    r.status === "no_match",
    `${r.status} · ${r.reason}`,
  );
}
{
  const iphonePro = product("10", "iphone-16-pro-128gb", "iPhone 16 Pro 128GB", "Apple");
  const r = matchProduct({ title: "Apple iPhone 16 Pro 128GB" }, [iphone128]);
  check(
    "a Pro listing never lands on the base model",
    r.status === "no_match",
    `${r.status} · ${r.reason}`,
  );
  const reverse = matchProduct({ title: "Apple iPhone 16 128GB" }, [iphonePro]);
  check(
    "a base listing never lands on the Pro model",
    reverse.status === "no_match",
    `${reverse.status} · ${reverse.reason}`,
  );
}
{
  const rtx5060 = product("11", "rtx-5060-8gb", "RTX 5060 8GB", "Nvidia");
  const rtx5060ti = product("12", "rtx-5060-ti-16gb", "RTX 5060 Ti 16GB", "Nvidia");
  const ti = matchProduct({ title: "Nvidia RTX 5060 Ti 16GB" }, [rtx5060]);
  check(
    "a Ti listing never lands on the non-Ti card",
    ti.status === "no_match",
    `${ti.status} · ${ti.reason}`,
  );
  const plain = matchProduct({ title: "Nvidia RTX 5060 8GB" }, [rtx5060ti]);
  check(
    "a non-Ti listing never lands on the Ti card",
    plain.status === "no_match",
    `${plain.status} · ${plain.reason}`,
  );
  check(
    "the matching card still matches",
    matchProduct({ title: "Nvidia RTX 5060 Ti 16GB" }, [rtx5060ti]).status === "match",
  );
}
{
  const r = matchProduct({ title: "Apple iPhone 16 128GB + Case Bundle" }, catalog);
  check(
    "a bundle listing never satisfies a standalone product",
    r.status === "no_match",
    `${r.status} · ${r.reason}`,
  );
  const second = matchProduct({ title: "Apple iPhone 16 128GB Bundle" }, catalog);
  check(
    "a bundle word alone is enough to refuse",
    second.status === "no_match",
    `${second.status} · ${second.reason}`,
  );
  const accessory = matchProduct({ title: "Apple iPhone 16 128GB + Charger" }, catalog);
  check(
    "a plus-accessory title is a bundle too",
    accessory.status === "no_match",
    `${accessory.status} · ${accessory.reason}`,
  );
  const specPlus = matchProduct({ title: "Apple iPhone 16 128GB + Free Shipping" }, catalog);
  check(
    "a seller's plus-padded title is not mistaken for a bundle",
    specPlus.status === "match" && specPlus.product.slug === "iphone-16-128gb",
    `${specPlus.status} · ${specPlus.reason}`,
  );
}
{
  const standalone = product("13", "airpods", "AirPods Pro 2nd Gen", "Apple");
  const bundled = product("14", "airpods-bundle", "AirPods Pro 2nd Gen Bundle", "Apple");
  const r = matchProduct({ title: "Apple AirPods Pro Gen 2" }, [bundled]);
  check(
    "a standalone listing never lands on a bundle product",
    r.status === "no_match",
    `${r.status} · ${r.reason}`,
  );
  const both = matchProduct({ title: "Apple AirPods Pro Gen 2 Bundle" }, [bundled]);
  check(
    "the same bundle still matches itself",
    both.status === "match",
    `${both.status} · ${both.reason}`,
  );
  check(
    "the standalone product is unaffected",
    matchProduct({ title: "Apple AirPods Pro Gen 2" }, [standalone]).status === "match",
  );
}
{
  const barcoded = { ...product("15", "galaxy-s25-256", "Galaxy S25 256GB", "Samsung"), gtin: "8806095499999" };
  const modeled = { ...product("16", "galaxy-a55-128", "Galaxy A55 128GB", "Samsung"), modelNumber: "SM-A556E" };
  const byGtin = matchProduct(
    { title: "some padded seller title nobody can read", gtin: "8806095499999" },
    [barcoded, modeled],
  );
  check(
    "a GTIN wins before any title is read",
    byGtin.status === "match" && byGtin.product.slug === "galaxy-s25-256",
    `${byGtin.status} · ${byGtin.reason}`,
  );
  const byModel = matchProduct(
    { title: "Samsung factory sealed unit", modelNumber: "sm-a556e" },
    [barcoded, modeled],
  );
  check(
    "a manufacturer model number wins next",
    byModel.status === "match" && byModel.product.slug === "galaxy-a55-128",
    `${byModel.status} · ${byModel.reason}`,
  );
  const unknown = matchProduct(
    { title: "Totally generic words", gtin: "0000000000000" },
    [barcoded, modeled],
  );
  check(
    "an identifier we have never recorded falls back to the title path",
    unknown.status === "no_match",
    `${unknown.status} · ${unknown.reason}`,
  );
}

console.log("\nSize and condition (backend fix pass, FIX 3)");
{
  const size8 = product("17", "pegasus-40-size-8", "Air Zoom Pegasus 40 Size 8", "Nike");
  const size10 = product("18", "pegasus-40-size-10", "Air Zoom Pegasus 40 Size 10", "Nike");

  const explicit = matchProduct({ title: "Nike Air Zoom Pegasus 40 Size 10" }, [size8, size10]);
  check(
    "a stated size picks that size, even when both share a model number",
    explicit.status === "match" && explicit.product.slug === "pegasus-40-size-10",
    `${explicit.status} · ${explicit.reason}`,
  );

  const omitted = matchProduct({ title: "Nike Air Zoom Pegasus 40" }, [size8, size10]);
  check(
    "a listing that omits the size is ambiguous, not attached to one",
    omitted.status === "ambiguous",
    `${omitted.status} · ${omitted.reason}`,
  );

  const single = matchProduct({ title: "Nike Air Zoom Pegasus 40 Size 8" }, [size8]);
  check(
    "a listing that names the only size we carry matches it",
    single.status === "match",
    `${single.status} · ${single.reason}`,
  );

  const tee8 = product("19", "classic-tee-m", "Classic Tee Size M", "Uniqlo");
  const teeL = product("20", "classic-tee-l", "Classic Tee Size L", "Uniqlo");
  const letter = matchProduct({ title: "Uniqlo Classic Tee Size L" }, [tee8, teeL]);
  check(
    "letter sizes are compared against letter sizes",
    letter.status === "match" && letter.product.slug === "classic-tee-l",
    `${letter.status} · ${letter.reason}`,
  );
}
{
  const newOne = product("21", "iphone-16-128-new", "iPhone 16 128GB", "Apple");
  const refurb = product("22", "iphone-16-128-refurb", "iPhone 16 128GB Refurbished", "Apple");

  const used = matchProduct({ title: "Apple iPhone 16 128GB Used — good condition" }, [newOne]);
  check(
    "a used listing never lands on a new product",
    used.status === "no_match",
    `${used.status} · ${used.reason}`,
  );
  const plain = matchProduct({ title: "Apple iPhone 16 128GB" }, [refurb]);
  check(
    "a plain listing never lands on a refurbished product",
    plain.status === "no_match",
    `${plain.status} · ${plain.reason}`,
  );
  const refurbishedListing = matchProduct({ title: "Apple iPhone 16 128GB Refurbished" }, [refurb]);
  check(
    "the refurbished listing matches the refurbished product",
    refurbishedListing.status === "match",
    `${refurbishedListing.status} · ${refurbishedListing.reason}`,
  );
  check(
    "an untouched condition still matches the new product",
    matchProduct({ title: "Apple iPhone 16 128GB Brand New Sealed" }, [newOne]).status === "match",
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  failed.forEach((f) => console.error(`  FAILED: ${f.label}`));
  process.exit(1);
}
