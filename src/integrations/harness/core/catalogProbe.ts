import { setHarnessModels, type AgentModel } from "../../../features/sessions/model/models";
import type { HarnessId } from "../../../features/sessions/model/session";

/** A probe answered successfully but listed no models; the earlier list is kept. */
export class EmptyCatalogProbeError extends Error {
  constructor(readonly harness: HarnessId) {
    super(`${harness} reported no models.`);
    this.name = "EmptyCatalogProbeError";
  }
}

/**
 * Publishes a probed model list. An empty answer is never applied (the last good
 * list stays selectable) and never reported as success: it rejects so the refresh
 * receipt shows the list was not replaced.
 */
export function applyProbedCatalog(harness: HarnessId, models: AgentModel[], live = true): void {
  if (models.length === 0) throw new EmptyCatalogProbeError(harness);
  setHarnessModels(harness, models, live);
}
