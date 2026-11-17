import { invokeProviderCommand } from "./child";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
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

/** The owner's notice for a fallback: the guidance above addresses the model, this the owner.
 * It names the cause and that the next message after the Host answers recovers on its own. */
export function delegationNotice(guidance: string) {
  if (guidance === ADVISOR_LOST)
    return "The advisor is off for this message because bycoda Host is not responding.";
  return guidance.includes("use your built-in subagents")
    ? "bycoda Host is not responding, so this message uses the provider's built-in subagents. Host subagents return once it responds."
    : "Subagents are off for this message because bycoda Host is not responding. They return once it responds.";
}

/** One bridge question within five seconds; a hung or failed backend answers false. */
async function askBridge(
  args: Record<string, unknown>,
  read: (answer: Record<string, unknown> | null) => boolean,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invokeProviderCommand<Record<string, unknown> | null>(
        "harness_conversation_tools_bridge",
        args,
      ).then(read),
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

/** Prepare an upcoming spawn when absent; probe an existing process without issuing grants. */
export function conversationDelegationReady(sessionId: string): Promise<boolean> {
  return askBridge(
    { sessionId, checkReady: true, prepareSpawn: true },
    (answer) => answer?.ready === true,
  );
}

/** A failed respawn (the Host refuses this conversation) must not restart the provider every turn. */
const RESPAWN_COOLDOWN_MS = 10 * 60_000;
const respawnedAt = new Map<string, number>();

/** Whether the running provider lost its Host tools (it started while the Host did not answer,
 * or the Host restarted since) and the Host answers again: starting it again restores them. */
export async function delegationNeedsRespawn(sessionId: string): Promise<boolean> {
  const last = respawnedAt.get(sessionId);
  if (last !== undefined && elapsedSince(last) < RESPAWN_COOLDOWN_MS) return false;
  if (!(await askBridge({ sessionId, checkRespawn: true }, (answer) => answer?.respawn === true)))
    return false;
  respawnedAt.set(sessionId, monotonicNow());
  return true;
}

/** Test seam. */
export function resetDelegationRespawns(): void {
  respawnedAt.clear();
}
