#!/usr/bin/env node
/**
 * Phase 23 verification: the security audit, made executable.
 *
 * Static:
 *   - .env files are untracked now and were never committed;
 *   - no hardcoded secret literals in shipped source;
 *   - SQL is parameterised (no string interpolation into statements);
 *   - next.config ships the security headers and no wildcard image host;
 *   - the affiliate redirect allowlist refuses non-https and foreign hosts;
 *   - the ingest and admin-session routes keep their "not configured" locks.
 *
 * Secret exposure: every secret value in .env.local is checked against the
 * client bundles and the rendered homepage — a value there is an immediate
 * failure, which is the actual "never expose through client-side code" rule.
 *
 * Live (real server on port 3995, INGEST_SECRET and CRON_SECRET configured):
 *   - the headers are served;
 *   - /go only ever redirects to allowlisted hosts or back inside the app —
 *     unknown products, unknown stores, traversal-shaped stores, and
 *     campaign parameters cannot produce an open redirect;
 *   - reflected input stays escaped;
 *   - the ingest lock answers 401/401/200-refusal for wrong/wrong/right;
 *   - alert mailboxes are token-guarded (§25): mint on first POST, then
 *     403 for every later GET/POST/DELETE without the token, 200/204 with
 *     it, and POST answers 429 with Retry-After once the per-IP budget
 *     is spent;
 *   - the cron sweep fails closed (§26): 401 for wrong or missing bearer
 *     on a configured server, 503 on a server with no CRON_SECRET.
 *
 * Usage: node scripts/security-verify.mjs   (expects `npm run build` to have run)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = 3995;
const DISABLED_PORT = 3993;
const BASE = `http://localhost:${APP_PORT}`;
const TEST_INGEST = "verify-ingest-secret-7d21";
const TEST_CRON = "verify-cron-secret-4e08";
const FLOW_EMAIL = "verify-token-flow@example.com";

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function walk(dir, suffixes) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    if (suffixes.some((suffix) => entry.name.endsWith(suffix))) out.push(full);
  }
  return out;
}

/* ------------------------------ static checks ----------------------------- */

