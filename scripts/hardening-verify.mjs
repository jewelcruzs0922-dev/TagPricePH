#!/usr/bin/env node
/**
 * Hardening verification: the security fixes from the production audit,
 * proved by running them rather than by re-reading the code.
 *
 * Four layers, mirroring the other suites:
 *   - unit: the pure helpers imported straight from lib/ (timing-safe
 *     comparison, query cap, JSON-LD escaping, both rate-limit modes);
 *   - source: the JSON-LD serializer is the only thing feeding inline script
 *     payloads, and the secret routes import the constant-time comparator;
 *   - live: a real `next start` with known test secrets — security headers,
 *     CSP, reflected XSS, CSRF guards, per-IP budgets (including the
 *     X-Forwarded-For key position), secret lockouts with a cleared budget,
 *     and the alert token flow end to end;
 *   - browser: headless Chrome loads the key routes and asserts zero
 *     Content-Security-Policy violations, so the new CSP is proved not to
 *     break the site instead of being assumed safe.
 *
 * Usage: node scripts/hardening-verify.mjs   (requires `npm run build` first)
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { capQuery, parseSearchParams } from "../lib/data/search-url.ts";
import {
  clearFailures,
  consumeRateLimit,
  failureBudgetVerdict,
  recordFailure,
} from "../lib/rate-limit.ts";
import { timingSafeStringEqual } from "../lib/security/timing-safe.ts";
import { serializeJsonLd } from "../lib/utils/jsonld.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = 3994;
const DEBUG_PORT = 9338;
const BASE = `http://localhost:${APP_PORT}`;
const TEST_ADMIN = "hardening-admin-token-4f19c2";
const TEST_INGEST = "hardening-ingest-secret-8c27";
const TEST_CRON = "hardening-cron-secret-5b63";
const FLOW_EMAIL = "hardening-flow@example.com";

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? `  -  ${detail}` : ""}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------------- units --------------------------------- */

function unitChecks() {
  console.log("\nTiming-safe comparison (lib/security/timing-safe.ts)");
  check("identical secrets compare equal", timingSafeStringEqual("s3cret", "s3cret"));
  check("different secrets compare unequal", !timingSafeStringEqual("s3cret", "s3creu"));
  check(
    "a prefix never matches",
    !timingSafeStringEqual("hardening-token-1", "hardening-token-12"),
  );
  check(
    "different lengths never match",
    !timingSafeStringEqual("abc", "abcdef"),
  );
  check("two absent values are equal", timingSafeStringEqual(null, null));
  check(
    "an absent header never matches a stored token",
    !timingSafeStringEqual(null, "stored-token"),
  );

  console.log("\nQuery cap (lib/data/search-url.ts)");
  check("short queries pass through", capQuery("iphone 16") === "iphone 16");
  const long = "x".repeat(10_000);
  check("a 10,000-char query is clamped to 300", capQuery(long).length === 300);
  const parsed = parseSearchParams(new URLSearchParams(`q=${long}`));
  check(
    "parseSearchParams applies the cap too",
    parsed.q.length === 300,
    `got ${parsed.q.length}`,
  );

  console.log("\nJSON-LD escaping (lib/utils/jsonld.ts)");
  const hostile = {
    name: "</script><img src=x onerror=alert(1)>",
    brand: "Acme<script>alert(document.cookie)</script>",
  };
  const encoded = serializeJsonLd(hostile);
  check(
    "a </script> payload never survives as raw markup",
    !encoded.includes("<"),
    encoded.slice(0, 120),
  );
  let roundTrip = null;
  try {
    roundTrip = JSON.parse(encoded);
  } catch {
    /* stays null */
  }
  check(
    "the escaped payload still parses back to the original strings",
    roundTrip?.name === hostile.name && roundTrip?.brand === hostile.brand,
  );
  const plain = serializeJsonLd({ name: "iPhone 16 128GB", price: 56990 });
  check(
    "ordinary JSON-LD is unchanged by the escaping",
    JSON.parse(plain).name === "iPhone 16 128GB" && plain.includes("iPhone"),
  );

  console.log("\nRate limiter (lib/rate-limit.ts)");
  const state = new Map();
  const opts = { limit: 10, windowMs: 60_000 };
  let allowed = 0;
  for (let i = 0; i < 11; i += 1) {
    if (consumeRateLimit(state, "k", opts, 1_000).allowed) allowed += 1;
  }
  check("count-then-deny: 10 pass, the 11th is refused", allowed === 10);
  const denied = consumeRateLimit(state, "k", opts, 1_000);
  check(
    "the refusal carries Retry-After >= 1",
    !denied.allowed && denied.retryAfterSeconds >= 1,
    JSON.stringify(denied),
  );
  check(
    "another key keeps its own budget",
    consumeRateLimit(state, "other", opts, 1_000).allowed,
  );
  check(
    "a fresh window opens a new budget",
    consumeRateLimit(state, "k", opts, 1_000 + 60_001).allowed,
  );

  const failures = new Map();
  check(
    "an untouched failure budget allows",
    failureBudgetVerdict(failures, "f", opts, 1_000).allowed,
  );
  for (let i = 0; i < 10; i += 1) recordFailure(failures, "f", opts, 1_000);
  check(
    "ten recorded failures exhaust the budget",
    !failureBudgetVerdict(failures, "f", opts, 1_000).allowed,
  );
  check(
    "a success clears the budget",
    (clearFailures(failures, "f"),
    failureBudgetVerdict(failures, "f", opts, 1_000).allowed),
  );
  check(
    "the failure window still expires on its own",
    (recordFailure(failures, "g", opts, 1_000),
    failureBudgetVerdict(failures, "g", opts, 1_000 + 60_001).allowed),
  );

  const flood = new Map();
  for (let i = 0; i < 10_050; i += 1) {
    consumeRateLimit(flood, `key-${i}`, opts, 1_000);
  }
  check(
    "the bucket map stays bounded under a key flood (<= 10,000)",
    flood.size <= 10_000,
    `size ${flood.size}`,
  );
}

