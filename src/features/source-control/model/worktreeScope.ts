import { pathKey } from "../../../shared/lib/paths";
import { sessionCheckout } from "./checkoutSelection";
import { hasUncommittedChanges, isListedWorktree } from "./worktreeRows";
import type { Worktree } from "./worktrees";

/**
 * The worktrees with work in them: those with uncommitted changes first, then those with
 * commits waiting to be pushed. They open by default in the All-repositories Changes panel and
 * add up to the Changes badge. With none, the session's worktree stands in.
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

/**
 * Every listed worktree as an All-repositories section, as in VS Code: the changed ones in
 * `changeSectionRoots` order, then the clean and unknown ones (the session's first, then the
 * project folder). Only the changed ones open by default.
 */
export function overviewSectionRoots(
  trees: readonly Worktree[] | undefined,
  cwd: string,
): string[] {
  const listed = (trees ?? []).filter(isListedWorktree);
  const changed = new Set(
    listed
      .filter((tree) => hasUncommittedChanges(tree) || (tree.unpushed ?? 0) > 0)
      .map((tree) => pathKey(tree.path)),
  );
  const session = sessionCheckout(
    cwd,
    listed.map((tree) => tree.path),
  );
  const rank = (tree: Worktree) =>
    session && pathKey(tree.path) === pathKey(session) ? 0 : tree.isMain ? 1 : 2;
  const rest = listed
    .filter((tree) => !changed.has(pathKey(tree.path)))
    .sort((a, b) => rank(a) - rank(b))
    .map((tree) => tree.path);
  const first = changed.size ? changeSectionRoots(listed, cwd) : [];
  return [...first, ...rest];
}

/** The Changes tab badge and the picker's "All repositories" chip: the sum of the section chips; unread counts add nothing. */
export const totalChangedFiles = (counts: readonly (number | undefined)[]) =>
  counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
