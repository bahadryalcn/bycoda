import type { AssistantModelPoolRole } from "../../../src/shared/model/assistantModelPool";
import type {
  AssistantExecution,
  AssistantProfile,
} from "../../../src/shared/model/host-contracts/assistant";
import type { AssistantRepository } from "../repository";
import { getAssistantModelPool } from "./assistant-model-pool";
import { selectPoolRow } from "./assistant-model-selector";
import type { AssistantQuotaReader } from "./assistant-quota-reader";

/** Execution chosen from the pool; `providerAccountId` is omitted for the default account. */
export type AssistantPoolExecution = AssistantExecution & {
  providerAccountId?: string;
};

export type AssistantExecutionChoice =
  | { execution: AssistantPoolExecution; rowId: string; reason: string }
  | { held: "limits"; nextResetAt?: number }
  | { held: "noRow" };

/** `null` means no pool was saved: the caller keeps using the profile's own role fields unchanged. */
export type AssistantModelSelector = (
  role: AssistantModelPoolRole,
  profile: AssistantProfile,
) => Promise<AssistantExecutionChoice | null>;

/** Raised when no pool row can serve a role right now. Callers keep work queued instead of failing it. */
export class AssistantModelsHeldError extends Error {
  constructor(
    readonly held: "limits" | "noRow",
    readonly nextResetAt?: number,
  ) {
    super(
      held === "limits"
        ? "Every model in the assistant pool is below its remaining-limit threshold."
        : "No model in the assistant pool serves this role.",
    );
    this.name = "AssistantModelsHeldError";
  }
}

export function createAssistantModelSelector(deps: {
  repository: Pick<AssistantRepository, "get" | "put">;
  quota: Pick<AssistantQuotaReader, "reading">;
  now?: () => number;
}): AssistantModelSelector {
  return async (role, profile) => {
    const pool = await getAssistantModelPool({
      repository: deps.repository,
      profile: async () => profile,
      now: deps.now ?? Date.now,
    });
    if (pool.derived) return null;
    const picked = selectPoolRow(role, pool, (row) =>
      deps.quota.reading(row.harness, row.providerAccountId, row.model),
    );
    if (!picked.row)
      return picked.reason === "noRowForRole"
        ? { held: "noRow" }
        : {
            held: "limits",
            ...(picked.nextResetAt === undefined ? {} : { nextResetAt: picked.nextResetAt }),
          };
    const { row } = picked;
    return {
      execution: {
        harness: row.harness,
        model: row.model,
        modelSettings: { ...row.modelSettings },
        runtimeMode: row.runtimeMode,
        maxRunMinutes: row.maxRunMinutes,
        ...(row.providerAccountId && row.providerAccountId !== "default"
          ? { providerAccountId: row.providerAccountId }
          : {}),
      },
      rowId: row.id,
      reason: picked.reason,
    };
  };
}

/** Resolve a role to an execution, throwing the typed hold error when nothing is usable. */
export async function chooseAssistantExecution(
  selector: AssistantModelSelector | undefined,
  role: AssistantModelPoolRole,
  profile: AssistantProfile,
): Promise<Extract<AssistantExecutionChoice, { execution: unknown }> | null> {
  const choice = await selector?.(role, profile);
  if (!choice) return null;
  if ("held" in choice)
    throw new AssistantModelsHeldError(
      choice.held,
      (choice as { nextResetAt?: number }).nextResetAt,
    );
  return choice;
}
