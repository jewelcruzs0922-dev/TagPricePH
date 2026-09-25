import "server-only";

import { randomBytes } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import {
  ACTIVE_ALERTS_SQL,
  ALERT_OWNER_SQL,
  CANCEL_ALERT_SQL,
  INSERT_ALERT_SQL,
  LIST_ALERTS_SQL,
  MAILBOX_TOKEN_SQL,
  TRIGGER_ALERT_SQL,
} from "@/lib/db/alert-queries";

/**
 * Server-side price alerts.
 *
 * The email is the identity an alert is *filed under*; the access token is
 * what proves the caller may read or change it (§25). Knowing an address
 * grants nothing: every list/cancel path compares the `x-alert-token`
 * header against the token stored on the rows, and a NULL token — which the
 * schema still allows only for pre-0008 history — reads as "no access",
 * never as "no protection".
 *
 * One token per email (mailbox access, not row access): it is minted when
 * the mailbox's first alert is filed, returned once to that caller, and
 * reused for every later row. Rows are never returned with the token
 * attached on a read — only the create response carries it, once.
 *
 * Triggering is a comparison, not a prediction: an alert flips when the
 * current lowest price is at or below the target, and it stays triggered even
 * if the price climbs again — triggered_at records when the condition was
 * actually observed, not when someone happened to look.
 */

export type AlertRow = {
  id: number;
  product_slug: string;
  target_price_cents: number;
  status: "active" | "triggered" | "cancelled";
  created_at: Date | string;
  triggered_at: Date | string | null;
};

/** A row as INSERT returns it — the only shape that carries the token. */
export type OwnedAlertRow = AlertRow & { access_token: string };

export type ActiveAlertRow = {
  id: number;
  product_slug: string;
  target_price_cents: number;
};

export type AlertOwner = {
  id: number;
  email: string;
  access_token: string | null;
};

/** 24 random bytes, hex — the mailbox access token (§25). */
export function newAlertToken(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Creates an alert (with the mailbox's token), or retargets the active one
 * for this email and product. The conflict path never touches the token, so
 * the row keeps whatever was verified before the call.
 */
export async function createAlert(input: {
  email: string;
  productSlug: string;
  targetPriceCents: number;
  accessToken: string;
}): Promise<OwnedAlertRow> {
  const rows = await query<OwnedAlertRow>(INSERT_ALERT_SQL, [
    input.productSlug,
    input.targetPriceCents,
    input.email,
    input.accessToken,
  ]);
  return rows[0];
}

/** The token this email's alerts are locked to, or null for a fresh mailbox. */
export async function getMailboxToken(email: string): Promise<string | null> {
  const rows = await query<{ access_token: string | null }>(MAILBOX_TOKEN_SQL, [
    email,
  ]);
  return rows[0]?.access_token ?? null;
}

/** The row behind an id — its owning email and token — before any cancel. */
export async function getAlertOwner(id: number): Promise<AlertOwner | null> {
  return queryOne<AlertOwner>(ALERT_OWNER_SQL, [id]);
}

export async function listAlerts(email: string): Promise<AlertRow[]> {
  return query<AlertRow>(LIST_ALERTS_SQL, [email]);
}

/** Returns the cancelled row, or null when the id does not belong to `email`. */
export async function cancelAlert(
  id: number,
  email: string,
): Promise<{ id: number } | null> {
  return queryOne<{ id: number }>(CANCEL_ALERT_SQL, [id, email]);
}

export async function listActiveAlerts(): Promise<ActiveAlertRow[]> {
  return query<ActiveAlertRow>(ACTIVE_ALERTS_SQL);
}

/**
 * Marks one alert as reached. Returns the row when this call is the one that
 * triggered it, or null if another check run got there first.
 */
export async function triggerAlert(
  id: number,
): Promise<{ id: number; triggered_at: Date | string } | null> {
  return queryOne<{ id: number; triggered_at: Date | string }>(
    TRIGGER_ALERT_SQL,
    [id],
  );
}
