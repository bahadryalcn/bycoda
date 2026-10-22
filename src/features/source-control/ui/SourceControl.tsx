import type { HarnessId } from "../../sessions/model/session";
import type { GitFileDiffKind, GitHistoryCommit } from "../../../platform/tauri/fs";
import { GitChangesPanel } from "./GitChangesPanel";
import { WorkspaceSourceControl } from "./WorkspaceSourceControl";
import type { RepositoryReviewRequest } from "../model/workspaceRepositories";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { t, useLocale } from "../../../shared/i18n/git";
import { pathKey } from "../../../shared/lib/paths";
import { checkoutOptionLabel, sessionCheckout } from "../model/checkoutSelection";
import type { Worktree } from "../model/worktrees";

type Props = {
  repositoryPaths?: readonly string[];
  onOpenRepository?: (request: RepositoryReviewRequest) => void;
  cwd: string;
  enabled: boolean;
  textHarness?: HarnessId;
  selectedPath?: string;
  selectedKind?: GitFileDiffKind;
  selectedSha?: string;
  onOpenFile: (path: string, kind: GitFileDiffKind) => void;
  onOpenInEditor?: (path: string, pin?: boolean) => void;
  onOpenAllChanges: (kind: GitFileDiffKind) => void;
  onOpenCommit: (commit: GitHistoryCommit) => void;
};

export function SourceControl({
  repositoryPaths,
  onOpenRepository,
  cwd,
  enabled,
  textHarness,
  selectedPath,
  selectedKind,
  selectedSha,
  onOpenFile,
  onOpenInEditor,
  onOpenAllChanges,
  onOpenCommit,
}: Props) {
  useLocale();
  const { data, error, refresh } = useProjectWorktrees(
    cwd,
    enabled && !repositoryPaths?.length && !!onOpenRepository,
  );
  const checkouts = (() => {
    const paths: string[] = [];
    const labels: Record<string, string> = {};
    const worktrees: Record<string, Worktree> = {};
    for (const tree of data?.worktrees ?? []) {
      if (tree.missing || tree.prunable) continue;
      if (paths.some((path) => pathKey(path) === pathKey(tree.path))) continue;
      paths.push(tree.path);
      worktrees[tree.path] = tree;
    }
    const current = sessionCheckout(cwd, paths);
    for (const path of paths)
      labels[path] = checkoutOptionLabel(
        worktrees[path],
        !!current && pathKey(path) === pathKey(current),
      );
    return { paths, labels, worktrees };
  })();
  if (!repositoryPaths?.length && onOpenRepository && checkouts.paths.length > 1)
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-clip">
        {error ? (
          <p
            role="status"
            className="shrink-0 border-b border-stroke px-2 py-1 text-[11px] text-[var(--ui-text-secondary)]"
          >
            {t("Could not refresh worktrees. Showing the last available list.")}
          </p>
        ) : null}
        <WorkspaceSourceControl
          key={cwd}
          cwd={cwd}
          paths={checkouts.paths}
          labels={checkouts.labels}
          worktrees={checkouts.worktrees}
          checkouts
          enabled={enabled}
          textHarness={textHarness}
          selectedPath={selectedPath}
          selectedKind={selectedKind}
          selectedSha={selectedSha}
          onOpen={onOpenRepository}
          onRefresh={() => void refresh()}
        />
      </div>
    );
  if (repositoryPaths?.length && onOpenRepository)
    return (
      <WorkspaceSourceControl
        key={cwd}
        cwd={cwd}
        paths={repositoryPaths}
        enabled={enabled}
        textHarness={textHarness}
        onOpen={onOpenRepository}
      />
    );
  if (onOpenRepository)
    return (
      <WorkspaceSourceControl
        key={cwd}
        cwd={cwd}
        paths={[cwd]}
        singleRepository
        enabled={enabled}
        textHarness={textHarness}
        selectedPath={selectedPath}
        selectedKind={selectedKind}
        selectedSha={selectedSha}
        onOpen={onOpenRepository}
      />
    );
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <GitChangesPanel
        key={cwd}
        cwd={cwd}
        enabled={enabled}
        textHarness={textHarness}
        selectedPath={selectedPath}
        selectedKind={selectedKind}
        selectedSha={selectedSha}
        onOpenFile={onOpenFile}
        onOpenInEditor={onOpenInEditor}
        onOpenAllChanges={onOpenAllChanges}
        onOpenCommit={onOpenCommit}
      />
    </div>
  );
}
