import { prettyCwd } from "../../../shared/lib/paths";
import { shortSha } from "../../../shared/lib/shortSha";
import { t } from "../../../shared/i18n/git";
import { groupCheckouts } from "./checkoutSelection";
import type { Worktree } from "./worktrees";

/** One worktree as every picker lists it: same name, detail, order and filter. */
export type WorktreeRow = {
  path: string;
  tree: Worktree;
  /** Branch, or "Detached <sha>". */
  title: string;
  /** Short path, prefixed "Project folder" for the main worktree. */
  detail: string;
  isMain: boolean;
};

/** A worktree that can be opened: neither deleted on disk nor awaiting prune. */
export const isListedWorktree = (tree: Worktree) =>
  !tree.missing && !tree.prunable;

export const worktreeRowTitle = (tree: Worktree) =>
  tree.branch ??
  (tree.head
    ? t("Detached {p0}", { p0: shortSha(tree.head) })
    : t("Detached HEAD"));

export const worktreeRowDetail = (tree: Worktree) =>
  `${tree.isMain ? `${t("Project folder")} · ` : ""}${prettyCwd(tree.path)}`;

/**
 * The single worktree list: listed worktrees only, the project folder (and the
 * checkout containing `cwd`) first, then worktrees with work, then clean ones.
 * `query` matches title, detail and full path, ignoring case and outer spaces.
 */
export function worktreeRows(
  trees: readonly Worktree[] | undefined,
  cwd: string,
  query = "",
): WorktreeRow[] {
  const groups = groupCheckouts((trees ?? []).filter(isListedWorktree), cwd);
  const needle = query.trim().toLocaleLowerCase();
  return [...groups.primary, ...groups.active, ...groups.idle]
    .map((tree) => ({
      path: tree.path,
      tree,
      title: worktreeRowTitle(tree),
      detail: worktreeRowDetail(tree),
      isMain: tree.isMain,
    }))
    .filter((row) =>
      `${row.title}\n${row.detail}\n${row.path}`
        .toLocaleLowerCase()
        .includes(needle),
    );
}
