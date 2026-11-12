import { useMemo, useSyncExternalStore } from "react";
import type { HarnessId } from "./session";
import {
  findModelIdentity,
  getModelSnapshot,
  hasLiveCatalog,
  modelsFor,
  modelResolutionCatalog,
  subscribeModels,
  type AgentModel,
} from "./models";

/**
 * The catalog readers for render. The returned object is new whenever the catalog
 * changes, so a render that reads through it recomputes then and only then.
 * Pass a harness to include its pure model-resolution snapshot.
 */
export function useModelCatalog(harness?: HarnessId) {
  const version = useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  return useMemo(
    () => ({
      version,
      hasLiveCatalog,
      modelsFor,
      resolution: harness ? modelResolutionCatalog(harness) : undefined,
    }),
    [version, harness],
  );
}

/** `findModelIdentity` for render: re-renders the caller when the model catalog changes. */
export function useModelIdentity(id: string | undefined): AgentModel | undefined {
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  return id ? findModelIdentity(id) : undefined;
}
