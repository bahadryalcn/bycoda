import { useMemo } from "react";
import { useT } from "../../shared/i18n";
import { useT as useGitT } from "../../shared/i18n/git";
import {
  useProjectDiffStats,
  useProjectsDiffStats,
} from "../../features/source-control/hooks/useProjectDiffStats";
import { useProjectWorktrees } from "../../features/source-control/hooks/useProjectWorktrees";
import {
  checkoutTitleWith,
  folderName,
  sessionCheckout,
} from "../../features/source-control/model/checkoutSelection";
import type { WorktreeFocus } from "../../features/source-control/model/worktreeFocus";
import type { Worktree } from "../../features/source-control/model/worktrees";
import { sameProjectPath } from "../../features/projects/model/recents";
import type { ChangeScope } from "./ChangesTabTooltip";

/**
 * Changes tab totals. They follow the sidebar header: no focus is "All worktrees"
 * (the sum of every worktree), a focused worktree is that worktree alone.
 *
 * Deliberately no repository discovery here: All worktrees is the default, and
 * walking every worktree's tree for child repositories queued 20+ scans on the
 * Host at startup. Totals are plain per-worktree diff stats; the Changes panel
 * discovers child repositories only for a worktree that is opened.
 */
export function useCheckoutChangeStats({
  gitRoot,
  repositoryPaths,
  focus,
  active,
}: {
  gitRoot: string;
  /** Workspace repositories; the worktree scope only applies without them. */
  repositoryPaths: readonly string[] | undefined;
  /** The sidebar header's worktree; undefined means All worktrees. */
  focus: WorktreeFocus | undefined;
  /** The panel is visible and the sidebar available. */
  active: boolean;
}) {
  const t = useT();
  const gitT = useGitT();
  const scopeEnabled = active && !repositoryPaths?.length;
  const { data: worktreeData } = useProjectWorktrees(gitRoot, scopeEnabled);
  const worktrees = useMemo(() => {
    const trees: Worktree[] = [];
    for (const tree of worktreeData?.worktrees ?? []) {
      if (tree.missing || tree.prunable) continue;
      if (trees.some((entry) => sameProjectPath(entry.path, tree.path))) continue;
      trees.push(tree);
    }
    return trees.length > 1 ? trees : null;
  }, [worktreeData]);
  const paths = useMemo(() => worktrees?.map((tree) => tree.path) ?? [], [worktrees]);
  const focusedTree =
    worktrees && focus
      ? worktrees.find((tree) => sameProjectPath(tree.path, focus.path))
      : undefined;
  // A focus that is not listed (deleted, still loading) shows the overview.
  const overview = !!worktrees && !focusedTree;
  const statsRoot = focusedTree ? focusedTree.path : gitRoot;
  const singleStats = useProjectDiffStats(statsRoot, active && !overview);
  const allStats = useProjectsDiffStats(overview ? paths : [], active && overview);
  const changeStats = overview
    ? allStats.length !== paths.length || allStats.some((stats) => !stats)
      ? null
      : allStats.reduce<{ files: number; additions: number; deletions: number }>(
          (total, stats) =>
            stats
              ? {
                  files: total.files + stats.files,
                  additions: total.additions + stats.additions,
                  deletions: total.deletions + stats.deletions,
                }
              : total,
          { files: 0, additions: 0, deletions: 0 },
        )
    : singleStats;
  const changeScope = ((): ChangeScope | null => {
    if (!worktrees) return null;
    if (overview) return { title: t("All worktrees") };
    if (!focusedTree) return null;
    const own = sessionCheckout(gitRoot, paths);
    return {
      title: checkoutTitleWith(focusedTree, gitT),
      folder: folderName(focusedTree.path),
      branch: !!focusedTree.branch,
      session: !!own && sameProjectPath(own, focusedTree.path),
    };
  })();
  const changeScopeLabel = changeScope
    ? [changeScope.title, changeScope.folder, changeScope.session ? t("This session") : ""]
        .filter(Boolean)
        .join(" · ")
    : "";

  return { changeStats, changeScope, changeScopeLabel };
}
