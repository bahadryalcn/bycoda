import {
  ASSISTANT_MODEL_POOL_ROLES,
  type AssistantModelPoolResponse,
} from "../../../src/shared/model/assistantModelPool";
import type { AssistantProfile } from "../../../src/shared/model/host-contracts/assistant";
import type { ModelRoutingService } from "../../model-routing/service";

/** Live runtime pool projection. Identity and limits belong to the Host-wide main order. */
export async function getAssistantModelPool(deps: {
  routing: Pick<ModelRoutingService, "get">;
  profile: () => Promise<AssistantProfile>;
}): Promise<AssistantModelPoolResponse> {
  const [state, profile] = await Promise.all([deps.routing.get(), deps.profile()]);
  return {
    version: state.version,
    updatedAt: state.updatedAt,
    derived: false,
    rows: state.entries.map((entry) => ({
      ...entry,
      roles: [...ASSISTANT_MODEL_POOL_ROLES],
      runtimeMode: profile.execution?.runtimeMode ?? "supervised",
      maxRunMinutes: profile.execution?.maxRunMinutes ?? 60,
    })),
  };
}

export async function assistantModelPoolOp(
  _input: { op: "models.pool.get" },
  _principal: string,
  deps: Parameters<typeof getAssistantModelPool>[0],
): Promise<{ modelPool: AssistantModelPoolResponse }> {
  return { modelPool: await getAssistantModelPool(deps) };
}
