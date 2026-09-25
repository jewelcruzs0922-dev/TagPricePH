#!/usr/bin/env node
/**
 * Phase 25 verification: the admin area stays admin.
 *
 * Two halves:
 *
 *   Unit — the token gate itself (imported straight from lib/admin/token.ts,
 *   which is deliberately free of Next imports): disabled when no
 *   ADMIN_TOKEN is set, constant-time comparison, and a session cookie that
 *   only ever holds the token's hash.
 *
 *   Live — a real `next start` with a known ADMIN_TOKEN, proving over HTTP
 *   that:
 *     - /admin renders only the login form without the session cookie, and
 *       the dashboard markup (and its figures) never leak to a guest;
 *     - the session endpoint accepts the real token (204 + httpOnly cookie),
 *       rejects wrong ones (401), and reports an unconfigured deployment (503
 *       logic is unit-covered);
 *     - the page is noindexed, robots.txt disallows /admin, the sitemap omits
 *       it, and no public page links to it;
 *     - sign-out clears the cookie.
 *
 * Usage: node scripts/admin-verify.mjs   (expects `npm run build` to have run)
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const APP_PORT = 3996;
const BASE = `http://localhost:${APP_PORT}`;
const TEST_TOKEN = "verify-admin-token-5c9f2b7e41";
const COOKIE_NAME = "tp_admin";

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

function startServer() {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  return spawn(process.execPath, [nextBin, "start", "-p", String(APP_PORT)], {
    cwd: root,
    stdio: "ignore",
    env: { ...process.env, ADMIN_TOKEN: TEST_TOKEN },
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

async function get(pathname, cookie) {
  const response = await fetch(`${BASE}${pathname}`, {
    headers: cookie ? { cookie: `${COOKIE_NAME}=${cookie}` } : {},
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, text: await response.text(), response };
}

async function post(pathname, body) {
  const response = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, response };
}

function sessionCookieFrom(setCookie) {
  const match = new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(setCookie ?? "");
  return match ? match[1] : null;
}

/* ----------------------------- unit: token gate --------------------------- */

