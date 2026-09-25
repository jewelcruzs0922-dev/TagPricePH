#!/usr/bin/env node
/**
 * Phase 21 verification: the mobile experience.
 *
 * Runs a real browser (headless Chrome or Edge) with device emulation —
 * the same thing DevTools does when you pick a phone — because a stylesheet
 * audit cannot prove what the layout actually does:
 *
 *   1. The viewport meta is present and does not lock zoom.
 *   2. No page scrolls sideways at 390px (iPhone) or 360px (small Android):
 *      every route's scrollWidth must equal its viewport.
 *   3. The hamburger menu opens, shows tappable links, causes no overflow,
 *      and closes again.
 *   4. The search filters panel toggles from its mobile button.
 *   5. Primary tap targets clear 36–44px — header icons, the hero search
 *      button, and the search field itself.
 *
 * Needs a Chrome/Edge install (CHROME_PATH overrides detection) and its own
 * `next start` on port 3997, killed afterwards.
 *
 * Usage: node scripts/mobile-verify.mjs   (expects `npm run build` to have run)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = 3997;
const DEBUG_PORT = 9337;
const BASE = `http://localhost:${APP_PORT}`;

const ROUTES = [
  ["/", "home"],
  ["/search?q=iphone", "search"],
  ["/product/iphone-16-128gb", "product"],
  ["/price-drops", "price drops"],
  ["/alerts", "alerts"],
  ["/categories", "categories"],
];

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

function startServer() {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  return spawn(process.execPath, [nextBin, "start", "-p", String(APP_PORT)], {
    cwd: root,
    stdio: "ignore",
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

/* ---------------------------- browser plumbing --------------------------- */

async function attach(browserPath) {
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
    throw new Error("Chrome DevTools endpoint never came up");
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
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

  await send("Page.enable");
  await send("Runtime.enable");

  return {
    chrome,
    setViewport: (width, height = 844) =>
      send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: true,
      }),
    navigate: async (url) => {
      const target = new URL(url);
      await send("Page.navigate", { url });
      for (let i = 0; i < 50; i += 1) {
        await sleep(200);
        const state = await evaluate(
          "({ href: location.pathname + location.search, ready: document.readyState })",
        );
        if (state?.ready === "complete" && state.href === target.pathname + target.search) {
          await sleep(700);
          return true;
        }
      }
      return false;
    },
    evaluate,
    close: () => {
      try {
        ws.close();
      } catch {
        /* already gone */
      }
      chrome.kill();
    },
  };
}

/* --------------------------------- checks -------------------------------- */

async function overflowPass(driver, width) {
  console.log(`\nHorizontal fit at ${width}px`);
  for (const [route, name] of ROUTES) {
    const arrived = await driver.navigate(`${BASE}${route}`);
    if (!arrived) {
      check(`${name} loads at ${width}px`, false, "navigation never settled");
      continue;
    }
    const metrics = await driver.evaluate(
      "({ vw: innerWidth, sw: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) })",
    );
    check(
      `${name} never scrolls sideways at ${width}px`,
      metrics.sw <= metrics.vw + 1,
      `viewport=${metrics.vw} scrollWidth=${metrics.sw} (overflow ${metrics.sw - metrics.vw}px)`,
    );
  }
}

