import "server-only";

import type { MarketplaceProvider } from "@/lib/api/provider";
import { demoProvider } from "@/lib/api/demo-provider";
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
 * DEMO_MODE is the single switch: on → sample catalog, off → whatever
 * DATA_PROVIDER names. It falls back to "demo" rather than throwing when no
 * live provider is registered, because `isDemoData` derives from the catalog
 * itself — so the UI keeps labelling sample data as sample, and flipping the
 * flag can never make it masquerade as live pricing.
 */
export function getActiveProviderId(): string {
  if (DEMO_MODE) return "demo";
  return process.env.DATA_PROVIDER ?? "demo";
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
  return provider;
}

registerProvider(demoProvider);
