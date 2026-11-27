import { pathKey } from "../../../shared/lib/paths";
import { cachedRemoteSessionSummaries } from "../../connections/public/connections";
import { parseRemotePath, remotePath } from "../../connections/public/remoteProjects";
import { sessionActivityAt } from "../../sessions/public/sessionActivity";
import type { Worktree } from "../../source-control/model/worktrees";
import type { Session } from "../../sessions/model/session";

/** A path in Host form, so a `remote://` session path matches a Worktree listed by its Host. */
const hostKey = (path: string) => pathKey(parseRemotePath(path)?.hostPath ?? path);

/**
 * The previous worktree to offer in the workspace menu: the newest session of this project
 * (`sessions` must be ordered newest first; sessions carry no archived flag, deleted ones are
 * gone from the list) whose `worktreeCwd` differs from `currentCwd` and still exists in
 * `worktrees` (not missing or prunable, not the main checkout). Derived on every call; nothing
 * is stored. Null when there is none.
 */
export function previousWorktreeFor(
  sessions: readonly Pick<Session, "id" | "cwd" | "worktreeCwd">[],
  projectKey: string,
  currentCwd: string | undefined,
  worktrees: readonly Worktree[],
): Worktree | null {
  const project = hostKey(projectKey);
  const current = currentCwd ? hostKey(currentCwd) : undefined;
  const usable = new Map(
    worktrees
      .filter((tree) => !tree.isMain && !tree.missing && !tree.prunable)
      .map((tree) => [hostKey(tree.path), tree]),
  );
  for (const session of sessions) {
    if (!session.worktreeCwd || hostKey(session.cwd) !== project) continue;
    const key = hostKey(session.worktreeCwd);
    if (key === current) continue;
    const tree = usable.get(key);
    if (tree) return tree;
  }
  return null;
}

/** The fields of a session `previousWorktreeFor` reads. */
export type PreviousWorktreeCandidate = Pick<Session, "id" | "cwd" | "worktreeCwd">;

/**
 * The sessions to scan for the previous worktree, newest first: every session of this computer
 * but `excludeId` ordered by its last turn (a session with no turn yet follows the order it was
 * created in, later first), plus, for a project on another machine, the sessions its Host listed
 * (by their last activity), which have no copy here.
 */
export function previousWorktreeCandidates(
  sessions: readonly Session[],
  excludeId: string | undefined,
  project: string,
): PreviousWorktreeCandidate[] {
  const ranked: { candidate: PreviousWorktreeCandidate; at: number }[] = sessions
    .filter((entry) => entry.id !== excludeId)
    .map((entry) => ({ candidate: entry, at: sessionActivityAt(entry) }));
  const owner = parseRemotePath(project);
  if (owner)
    for (const listed of cachedRemoteSessionSummaries(project))
      if (listed.id !== excludeId && listed.worktreeCwd)
        ranked.push({
          candidate: {
            id: listed.id,
            cwd: project,
            worktreeCwd: remotePath(owner.environmentId, listed.worktreeCwd),
          },
          at: listed.lastActivityAt ?? listed.updatedAt ?? listed.createdAt ?? 0,
        });
  // Array order breaks ties: stable sort keeps the store's creation order, so reverse it first.
  return ranked
    .reverse()
    .sort((a, b) => b.at - a.at)
    .map(({ candidate }) => candidate);
}
