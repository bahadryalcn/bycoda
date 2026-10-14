import { projectDisplayName } from "../../features/projects/model/projectNames";
import { pathKey } from "../../shared/lib/paths";
import { HARNESS_TITLE } from "../../features/sessions/model/session";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { LiveSessionInfo } from "../../features/sessions/model/recentSessions";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";

export type TraySession = {
  id: string;
  key: string;
  label: string;
  status: "working" | "input" | "done" | "active" | "retrying" | "failed";
  updatedAt: number;
  owned: boolean;
};

// Bound each part separately so a long title never hides the project or agent.
function menuText(value: string, limit: number): string {
  const chars = [...value.replace(/\s+/g, " ").trim()];
  return chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : chars.join("");
}

/** Idle history is Active, not Done: a saved transcript does not prove success. */
export function traySessions({
  stored,
  live,
  agents,
  projectKeys,
  ownedKeys,
}: {
  stored: readonly SessionSummary[];
  live: readonly LiveSessionInfo[];
  agents: readonly LiveAgent[];
  projectKeys: ReadonlySet<string>;
  ownedKeys: Record<string, string>;
}): TraySession[] {
  const rows = new Map<string, TraySession>();
  const add = (
    row: Pick<LiveSessionInfo, "id" | "cwd" | "title" | "harness">,
    status: TraySession["status"],
    updatedAt: number,
  ) => {
    if (!projectKeys.has(pathKey(row.cwd))) return;
    const provider = HARNESS_TITLE[row.harness];
    const title = menuText(row.title ?? "", 48) || provider;
    const project = menuText(projectDisplayName(row.cwd), 24);
    rows.set(row.id, {
      id: row.id,
      key: ownedKeys[row.id] ?? row.id,
      status,
      updatedAt: Math.max(updatedAt, rows.get(row.id)?.updatedAt ?? 0),
      owned: Boolean(ownedKeys[row.id]),
      label: `${title} — ${project}${title === provider ? "" : ` · ${provider}`}`,
    });
  };
  for (const row of stored) {
    if (row.archived || row.draft || row.orchestrationLeadId) continue;
    add(row, "active", row.updatedAt);
  }
  for (const row of live) add(row, row.status ?? "active", row.activityAt);
  const liveById = new Map(live.map((row) => [row.id, row]));
  for (const agent of agents) {
    // Cached remote history deliberately clears its live status. Do not let
    // the rail's older working summary turn it into a current run again.
    if (
      !ownedKeys[agent.id] &&
      !agent.done &&
      liveById.has(agent.id) &&
      !liveById.get(agent.id)?.status
    )
      continue;
    add(
      agent,
      agent.issue ?? (agent.needsApproval ? "input" : agent.done ? "done" : "working"),
      agent.startedAt ?? 0,
    );
  }
  return [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