/* -------------------------------- source --------------------------------- */

function sourceChecks() {
  console.log("\nWiring (source)");
  const pages = [
    path.join(root, "app", "product", "[slug]", "page.tsx"),
    path.join(root, "app", "categories", "[slug]", "page.tsx"),
  ];
  let wired = 0;
  let rawSinks = 0;
  for (const page of pages) {
    const text = readFileSync(page, "utf8");
    if (text.includes("serializeJsonLd(")) wired += 1;
    if (/__html:\s*JSON\.stringify/.test(text)) rawSinks += 1;
  }
  check(
    "both JSON-LD pages serialize through serializeJsonLd",
    wired === 2,
    `${wired}/2`,
  );
  check("no page still pipes JSON.stringify into __html", rawSinks === 0);

  // Every secret/token comparison stays constant-time. The alert routes go
  // through alertTokenMatches (Live Data Readiness §6), which must itself be
  // built on timingSafeStringEqual — so accept either spelling, but verify
  // the helper's implementation rather than trusting its name.
  const alertTokenHelper = readFileSync(
    path.join(root, "lib", "security", "alert-token.ts"),
    "utf8",
  );
  const helperIsConstantTime = alertTokenHelper.includes("timingSafeStringEqual");
  const secretRoutes = [
    path.join(root, "app", "api", "ingest", "route.ts"),
    path.join(root, "app", "api", "alerts", "check", "route.ts"),
    path.join(root, "app", "api", "alerts", "route.ts"),
  ];
  const withTimingSafe = secretRoutes.filter((file) => {
    const text = readFileSync(file, "utf8");
    return (
      text.includes("timingSafeStringEqual") ||
      (text.includes("alertTokenMatches") && helperIsConstantTime)
    );
  }).length;
  check(
    "ingest, cron, and alert token checks use timingSafeStringEqual",
    withTimingSafe === 3,
    `${withTimingSafe}/3`,
  );
}

/* --------------------------------- live ---------------------------------- */

