import "server-only";

import type { MarketplaceProvider } from "@/lib/api/provider";
import { selectActiveProviderId } from "@/lib/api/active-provider";
import {
  assertUsableProvider,
  lazadaProvider,
  shopeeProvider,
  tiktokShopProvider,
} from "@/lib/api/marketplace-adapters";
import { demoProvider } from "@/lib/api/demo-provider";
import { dbProvider } from "@/lib/api/db-provider";
import { DEMO_MODE } from "@/lib/config";

const providers = new Map<string, MarketplaceProvider>();

export function registerProvider(provider: MarketplaceProvider): void {
  providers.set(provider.id, provider);
}

export function getRegisteredProviderIds(): string[] {
  return Array.from(providers.keys());
}

export function getProvider(id: string): MarketplaceProvider | undefined {
  return providers.get(id);
}

/**
 * Which provider the app reads from.
 *
 * The decision itself lives in selectActiveProviderId (lib/api/active-provider.ts)
 * so it can be unit-tested without server-only neighbours. DEMO_MODE on →
 * sample catalog; off → DATA_PROVIDER must name a usable provider, and both
 * contradiction cases (unset, or explicitly "demo") throw instead of falling
 * back — backend §18: production fails closed rather than silently showing
 * demo data.
 */
export function getActiveProviderId(): string {
  const selection = selectActiveProviderId(DEMO_MODE, process.env.DATA_PROVIDER);
  if (!selection.ok) throw new Error(selection.error);
  return selection.id;
}

export function getActiveProvider(): MarketplaceProvider {
  const id = getActiveProviderId();
  const provider = providers.get(id);
  if (!provider) {
    const available = getRegisteredProviderIds().join(", ") || "none";
    throw new Error(
      `No marketplace provider registered for "${id}". Registered: ${available}.`,
    );
  }
  // A marketplace adapter that cannot be read yet must fail the operator's
  // configuration loudly at build time, not serve an empty catalog at runtime.
  assertUsableProvider(provider);
  return provider;
}

/**
 * Whether a registered provider can serve reads right now, and why not.
 *
 * The registry is the only sanctioned place outside the adapters themselves
 * to ask that question (Phase 8: nothing outside lib/api touches
 * marketplace-specific code) — admin surfaces probe through here.
 */
export function probeProvider(id: string): { usable: boolean; reason: string | null } {
  const provider = providers.get(id);
  if (!provider) return { usable: false, reason: "not registered" };
  try {
    assertUsableProvider(provider);
    return { usable: true, reason: null };
  } catch (error) {
    return {
      usable: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

registerProvider(demoProvider);

// The database read model (DATA_PROVIDER=db): serves what adapters write,
// refuses to be selected as an ingest *source* by id in providerRefusal.
registerProvider(dbProvider);

// Registered so each marketplace can be enabled independently later, and so a
// misconfigured DATA_PROVIDER fails with the reason instead of an unknown-id
// error. They are never selectable: assertUsableProvider refuses them above.
registerProvider(shopeeProvider);
registerProvider(lazadaProvider);
registerProvider(tiktokShopProvider);
