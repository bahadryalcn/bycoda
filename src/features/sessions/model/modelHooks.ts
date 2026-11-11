import { useMemo, useSyncExternalStore } from "react";
import {
  findModelIdentity,
  getModelSnapshot,
  hasLiveCatalog,
  modelsFor,
  subscribeModels,
  type AgentModel,
} from "./models";

/**
 * The catalog readers for render. The returned object is new whenever the catalog
 * changes, so a render that reads through it recomputes then and only then.
 */
export function useModelCatalog() {
  const version = useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  return useMemo(() => ({ version, hasLiveCatalog, modelsFor }), [version]);
}

/** `findModelIdentity` for render: re-renders the caller when the model catalog changes. */
export function useModelIdentity(id: string | undefined): AgentModel | undefined {
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  return id ? findModelIdentity(id) : undefined;
}
