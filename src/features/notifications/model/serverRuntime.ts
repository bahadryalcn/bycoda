import type { ServerReportEvent } from "./serverPort";
import type { ServerSync } from "./serverSync";

/**
 * The sync of the signed-in account, or null. Signed out (or no account service bound) nothing is
 * active, so reporting is a synchronous no-op with no network.
 */
let active: ServerSync | null = null;

export function activateServerSync(sync: ServerSync | null): void {
  active = sync;
}

export function activeServerSync(): ServerSync | null {
  return active;
}

export type AgentEventKind = "finished" | "failed" | "input";
const EVENT_OF: Record<AgentEventKind, ServerReportEvent> = {
  finished: "agent.finished",
  failed: "agent.failed",
  input: "approval.pending",
};

/** A stable key that reveals nothing about the session: a hash of the local turn identity. */
export async function reportDedupeKey(parts: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(parts.join("\u0000"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Reports an agent event to the account so the phone can be notified. Does nothing unless the user
 * is signed in and turned push on for this event. `identity` is local (session and turn ids); only
 * its hash leaves the computer.
 */
export function reportAgentEvent(
  kind: AgentEventKind,
  identity: readonly string[],
  occurredAt: number = Date.now(),
): void {
  const sync = active;
  if (!sync) return;
  reportDedupeKey([kind, ...identity])
    .then((key) => sync.report(EVENT_OF[kind], key, occurredAt))
    .catch(() => undefined); // -- the phone copy is best effort; the desktop already notified.
}
