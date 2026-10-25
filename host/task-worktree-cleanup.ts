import { existsSync, lstatSync, mkdirSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve, relative, sep } from "node:path";
import { runGitText } from "../src/shared/lib/processExecution.node";
import { hostWorktrees, invalidateHostWorktrees } from "./git-worktrees";

/** Same filesystem path; only Windows paths are case-insensitive. */
export const sameHostPath = (a: string, b: string) =>
  process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);
const same = sameHostPath;

/** Only retire a recorded host-managed checkout. Retain outputs and partial Windows removals. */
export async function cleanupTaskWorktree(
  projectCwd: string,
  taskId: string,
  path: string,
  branch: string,
  evidence: { head?: string; deliveredCommit?: string },
  inUse: () => boolean | Promise<boolean> = () => false,
): Promise<string[]> {
  invalidateHostWorktrees(projectCwd);
  let listed = await hostWorktrees(projectCwd);
  const main = listed.worktrees.find((tree) => tree.isMain);
  if (!main || !branch || branch.startsWith("-") || branch.length > 120)
    throw new Error("Only a recorded task checkout can be cleaned up.");
  const expected = join(listed.defaultRoot, `wt-${branch.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
  if (!same(path, expected) || same(path, main.path))
    throw new Error("Task cleanup path is outside its managed workspace.");
  const safeParents = (root: string, target: string) => {
    if (lstatSync(root).isSymbolicLink())
      throw new Error("Task cleanup cannot follow a symbolic link.");
    const rel = relative(resolve(root), resolve(target));
    if (rel === ".." || rel.startsWith(`..${sep}`))
      throw new Error("Task cleanup path escaped its workspace.");
    let current = resolve(root);
    for (const part of rel.split(sep)) {
      current = join(current, part);
      if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
        throw new Error("Task cleanup cannot follow a symbolic link.");
    }
  };
  safeParents(dirname(listed.defaultRoot), path);
  const git = (args: string[], cwd = projectCwd) =>
    runGitText(args, { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  await git(["check-ref-format", "--branch", branch]);
  const archives: string[] = [];
  const archive = (source: string, label: string) => {
    const destination = join(
      main.path,
      "temp/archive/task-worktrees",
      taskId.replace(/[^a-zA-Z0-9_-]/g, "-"),
      `${basename(path)}-${randomUUID()}`,
      label,
    );
    safeParents(main.path, destination);
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(source, destination);
    archives.push(destination);
  };
  const registered = listed.worktrees.find((tree) => same(tree.path, path));
  if (await inUse()) throw new Error("The task checkout is still in use.");
  if (registered) {
    if (registered.locked)
      throw new Error("The task checkout is locked; cleanup will retry after it is unlocked.");
    if (registered.isMain || registered.branch !== branch)
      throw new Error("The task checkout changed branch; cleanup is paused.");
    if (evidence.head && registered.head !== evidence.head)
      throw new Error("The retained task checkout changed after delivery.");
    if (evidence.deliveredCommit)
      await git(["merge-base", "--is-ancestor", registered.head, evidence.deliveredCommit]);
    if ((await git(["status", "--porcelain"], path)).trim())
      throw new Error("The task checkout contains changes made after delivery.");
    if (await inUse()) throw new Error("The task checkout is still in use.");
    if (existsSync(join(path, "temp"))) {
      await git(["check-ignore", "--quiet", "--", "temp"], path);
      await git(["check-ignore", "--quiet", "--", "temp/archive"], main.path);
      // A rename keeps all local outputs, including verification files, without traversing them.
      archive(join(path, "temp"), "temp");
    }
    try {
      if (await inUse()) throw new Error("The task checkout is still in use.");
      await git(["worktree", "remove", "--", path]);
    } catch (error) {
      invalidateHostWorktrees(projectCwd);
      listed = await hostWorktrees(projectCwd);
      if (listed.worktrees.some((tree) => same(tree.path, path))) throw error;
      // Git can unregister the tree before Windows finishes deleting the directory.
      if (existsSync(path)) archive(path, "remaining-files");
    }
  } else if (existsSync(path)) {
    if (await inUse()) throw new Error("The task checkout is still in use.");
    if (existsSync(join(path, ".git")))
      throw new Error("The leftover task directory has Git metadata; cleanup is paused.");
    await git(["check-ignore", "--quiet", "--", "temp/archive"], main.path);
    // The host's recorded cleanup already unregistered it. Preserve every residual file.
    archive(path, "remaining-files");
  }
  invalidateHostWorktrees();
  return archives;
}
