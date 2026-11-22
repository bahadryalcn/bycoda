import { shortSha } from "../../../shared/lib/shortSha";
import { t } from "../../../shared/i18n/git";
import { folderName, groupCheckouts, sessionCheckout } from "./checkoutSelection";
import type { Worktree } from "./worktrees";
import { pathKey } from "../../../shared/lib/paths";

/** Where a row sits: the session's folder and project folder, worktrees with work, clean ones. */
export type WorktreeRowGroup = "primary" | "active" | "idle";

/** One worktree as every list shows it: same title, folder, marker, counts, order and filter. */
export type WorktreeRow = {
  path: string;
  tree: Worktree;
  /** Branch, or "Detached <sha>". */
  title: string;
  /** Folder name of the worktree ("Project folder" for the main one); the full path is only a tooltip. */
  folder: string;
  isMain: boolean;
  /** The checkout the current session works in. */
  current: boolean;
  group: WorktreeRowGroup;
};

/** A worktree that can be opened: neither deleted on disk nor awaiting prune. */
export const isListedWorktree = (tree: Worktree) => !tree.missing && !tree.prunable;

export const worktreeRowTitle = (tree: Worktree) =>
  tree.branch ?? (tree.head ? t("Detached {p0}", { p0: shortSha(tree.head) }) : t("Detached HEAD"));

export const worktreeRowFolder = (tree: Worktree) =>
  tree.isMain ? t("Project folder") : folderName(tree.path);

/** Heading of the group, if it has one: the leading group is unlabelled. */
export const worktreeGroupLabel = (group: WorktreeRowGroup, count: number) =>
  group === "active"
    ? t("With changes")
    : group === "idle"
      ? t("Clean · {p0}", { p0: count })
      : undefined;

/**
 * The single worktree list: listed worktrees only, the session's checkout and the project
 * folder first, then worktrees with work, then clean ones. `query` matches title, folder and
 * full path, ignoring case and outer spaces.
 */
export function worktreeRows(
  trees: readonly Worktree[] | undefined,
  cwd: string,
  query = "",
): WorktreeRow[] {
  const listed = (trees ?? []).filter(isListedWorktree);
  const groups = groupCheckouts(listed, cwd);
  const session = sessionCheckout(
    cwd,
    listed.map((tree) => tree.path),
  );
  const needle = query.trim().toLocaleLowerCase();
  const row = (group: WorktreeRowGroup) => (tree: Worktree) => ({
    path: tree.path,
    tree,
    title: worktreeRowTitle(tree),
    folder: worktreeRowFolder(tree),
    isMain: tree.isMain,
    current: !!session && pathKey(tree.path) === pathKey(session),
    group,
  });
  return [
    ...groups.primary.map(row("primary")),
    ...groups.active.map(row("active")),
    ...groups.idle.map(row("idle")),
  ].filter((entry) =>
    `${entry.title}\n${entry.folder}\n${entry.path}`.toLocaleLowerCase().includes(needle),
  );
}
