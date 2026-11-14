import type {
  ModelRoutingEntryStatus,
  ModelRoutingItemChoice,
  ModelRoutingResolution,
  ModelRoutingRole,
  ModelRoutingState,
  ModelRoutingTarget,
} from "../../../src/shared/model/host-contracts/model-routing";

export type ModelRoutingResolveInput = {
  role: ModelRoutingRole;
  choice?: ModelRoutingItemChoice;
  fixed?: ModelRoutingTarget;
  /** The run's project folder; selects its scope so other-scope accounts are skipped. */
  cwd?: string;
  /** In-process feature capability/identity filter; never accepted over RPC. */
  eligible?: (target: ModelRoutingTarget) => boolean;
};

export interface ModelRoutingService {
  get(): Promise<ModelRoutingState>;
  save(
    expectedVersion: number,
    draft: unknown,
    authorize?: () => Promise<void>,
  ): Promise<ModelRoutingState>;
  status(): Promise<ModelRoutingEntryStatus[]>;
  resolve(input: ModelRoutingResolveInput): Promise<ModelRoutingResolution>;
}
