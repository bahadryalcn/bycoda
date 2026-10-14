import { pathKey } from "../../../shared/lib/paths";
import { projectGroupWorkspaceRoot, type ProjectGroup } from "../../projects/model/projectGroups";
import { isProjectLockedIn, type LockSnapshot } from "../../group-lock/model/lockState";
import type { GitFileDiffKind, GitHistoryCommit } from "../../../platform/tauri/fs";

export type RepositoryReviewRequest =
  | { type: "diff"; cwd: string; path?: string; kind: GitFileDiffKind; pin?: boolean }
  | { type: "file"; cwd: string; path: string; pin?: boolean }
  | { type: "commit"; cwd: string; commit: GitHistoryCommit; pin?: boolean };

/** Opening a child repository's file must not retarget the workspace Explorer or Git list. */
export function workspaceSourceControlRoot(
  project: string,
  checkout: string,
  paths?: readonly string[],
): string {
  return paths &&
    (pathKey(project) === pathKey(checkout) ||
      paths.some((path) => pathKey(path) === pathKey(checkout)))
    ? project
    : checkout;
}

/** Workspace files own their folder list; manually assigned folders are included too. */
export function workspaceRepositoryPaths(
  cwd: string,
  groups: readonly ProjectGroup[],
  assignments: Readonly<Record<string, string>>,
  rememberedPaths: readonly string[],
  lock: LockSnapshot,
): string[] | undefined {
  const key = pathKey(cwd);
  const group = groups.find((group) => {
    const root = projectGroupWorkspaceRoot(group);
    return root && pathKey(root) === key;
  });
  if (!group || isProjectLockedIn(lock, cwd)) return undefined;
  const seen = new Set([key]);
  return [
    ...(group.workspaceFolders ?? []),
    ...rememberedPaths.filter((path) => assignments[pathKey(path)] === group.id),
  ].filter((path) => {
    const candidate = pathKey(path);
    if (seen.has(candidate) || isProjectLockedIn(lock, path)) return false;
    seen.add(candidate);
    return true;
  });
}
