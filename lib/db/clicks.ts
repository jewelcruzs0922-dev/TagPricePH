import "server-only";

import { query } from "@/lib/db";

export type ClickEventInput = {
  productSlug: string;
  storeId: string;
  /** `marketplace_listings.id` the click left for, when the offer was linked. */
  listingId?: number | null;
  /** Where the link was clicked from, e.g. "product-hero" or "comparison". */
  placement: string;
  /** Campaign parameter the link was generated with, if any. */
  campaign?: string | null;
  /** Fully-resolved outbound URL the visitor was sent to. */
  destination: string;
  referrer?: string | null;
  userAgent?: string | null;
};

/**
 * Records one outbound click.
 *
 * Deliberately best-effort: click logging is analytics, never a gate on the
 * redirect. Callers must treat a failure here as "we missed a data point", and
 * must not let it surface as an error to the visitor.
 *
 * Nothing sensitive is stored: no tokens, no cookies, no affiliate
 * credentials — only the product, store, listing, placement, campaign, and
 * the destination the visitor was sent to.
 */
export async function recordClick(input: ClickEventInput): Promise<void> {
  await query(
    `INSERT INTO click_events
       (product_slug, store_id, listing_id, placement, campaign, destination, referrer, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.productSlug,
      input.storeId,
      input.listingId ?? null,
      input.placement,
      input.campaign ?? null,
      input.destination,
      input.referrer ?? null,
      input.userAgent ?? null,
    ],
  );
}
