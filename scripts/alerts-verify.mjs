#!/usr/bin/env node
/**
 * Phase 14 verification: server-side price alerts.
 *
 * Two halves, like the other suites:
 *   - validation and the trigger rule, imported straight from
 *     lib/data/alert-events.ts, so the exact rules the API enforces are
 *     checked without booting a server;
 *   - the real statements from lib/db/alert-queries.ts run against Postgres:
 *     filing an alert, retargeting the active one through the partial unique
 *     index from migration 0005, flipping it to triggered exactly once,
 *     re-arming after a trigger, ownership on cancel, and cleanup.
 *
 * Rows are deleted again; the table is left as it was.
 *
 * Usage: node scripts/alerts-verify.mjs
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  parseAlertEmail,
  parseAlertId,
  parseAlertRequest,
  parseAlertTarget,
  shouldTriggerAlert,
} from "../lib/data/alert-events.ts";
import {
  ACTIVE_ALERTS_SQL,
  CANCEL_ALERT_SQL,
  INSERT_ALERT_SQL,
  LIST_ALERTS_SQL,
  TRIGGER_ALERT_SQL,
} from "../lib/db/alert-queries.ts";

const { Client } = pg;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const TEST_EMAIL = "alerts-verify@example.test";
const TEST_SLUG = "verify-temp-product";

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

function validationChecks() {
  console.log("\nValidation (lib/data/alert-events.ts)");

  const valid = parseAlertRequest({
    email: "  Shopper@Example.COM ",
    slug: "iphone-16-128gb",
    targetPrice: 40491,
  });
  check(
    "a well-formed request parses",
    valid?.productSlug === "iphone-16-128gb" && valid?.targetPriceCents === 4049100,
    JSON.stringify(valid),
  );
  check(
    "the email is normalised to lowercase and trimmed",
    valid?.email === "shopper@example.com",
    valid?.email,
  );
  check(
    "a formatted peso string is accepted as a target",
    parseAlertTarget("₱40,491.50") === 4049150,
    String(parseAlertTarget("₱40,491.50")),
  );
  check("an email without @ is rejected", parseAlertEmail("not-an-email") === null);
  check("an email with spaces is rejected", parseAlertEmail("a b@mail.com") === null);
  check("an email without a domain dot is rejected", parseAlertEmail("a@b") === null);
  check(
    "an over-long email is rejected",
    parseAlertEmail(`${"a".repeat(250)}@mail.com`) === null,
  );
  check("a zero target is rejected", parseAlertTarget(0) === null);
  check("a negative target is rejected", parseAlertTarget(-100) === null);
  check(
    "a target above ₱1,000,000 is rejected",
    parseAlertTarget(1_000_001) === null,
  );
  check("a non-numeric target is rejected", parseAlertTarget("soon") === null);
  check("an uppercase slug is rejected", parseAlertRequest({
    email: "a@b.co", slug: "iPhone", targetPrice: 1,
  }) === null);
  check(
    "a path-like slug is rejected",
    parseAlertRequest({ email: "a@b.co", slug: "../../etc", targetPrice: 1 }) === null,
  );
  check("a request without an email is rejected", parseAlertRequest({
    slug: "iphone-16-128gb", targetPrice: 100,
  }) === null);
  check("a non-object payload is rejected", parseAlertRequest(null) === null);
  check("an id must be a positive integer", parseAlertId("12") === 12);
  check("a non-integer id is rejected", parseAlertId("1.5") === null);
  check("a zero id is rejected", parseAlertId(0) === null);

  console.log("\nTrigger rule");
  check("at the target price it fires", shouldTriggerAlert(4499000, 4499000));
  check("below the target it fires", shouldTriggerAlert(4499000, 4400000));
  check("above the target it waits", !shouldTriggerAlert(4499000, 4599000));
  check("no price means no trigger", !shouldTriggerAlert(4499000, null));
}

async function main() {
  validationChecks();

  const client = new Client({ connectionString: resolveConnectionString() });
  await client.connect();

  try {
    console.log("\nSchema");
    let tableOk = true;
    let tableDetail = "";
    try {
      await client.query("SELECT id FROM price_alerts LIMIT 0");
    } catch (error) {
      tableOk = false;
      tableDetail = error.message;
    }
    check("price_alerts table exists", tableOk, tableDetail);

    const { rows: indexes } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'price_alerts' AND schemaname = 'public'
    `);
    const indexNames = indexes.map((row) => row.indexname);
    check(
      "one active alert per email+product (migration 0005)",
      indexNames.includes("price_alerts_one_active_idx"),
      indexNames.join(", "),
    );

    await client.query("DELETE FROM price_alerts WHERE email = $1", [TEST_EMAIL]);

    try {
      console.log("\nFiling and retargeting (INSERT_ALERT_SQL)");
      const MAILBOX_TOKEN = "verify-mailbox-token-25a7c1";
      const first = (
        await client.query(INSERT_ALERT_SQL, [
          TEST_SLUG,
          4049100,
          TEST_EMAIL,
          MAILBOX_TOKEN,
        ])
      ).rows[0];
      check(
        "an alert is created as active",
        first?.status === "active" && first?.target_price_cents === 4049100,
        JSON.stringify(first ?? null),
      );
      check(
        "the created alert stores the mailbox token it was filed with (§25)",
        first?.access_token === MAILBOX_TOKEN,
        String(first?.access_token ?? "null"),
      );

      // The route always passes the *verified* mailbox token, but the SQL
      // must not depend on that: a conflicting retarget may never rewrite
      // the token, even if a caller hands it a different one.
      const second = (
        await client.query(INSERT_ALERT_SQL, [
          TEST_SLUG,
          4599000,
          TEST_EMAIL,
          "some-other-token-must-not-stick",
        ])
      ).rows[0];
      const { rows: afterUpsert } = await client.query(LIST_ALERTS_SQL, [TEST_EMAIL]);
      check(
        "filing again retargets instead of duplicating",
        afterUpsert.length === 1 && second?.target_price_cents === 4599000,
        `${afterUpsert.length} rows, target ${second?.target_price_cents}`,
      );
      check(
        "the retarget keeps the original row",
        second?.id === first?.id,
        `${second?.id} vs ${first?.id}`,
      );
      check(
        "retargeting never rewrites the mailbox token (§25)",
        second?.access_token === MAILBOX_TOKEN,
        String(second?.access_token ?? "null"),
      );

      console.log("\nReaching the target (TRIGGER_ALERT_SQL)");
      check(
        "the rule says a lower price has been reached",
        shouldTriggerAlert(second.target_price_cents, 3999900),
      );
      const triggered = (
        await client.query(TRIGGER_ALERT_SQL, [first.id])
      ).rows[0];
      check(
        "the alert flips to triggered with a timestamp",
        triggered?.triggered_at != null,
        String(triggered?.triggered_at ?? "null"),
      );
      const secondFlip = (
        await client.query(TRIGGER_ALERT_SQL, [first.id])
      ).rows[0];
      check("a second check cannot re-trigger it", secondFlip === undefined);

      console.log("\nRe-arming after a trigger");
      const rearmed = (
        await client.query(INSERT_ALERT_SQL, [
          TEST_SLUG,
          3800000,
          TEST_EMAIL,
          MAILBOX_TOKEN,
        ])
      ).rows[0];
      const { rows: both } = await client.query(LIST_ALERTS_SQL, [TEST_EMAIL]);
      check(
        "history never blocks watching again",
        rearmed.status === "active" && both.length === 2,
        `${both.length} rows, new status ${rearmed.status}`,
      );
      check(
        "a new row on the same mailbox reuses its token (§25)",
        rearmed.access_token === MAILBOX_TOKEN,
        String(rearmed.access_token ?? "null"),
      );

      console.log("\nOwnership (CANCEL_ALERT_SQL)");
      const wrongOwner = (
        await client.query(CANCEL_ALERT_SQL, [rearmed.id, "someone-else@example.test"])
      ).rows[0];
      check(
        "a different email cannot cancel it",
        wrongOwner === undefined,
      );
      const cancelled = (
        await client.query(CANCEL_ALERT_SQL, [rearmed.id, TEST_EMAIL])
      ).rows[0];
      check(
        "the owner cancels it",
        cancelled?.id === rearmed.id,
        String(cancelled?.id ?? "null"),
      );
      const { rows: afterCancel } = await client.query(LIST_ALERTS_SQL, [TEST_EMAIL]);
      check(
        "cancelled alerts drop out of the list",
        afterCancel.length === 1 && afterCancel[0].id === first.id,
        `${afterCancel.length} rows left`,
      );

      const { rows: active } = await client.query(ACTIVE_ALERTS_SQL);
      check(
        "no test alert is left active",
        !active.some((row) => row.id === first.id || row.id === rearmed.id),
        `${active.length} active overall`,
      );

      console.log("\nCleanup");
      const deleted = await client.query("DELETE FROM price_alerts WHERE email = $1", [TEST_EMAIL]);
      const { rows: remaining } = await client.query(
        "SELECT count(*)::int AS n FROM price_alerts WHERE email = $1",
        [TEST_EMAIL],
      );
      check(
        "test rows removed",
        remaining[0].n === 0,
        `${deleted.rowCount} deleted, ${remaining[0].n} left`,
      );
    } finally {
      await client.query("DELETE FROM price_alerts WHERE email = $1", [TEST_EMAIL]);
    }
  } finally {
    await client.end();
  }

  console.log(`\n${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nPrice-alert verification failed: ${error.message}`);
  process.exit(1);
});
