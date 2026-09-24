import type { Store } from "@/lib/types";

export const isDemoData = true;

export const stores: Store[] = [
  { id: "tiktok", name: "TikTok Shop", color: "#111111", short: "♪" },
  { id: "lazada", name: "Lazada", color: "#F85606", short: "L" },
  { id: "shopee", name: "Shopee", color: "#EE4D2D", short: "S" },
  { id: "abensons", name: "Abenson", color: "#111827", short: "a" },
  { id: "sm", name: "SM Store", color: "#0030FF", short: "SM" },
];

export const storeMap: Record<string, Store> = Object.fromEntries(
  stores.map((store) => [store.id, store]),
);

export function getStore(id: string): Store {
  return storeMap[id] ?? { id, name: id, color: "#667085", short: id.slice(0, 2).toUpperCase() };
}