function startServer() {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const env = {
    ...process.env,
    ADMIN_TOKEN: TEST_ADMIN,
    INGEST_SECRET: TEST_INGEST,
    CRON_SECRET: TEST_CRON,
    NEXT_PUBLIC_DEMO_MODE: "true",
  };
  return spawn(process.execPath, [nextBin, "start", "-p", String(APP_PORT)], {
    cwd: root,
    stdio: "ignore",
    env,
  });
}

async function waitForServer(child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(3000) });
      if (response.status === 200) return true;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  return false;
}

async function stopServer(child) {
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 5_000);
  });
}

function get(pathname, headers = {}) {
  return fetch(`${BASE}${pathname}`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
}

function post(pathname, { body, headers = {}, method = "POST" } = {}) {
  return fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  });
}

async function liveChecks() {
  /* ---- headers ---- */
  console.log("\nSecurity headers (live)");
  const home = await get("/");
  const header = (name) => home.headers.get(name)?.toLowerCase() ?? null;
  check("X-Content-Type-Options: nosniff", header("x-content-type-options") === "nosniff");
  check(
    "X-Frame-Options: SAMEORIGIN (clickjacking)",
    header("x-frame-options") === "sameorigin",
  );
  check(
    "Referrer-Policy: strict-origin-when-cross-origin",
    header("referrer-policy") === "strict-origin-when-cross-origin",
  );
  check(
    "Permissions-Policy present",
    Boolean(header("permissions-policy")),
  );
  check(
    "Strict-Transport-Security: HSTS with a one-year max-age",
    Boolean(header("strict-transport-security")?.startsWith("max-age=31536000")),
    String(header("strict-transport-security")),
  );
  check("X-Download-Options: noopen", header("x-download-options") === "noopen");
  check(
    "X-Permitted-Cross-Domain-Policies: none",
    header("x-permitted-cross-domain-policies") === "none",
  );
  const csp = header("content-security-policy") ?? "";
  check("Content-Security-Policy served in production", Boolean(csp), "missing");
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ]) {
    check(`CSP carries \`${directive}\``, csp.includes(directive));
  }
  check("CSP blocks upgrade-insecure-requests for local http", !csp.includes("upgrade-insecure-requests"));
  check("X-Powered-By is no longer emitted", home.headers.get("x-powered-by") === null);

  const product = await get("/product/iphone-16-128gb");
  check(
    "product pages carry the same CSP",
    Boolean(product.headers.get("content-security-policy")),
  );

  /* ---- routes ---- */
  console.log("\nKey routes still render");
  for (const route of [
    ["/", "home"],
    ["/search?q=iphone", "search"],
    ["/product/iphone-16-128gb", "product"],
    ["/price-drops", "price drops"],
    ["/categories", "categories"],
    ["/categories/phones-accessories", "category page"],
    ["/alerts", "alerts"],
    ["/admin", "admin login"],
  ]) {
    const response = await get(route[0]);
    const body = await response.text();
    check(
      `${route[1]} responds 200`,
      response.status === 200,
      `status ${response.status}`,
    );
    check(
      `${route[1]} still renders its heading/markup`,
      body.includes("<h1") && body.length > 20_000,
      `${body.length} bytes`,
    );
  }
  const go = await fetch(`${BASE}/go/unknown-store/unknown-product`, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const goLocation = go.headers.get("location") ?? "";
  check(
    "an unknown /go target redirects back inside the app",
    (go.status === 302 || go.status === 301) &&
      goLocation.startsWith(BASE),
    `status ${go.status} -> ${goLocation}`,
  );

  /* ---- JSON-LD ---- */
  console.log("\nJSON-LD payload safety");
  const productText = await product.text();
  const ldBodies = [...productText.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )].map((match) => match[1]);
  check("the product page emits JSON-LD blocks", ldBodies.length >= 2, `${ldBodies.length}`);
  let allParse = ldBodies.length >= 2;
  let noMarkup = true;
  for (const body of ldBodies) {
    try {
      JSON.parse(body);
    } catch {
      allParse = false;
    }
    if (body.includes("<")) noMarkup = false;
  }
  check("every JSON-LD block parses as JSON", allParse);
  check("no JSON-LD block contains a raw '<'", noMarkup);

  /* ---- reflected XSS ---- */
  console.log("\nReflected input");
  const xss = await get("/search?q=" + encodeURIComponent("<script>alert(1)</script>"));
  const xssBody = await xss.text();
  check(
    "a script payload in q renders escaped, not executable",
    !xssBody.includes("<script>alert(1)</script>") &&
      xssBody.includes("Results for"),
  );

  /* ---- CSRF / content-type guards ---- */
  console.log("\nCSRF and content-type guards");
  const evilOrigin = { Origin: "https://evil.example", "Content-Type": "application/json" };
  const evilViews = await post("/api/views", {
    body: JSON.stringify({ slug: "iphone-16-128gb" }),
    headers: evilOrigin,
  });
  check("cross-origin POST /api/views is refused", evilViews.status === 403, `${evilViews.status}`);
  const evilAlerts = await post("/api/alerts", {
    body: JSON.stringify({ email: FLOW_EMAIL, slug: "iphone-16-128gb", targetPrice: "10000" }),
    headers: evilOrigin,
  });
  check("cross-origin POST /api/alerts is refused", evilAlerts.status === 403, `${evilAlerts.status}`);
  const evilAdmin = await post("/api/admin/session", {
    body: JSON.stringify({ token: TEST_ADMIN }),
    headers: evilOrigin,
  });
  check(
    "cross-origin POST /api/admin/session is refused before verification",
    evilAdmin.status === 403,
    `${evilAdmin.status}`,
  );
  const formViews = await post("/api/views", {
    body: "slug=iphone-16-128gb",
    headers: { "Content-Type": "text/plain" },
  });
  check(
    "a text/plain (form) body is refused as non-JSON",
    formViews.status === 415,
    `${formViews.status}`,
  );
  const oversized = await post("/api/views", {
    body: JSON.stringify({ slug: "iphone-16-128gb", pad: "x".repeat(70_000) }),
    headers: { "Content-Type": "application/json" },
  });
  check(
    "a body beyond the 64 KB cap is refused",
    oversized.status === 413,
    `${oversized.status}`,
  );
  const sameOrigin = await post("/api/views", {
    body: JSON.stringify({ slug: "does-not-exist-yet" }),
    headers: { Origin: BASE, "Content-Type": "application/json" },
  });
  check(
    "a same-origin JSON POST passes the guard (404 = allowed through)",
    sameOrigin.status === 404,
    `${sameOrigin.status}`,
  );
  const noOrigin = await post("/api/views", {
    body: JSON.stringify({ slug: "does-not-exist-yet" }),
    headers: { "Content-Type": "application/json" },
  });
  check(
    "a server caller with no Origin passes the guard",
    noOrigin.status === 404,
    `${noOrigin.status}`,
  );

  /* ---- per-IP budgets + XFF key position ---- */
  console.log("\nPer-IP budgets and X-Forwarded-For keying");
  async function floodViews(headers = {}, max = 65) {
    let status429 = null;
    let attempts = 0;
    for (; attempts < max; attempts += 1) {
      const response = await post("/api/views", {
        body: JSON.stringify({ slug: "does-not-exist-yet" }),
        headers: { "Content-Type": "application/json", ...headers },
      });
      if (response.status === 429) {
        status429 = response;
        attempts += 1;
        break;
      }
    }
    return { status429, attempts };
  }

  // Prior guard tests already spent a few of the 60 "unknown" slots.
  const plainFlood = await floodViews();
  check(
    "POST /api/views runs out of its per-IP budget with 429",
    Boolean(plainFlood.status429),
    `${plainFlood.attempts} attempts without 429`,
  );
  check(
    "the views 429 carries Retry-After",
    Number(plainFlood.status429?.headers.get("retry-after") ?? 0) >= 1,
  );

  const spoofedFlood = await floodViews({ "X-Forwarded-For": "hardening-aaa" });
  check(
    "a rotated X-Forwarded-For hop gets its own budget (keyed, not shared)",
    Boolean(spoofedFlood.status429),
    `${spoofedFlood.attempts} attempts without 429`,
  );
  const twoHop = await post("/api/views", {
    body: JSON.stringify({ slug: "does-not-exist-yet" }),
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "hardening-aaa, hardening-bbb",
    },
  });
  check(
    "the budget keys on the right-most XFF hop (aaa exhausted, bbb fresh)",
    twoHop.status === 404,
    `expected 404 through, got ${twoHop.status}`,
  );

  async function floodGet(pathname, headers = {}, max = 125) {
    for (let attempts = 1; attempts <= max; attempts += 1) {
      const response = await fetch(`${BASE}${pathname}`, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 429) return attempts;
    }
    return null;
  }
  const searchHits = await floodGet("/api/search?q=hardening");
  check(
    "GET /api/search runs out of its per-IP budget with 429",
    Boolean(searchHits),
    `no 429 within 125 requests`,
  );
  const suggestionHits = await floodGet("/api/suggestions?q=hardening");
  check(
    "GET /api/suggestions runs out of its per-IP budget with 429",
    Boolean(suggestionHits),
    `no 429 within 125 requests`,
  );

  /* ---- secret lockouts ---- */
  console.log("\nSecret endpoints: lockout and cleared budgets");
  async function adminAttempt(token) {
    return post("/api/admin/session", {
      body: JSON.stringify({ token }),
      headers: { "Content-Type": "application/json" },
    });
  }
  let wrong = 0;
  for (let i = 0; i < 5; i += 1) {
    const r = await adminAttempt("definitely-wrong-token");
    if (r.status === 401) wrong += 1;
  }
  check("five wrong admin tokens answer 401", wrong === 5, `${wrong}/5`);
  const adminOk = await adminAttempt(TEST_ADMIN);
  check("the correct admin token still answers 204", adminOk.status === 204, `${adminOk.status}`);
  wrong = 0;
  for (let i = 0; i < 5; i += 1) {
    const r = await adminAttempt("definitely-wrong-token");
    if (r.status === 401) wrong += 1;
  }
  check(
    "a success cleared the failure budget (next five wrongs are 401, not 429)",
    wrong === 5,
    `${wrong}/5`,
  );
  for (let i = 0; i < 5; i += 1) await adminAttempt("definitely-wrong-token");
  const adminLocked = await adminAttempt("definitely-wrong-token");
  check(
    "ten accumulated wrongs lock the endpoint with 429",
    adminLocked.status === 429,
    `${adminLocked.status}`,
  );
  const adminLockedCorrect = await adminAttempt(TEST_ADMIN);
  check(
    "the lockout holds even for the right token inside the window",
    adminLockedCorrect.status === 429,
    `${adminLockedCorrect.status}`,
  );

  async function ingestAttempt(secret) {
    return post("/api/ingest", {
      headers: { "x-ingest-secret": secret },
    });
  }
  wrong = 0;
  for (let i = 0; i < 5; i += 1) {
    const r = await ingestAttempt("wrong-ingest-secret");
    if (r.status === 401) wrong += 1;
  }
  check("five wrong ingest secrets answer 401", wrong === 5, `${wrong}/5`);
  const ingestOk = await ingestAttempt(TEST_INGEST);
  check(
    "the right ingest secret answers (200, refusal body is fine)",
    ingestOk.status === 200,
    `${ingestOk.status}`,
  );
  wrong = 0;
  for (let i = 0; i < 5; i += 1) {
    const r = await ingestAttempt("wrong-ingest-secret");
    if (r.status === 401) wrong += 1;
  }
  check(
    "the ingest failure budget was cleared by the success",
    wrong === 5,
    `${wrong}/5`,
  );
  for (let i = 0; i < 5; i += 1) await ingestAttempt("wrong-ingest-secret");
  const ingestLocked = await ingestAttempt("wrong-ingest-secret");
  check("ingest locks with 429 after ten wrongs", ingestLocked.status === 429, `${ingestLocked.status}`);

  async function cronAttempt(bearer) {
    return post("/api/alerts/check", {
      body: "{}",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    });
  }
  wrong = 0;
  for (let i = 0; i < 5; i += 1) {
    const r = await cronAttempt("wrong-cron-secret");
    if (r.status === 401) wrong += 1;
  }
  check("five wrong cron bearers answer 401", wrong === 5, `${wrong}/5`);
  const cronOk = await cronAttempt(TEST_CRON);
  check("the right cron bearer runs the sweep", cronOk.status === 200, `${cronOk.status}`);
  wrong = 0;
  for (let i = 0; i < 5; i += 1) {
    const r = await cronAttempt("wrong-cron-secret");
    if (r.status === 401) wrong += 1;
  }
  check("the cron failure budget was cleared by the success", wrong === 5, `${wrong}/5`);
  for (let i = 0; i < 5; i += 1) await cronAttempt("wrong-cron-secret");
  const cronLocked = await cronAttempt("wrong-cron-secret");
  check("cron locks with 429 after ten wrongs", cronLocked.status === 429, `${cronLocked.status}`);

  /* ---- alert token flow ---- */
  console.log("\nAlert token flow (after the constant-time change)");
  const created = await post("/api/alerts", {
    body: JSON.stringify({
      email: FLOW_EMAIL,
      slug: "iphone-16-128gb",
      targetPrice: "25000",
    }),
    headers: { "Content-Type": "application/json" },
  });
  const createdBody = await created.json().catch(() => null);
  check("filing an alert answers 200", created.status === 200, `${created.status}`);
  check(
    "the response carries the stored mailbox token",
    typeof createdBody?.accessToken === "string" && createdBody.accessToken.length >= 32,
  );
  const token = createdBody?.accessToken ?? "";
  const listed = await get(`/api/alerts?email=${encodeURIComponent(FLOW_EMAIL)}`, {
    "x-alert-token": token,
  });
  const listedBody = await listed.json().catch(() => null);
  check(
    "the token reads the mailbox back",
    listed.status === 200 && (listedBody?.alerts?.length ?? 0) === 1,
    `status ${listed.status}, ${listedBody?.alerts?.length ?? "?"} alerts`,
  );
  const wrongToken = await get(`/api/alerts?email=${encodeURIComponent(FLOW_EMAIL)}`, {
    "x-alert-token": "0".repeat(48),
  });
  check("a wrong token is refused with 403", wrongToken.status === 403, `${wrongToken.status}`);
  const noToken = await get(`/api/alerts?email=${encodeURIComponent(FLOW_EMAIL)}`);
  check("a missing token is refused with 403", noToken.status === 403, `${noToken.status}`);
  const retarget = await post("/api/alerts", {
    body: JSON.stringify({
      email: FLOW_EMAIL,
      slug: "iphone-16-128gb",
      targetPrice: "24000",
    }),
    headers: { "Content-Type": "application/json" },
  });
  check("a retarget without the token is refused with 403", retarget.status === 403, `${retarget.status}`);
  const cancelled = await post(
    `/api/alerts?email=${encodeURIComponent(FLOW_EMAIL)}&id=${createdBody?.alert?.id}`,
    { method: "DELETE", headers: { "x-alert-token": token } },
  );
  check("the owner cancels with 204", cancelled.status === 204, `${cancelled.status}`);
}

