import { invokeProviderCommand } from "./child";
import {
  CROSS_SUBAGENTS_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
} from "../../../shared/model/host-contracts/delegation";

export function delegationFallback(settings: Record<string, string> | undefined, ready: boolean) {
  const selection = settings?.[CROSS_SUBAGENTS_KEY];
  if (
    ready ||
    selection === "" ||
    // Explicit Off has no delegation to lose, so there is nothing to tell.
    selection === "[]" ||
    (selection === undefined && !settings?.[CROSS_SUBAGENT_MAX_EFFORT_KEY])
  )
    return "";
  return selection === "auto" && !settings?.[CROSS_SUBAGENT_MAX_EFFORT_KEY]
    ? "Host delegation is unavailable this turn; use your built-in subagents."
    : "Host delegation is unavailable this turn; subagents must remain within the owner's selected models and effort ceiling. Do not use unrestricted built-in subagents.";
}

/** The owner's notice for a fallback: the guidance above addresses the model, this the owner. */
export function delegationNotice(guidance: string) {
  return guidance.includes("use your built-in subagents")
    ? "Host subagents are unavailable this turn; the model uses its built-in subagents instead."
    : "Host subagents are unavailable this turn; the model may not start subagents outside your selected models and effort limit.";
}

/** Prepare an upcoming spawn when absent; probe an existing process without issuing grants. */
export async function conversationDelegationReady(sessionId: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invokeProviderCommand<{ ready?: boolean } | null>("harness_conversation_tools_bridge", {
        sessionId,
        checkReady: true,
        prepareSpawn: true,
      }).then((answer) => answer?.ready === true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 5000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
