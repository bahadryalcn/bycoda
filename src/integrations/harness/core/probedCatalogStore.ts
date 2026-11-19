import type { AgentModel } from "../../../shared/model/agentModel";
import type { HarnessId } from "../../../shared/model/harnessIdentity";

type Catalog = [harness: HarnessId, models: AgentModel[], live: boolean];
const pending = new Map<HarnessId, Catalog>();
let consumeCatalog: ((...catalog: Catalog) => void) | undefined;

export function publishProbedCatalog(...catalog: Catalog): void {
  if (consumeCatalog) consumeCatalog(...catalog);
  else pending.set(catalog[0], catalog);
}

/** Attach the session catalog and replay probes completed before it loaded. */
export function attachProbedCatalogConsumer(consume: (...catalog: Catalog) => void): void {
  consumeCatalog = consume;
  for (const catalog of pending.values()) consume(...catalog);
  pending.clear();
}
