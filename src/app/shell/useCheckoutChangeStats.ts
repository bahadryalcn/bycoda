import { useMemo } from "react";
import { useT } from "../../shared/i18n";
import { useT as useGitT } from "../../shared/i18n/git";
import { useChangeTotals } from "../../features/source-control/hooks/useChangeTotals";
import { changeSectionRoots } from "../../features/source-control/model/worktreeScope";
import { useProjectWorktrees } from "../../features/source-control/hooks/useProjectWorktrees";
import {
  checkoutStateKey,
  checkoutTitleWith,
  folderName,
  followedCheckoutRepository,
  sessionCheckout,
} from "../../features/source-control/model/checkoutSelection";
import { useRetainedState } from "../../shared/hooks/useRetainedState";
import type { WorktreeFocus } from "../../features/source-control/model/worktreeFocus";
import type { Worktree } from "../../features/source-control/model/worktrees";
import { sameProjectPath } from "../../features/projects/model/recents";
import type { ChangeScope } from "./ChangesTabTooltip";

/**
 * Changes tab totals of one repository. A focused sidebar header shows that worktree; under
 * "All repositories" the badge follows the repository the panel's Graph follows ("Auto"): the
 * Graph choice, else the row last used, else the first worktree with changes.
 *
 * Deliberately no repository discovery here: All repositories is the default, and
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
  /** The sidebar header's worktree; undefined means All repositories. */
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
  // The panel's Graph choice and last-used row, shared through retained state.
  const stateKey = checkoutStateKey(gitRoot, paths);
  const [graphChoice] = useRetainedState(`${stateKey}:sections`, "");
  const [lastUsed] = useRetainedState(`${stateKey}:last-used`, "");
  // A focus that is not listed (deleted, still loading) follows the panel instead.
  const followed =
    worktrees && !focusedTree
      ? followedCheckoutRepository(changeSectionRoots(worktrees, gitRoot), paths, [
          graphChoice,
          lastUsed,
        ])
      : undefined;
  // The badge counts the whole worktree the followed repository belongs to.
  const tree =
    focusedTree ??
    (followed
      ? worktrees?.find((entry) =>
          sameProjectPath(entry.path, sessionCheckout(followed, paths) ?? followed),
        )
      : undefined);
  const totals = useChangeTotals([tree?.path ?? gitRoot], active);
  const changeStats = totals.ready ? totals.stats : null;
  const changeScope = ((): ChangeScope | null => {
    if (!tree) return null;
    const own = sessionCheckout(gitRoot, paths);
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