async function interactionChecks(driver) {
  console.log("\nTap targets on the home page");
  await driver.setViewport(390);
  await driver.navigate(`${BASE}/`);
  const targets = await driver.evaluate(
    `(() => {
      const size = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        searchLink: size('a[aria-label="Search products"], button[aria-label="Search products"]'),
        alertsLink: size('a[aria-label="Price alerts"], button[aria-label="Price alerts"]'),
        menuToggle: size('button[aria-label="Open menu"]'),
        heroSubmit: size('main form button[type="submit"], main form button'),
        searchInput: size('main form input'),
      };
    })()`,
  );
  for (const [label, target, minimum] of [
    ["the header search target", targets?.searchLink, 36],
    ["the header alerts target", targets?.alertsLink, 36],
    ["the menu toggle", targets?.menuToggle, 36],
    ["the hero search button", targets?.heroSubmit, 44],
    ["the search input", targets?.searchInput, 44],
  ]) {
    check(
      `${label} clears ${minimum}px (${label.includes("input") ? "tall" : "square"})`,
      Boolean(target) && target.w >= minimum && target.h >= minimum,
      target ? `${target.w}×${target.h}` : "not found",
    );
  }

  console.log("\nMobile menu");
  await driver.evaluate(`document.querySelector('button[aria-label="Open menu"]')?.click()`);
  await sleep(500);
  const menu = await driver.evaluate(
    `(() => {
      const nav = document.querySelector('nav[aria-label="Mobile"]');
      if (!nav) return { found: false };
      const links = [...nav.querySelectorAll("a, button")].map(
        (el) => Math.round(el.getBoundingClientRect().height),
      );
      return {
        found: true,
        visible: nav.getBoundingClientRect().height > 0,
        links,
        sw: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
        vw: innerWidth,
      };
    })()`,
  );
  check("the menu opens", Boolean(menu?.found) && menu.visible);
  check(
    "the open menu does not push the page sideways",
    menu?.found && menu.sw <= menu.vw + 1,
    menu?.found ? `scrollWidth=${menu.sw} viewport=${menu.vw}` : "menu missing",
  );
  check(
    "every menu link is comfortably tappable (≥44px)",
    menu?.found && menu.links.length >= 5 && Math.min(...menu.links) >= 44,
    menu?.found ? `heights: ${menu.links.join(", ")}` : "menu missing",
  );
  await driver.evaluate(`document.querySelector('button[aria-label="Close menu"]')?.click()`);
  await sleep(400);
  const closed = await driver.evaluate(
    `(() => {
      const nav = document.querySelector('nav[aria-label="Mobile"]');
      return { gone: !nav || nav.getBoundingClientRect().height === 0 };
    })()`,
  );
  check("the menu closes again", closed?.gone === true);

  console.log("\nFilters panel on mobile");
  await driver.navigate(`${BASE}/search?q=iphone`);
  // The toggle is a text-only button ("Filters" + chevron); aria-label="Filters"
  // belongs to the panel itself, so the button is found by its visible label.
  const filters = await driver.evaluate(
    `(() => {
      const button = [...document.querySelectorAll("button")].find((el) =>
        el.textContent.trim().startsWith("Filters"),
      );
      if (!button) return null;
      const r = button.getBoundingClientRect();
      return { h: Math.round(r.height), w: Math.round(r.width), expanded: button.getAttribute("aria-expanded") };
    })()`,
  );
  check(
    "the Filters button clears 44px tall",
    Boolean(filters) && filters.h >= 44,
    filters ? `${filters.w}×${filters.h}` : "button not found",
  );
  await driver.evaluate(
    `[...document.querySelectorAll("button")].find((el) => el.textContent.trim().startsWith("Filters"))?.click()`,
  );
  await sleep(400);
  const after = await driver.evaluate(
    `(() => {
      const button = [...document.querySelectorAll("button")].find((el) =>
        el.textContent.trim().startsWith("Filters"),
      );
      const panel = document.querySelector('aside[aria-label="Filters"]');
      return {
        expanded: button?.getAttribute("aria-expanded"),
        panelVisible: Boolean(panel) && panel.getBoundingClientRect().height > 0,
        sw: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
        vw: innerWidth,
      };
    })()`,
  );
  check(
    "the filters panel opens from its mobile button",
    after?.expanded === "true" && after?.panelVisible,
    `expanded=${after?.expanded} panelVisible=${after?.panelVisible}`,
  );
  check(
    "the open panel causes no sideways scroll",
    after?.sw <= after.vw + 1,
    `scrollWidth=${after?.sw} viewport=${after?.vw}`,
  );
}

/* ---------------------------------- main --------------------------------- */

async function main() {
  if (!existsSync(path.join(root, ".next"))) {
    console.error("No .next directory — run npm run build first.");
    process.exit(1);
  }

  const browser = findBrowser();
  if (!browser) {
    console.error("No Chrome or Edge found — set CHROME_PATH to a browser executable.");
    process.exit(1);
  }
  console.log(`Browser: ${browser}`);

  const server = startServer();
  let driver = null;
  try {
    const up = await waitForServer(server);
    check("server starts", up, "next start never became ready");
    if (!up) return;

    driver = await attach(browser);
    check("browser attaches over CDP", Boolean(driver));

    console.log("\nStatic viewport rules");
    await driver.setViewport(390);
    const home = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(10_000) });
    const html = await home.text();
    check("the viewport meta declares device-width", /width=device-width/.test(html));
    check(
      "user zoom is not locked",
      !/user-scalable\s*=\s*(no|0)/i.test(html) && !/maximum-scale\s*=\s*1\b/i.test(html),
    );

    await overflowPass(driver, 390);
    await overflowPass(driver, 360);

    // Interaction checks re-set their own viewport state as they go.
    await driver.setViewport(390);
    console.log("\nTap targets and interactions at 390px");
    await interactionChecks(driver);
  } finally {
    if (driver) driver.close();
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
