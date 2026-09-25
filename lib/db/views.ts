import "server-only";

import type { ProductViewEvent } from "@/lib/data/view-events";
import { query } from "@/lib/db";
import { INSERT_VIEW_SQL } from "@/lib/db/view-queries";

/**
 * Records one anonymous product view.
 *
 * Best-effort for the same reason recordClick is: analytics is never a gate
 * on what a shopper sees. Callers treat a failure as "we missed a data point"
 * and must not let it surface as an error.
 *
 * Only what the schema holds is written — no IP address, no user agent, no
 * identifier of any kind. The visitor cannot be reconstructed from a row.
 */
export async function recordProductView(event: ProductViewEvent): Promise<void> {
  await query(INSERT_VIEW_SQL, [event.productSlug, event.referrerHost]);
}
