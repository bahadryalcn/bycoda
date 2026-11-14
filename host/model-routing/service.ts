import type {
  ModelRoutingDraft,
  ModelRoutingResolution,
} from "../../src/shared/model/host-contracts/model-routing";
import type { HostProviderAccountCatalog } from "../providers/provider-accounts";
import {
  modelRoutingEntryStatus,
  selectModelRouting,
  type ModelRoutingResolveInput,
  type ModelRoutingSignals,
} from "./selector";
import { readModelRouting, saveModelRouting, type ModelRoutingStore } from "./storage";
import { validateModelRoutingDraft, type ModelRoutingCatalog } from "./validation";

export interface ModelRoutingPorts {
  store: ModelRoutingStore;
  accounts(): Promise<HostProviderAccountCatalog>;
  catalog(): Promise<ModelRoutingCatalog | undefined>;
  signals(state: ModelRoutingDraft): Promise<ModelRoutingSignals>;
  now?: () => number;
}
import type { ModelRoutingService } from "../domains/model-routing/ports";
export type { ModelRoutingService } from "../domains/model-routing/ports";
export function createModelRoutingService(ports: ModelRoutingPorts): ModelRoutingService {
  return {
    get: () => readModelRouting(ports.store),
    async save(expectedVersion, raw, authorize) {
      const [accounts, catalog] = await Promise.all([ports.accounts(), ports.catalog()]);
      const draft = validateModelRoutingDraft(raw, accounts, catalog);
      return saveModelRouting(
        ports.store,
        draft,
        expectedVersion,
        (ports.now ?? Date.now)(),
        authorize,
      );
    },
    async status() {
      const state = await readModelRouting(ports.store);
      const signals = await ports.signals(state);
      return state.entries.map((entry) => modelRoutingEntryStatus(entry, signals));
    },
    async resolve(input) {
      const state = await readModelRouting(ports.store);
      // Fixed choices bypass availability and quota, including signal I/O.
      const choice =
        !input.choice || input.choice.kind === "default" ? state.roles[input.role] : input.choice;
      const signals =
        choice?.kind === "fixed"
          ? {
              available: () => true,
              signedIn: () => true,
              quota: () => ({ unknown: true as const }),
              accountKind: () => undefined,
            }
          : await ports.signals(state);
      return selectModelRouting(state, input, signals);
    },
  };
}

/** Run-start API: an item with a stored target and no choice predates routing and stays fixed.
 * Role-only calls omit fixed; an explicit default always follows the role. */
export function resolveModelChoice(
  service: ModelRoutingService,
  input: ModelRoutingResolveInput,
): Promise<ModelRoutingResolution> {
  return service.resolve({
    ...input,
    choice: input.choice ?? (input.fixed ? { kind: "fixed" } : undefined),
  });
}