async function unitChecks() {
  console.log("\nToken gate (unit)");
  const source = readFileSync(path.join(root, "lib", "admin", "token.ts"), "utf8");
  check("comparison is constant-time (timingSafeEqual in source)", source.includes("timingSafeEqual"));

  const original = process.env.ADMIN_TOKEN;
  try {
    delete process.env.ADMIN_TOKEN;
    const token = await import("../lib/admin/token.ts");
    check("no ADMIN_TOKEN → admin disabled", token.verifyAdminToken("anything") === "disabled");
    check(
      "no ADMIN_TOKEN → no valid session value exists",
      token.isValidSessionValue(token.hashToken("anything")) === false &&
        token.expectedSessionValue() === null,
    );

    process.env.ADMIN_TOKEN = TEST_TOKEN;
    check("configured token verifies", token.verifyAdminToken(TEST_TOKEN) === "ok");
    check("wrong token rejected", token.verifyAdminToken(`${TEST_TOKEN}x`) === "mismatch");
    check("empty submission rejected", token.verifyAdminToken("") === "mismatch");
    check("missing submission rejected", token.verifyAdminToken(null) === "mismatch");
    const expected = token.expectedSessionValue();
    check(
      "session value is a 64-char hash of the token, not the token",
      /^[0-9a-f]{64}$/.test(expected ?? "") &&
        expected === token.hashToken(TEST_TOKEN) &&
        !expected.includes(TEST_TOKEN),
    );
    check("hash of token accepted as session", token.isValidSessionValue(expected) === true);
    check(
      "arbitrary cookie value rejected",
      token.isValidSessionValue("deadbeef".repeat(8)) === false,
    );
    check("absent cookie rejected", token.isValidSessionValue(null) === false);
  } finally {
    if (original === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = original;
  }
}

/* --------------------------------- live ----------------------------------- */

async function liveChecks() {
  console.log("\nLogin gate (live)");
  const guest = await get("/admin");
  check("guest gets the login form", guest.status === 200 && guest.text.includes('data-admin="login"'));
  check(
    "dashboard markup never reaches a guest",
    !guest.text.includes('data-admin="dashboard"') &&
      !guest.text.includes('data-admin="observations"') &&
      !guest.text.includes("Price observations"),
  );
  check(
    "/admin is noindexed for guests",
    /<meta[^>]+name="robots"/i.test(guest.text) && /noindex/i.test(guest.text),
  );

  console.log("\nSession endpoint");
  const badToken = await post("/api/admin/session", { token: "wrong-token" });
  check("wrong token → 401", badToken.status === 401);
  const emptyBody = await post("/api/admin/session", {});
  check("missing token field → 401", emptyBody.status === 401);
  const brokenBody = await post("/api/admin/session", "not json at all");
  check("unparseable body → 400", brokenBody.status === 400);
  const good = await post("/api/admin/session", { token: TEST_TOKEN });
  const setCookie = good.response.headers.get("set-cookie") ?? "";
  check("correct token → 204", good.status === 204);
  check(
    "session cookie is httpOnly, SameSite, path=/, 8h",
    setCookie.includes(`${COOKIE_NAME}=`) &&
      /HttpOnly/i.test(setCookie) &&
      /SameSite=Lax/i.test(setCookie) &&
      /Path=\//i.test(setCookie) &&
      /Max-Age=28800/.test(setCookie),
    setCookie,
  );
  const cookie = sessionCookieFrom(setCookie);
  check("cookie holds a hash, not the raw token", Boolean(cookie) && cookie !== TEST_TOKEN);
  const sessionGet = await fetch(`${BASE}/api/admin/session`, { signal: AbortSignal.timeout(10_000) });
  check("session endpoint exposes no GET handler", sessionGet.status === 405);

  console.log("\nDashboard (live)");
  const admin = await get("/admin", cookie);
  check("valid session gets the dashboard", admin.status === 200 && admin.text.includes('data-admin="dashboard"'));
  check("login form replaced after sign-in", !admin.text.includes('data-admin="login"'));
  check(
    "dashboard is noindexed too",
    /<meta[^>]+name="robots"/i.test(admin.text) && /noindex/i.test(admin.text),
  );
  const observations = /data-admin="observations"[\s\S]*?data-admin="alerts"/.exec(admin.text)?.[0] ?? "";
  const renderedCount = /text-2xl font-bold text-ink">([\d,]+)</.exec(observations)?.[1]?.replace(/,/g, "");
  const recorded = await dbObservationCount();
  check(
    "observation queue reports the database's real count",
    renderedCount !== undefined && recorded !== null && Number(renderedCount) === recorded,
    `rendered ${renderedCount ?? "?"} vs database ${recorded ?? "?"}`,
  );
  check("provider section explains the demo catalog", admin.text.includes("Sample catalog"));

  const forged = await get("/admin", "ab".repeat(32));
  check("forged cookie gets only the login form", forged.text.includes('data-admin="login"') && !forged.text.includes('data-admin="dashboard"'));

  console.log("\nSign-out");
  const logout = await fetch(`${BASE}/api/admin/session`, {
    method: "DELETE",
    headers: { cookie: `${COOKIE_NAME}=${cookie}` },
    signal: AbortSignal.timeout(10_000),
  });
  const clearCookie = logout.headers.get("set-cookie") ?? "";
  check("DELETE ends the session with 204", logout.status === 204);
  check(
    "sign-out clears the cookie (Max-Age=0)",
    new RegExp(`${COOKIE_NAME}=;`).test(clearCookie) && /Max-Age=0/i.test(clearCookie),
    clearCookie,
  );
  const afterLogout = await get("/admin");
  check("cleared session returns to the login form", afterLogout.text.includes('data-admin="login"'));

  console.log("\nDiscovery (public surface)");
  const robots = await get("/robots.txt");
  check("robots.txt disallows /admin", /Disallow:\s*\/admin/.test(robots.text));
  const sitemap = await get("/sitemap.xml");
  check("sitemap omits /admin", !sitemap.text.includes("/admin"));
  for (const publicPage of ["/", "/about"]) {
    const page = await get(publicPage);
    check(`${publicPage} contains no link to /admin`, page.status === 200 && !/href="\/admin"/.test(page.text));
  }
}

/* ---------------------------------- main ---------------------------------- */

/** The dashboard's "Recorded" figure must be the table's own count. */
async function dbObservationCount() {
  const client = new pg.Client({ connectionString: resolveConnectionString() });
  try {
    await client.connect();
    const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM price_observations");
    return rows[0].n;
  } catch (error) {
    console.error(`observation count unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
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

async function main() {
  await unitChecks();

  if (!existsSync(path.join(root, ".next"))) {
    console.error("No .next directory — run npm run build first.");
    process.exit(1);
  }

  const server = startServer();
  try {
    const up = await waitForServer(server);
    check("server starts", up, "next start never became ready");
    if (up) await liveChecks();
  } finally {
    server.kill();
    await new Promise((resolve) => {
      if (server.exitCode !== null) return resolve();
      server.once("exit", resolve);
      setTimeout(resolve, 5_000);
    });
  }
}

await main();
console.log(`\n${passed}/${passed + failed} checks passed.\n`);
process.exit(failed === 0 ? 0 : 1);
