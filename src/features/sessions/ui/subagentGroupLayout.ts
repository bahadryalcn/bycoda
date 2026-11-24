import type { DockAgentStatus } from "../model/activityDock";

/** Up to this many delegated runs of one turn show as cards; more show as aligned rows. */
export const SUBAGENT_CARD_LIMIT = 3;

export type SubagentGroupLayout = "row" | "cards" | "list";

/** One run keeps its own row; two or three are cards; more are aligned rows under a counter. */
export function subagentGroupLayout(count: number): SubagentGroupLayout {
  if (count <= 1) return "row";
  return count > SUBAGENT_CARD_LIMIT ? "list" : "cards";
}

/** The header counter of the row list: how many runs finished, and how many of those that ended did not succeed. */
export function subagentGroupProgress(statuses: readonly DockAgentStatus[]): {
  done: number;
  failed: number;
  total: number;
} {
  return {
    done: statuses.filter((status) => status === "done").length,
    failed: statuses.filter((status) => status === "failed").length,
    total: statuses.length,
  };
}
