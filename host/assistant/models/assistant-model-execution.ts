import type { AssistantRepository } from "../repository";
import type { AssistantModelPoolRole } from "../../../src/shared/model/assistantModelPool";
import type {
  AssistantExecution,
  AssistantProfile,
} from "../../../src/shared/model/host-contracts/assistant";
import { assistantRoleExecution } from "../../../src/shared/model/assistantRoles";
import { resolveModelChoice, type ModelRoutingService } from "../../model-routing/service";

/** Concrete routing target plus the assistant profile execution policy. */
export type AssistantPoolExecution = AssistantExecution & {
  providerAccountId?: string;
};

export type AssistantExecutionChoice =
  | { execution: AssistantPoolExecution; rowId: string; reason: string }
  | { held: "limits"; nextResetAt?: number; reason?: "noEligibleEntry" }
  | { held: "noRow" };

/** `null` means routing is unconfigured: the caller keeps using the profile's own role fields unchanged. */
type SelectedExecution = Extract<AssistantExecutionChoice, { execution: unknown }>;
export type AssistantModelSelector = {
  (
    role: AssistantModelPoolRole,
    profile: AssistantProfile,
    threadId?: string,
  ): Promise<AssistantExecutionChoice | null>;
  rememberThread?: (threadId: string, choice: SelectedExecution) => Promise<void>;
};

/** Raised when no pool row can serve a role right now. Callers keep work queued instead of failing it. */
export class AssistantModelsHeldError extends Error {
  constructor(
    readonly held: "limits" | "noRow",
    readonly nextResetAt?: number,
    readonly reason?: "noEligibleEntry",
  ) {
    super(
      held === "limits"
        ? "No eligible model is available for this assistant role."
        : "No model in the assistant pool serves this role.",
    );
    this.name = "AssistantModelsHeldError";
  }
}

export function createAssistantModelSelector(deps: {
  routing: () => ModelRoutingService;
  repository?: Pick<AssistantRepository, "get" | "put">;
}): AssistantModelSelector {
  const selector: AssistantModelSelector = async (role, profile, threadId) => {
    if (threadId) {
      const saved = await deps.repository?.get<{ value: SelectedExecution }>(
        "runtime",
        `model-thread:${threadId}`,
      );
      // A pre-routing thread keeps its profile identity; never resolve a live provider thread.
      return saved?.value ?? null;
    }
    const resolution = await resolveModelChoice(deps.routing(), { role: `assistant.${role}` });
    if (!resolution.ok) {
      if (resolution.reason === "notConfigured") return null;
      return { held: "limits", nextResetAt: resolution.nextResetAt, reason: "noEligibleEntry" };
    }
    const policy = role === "worker" ? profile.execution : assistantRoleExecution(profile, role);
    // Routing chooses identity, never execution authority or the profile's run deadline.
    if (!policy) return { held: "noRow" };
    return {
      execution: {
        ...resolution.target,
        runtimeMode: policy.runtimeMode,
        maxRunMinutes: policy.maxRunMinutes,
      },
      rowId: resolution.source.kind === "fixed" ? "fixed" : resolution.source.entryId,
      reason: resolution.skipped.length
        ? `skipped:${resolution.skipped.map((entry) => entry.entryId).join(",")}`
        : "first",
    };
  };
  selector.rememberThread = async (threadId, choice) => {
    if (!deps.repository) return;
    const id = `model-thread:${threadId}`;
    const old = await deps.repository.get<{ value: SelectedExecution }>("runtime", id);
    if (old) return;
    const now = Date.now();
    await deps.repository.put("runtime", {
      id,
      version: 0,
      createdAt: now,
      updatedAt: now,
      value: choice,
    });
  };
  return selector;
}

/** Resolve a role to an execution, throwing the typed hold error when nothing is usable. */
export async function chooseAssistantExecution(
  selector: AssistantModelSelector | undefined,
  role: AssistantModelPoolRole,
  profile: AssistantProfile,
  threadId?: string,
): Promise<Extract<AssistantExecutionChoice, { execution: unknown }> | null> {
  const choice = await selector?.(role, profile, threadId);
  if (!choice) return null;
  if ("held" in choice)
    throw new AssistantModelsHeldError(
      choice.held,
      (choice as { nextResetAt?: number }).nextResetAt,
      "reason" in choice ? choice.reason : undefined,
    );
  return choice;
}
