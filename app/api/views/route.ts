import { NextResponse } from "next/server";
import { getActiveProvider } from "@/lib/api/registry";
import { parseProductView } from "@/lib/data/view-events";
import { recordProductView } from "@/lib/db/views";

export const dynamic = "force-dynamic";

/**
 * Anonymous product-view beacon.
 *
 * The product page is statically generated, so there is no server render to
 * count a view in — this endpoint is the only place the top of the funnel can
 * be recorded.
 *
 * Public by necessity, and safe to be: the payload is validated before it
 * reaches the database, unknown products are ignored, the referrer has
 * already been reduced to a hostname by parseProductView, and nothing
 * identifying the visitor is accepted or stored.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const event = parseProductView(payload);
  if (!event) return new NextResponse(null, { status: 400 });

  try {
    const product = await getActiveProvider().getProduct(event.productSlug);
    if (!product) return new NextResponse(null, { status: 404 });
    await recordProductView(event);
  } catch (error) {
    // Carries no exception detail: this is a public endpoint.
    console.error(
      "product view not recorded:",
      error instanceof Error ? error.message : error,
    );
    return new NextResponse(null, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
