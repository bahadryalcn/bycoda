import { dockAgent, type DockAgent } from "./activityDock";
import type { Block } from "./session";

/**
 * Every subagent of the session, past and running, as dock rows: native
 * subagent blocks of all turns plus delegated child sessions. Running first,
 * then newest first; runs without a start time keep transcript order, latest
 * on top. Background commands are not subagents and are left out.
 */
export function sessionSubagents(
  blocks: readonly Block[],
  busy: boolean,
  delegatedAgents: readonly DockAgent[] = [],
): DockAgent[] {
  const visible = blocks.filter((block) => !block.internal);
  let lastUser = visible.length - 1;
  while (lastUser >= 0 && visible[lastUser].role !== "user") lastUser--;
  // Only the latest turn can still be running; an earlier unfinished call was cut off.
  const native = visible.flatMap((block, index) =>
    dockAgent(block, busy && index > lastUser).filter((agent) => agent.kind === "agent"),
  );
  const seen = new Set<string>();
  const merged = [...native, ...delegatedAgents].filter((agent) => {
    if (seen.has(agent.blockId)) return false;
    seen.add(agent.blockId);
    return true;
  });
  return merged
    .reverse()
    .sort(
      (a, b) =>
        Number(b.status === "running") - Number(a.status === "running") ||
        (b.startedAt ?? 0) - (a.startedAt ?? 0),
    );
}