async function staticChecks() {
  console.log("\nRepository hygiene");

  // .env.example is the documented template: it ships empty values and the
  // brief requires it in the repository. Every other .env file must stay
  // out of the index — and out of history.
  const TEMPLATE = ".env.example";
  const tracked = spawnSync("git", ["ls-files", ".env*"], { cwd: root, encoding: "utf8" });
  const trackedReal = tracked.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((file) => file && file !== TEMPLATE);
  check(
    "only the .env.example template is tracked — every real .env file stays out of git",
    tracked.status === 0 && trackedReal.length === 0,
    trackedReal.join(", "),
  );
  const history = spawnSync(
    "git",
    ["log", "--all", "--pretty=format:", "--name-only", "--", ".env*"],
    { cwd: root, encoding: "utf8" },
  );
  const everCommitted = [
    ...new Set(
      history.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((file) => file && file !== TEMPLATE),
    ),
  ];
  check(
    "no real .env file was ever committed",
    history.status === 0 && everCommitted.length === 0,
    everCommitted.join(", "),
  );

  const secretPattern = /(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["'][^"'\s]{16,}["']/i;
  const sourceFiles = [
    ...walk(path.join(root, "app"), [".ts", ".tsx"]),
    ...walk(path.join(root, "lib"), [".ts", ".tsx"]),
    ...walk(path.join(root, "components"), [".ts", ".tsx"]),
  ];
  const hardcoded = [];
  for (const file of sourceFiles) {
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (secretPattern.test(line)) {
        hardcoded.push(`${path.relative(root, file)}:${index + 1}`);
      }
    });
  }
  check("no hardcoded secret literals in shipped source", hardcoded.length === 0, hardcoded.join(", "));

  const dbFiles = walk(path.join(root, "lib", "db"), [".ts"]);
  const interpolatedSql = [];
  for (const file of dbFiles) {
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (line.includes("${") && /SELECT |INSERT |UPDATE |DELETE /i.test(line)) {
        interpolatedSql.push(`${path.relative(root, file)}:${index + 1}`);
      }
    });
  }
  check(
    "SQL statements never interpolate template variables",
    interpolatedSql.length === 0,
    interpolatedSql.join(", "),
  );

  console.log("\nConfiguration");
  const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
  for (const header of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) {
    check(`next.config ships ${header}`, config.includes(header));
  }
  check(
    "image optimizer has no wildcard remote host",
    !/"\*\*"/.test(config) && !config.includes('hostname: "**"'),
  );

  const ingestSource = readFileSync(path.join(root, "app", "api", "ingest", "route.ts"), "utf8");
  check(
    "ingest answers 404 when no secret is configured",
    ingestSource.includes("if (!secret)") && ingestSource.includes('"not found"'),
  );
  const sessionSource = readFileSync(
    path.join(root, "app", "api", "admin", "session", "route.ts"),
    "utf8",
  );
  check(
    "admin session answers 503 when no token is configured",
    sessionSource.includes('"disabled"') && sessionSource.includes('"admin is not configured"'),
  );
  const cronSource = readFileSync(
    path.join(root, "app", "api", "alerts", "check", "route.ts"),
    "utf8",
  );
  check(
    "cron check answers 503 when no CRON_SECRET is configured — in every environment (§26)",
    cronSource.includes("if (!secret)") && cronSource.includes('"cron check disabled"'),
  );
  check(
    "cron check has no development bypass branch",
    !/NODE_ENV/.test(cronSource),
  );

  console.log("\nRedirect allowlist (unit)");
  const { ALLOWED_REDIRECT_HOSTS, isSafeRedirectUrl } = await import("../lib/api/affiliate.ts");
  check("an allowlist exists and is non-empty", ALLOWED_REDIRECT_HOSTS.length > 0);
  check("https://shopee.ph is allowed", isSafeRedirectUrl("https://shopee.ph/item/123") === true);
  check("plain http is refused", isSafeRedirectUrl("http://shopee.ph/item") === false);
  check("a foreign host is refused", isSafeRedirectUrl("https://evil.example/phish") === false);
  check("a javascript: URL is refused", isSafeRedirectUrl("javascript:alert(1)") === false);
  check("a lookalike host is refused", isSafeRedirectUrl("https://shopee.ph.evil.com/") === false);
  check("garbage is refused", isSafeRedirectUrl("not a url") === false);

  console.log("\nRate limiter (unit, §25)");
  const { consumeRateLimit } = await import("../lib/rate-limit.ts");
  const bucket = new Map();
  const limit = { limit: 2, windowMs: 60_000 };
  const t0 = 1_700_000_000_000;
  check(
    "first request inside the budget is allowed",
    consumeRateLimit(bucket, "ip-a", limit, t0).allowed === true,
  );
  check(
    "second request inside the budget is allowed",
    consumeRateLimit(bucket, "ip-a", limit, t0 + 1).allowed === true,
  );
  const denied = consumeRateLimit(bucket, "ip-a", limit, t0 + 2);
  check("third request exceeds the limit", denied.allowed === false);
  check(
    "the denial says when to come back",
    denied.allowed === false && denied.retryAfterSeconds >= 1,
    JSON.stringify(denied),
  );
  check(
    "another address keeps its own budget",
    consumeRateLimit(bucket, "ip-b", limit, t0 + 2).allowed === true,
  );
  check(
    "the window resets and requests are allowed again",
    consumeRateLimit(bucket, "ip-a", limit, t0 + limit.windowMs + 1).allowed === true,
  );
}

/* --------------------------- secret exposure ----------------------------- */

function secretValues() {
  const envPath = path.join(root, ".env.local");
  if (!existsSync(envPath)) return [];
  const values = [];
  process.loadEnvFile(envPath);
  for (const key of [
    "ADMIN_TOKEN",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
    "PGPASSWORD",
    "VERCEL_OIDC_TOKEN",
  ]) {
    const value = process.env[key];
    if (value && value.length >= 8) values.push({ key, value });
  }
  return values;
}

function secretExposureChecks() {
  console.log("\nSecret exposure (client bundles + rendered HTML)");
  const values = secretValues();
  check("secrets found in .env.local to audit against", values.length > 0, `${values.length} values`);

  const bundleFiles = walk(path.join(root, ".next", "static"), [".js", ".css", ".txt"]);
  const bundleText = bundleFiles.map((file) => readFileSync(file, "utf8")).join("\n");

  for (const { key, value } of values) {
    check(`${key} value never reaches the client bundle`, !bundleText.includes(value));
  }
  check(
    "no connection string reaches the client bundle",
    !bundleText.includes("postgres://") && !bundleText.includes("postgresql://"),
  );
  return values;
}

