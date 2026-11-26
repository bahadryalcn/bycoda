import { pathKey } from "../../../shared/lib/paths";
import { sessionCheckout } from "./checkoutSelection";
import { hasUncommittedChanges, isListedWorktree } from "./worktreeRows";
import type { Worktree } from "./worktrees";

/**
 * The worktrees the All-worktrees Changes panel lists as sections: those with uncommitted
 * changes first, then those with commits waiting to be pushed (clean and unknown ones live in
 * the header picker). With none, the session's worktree stays so the panel is never empty.
 */
export function changeSectionRoots(trees: readonly Worktree[] | undefined, cwd: string): string[] {
  const listed = (trees ?? []).filter(isListedWorktree);
  const dirty = listed.filter(hasUncommittedChanges);
  const ahead = listed.filter((tree) => !hasUncommittedChanges(tree) && (tree.unpushed ?? 0) > 0);
  const session = sessionCheckout(
    cwd,
    listed.map((tree) => tree.path),
  );
  const rank = (tree: Worktree) =>
    session && pathKey(tree.path) === pathKey(session) ? 0 : tree.isMain ? 1 : 2;
  const byRank = (trees: Worktree[]) => [...trees].sort((a, b) => rank(a) - rank(b));
  if (dirty.length || ahead.length)
    return [...byRank(dirty), ...byRank(ahead)].map((tree) => tree.path);
  const fallback = listed.find((tree) => rank(tree) === 0) ?? listed.find((tree) => tree.isMain);
  return fallback ? [fallback.path] : [];
}

/** The Changes tab badge and the picker's "All worktrees" chip: the sum of the section chips; unread counts add nothing. */
export const totalChangedFiles = (counts: readonly (number | undefined)[]) =>
  counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
