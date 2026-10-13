import { runGitText } from "../src/shared/lib/processExecution.node";
import type { TaskWorkspace } from "../src/features/tasks/model/taskWorkspace";
import { hostWorktrees, resolveHostWorktreeAsync } from "./git-worktrees";

export async function taskWorkspace(projectCwd: string, selected?: TaskWorkspace) {
  let cwd = await resolveHostWorktreeAsync(projectCwd, selected?.checkoutCwd);
  const git = (path: string, args: string[]) =>
    runGitText(args, {
      cwd: path,
      timeout: 30_000,
      windowsHide: true,
    }).then((text) => text.trim());
  let branch = await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (selected?.baseBranch && branch !== selected.baseBranch) {
    const tree = (await hostWorktrees(projectCwd)).worktrees.find(
      (item) => !item.missing && item.branch === selected.baseBranch,
    );
    if (!tree || selected.checkoutCwd)
      throw new Error(
        "The selected worktree is not on the base branch. Choose or create a worktree for that branch.",
      );
    cwd = await resolveHostWorktreeAsync(projectCwd, tree.path);
    branch = selected.baseBranch;
  }
  return { cwd, branch };
}
