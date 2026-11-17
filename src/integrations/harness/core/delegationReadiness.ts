import { invokeProviderCommand } from "./child";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
  decodeAdvisor,
  nativeAdvisor,
} from "../../../shared/model/host-contracts/delegation";

type Settings = Readonly<Record<string, string>> | undefined;

/** An advisor the Host runs as a child session; Claude Code's own advisor needs no bridge. */
function hostAdvisor(harness: string | undefined, settings: Settings): boolean {
  return !!decodeAdvisor(settings?.[CROSS_ADVISOR_KEY]) && !nativeAdvisor(harness, settings);
}

/** Whether the turn relies on the Host bridge: subagent bounds or a Host advisor. */
export function needsHostDelegation(harness: string | undefined, settings: Settings): boolean {
  return (
    !!settings?.[CROSS_SUBAGENTS_KEY] ||
    !!settings?.[CROSS_SUBAGENT_MAX_EFFORT_KEY] ||
    hostAdvisor(harness, settings)
  );
}

const ADVISOR_LOST = "Your advisor is unavailable this turn; do not call agents.consult.";

export function delegationFallback(settings: Settings, ready: boolean, harness?: string) {
  if (ready) return "";
  const advisor = hostAdvisor(harness, settings) ? ADVISOR_LOST : "";
  const selection = settings?.[CROSS_SUBAGENTS_KEY];
  if (
    selection === "" ||
    // Explicit Off has no delegation to lose, so there is nothing to tell.
    selection === "[]" ||
    (selection === undefined && !settings?.[CROSS_SUBAGENT_MAX_EFFORT_KEY])
  )
    return advisor;
  const subagents =
    selection === "auto" && !settings?.[CROSS_SUBAGENT_MAX_EFFORT_KEY]
      ? "Host delegation is unavailable this turn; use your built-in subagents."
      : "Host delegation is unavailable this turn; subagents must remain within the owner's selected models and effort ceiling. Do not use unrestricted built-in subagents.";
  return advisor ? `${subagents} ${advisor}` : subagents;
}

/** The owner's notice for a fallback: the guidance above addresses the model, this the owner. */
export function delegationNotice(guidance: string) {
  if (guidance === ADVISOR_LOST)
    return "The advisor is unavailable this turn because the Host connection is not ready.";
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
