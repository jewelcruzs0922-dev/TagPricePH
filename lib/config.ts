/**
 * Intended data mode for the app.
 *
 * NEXT_PUBLIC_DEMO_MODE=false is the switch that will select live providers
 * once authorized data sources exist (provider registry). It is deliberately
 * NOT what drives the UI banners — those read the catalog's real data source,
 * so a flag can never make demo seed data present itself as live pricing.
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
