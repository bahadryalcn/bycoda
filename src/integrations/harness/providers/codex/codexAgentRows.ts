import type { HarnessEvent } from "../../core/types";

/** The per-row collab bookkeeping a live Codex session keeps. */
export type AgentRowBookkeeping = {
  openAgentRows: Map<string, string>;
  subagentThreads: Map<string, string>;
  terminalChildren: Set<string>;
  childTurns: Map<string, string>;
  agentTitles: Map<string, string>;
  childOutcomes: Map<string, string>;
};

/** Remembers an agent row while it runs, so the turn can close it out. */
export function trackAgentRow(live: AgentRowBookkeeping, event: HarnessEvent): void {
  if (event.type !== "tool.started" && event.type !== "tool.updated") return;
  if (event.kind !== "agent") return;
  if (event.title) live.agentTitles.set(event.callId, event.title);
  if (event.status === "in_progress" || event.status === "pending") {
    live.openAgentRows.set(event.callId, event.title ?? "Subagent");
    return;
  }
  live.openAgentRows.delete(event.callId);
  retireAgentRow(live, event.callId);
}

/** Drops the per-row collab bookkeeping once its row is closed and none of its
 * children is still running, so the maps are bounded by open agent rows. */
function retireAgentRow(live: AgentRowBookkeeping, callId: string): void {
  if (live.openAgentRows.has(callId)) return;
  for (const [threadId, owner] of live.subagentThreads) {
    if (owner === callId && !live.terminalChildren.has(threadId)) return;
  }
  for (const [threadId, owner] of live.subagentThreads) {
    if (owner !== callId) continue;
    live.subagentThreads.delete(threadId);
    live.terminalChildren.delete(threadId);
    live.childTurns.delete(threadId);
  }
  live.agentTitles.delete(callId);
  live.childOutcomes.delete(callId);
}