/* ------------------------------- browser CSP ------------------------------ */

function findBrowser() {
  const roots = [process.env.CHROME_PATH, process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]]
    .filter(Boolean);
  const candidates = [];
  for (const root_ of roots) {
    if (root_.endsWith(".exe")) candidates.push(root_);
    else {
      candidates.push(path.join(root_, "Google", "Chrome", "Application", "chrome.exe"));
      candidates.push(path.join(root_, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function cspBrowserCheck() {
  console.log("\nCSP in a real browser (headless Chrome)");
  const browserPath = findBrowser();
  if (!browserPath) {
    check("a browser is available for the CSP pass", false, "Chrome/Edge not found");
    return;
  }

  const chrome = spawn(
    browserPath,
    [
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--remote-allow-origins=*",
      "--window-size=1200,900",
      "--hide-scrollbars",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let page = null;
  for (let i = 0; i < 40 && !page; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const pages = await response.json();
      page = pages.find((entry) => entry.type === "page") ?? null;
    } catch {
      /* not up yet */
    }
    if (!page) await sleep(250);
  }
  if (!page) {
    chrome.kill();
    check("browser attaches over CDP", false, "DevTools endpoint never came up");
    return;
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

  let seq = 0;
  const pending = new Map();
  const violations = [];
  const noteEntry = (text) => {
    // Genuine CSP breaches name the policy. The local build also logs a
    // MIME-type refusal for /_vercel/insights/script.js (that asset only
    // exists on Vercel) — unrelated to CSP, so it is not a violation.
    if (/Content Security Policy/i.test(text)) {
      violations.push(text);
    }
  };
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === "Log.entryAdded") {
      const entry = message.params?.entry;
      if (entry) noteEntry(`${entry.source}: ${entry.text}`);
    } else if (message.method === "Runtime.consoleAPICalled") {
      const params = message.params;
      if (params?.type === "error" || params?.type === "warning") {
        const text = (params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? "")
          .join(" ");
        noteEntry(text);
      }
    } else if (message.method === "Runtime.exceptionThrown") {
      noteEntry(String(message.params?.exceptionDetails?.text ?? "exception"));
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      seq += 1;
      pending.set(seq, resolve);
      ws.send(JSON.stringify({ id: seq, method, params }));
    });
  const evaluate = (expression) =>
    send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }).then(
      (message) => message.result?.result?.value,
    );
  const navigate = async (url) => {
    await send("Page.navigate", { url });
    for (let i = 0; i < 50; i += 1) {
      await sleep(200);
      const state = await evaluate(
        "({ href: location.pathname + location.search, ready: document.readyState })",
      );
      if (state?.ready === "complete" && url.includes(state.href)) {
        await sleep(500);
        return true;
      }
    }
    return false;
  };

  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");

    const routes = [
      ["/", true],
      ["/search?q=iphone", true],
      ["/product/iphone-16-128gb", true],
      ["/price-drops", true],
      ["/alerts", true],
      ["/categories/phones-accessories", true],
      ["/admin", false],
    ];
    for (const [route, needsHeading] of routes) {
      const arrived = await navigate(`${BASE}${route}`);
      const probe = await evaluate(
        `(() => ({ text: document.body ? document.body.innerText.length : 0, h1: Boolean(document.querySelector("h1")) }))()`,
      );
      check(
        `${route} renders under CSP`,
        arrived && (probe?.text ?? 0) > 200 && (!needsHeading || probe?.h1),
        JSON.stringify(probe),
      );
    }
    check(
      "zero Content-Security-Policy violations across the journey",
      violations.length === 0,
      violations.slice(0, 5).join(" | "),
    );
  } finally {
    try {
      ws.close();
    } catch {
      /* already gone */
    }
    chrome.kill();
  }
}

/* -------------------------------- cleanup -------------------------------- */

async function resolveConnectionString() {
  const candidates = [
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_URL,
    process.env.DATABASE_URL,
  ].filter(Boolean);
  const url = candidates.find((value) => !value.includes("-pooler")) ?? candidates[0];
  return url ?? null;
}

async function cleanupFlowRows() {
  const connectionString = await resolveConnectionString();
  if (!connectionString) {
    console.error("cleanup skipped: no Postgres connection string");
    failed += 1;
    return;
  }
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query("DELETE FROM price_alerts WHERE email = $1", [FLOW_EMAIL]);
  } catch (error) {
    console.error(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  } finally {
    await client.end().catch(() => {});
  }
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
  if (!existsSync(path.join(root, ".next"))) {
    console.error("No .next directory - run npm run build first.");
    process.exit(1);
  }
  const envFile = path.join(root, ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  unitChecks();
  sourceChecks();

  const server = startServer();
  try {
    const up = await waitForServer(server);
    check("server starts", up, "next start never became ready");
    if (up) {
      await liveChecks();
      await cspBrowserCheck();
    }
  } finally {
    await stopServer(server);
  }

  await cleanupFlowRows();
}

await main();
console.log(`\n${passed}/${passed + failed} checks passed.\n`);
process.exit(failed === 0 ? 0 : 1);
