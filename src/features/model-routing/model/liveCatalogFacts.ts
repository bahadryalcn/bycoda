import { invoke } from "@tauri-apps/api/core";
import { withTimeout } from "../../../shared/lib/withTimeout";
import {
  HOST_MODEL_ROUTING,
  ModelRoutingCatalogFactsResultSchema,
  type ModelCatalogFact,
} from "../../../shared/model/host-contracts/model-routing";
import { machineCapabilities } from "../../automations/public/hostMachines";
import { remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";

/**
 * Live prices and Artificial Analysis scores the Host fetched from OpenRouter (the renderer CSP
 * blocks the network). Empty until the first refresh lands; callers then use the researched
 * table alone.
 */
let facts: ReadonlyMap<string, ModelCatalogFact> = new Map();
const listeners = new Set<() => void>();

export const liveCatalogFacts = {
  /** Stable between changes, so it can back `useSyncExternalStore`. */
  snapshot: () => facts,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function setLiveCatalogFacts(models: readonly ModelCatalogFact[]): void {
  facts = new Map(models.map((model) => [model.family, model]));
  for (const listener of listeners) listener();
}

export function liveFactsFor(family: string): ModelCatalogFact | undefined {
  return facts.get(family);
}

let inflight: Promise<void> | undefined;

/**
 * Asks one Host for the live list. Never rejects: an old Host without the method, a failed
 * refresh or an empty answer leaves whatever is already loaded.
 */
export function refreshLiveCatalogFacts(machineId: string): Promise<void> {
  inflight ??= (async () => {
    try {
      const result = ModelRoutingCatalogFactsResultSchema.parse(
        await remoteRequest(machineId, "modelRouting.catalogFacts", {}),
      );
      if (result.models.length) setLiveCatalogFacts(result.models);
    } catch {
      // Prices and scores are an upgrade; the researched table keeps smart setup working.
    }
  })().finally(() => {
    inflight = undefined;
  });
  return inflight;
}

/** The local Host, when it carries model routing; undefined otherwise. */
async function localRoutingMachine(): Promise<RemoteMachine | undefined> {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const machine = machines?.find(isLocalSyncMachine);
  if (!machine || !(await machineCapabilities(machine)).includes(HOST_MODEL_ROUTING)) return;
  return machine;
}

/** Refreshes from the local Host; resolves after at most `maxWaitMs`, never rejects. */
export async function refreshLocalLiveCatalogFacts(maxWaitMs = 3000): Promise<void> {
  try {
    await withTimeout(
      localRoutingMachine().then((machine) =>
        machine ? refreshLiveCatalogFacts(machine.id) : undefined,
      ),
      maxWaitMs,
      "Live catalog facts",
    );
  } catch {
    // Continue with whatever is already loaded.
  }
}
