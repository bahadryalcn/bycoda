import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { hostWorktrees, invalidateHostWorktrees } from "./git-worktrees";
import { guardedRemoveWorkspace, sameWorkspacePath } from "./workspace-cleanup";
import { runGitText } from "../src/shared/lib/processExecution.node";
import {
  canonicalWorkspaceDirectorySync,
  canonicalWorkspaceEntry,
  canonicalWorkspacePath,
  workspacePathKey,
} from "./workspace-paths";

/** Same filesystem path; only Windows paths are case-insensitive. */
export const sameHostPath = sameWorkspacePath;
const removing = new Set<string>();
const key = (path: string) => workspacePathKey(canonicalWorkspaceDirectorySync(path));
/** Legacy launch adapters must check this inside their process-start admission gate. */
export const isTaskWorktreeRemoving = (path: string) => removing.has(key(path));

/** Compatibility adapter: no separate recursive deletion or branch deletion path. */
export async function cleanupTaskWorktree(
  projectCwd: string,
  taskId: string,
  path: string,
  branch: string,
  evidence: { head?: string; deliveredCommit?: string },
  inUse: () => boolean | Promise<boolean> = () => false,
): Promise<string[]> {
  [projectCwd, path] = await Promise.all([
    canonicalWorkspacePath(projectCwd),
    canonicalWorkspaceEntry(path),
  ]);
  if (removing.has(key(path))) throw new Error("The task checkout is still in use.");
  removing.add(key(path));
  try {
    invalidateHostWorktrees(projectCwd);
    const listed = await hostWorktrees(projectCwd);
    const main = listed.worktrees.find((tree) => tree.isMain);
    if (!main || !branch || branch.startsWith("-") || branch.length > 120)
      throw new Error("Only a recorded task checkout can be cleaned up.");
    const expected = join(listed.defaultRoot, `wt-${branch.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
    if (!sameHostPath(path, expected) || sameHostPath(path, main.path))
      throw new Error("Task cleanup path is outside its managed workspace.");
    const registered = listed.worktrees.find((tree) => sameHostPath(tree.path, path));
    if (registered && evidence.deliveredCommit)
      await runGitText(["merge-base", "--is-ancestor", registered.head, evidence.deliveredCommit], {
        cwd: projectCwd,
        windowsHide: true,
        timeout: 30_000,
      });
    const id = randomUUID();
    const result = await guardedRemoveWorkspace({
      projectCwd,
      managedRoot: listed.defaultRoot,
      path,
      branchRef: `refs/heads/${branch}`,
      head: evidence.head,
      operationId: id,
      archiveRoot: join(
        main.path,
        "temp/archive/task-worktrees",
        taskId.replace(/[^a-zA-Z0-9_-]/g, "-"),
        id,
      ),
      inUse,
    });
    return result.archives;
  } finally {
    removing.delete(key(path));
  }
}
