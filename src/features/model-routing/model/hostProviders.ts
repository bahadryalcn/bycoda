import type { SetupCatalog } from "./smartSetupCatalog";

/** The providers the bound Host runs, as its own catalog reports them. */
export type HostProviders =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; providers: ReadonlySet<string> };

/**
 * The Host probes exactly its own providers, and each one appears in its catalog as models,
 * an error or a pending probe. Nothing here reads this computer's CLIs.
 */
export function hostProvidersFrom(query: {
  data?: SetupCatalog;
  isPending: boolean;
}): HostProviders {
  const catalog = query.data;
  if (!catalog) return query.isPending ? { status: "loading" } : { status: "failed" };
  return {
    status: "ready",
    providers: new Set([
      ...Object.keys(catalog.models),
      ...Object.keys(catalog.errors ?? {}),
      ...(catalog.pending ?? []),
    ]),
  };
}

/**
 * Provider rows for the limits table: the Host's providers, plus any provider that already
 * holds a saved cap or keep-free share, so a saved value never disappears from view.
 */
export function limitedProviders<T extends string>(
  all: readonly T[],
  hosted: HostProviders | undefined,
  hasSaved: (provider: T) => boolean,
): T[] {
  return all.filter(
    (provider) =>
      (hosted?.status === "ready" && hosted.providers.has(provider)) || hasSaved(provider),
  );
}
