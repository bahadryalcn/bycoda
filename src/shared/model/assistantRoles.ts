import type { AssistantExecution, AssistantProfile } from "./host-contracts/assistant";

export type AssistantExecutionRole = "chief" | "reply" | "planning";
export const ASSISTANT_ROLE_FIELDS = {
  chief: "chiefExecution",
  reply: "replyExecution",
  planning: "planningExecution",
} as const;

/** Optional roles inherit the saved worker selection. No model, account or
 * permission defaults are synthesized here; callers retain their own authority. */
export function assistantRoleExecution(
  profile: Partial<
    Pick<AssistantProfile, "execution" | "chiefExecution" | "replyExecution" | "planningExecution">
  >,
  role: AssistantExecutionRole,
): AssistantExecution | null {
  const selected = profile[ASSISTANT_ROLE_FIELDS[role]] ?? profile.execution;
  return selected ? { ...selected, modelSettings: { ...selected.modelSettings } } : null;
}

/** Utility contexts bind to the actual selected role before fingerprints and
 * provider thread persistence. This does not grant a runtime mode or tools. */
export function assistantRoleProfile(
  profile: AssistantProfile,
  role: AssistantExecutionRole,
): AssistantProfile {
  return { ...profile, execution: assistantRoleExecution(profile, role) };
}