/* --------------------------------- live ----------------------------------- */

function startServer({ port = APP_PORT, env: overrides = {} } = {}) {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const env = {
    ...process.env,
    INGEST_SECRET: TEST_INGEST,
    CRON_SECRET: TEST_CRON,
    // Deterministic provider for the alert flow — the checks below are about
    // locks and headers, not which catalog is wired up.
    NEXT_PUBLIC_DEMO_MODE: "true",
    ...overrides,
  };
  return spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: root,
    stdio: "ignore",
    env,
  });
}

async function waitForServer(child, port = APP_PORT) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(`http://localhost:${port}/`, {
        signal: AbortSignal.timeout(3000),
      });
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

async function get(pathname) {
  const response = await fetch(`${BASE}${pathname}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, text: await response.text(), response };
}

function locationOf(response) {
  return response.headers.get("location") ?? "";
}

function isInternal(location) {
  try {
    const url = new URL(location, BASE);
    return url.origin === new URL(BASE).origin;
  } catch {
    return false;
  }
}

async function liveChecks(values) {
  const { ALLOWED_REDIRECT_HOSTS } = await import("../lib/api/affiliate.ts");

  console.log("\nSecurity headers");
  const home = await get("/");
  check("homepage responds", home.status === 200);
  for (const header of ["x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"]) {
    check(`${header} header present`, home.response.headers.get(header) !== null);
  }
  for (const { key, value } of values) {
    check(`${key} value never appears in rendered HTML`, !home.text.includes(value));
  }

  console.log("\nOutbound redirect (/go) cannot be abused");
  const valid = await get("/go/shopee/iphone-16-128gb");
  const validLocation = locationOf(valid.response);
  let validHost = "";
  try {
    validHost = new URL(validLocation).hostname;
  } catch {
    /* handled below */
  }
  check(
    "a valid deal lands on an allowlisted host or back inside the app",
    (valid.status === 302 || valid.status === 307) &&
      (isInternal(validLocation) || ALLOWED_REDIRECT_HOSTS.includes(validHost)),
    `${valid.status} → ${validLocation}`,
  );

  const badProduct = await get("/go/shopee/not-a-real-product");
  check(
    "an unknown product redirects inside the app",
    isInternal(locationOf(badProduct.response)) &&
      locationOf(badProduct.response).endsWith("/search"),
    locationOf(badProduct.response),
  );

  const badStore = await get("/go/evilstore/iphone-16-128gb");
  check(
    "an unknown store redirects inside the app",
    isInternal(locationOf(badStore.response)) &&
      locationOf(badStore.response).includes("/product/iphone-16-128gb"),
    locationOf(badStore.response),
  );

  const traversal = await get("/go/%2e%2e%2f%2e%2e%2fgoogle.com/iphone-16-128gb");
  const traversalLocation = locationOf(traversal.response);
  check(
    "a traversal-shaped store never escapes the app",
    isInternal(traversalLocation),
    traversalLocation,
  );

  const campaign = await get("/go/shopee/iphone-16-128gb?campaign=https%3A%2F%2Fevil.example");
  const campaignLocation = locationOf(campaign.response);
  let campaignHost = "";
  try {
    campaignHost = new URL(campaignLocation).hostname;
  } catch {
    /* handled below */
  }
  check(
    "a campaign parameter cannot move the redirect host",
    isInternal(campaignLocation) || ALLOWED_REDIRECT_HOSTS.includes(campaignHost),
    campaignLocation,
  );

  console.log("\nReflected input");
  const payload = "<script>alert(1)</script>";
  const xss = await get(`/search?q=${encodeURIComponent(payload)}`);
  check(
    "a script payload in search renders escaped, not executable",
    xss.status === 200 && !xss.text.includes(payload),
    xss.status !== 200 ? `status ${xss.status}` : "raw payload found in HTML",
  );

  const badEmailBody = JSON.stringify({
    email: '"><script>alert(1)</script>',
    productSlug: "iphone-16-128gb",
    targetPriceCents: 4000000,
  });
  const alertPost = await fetch(`${BASE}/api/alerts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: badEmailBody,
    signal: AbortSignal.timeout(10_000),
  });
  check("alerts rejects a malformed email outright", alertPost.status === 400, String(alertPost.status));
  const alertGet = await get("/api/alerts?email=javascript%3Aalert(1)");
  check("alerts rejects a javascript: email parameter", alertGet.status === 400, String(alertGet.status));

  console.log("\nIngest lock (INGEST_SECRET configured)");
  const noSecret = await fetch(`${BASE}/api/ingest`, { signal: AbortSignal.timeout(10_000) });
  check("no secret → 401", noSecret.status === 401, String(noSecret.status));
  const wrongSecret = await fetch(`${BASE}/api/ingest`, {
    headers: { "x-ingest-secret": "wrong" },
    signal: AbortSignal.timeout(10_000),
  });
  check("wrong secret → 401", wrongSecret.status === 401, String(wrongSecret.status));
  const rightSecret = await fetch(`${BASE}/api/ingest`, {
    headers: { "x-ingest-secret": TEST_INGEST },
    signal: AbortSignal.timeout(30_000),
  });
  const ingestBody = await rightSecret.json().catch(() => null);
  check(
    "right secret → honest refusal (no authorized provider, nothing written)",
    rightSecret.status === 200 &&
      ingestBody?.ok === false &&
      typeof ingestBody?.reason === "string" &&
      ingestBody.reason.includes("not authorized"),
    JSON.stringify(ingestBody),
  );

  await alertTokenFlow();
  await cronAuthChecks();
}

