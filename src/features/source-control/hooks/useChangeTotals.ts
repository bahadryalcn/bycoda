import { pathKey } from "../../../shared/lib/paths";
import { checkoutRepositoryPaths, sessionCheckout } from "../model/checkoutSelection";
import { totalChangedFiles } from "../model/worktreeScope";
import { useGitSubmodules } from "./useGitSubmodules";
import { useProjectsDiffStats } from "./useProjectDiffStats";

/**
 * Uncommitted files of the given worktree roots and the separate repositories inside them:
 * the same sections the Changes panel lists, so the tab badge, the picker's "All worktrees"
 * chip and the section chips agree. `byRoot` sums each root with its nested repositories.
 * Discovery runs only for the roots passed (dirty worktrees), never for every worktree.
 */
export function useChangeTotals(roots: readonly string[], enabled: boolean) {
  const { modules } = useGitSubmodules(roots, enabled && roots.length > 0, true);
  const repositories = checkoutRepositoryPaths(roots, modules);
  const stats = useProjectsDiffStats(repositories, enabled && repositories.length > 0);
  const ready = stats.length === repositories.length && stats.every(Boolean);
  const byRoot = new Map<string, number>();
  const sum = { files: 0, additions: 0, deletions: 0 };
  repositories.forEach((repository, index) => {
    const item = stats[index];
    if (!item) return;
    sum.files += item.files;
    sum.additions += item.additions;
    sum.deletions += item.deletions;
    const root = sessionCheckout(repository, roots) ?? repository;
    byRoot.set(pathKey(root), (byRoot.get(pathKey(root)) ?? 0) + item.files);
  });
  return {
    ready,
    total: totalChangedFiles(stats.map((item) => item?.files)),
    stats: sum,
    byRoot,
  };
}
