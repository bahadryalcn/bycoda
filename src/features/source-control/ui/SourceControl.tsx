import type { HarnessId } from "../../sessions/model/session";
import type { GitFileDiffKind, GitHistoryCommit } from "../../../platform/tauri/fs";
import { GitChangesPanel } from "./GitChangesPanel";
import { WorkspaceSourceControl } from "./WorkspaceSourceControl";
import type { RepositoryReviewRequest } from "../model/workspaceRepositories";

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
