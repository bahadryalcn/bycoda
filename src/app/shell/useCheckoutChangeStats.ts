import { useMemo } from "react";
import { useT } from "../../shared/i18n";
import { useT as useGitT } from "../../shared/i18n/git";
import {
  useProjectDiffStats,
  useProjectsDiffStats,
} from "../../features/source-control/hooks/useProjectDiffStats";
import { useProjectWorktrees } from "../../features/source-control/hooks/useProjectWorktrees";
import { useGitSubmodules } from "../../features/source-control/hooks/useGitSubmodules";
import {
  checkoutTitleWith,
  checkoutRepositoryPaths,
  folderName,
  checkoutSelectionScope,
  loadCheckoutSelection,
  resolveCheckoutSelection,
  sessionCheckout,
} from "../../features/source-control/model/checkoutSelection";
import type { Worktree } from "../../features/source-control/model/worktrees";
import { sameProjectPath } from "../../features/projects/model/recents";
import { useRetainedState } from "../../shared/hooks/useRetainedState";
import type { ChangeScope } from "./ChangesTabTooltip";

/**
 * Changes tab totals. They follow the checkout the panel is showing: the stored
 * checkout choice, or every checkout when the user picked the overview.
 */
export function useCheckoutChangeStats({
  gitRoot,
  repositoryPaths,
  active,
}: {
  gitRoot: string;
  /** Workspace repositories; the checkout scope only applies without them. */
  repositoryPaths: readonly string[] | undefined;
  /** The panel is visible and the sidebar available. */
  active: boolean;
}) {
  const t = useT();
  const gitT = useGitT();
  const checkoutScopeEnabled = active && !repositoryPaths?.length;
  const { data: checkoutTrees } = useProjectWorktrees(gitRoot, checkoutScopeEnabled);
  const checkoutScope = useMemo(() => {
    const trees: Worktree[] = [];
    for (const tree of checkoutTrees?.worktrees ?? []) {
      if (tree.missing || tree.prunable) continue;
      if (trees.some((entry) => sameProjectPath(entry.path, tree.path))) continue;
      trees.push(tree);
    }
    return trees.length > 1 ? trees : null;
  }, [checkoutTrees]);
  const checkoutPaths = useMemo(
    () => checkoutScope?.map((tree) => tree.path) ?? [],
    [checkoutScope],
  );
  const checkoutSelectionKey = checkoutSelectionScope(gitRoot, checkoutPaths);
  const [storedCheckout] = useRetainedState<string | null>(
    `source-control:checkouts:${checkoutSelectionKey}:selected`,
    () => loadCheckoutSelection(checkoutSelectionKey),
  );
  const { modules, error: discoveryError } = useGitSubmodules(
    checkoutPaths,
    checkoutScopeEnabled,
    true,
  );
  const repositoryTargets = checkoutRepositoryPaths(checkoutPaths, modules);
  const selectedCheckout = checkoutScope
    ? resolveCheckoutSelection(
        storedCheckout,
        gitRoot,
        checkoutPaths,
        Object.fromEntries(checkoutScope.map((tree) => [tree.path, tree])),
        modules,
      )
    : null;
  const allCheckouts = selectedCheckout === "";
  const statsRoot = selectedCheckout ? selectedCheckout : gitRoot;
  const singleStats = useProjectDiffStats(statsRoot, active && !allCheckouts);
  const allStats = useProjectsDiffStats(
    allCheckouts ? repositoryTargets : [],
    active && allCheckouts,
  );
  const changeStats = allCheckouts
    ? discoveryError ||
      checkoutPaths.some((path) => modules[path] === undefined) ||
      allStats.length !== repositoryTargets.length ||
      allStats.some((stats) => !stats)
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
    if (!checkoutScope) return null;
    if (allCheckouts) return { title: t("All checkouts") };
    const tree = checkoutScope.find((entry) => sameProjectPath(entry.path, selectedCheckout ?? ""));
    if (!tree) return selectedCheckout ? { title: folderName(selectedCheckout) } : null;
    const own = sessionCheckout(gitRoot, checkoutPaths);
    return {
      title: checkoutTitleWith(tree, gitT),
      folder: folderName(tree.path),
      branch: !!tree.branch,
      session: !!own && sameProjectPath(own, tree.path),
    };
  })();
  const changeScopeLabel = changeScope
    ? [changeScope.title, changeScope.folder, changeScope.session ? t("This session") : ""]
        .filter(Boolean)
        .join(" · ")
    : "";

  return { changeStats, changeScope, changeScopeLabel };
}
