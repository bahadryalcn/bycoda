import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { HostSessionSummary } from "../../features/connections/model/protocol";
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
    ? remoteSessions.filter(isUserConversation).map((session) => ({
        id: session.id,
        delegationParent: sessionDelegationParent(session) ?? null,
        cwd,
        harness: session.harness,
        providerHistory: session.providerHistory,
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
        worktreeCwd: session.worktreeCwd,
      }))
    : sessions.filter(isUserConversation);
}

/** Open conversations that saved folders may surface; delegated children stay in their parent. */
export function folderCandidates(remote: boolean, open: readonly SessionSummary[]) {
  return remote ? [] : open.filter(isUserConversation);
}
