import { pathKey } from "../../../shared/lib/paths";
import type { Worktree } from "./worktrees";

export type BranchWorktreeRef = { name: string; remote: string | null };

/** Local branches checked out in another live worktree, by branch name. The worktree the picker
 * itself works in is left out (its branch is the current one), and so are missing or prunable
 * trees: a branch whose worktree is gone is a normal branch again. */
export function branchWorktrees(
  trees: readonly Worktree[] | undefined,
  cwd: string,
): Map<string, Worktree> {
  const own = pathKey(cwd);
  const byBranch = new Map<string, Worktree>();
  for (const tree of trees ?? []) {
    if (!tree.branch || tree.missing || tree.prunable || pathKey(tree.path) === own) continue;
    if (!byBranch.has(tree.branch)) byBranch.set(tree.branch, tree);
  }
  return byBranch;
}

/** The worktree that holds this branch; remote refs never do. */
export function worktreeOfBranch(
  byBranch: ReadonlyMap<string, Worktree>,
  entry: BranchWorktreeRef,
): Worktree | undefined {
  return entry.remote ? undefined : byBranch.get(entry.name);
}

/** Stable partition: free branches keep their order, worktree branches follow as one group. */
export function partitionByWorktree<T extends BranchWorktreeRef>(
  entries: readonly T[],
  byBranch: ReadonlyMap<string, Worktree>,
): { free: T[]; inWorktree: T[] } {
  const free: T[] = [];
  const inWorktree: T[] = [];
  for (const entry of entries) (worktreeOfBranch(byBranch, entry) ? inWorktree : free).push(entry);
  return { free, inWorktree };
}
