import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";
import type { RemoteRailSession } from "../../features/connections/model/remoteRailSessions";
import { pathKey } from "../../shared/lib/paths";
import type { HostSessionSummary } from "../../features/connections/model/protocol";
import { parseRemotePath, remotePath } from "../../features/connections/model/remoteProjects";
import {
  isUserConversation,
  sessionDelegationParent,
} from "../../shared/model/host-contracts/delegation";

export function projectSessionCollection(
  remote: boolean,
  remoteSessions: readonly HostSessionSummary[],
  sessions: SessionSummary[],
  cwd: string,
): SessionSummary[] {
  return remote
    ? remoteSessions.filter(isUserConversation).map((session) => remoteSessionSummary(session, cwd))
    : sessions.filter(isUserConversation);
}

export function remoteSessionSummary(session: HostSessionSummary, cwd: string): SessionSummary {
  const project = parseRemotePath(cwd);
  const checkout = session.worktreeCwd || (project ? session.cwd : undefined);
  return {
    id: session.id,
    delegationParent: sessionDelegationParent(session) ?? null,
    cwd,
    harness: session.harness,
    providerHistory: session.providerHistory,
    managedBy: session.managedBy,
    model: session.model ?? "",
    runtimeMode: session.runtimeMode ?? "supervised",
    providerSessionId: session.providerSessionId ?? undefined,
    title: session.title,
    createdAt: session.createdAt ?? session.updatedAt,
    updatedAt: session.updatedAt,
    lastActivityAt: session.lastActivityAt,
    interrupted: session.status === "interrupted",
    archived: session.archived,
    issue: session.issue,
    pinned: session.pinned,
    linkedWorkItem: session.linkedWorkItem,
    draft: session.draft,
    repo: session.repo,
    branch: session.branch,
    worktreeCwd:
      project && checkout && !parseRemotePath(checkout)
        ? remotePath(project.environmentId, checkout)
        : checkout,
  };
}

/** Open conversations that saved folders may surface; delegated children stay in their parent. */
export function folderCandidates(remote: boolean, open: readonly SessionSummary[]) {
  return remote ? [] : open.filter(isUserConversation);
}

export function freshRemoteProjects(rows: readonly Pick<RemoteRailSession, "project" | "fresh">[]) {
  const projects = new Set<string>();
  for (const row of rows) {
    if (row.fresh) projects.add(row.project);
  }
  return projects;
}

/** A live desktop tab and its Host alias both refer to work in that tab's project. */
export function workingAgentIdsByProject(
  agents: readonly Pick<LiveAgent, "id" | "cwd" | "done" | "needsApproval">[],
  sessionFor: (shellId: string) => string | undefined,
) {
  const byProject = new Map<string, Set<string>>();
  for (const agent of agents) {
    if (agent.done || agent.needsApproval) continue;
    const key = pathKey(agent.cwd);
    const ids = byProject.get(key) ?? new Set<string>();
    ids.add(agent.id);
    const hostId = sessionFor(agent.id);
    if (hostId !== undefined) ids.add(hostId);
    byProject.set(key, ids);
  }
  return byProject;
}

export function sessionsForActionIds(rows: readonly SessionSummary[], ids: readonly string[]) {
  if (ids.length === 0) return [];
  if (ids.length === 1) {
    const row = rows.find((entry) => entry.id === ids[0]);
    return row ? [row] : [];
  }
  // Preserve the first listed record and the menu's selection order for a batch action.
  const firstById = new Map<string, SessionSummary>();
  for (const row of rows) {
    if (!firstById.has(row.id)) firstById.set(row.id, row);
  }
  return ids.flatMap((id) => {
    const row = firstById.get(id);
    return row ? [row] : [];
  });
}