/** POST a JSON body to BASE, returning status, headers and parsed body. */
async function postJson(pathname, body, headers = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* handled by callers via status */
  }
  return { status: response.status, headers: response.headers, body: parsed };
}

/**
 * §25 over HTTP: the email alone opens nothing — the mailbox token minted by
 * the first POST must accompany every later call, and POSTs are budgeted.
 * The row this creates is cancelled and then deleted, so the run leaves the
 * table as it found it.
 */
async function alertTokenFlow() {
  console.log("\nAlert token authorization (§25)");
  const alertBody = {
    email: FLOW_EMAIL,
    slug: "iphone-16-128gb",
    targetPrice: 1000,
  };

  const mint = await postJson("/api/alerts", alertBody);
  const token = mint.body?.accessToken;
  check("first POST mints and returns a mailbox token", mint.status === 200 && typeof token === "string" && token.length >= 32, `status ${mint.status}`);
  if (mint.status !== 200 || typeof token !== "string") return;
  const alertId = mint.body?.alert?.id;

  const unauthorized = await fetch(`${BASE}/api/alerts?email=${encodeURIComponent(FLOW_EMAIL)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  check("GET without the token → 403", unauthorized.status === 403, String(unauthorized.status));

  const authorized = await fetch(`${BASE}/api/alerts?email=${encodeURIComponent(FLOW_EMAIL)}`, {
    headers: { "x-alert-token": token },
    signal: AbortSignal.timeout(10_000),
  });
  const listed = await authorized.json().catch(() => null);
  check(
    "GET with the token → 200 and the alert list",
    authorized.status === 200 && Array.isArray(listed?.alerts) && listed.alerts.length >= 1,
    `status ${authorized.status}`,
  );

  const repost = await postJson("/api/alerts", alertBody);
  check("a second POST without the token → 403", repost.status === 403, String(repost.status));

  const deleteNoToken = await fetch(
    `${BASE}/api/alerts?email=${encodeURIComponent(FLOW_EMAIL)}&id=${alertId}`,
    { method: "DELETE", signal: AbortSignal.timeout(10_000) },
  );
  check("DELETE without the token → 403", deleteNoToken.status === 403, String(deleteNoToken.status));

  const deleteOk = await fetch(
    `${BASE}/api/alerts?email=${encodeURIComponent(FLOW_EMAIL)}&id=${alertId}`,
    { method: "DELETE", headers: { "x-alert-token": token }, signal: AbortSignal.timeout(10_000) },
  );
  check("DELETE with the token → 204", deleteOk.status === 204, String(deleteOk.status));

  const afterDelete = await fetch(`${BASE}/api/alerts?email=${encodeURIComponent(FLOW_EMAIL)}`, {
    headers: { "x-alert-token": token },
    signal: AbortSignal.timeout(10_000),
  });
  const remaining = await afterDelete.json().catch(() => null);
  check(
    "the cancelled alert drops out of the mailbox listing",
    afterDelete.status === 200 && Array.isArray(remaining?.alerts) && remaining.alerts.length === 0,
    JSON.stringify(remaining),
  );

  console.log("\nAlert POST rate limit (§25)");
  // Well-formed POSTs without the token still pass through the limiter before
  // the token check, so they spend the per-IP budget without writing rows.
  let saw429 = false;
  let retryAfter = null;
  for (let attempt = 0; attempt < 15 && !saw429; attempt += 1) {
    const response = await postJson("/api/alerts", alertBody);
    if (response.status === 429) {
      saw429 = true;
      retryAfter = response.headers.get("retry-after");
    }
  }
  check("the per-IP budget runs out with 429", saw429);
  check(
    "429 carries Retry-After",
    saw429 && Number(retryAfter) >= 1,
    `Retry-After: ${retryAfter}`,
  );
  const stillReads = await fetch(`${BASE}/api/alerts?email=${encodeURIComponent(FLOW_EMAIL)}`, {
    headers: { "x-alert-token": token },
    signal: AbortSignal.timeout(10_000),
  });
  check("only POST is limited — GET still answers 200", stillReads.status === 200, String(stillReads.status));
}

/** §26: with a secret configured, only the right bearer may sweep. */
async function cronAuthChecks() {
  console.log("\nCron authorization (§26)");
  const none = await postJson("/api/alerts/check", {});
  check("no bearer → 401", none.status === 401, String(none.status));
  const wrong = await postJson("/api/alerts/check", {}, { Authorization: "Bearer wrong" });
  check("wrong bearer → 401", wrong.status === 401, String(wrong.status));
  const right = await postJson("/api/alerts/check", {}, { Authorization: `Bearer ${TEST_CRON}` });
  check(
    "right bearer → 200 with the sweep result",
    right.status === 200 && typeof right.body?.checked === "number",
    JSON.stringify(right.body),
  );
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
  if (!existsSync(path.join(root, ".next"))) {
    console.error("No .next directory — run npm run build first.");
    process.exit(1);
  }

  await staticChecks();
  const values = secretExposureChecks();

  const server = startServer();
  try {
    const up = await waitForServer(server);
    check("server starts", up, "next start never became ready");
    if (up) await liveChecks(values);
  } finally {
    await stopServer(server);
  }

  await disabledCronCheck();
  await cleanupFlowRows();
}

/**
 * §26's other half: a server with no CRON_SECRET must answer 503 — in every
 * environment, so the sweep cannot be reached by flipping NODE_ENV or being
 * on a laptop. Its own port, because the secret is baked into the process.
 */
async function disabledCronCheck() {
  console.log("\nCron with no secret configured (§26)");
  const disabled = startServer({ port: DISABLED_PORT, env: { CRON_SECRET: "" } });
  try {
    const up = await waitForServer(disabled, DISABLED_PORT);
    check("server starts without a cron secret", up, "next start never became ready");
    if (!up) return;
    const response = await fetch(`http://localhost:${DISABLED_PORT}/api/alerts/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);
    check(
      "no CRON_SECRET → 503, not an open sweep",
      response.status === 503 && body?.error === "cron check disabled",
      `status ${response.status} ${JSON.stringify(body)}`,
    );
  } finally {
    await stopServer(disabled);
  }
}

/** The token-flow row was cancelled over HTTP; delete it outright here. */
async function cleanupFlowRows() {
  const client = new pg.Client({ connectionString: resolveConnectionString() });
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

function resolveConnectionString() {
  const candidates = [
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_URL,
    process.env.DATABASE_URL,
  ].filter(Boolean);
  const url = candidates.find((value) => !value.includes("-pooler")) ?? candidates[0];
  if (!url || url.includes("SENSITIVE")) {
    console.error("No usable Postgres connection string found in .env.local.");
    process.exit(1);
  }
  return url;
}

await main();
console.log(`\n${passed}/${passed + failed} checks passed.\n`);
process.exit(failed === 0 ? 0 : 1);
