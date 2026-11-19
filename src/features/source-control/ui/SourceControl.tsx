import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import type { HarnessId } from "../../sessions";
import type { GitFileDiffKind, GitHistoryCommit } from "../../../platform/tauri/fs";
import { GitChangesPanel } from "./GitChangesPanel";
import { WorkspaceSourceControl } from "./WorkspaceSourceControl";
import type { RepositoryReviewRequest } from "../model/workspaceRepositories";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { t, useLocale } from "../../../shared/i18n/git";
import { pathKey } from "../../../shared/lib/paths";
import { checkoutOptionLabel, sessionCheckout } from "../model/checkoutSelection";
import type { Worktree } from "../model/worktrees";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { MachineGate } from "../../connections/public/MachineUnavailable";
import { peekDiffIndex } from "../hooks/useDiffIndex";

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

/** Source control of a project, or the shared notice while its machine cannot be asked: no
 * repository, change, branch or history read starts until the machine is available. An
 * offline machine keeps what was loaded (worktrees or changes) with its reconnect notice. */
export function SourceControl(props: Props) {
  const { cwd, enabled, repositoryPaths, onOpenRepository } = props;
  const worktrees = useProjectWorktrees(
    cwd,
    enabled && !repositoryPaths?.length && !!onOpenRepository,
  );
  return (
    <MachineGate cwd={cwd} hasData={() => !!worktrees.data || peekDiffIndex(cwd) !== null}>
      <SourceControlContent {...props} worktrees={worktrees} />
    </MachineGate>
  );
}

function SourceControlContent({
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
  worktrees: { data, error, loading, refresh },
}: Props & { worktrees: ReturnType<typeof useProjectWorktrees> }) {
  useLocale();
  // A plain folder has no worktrees to list; the panel below says so once.
  const connectionShownCentrally = useConnectionErrorShownCentrally(error);
  const discoveryNotice =
    error && !connectionShownCentrally && !/not a git repository/i.test(error) ? (
      <Text
        as="div"
        size="caption"
        tone="inherit"
        {...surfaceAttributes(
          { frame: "pane", edge: "bottom" },
          "flex shrink-0 flex-wrap items-center gap-x-2 px-2 py-0.5",
        )}
      >
        <Text role="status" as="p" size="inherit" tone="secondary" className="min-w-0">
          {data
            ? t("Could not refresh worktrees. Showing the last available list.")
            : `${t("Worktrees")} · ${t("Unavailable")}`}
        </Text>
        <ErrorDetails detail={error} />
        <Button
          variant="ghost"
          size="sm"
          className="ms-auto"
          loading={loading}
          disabled={!enabled}
          onClick={() => void refresh()}
        >
          {t("Retry")}
        </Button>
      </Text>
    ) : null;
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
        {discoveryNotice}
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
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-clip">
        {discoveryNotice}
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
      </div>
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
