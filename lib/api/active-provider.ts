/**
 * Which provider the app reads from — the fail-closed decision, extracted as
 * a pure function so it has no server-only neighbours and can be imported by
 * scripts/catalog-verify.mjs directly (the marketplace-adapters precedent).
 *
 * Backend §18: "Production must fail closed rather than silently showing demo
 * data." DEMO_MODE off means the operator asked for real data — the registry
 * must then require a named, usable provider and never quietly resolve back
 * to the sample catalog. Both contradiction cases return a reason instead of
 * an id, and the caller decides how loudly to fail.
 */
export type ProviderSelection =
  | { ok: true; id: string }
  | { ok: false; error: string };

export function selectActiveProviderId(
  demoMode: boolean,
  dataProvider: string | undefined,
): ProviderSelection {
  if (demoMode) return { ok: true, id: "demo" };

  const wanted = dataProvider?.trim();
  if (!wanted) {
    return {
      ok: false,
      error:
        "NEXT_PUBLIC_DEMO_MODE=false but DATA_PROVIDER is not set — " +
        "refusing to fall back to the demo catalog.",
    };
  }
  if (wanted === "demo") {
    return {
      ok: false,
      error:
        "DATA_PROVIDER=demo contradicts NEXT_PUBLIC_DEMO_MODE=false — " +
        "refusing to serve sample data as production.",
    };
  }
  return { ok: true, id: wanted };
}
