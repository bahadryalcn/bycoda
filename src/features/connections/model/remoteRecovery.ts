import {
  classifyTurnRecovery,
  shouldAutoContinue,
  type TurnRecovery,
} from "../../sessions/model/turnRecovery";
import type { HostSession } from "./protocol";

/**
 * What became of the turn a host conversation was running, from what the host
 * reports. This is the same decision local chats make at launch
 * (`classifyTurnRecovery`), with the host's own word in place of a process and
 * a transcript to inspect: `running` means the turn is alive, `interrupted`
 * means the host recorded that it died (restart, stop, storage failure), and
 * `idle` means it ended.
 */
export function remoteTurnRecovery(status: HostSession["status"]): TurnRecovery {
  return classifyTurnRecovery({
    wasInFlight: status !== "idle",
    liveness: status === "running" ? "alive" : "dead",
    backgroundWorkAlive: false,
    // The host settles a turn it lost as `interrupted` itself, so it is certain.
    transcript: status === "interrupted" ? "open" : "unsupported",
  });
}

/** An interrupted host turn the user can continue. Needs a provider thread to continue. */
export function remoteTurnInterrupted(input: {
  status?: HostSession["status"];
  providerSessionId?: string;
  busy: boolean;
}): boolean {
  return input.status === "interrupted" && !!input.providerSessionId && !input.busy;
}

/**
 * Whether to send "Continue" on the user's behalf. Only for a turn this app saw
 * running (`watchedRunId` is that run): a conversation that merely sits at an
 * interrupted turn in history is the user's to continue, as a local chat
 * opened later is. The setting and the queue rule are the local ones.
 */
export function shouldAutoContinueRemote(input: {
  status: HostSession["status"];
  runId?: string;
  watchedRunId?: string;
  providerSessionId?: string;
  enabled: boolean;
  queuedCount: number;
}): boolean {
  if (!input.providerSessionId || !input.runId || input.watchedRunId !== input.runId) {
    return false;
  }
  return shouldAutoContinue({
    recovery: remoteTurnRecovery(input.status),
    enabled: input.enabled,
    queuedCount: input.queuedCount,
  });
}
