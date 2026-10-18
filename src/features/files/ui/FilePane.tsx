import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/technical";
import { lazySurface } from "../../../shared/ui/lazySurface";
import type { PointerEvent as ReactPointerEvent } from "react";
import { memo, useSyncExternalStore } from "react";
import { MarkdownViewShell, useMarkdownMode } from "../../sessions/ui/MarkdownModeToggle";
import { SurfaceTabs } from "../../workspace/ui/SurfaceTabs";
import type { WindowMovePosition } from "../../../app/model/windowTransferPopout";
import {
  isAgentTab,
  isChangesTab,
  isCommitTab,
  isPlanTab,
  isReleaseNotesTab,
  isReviewTab,
  isSessionChangesTab,
  isTerminalTab,
  type EditorPane,
  type FilePaneTab,
  type PaneEdge,
  type PaneTabDropPosition,
} from "../../workspace/model/layout";
import { documentKind } from "../model/documentViewer";
import { isImagePath } from "../model/filePreview";
import { mediaKind } from "../model/mediaPreview";
import type { TerminalMetaPatch } from "../../terminal/model/terminalTab";
import type { EditorNavigationTarget, OpenFileFn } from "../../search/model/search";
import { editorPathsEqual } from "../../search/model/search";
import type { PlanBuildTarget, Session } from "../../sessions/model/session";
import { Play } from "../../../shared/ui/icons";
import { BuildTargetButton } from "../../sessions/ui/SecondOpinionButton";
import { loadDiffViewer, subscribeDiffViewer } from "../../settings/model/settings";
import { AgentTabView } from "../../sessions/ui/AgentTabView";
import { useSession } from "../../sessions/model/sessionsStore";
import { MarkdownPreview } from "../../sessions/ui/AgentMarkdown";
import { BinaryFileView } from "./BinaryFileView";
import { DocumentView } from "./DocumentView";
import { ReleaseNotesSurface } from "../../../app/ui/ReleaseNotesSurface";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { PlanSelection } from "./PlanSelection";
import { SurfaceSelection } from "../../sessions/ui/SurfaceSelection";

const CommitDiff = lazySurface(async () => {
  const module = await import("../../source-control/ui/CommitDiff");
  return { default: module.CommitDiff };
});
const FileEditor = lazySurface(async () => {
  const module = await import("./FileEditor");
  return { default: module.FileEditor };
});
const MediaView = lazySurface(async () => ({ default: (await import("./MediaView")).MediaView }));
const DelimitedFileView = lazySurface(async () => ({
  default: (await import("./DelimitedFileView")).DelimitedFileView,
}));
const SessionChangesDiff = lazySurface(async () => {
  const module = await import("../../source-control/ui/SessionChangesDiff");
  return { default: module.SessionChangesDiff };
});
const TerminalView = lazySurface(async () => {
  const module = await import("../../terminal/ui/TerminalView");
  return { default: module.TerminalView };
});
const WorkingTreeDiff = lazySurface(async () => {
  const module = await import("../../source-control/ui/WorkingTreeDiff");
  return { default: module.WorkingTreeDiff };
});

type Props = {
  pane: EditorPane;
  focused: boolean;
  /** A workspace or grouped pane can stay mounted while hidden. */
  visible?: boolean;
  /** The title bar already names a standalone file, so avoid repeating it. */
  showTabs?: boolean;
  dirtyFileIds: Set<string>;
  fileErrorCounts: Map<string, number>;
  sessions: Session[];
  onFocus: (paneId: string) => void;
  onSelectFile: (paneId: string, fileId: string) => void;
  onCloseFile: (paneId: string, fileId: string) => void;
  onCloseOtherFiles: (paneId: string, fileId: string) => void;
  onOpenInNewWindow?: (paneId: string, fileId: string, position?: WindowMovePosition) => void;
  onPinFile?: (fileId: string) => void;
  onDirtyChange: (fileId: string, dirty: boolean) => void;
  onErrorCountChange: (fileId: string, count: number) => void;
  onReorderFiles: (paneId: string, ids: string[]) => void;
  onMoveFile?: (
    fileId: string,
    targetPaneId: string,
    edge: PaneEdge,
    targetFileId?: string,
    position?: PaneTabDropPosition,
  ) => void;
  onOpenFile: OpenFileFn;
  onUpdatePlan: (sessionId: string, blockId: string, text: string) => void;
  onBuildPlan: (sessionId: string, blockId: string, target?: PlanBuildTarget) => void;
  editorNavigation?: EditorNavigationTarget | null;
  onPaneDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  onTerminalMetaChange?: (fileId: string, patch: TerminalMetaPatch) => void;
};

function FilePaneComponent({
  pane,
  focused,
  visible = true,
  showTabs = true,
  dirtyFileIds,
  fileErrorCounts,
  sessions,
  onFocus,
  onSelectFile,
  onCloseFile,
  onCloseOtherFiles,
  onOpenInNewWindow,
  onPinFile,
  onDirtyChange,
  onErrorCountChange,
  onReorderFiles,
  onMoveFile,
  onOpenFile,
  onUpdatePlan,
  onBuildPlan,
  editorNavigation,
  onPaneDragStart,
  onTerminalMetaChange,
}: Props) {
  useLocale();
  const diffViewer = useSyncExternalStore(subscribeDiffViewer, loadDiffViewer, loadDiffViewer);
  const activeFile = pane.files.find((file) => file.id === pane.activeFileId);
  const sessionReview = activeFile && isSessionChangesTab(activeFile) ? activeFile : undefined;
  const unifiedReview =
    !!activeFile &&
    !sessionReview &&
    (isChangesTab(activeFile) || (diffViewer === "unified" && isReviewTab(activeFile)));
  const commitReview = !!activeFile && isCommitTab(activeFile);

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      onMouseDown={() => onFocus(pane.id)}
    >
      {showTabs ? (
        <SurfaceTabs
          files={pane.files}
          activeFileId={pane.activeFileId}
          dirtyFileIds={dirtyFileIds}
          fileErrorCounts={fileErrorCounts}
          onSelectFile={(fileId) => onSelectFile(pane.id, fileId)}
          onCloseFile={(fileId) => onCloseFile(pane.id, fileId)}
          onCloseOtherFiles={(fileId) => onCloseOtherFiles(pane.id, fileId)}
          onOpenInNewWindow={
            onOpenInNewWindow
              ? (fileId, position) => onOpenInNewWindow(pane.id, fileId, position)
              : undefined
          }
          onPinFile={onPinFile}
          onReorder={(ids) => onReorderFiles(pane.id, ids)}
          paneId={pane.id}
          onMoveFile={onMoveFile}
          onPaneDragStart={onPaneDragStart}
        />
      ) : null}
      <div className="relative min-h-0 flex-1">
        {sessionReview ? (
          <div className="absolute inset-0 h-full">
            <SessionChangesDiff
              cwd={sessionReview.cwd}
              sessionId={sessionReview.sessionChanges.sessionId}
              focusPath={sessionReview.path}
            />
          </div>
        ) : commitReview && activeFile?.commit ? (
          <div className="absolute inset-0 h-full">
            <CommitDiff cwd={activeFile.cwd} sha={activeFile.commit.sha} />
          </div>
        ) : unifiedReview && activeFile ? (
          <div className="absolute inset-0 h-full">
            <WorkingTreeDiff
              cwd={activeFile.cwd}
              focusPath={activeFile.path}
              focusKind={activeFile.changeKind}
              focusRequest={activeFile.focusRequest}
            />
          </div>
        ) : null}
        {pane.files.map((file) => {
          const kind = documentKind(file.path);
          const delimited = kind === "csv" || kind === "tsv";
          const Editor = delimited ? DelimitedFileView : FileEditor;
          if (
            isCommitTab(file) ||
            isChangesTab(file) ||
            isSessionChangesTab(file) ||
            (unifiedReview && isReviewTab(file))
          )
            return null;
          return (
            <div
              key={file.id}
              aria-hidden={file.id !== pane.activeFileId}
              className={file.id === pane.activeFileId ? "absolute inset-0 h-full" : "hidden"}
            >
              {isAgentTab(file) ? (
                <AgentTabView
                  title={file.path}
                  session={sessions.find((entry) => entry.id === file.agent.sessionId)}
                  visible={file.id === pane.activeFileId}
                  focused={focused && file.id === pane.activeFileId}
                  onOpenFile={onOpenFile}
                />
              ) : isPlanTab(file) ? (
                <PlanSurface
                  file={file}
                  active={visible && focused && file.id === pane.activeFileId}
                  sessions={sessions}
                  onOpenFile={onOpenFile}
                  onUpdatePlan={onUpdatePlan}
                  onBuildPlan={onBuildPlan}
                />
              ) : isReleaseNotesTab(file) ? (
                <ReleaseNotesSurface source={file.releaseNotes} />
              ) : isTerminalTab(file) ? (
                <TerminalView
                  id={file.id}
                  cwd={file.cwd}
                  profile={file.shellProfile}
                  active={focused && file.id === pane.activeFileId}
                  onMetaChange={(patch) => onTerminalMetaChange?.(file.id, patch)}
                />
              ) : isImagePath(file.path) ? (
                <BinaryFileView path={file.path} cwd={file.cwd} />
              ) : mediaKind(file.path) ? (
                <MediaView
                  path={file.path}
                  active={file.id === pane.activeFileId}
                  visible={visible && file.id === pane.activeFileId}
                />
              ) : kind && !delimited ? (
                <DocumentView path={file.path} cwd={file.cwd} />
              ) : (
                <Editor
                  documentId={file.id}
                  path={file.path}
                  cwd={file.cwd}
                  showDiff={!!file.review}
                  changeKind={file.changeKind}
                  active={visible && focused && file.id === pane.activeFileId}
                  navigation={
                    editorNavigation && editorPathsEqual(file.path, editorNavigation.path)
                      ? editorNavigation
                      : null
                  }
                  onDirtyChange={(_path, dirty) => onDirtyChange(file.id, dirty)}
                  onErrorCountChange={(_path, count) => onErrorCountChange(file.id, count)}
                  onOpenFile={onOpenFile}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const FilePane = memo(FilePaneComponent, (previous, next) => {
  if (
    previous.pane !== next.pane ||
    previous.focused !== next.focused ||
    previous.visible !== next.visible ||
    previous.showTabs !== next.showTabs ||
    previous.dirtyFileIds !== next.dirtyFileIds ||
    previous.fileErrorCounts !== next.fileErrorCounts ||
    previous.onFocus !== next.onFocus ||
    previous.onSelectFile !== next.onSelectFile ||
    previous.onCloseFile !== next.onCloseFile ||
    previous.onCloseOtherFiles !== next.onCloseOtherFiles ||
    previous.onOpenInNewWindow !== next.onOpenInNewWindow ||
    previous.onPinFile !== next.onPinFile ||
    previous.onDirtyChange !== next.onDirtyChange ||
    previous.onErrorCountChange !== next.onErrorCountChange ||
    previous.onReorderFiles !== next.onReorderFiles ||
    previous.onMoveFile !== next.onMoveFile ||
    previous.onOpenFile !== next.onOpenFile ||
    previous.onUpdatePlan !== next.onUpdatePlan ||
    previous.onBuildPlan !== next.onBuildPlan ||
    previous.editorNavigation !== next.editorNavigation ||
    Boolean(previous.onPaneDragStart) !== Boolean(next.onPaneDragStart) ||
    previous.onTerminalMetaChange !== next.onTerminalMetaChange
  ) {
    return false;
  }

  for (const file of next.pane.files) {
    // Plans and agent tabs both read a live session object from this pane.
    const sessionId = file.plan?.sessionId ?? file.agent?.sessionId;
    if (!sessionId) continue;
    const before = previous.sessions.find((session) => session.id === sessionId);
    const after = next.sessions.find((session) => session.id === sessionId);
    if (before !== after) return false;
  }
  return true;
});

function PlanSurface({
  file,
  active,
  sessions,
  onOpenFile,
  onUpdatePlan,
  onBuildPlan,
}: {
  file: FilePaneTab;
  active: boolean;
  sessions: Session[];
  onOpenFile: OpenFileFn;
  onUpdatePlan: (sessionId: string, blockId: string, text: string) => void;
  onBuildPlan: (sessionId: string, blockId: string, target?: PlanBuildTarget) => void;
}) {
  useLocale();
  const plan = file.plan;
  const [mode, setMode] = useMarkdownMode(file.path);
  // A streaming plan's text lives only in the store; the `sessions` prop lags.
  const liveSession = useSession(plan?.sessionId);
  const session =
    liveSession ?? (plan ? sessions.find((entry) => entry.id === plan.sessionId) : undefined);
  const block = plan ? session?.blocks.find((entry) => entry.id === plan.blockId) : undefined;
  const remote = !!session && isRemoteProjectPath(session.cwd);

  if (!block || !plan) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <p className="text-[13px] text-[var(--ui-text-secondary)]">
          {t("This plan is no longer in the session.")}
        </p>
      </div>
    );
  }

  const buildDisabled =
    !!session?.busy ||
    !block.text.trim() ||
    block.plan?.status === "streaming" ||
    block.plan?.status === "building" ||
    block.plan?.status === "built";
  const buildLabel =
    block.plan?.status === "building"
      ? "Building…"
      : block.plan?.status === "built"
        ? "Built"
        : "Build";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <MarkdownViewShell
        mode={mode}
        onModeChange={setMode}
        preview={
          <PlanSelection
            active={active && mode === "preview"}
            blockId={block.id}
            text={block.text}
            sessionId={plan.sessionId}
            cwd={session?.cwd ?? file.cwd}
          >
            <MarkdownPreview
              text={block.text}
              streaming={block.streaming}
              cwd={file.cwd}
              onOpenFile={onOpenFile}
            />
          </PlanSelection>
        }
        actions={
          <div className="flex items-center font-sans">
            <Button
              size="sm"
              variant="ghost"
              motion="none"
              type="button"
              disabled={buildDisabled}
              onClick={() => onBuildPlan(plan.sessionId, block.id)}
              className={`  flex  items-center gap-1.5 disabled:cursor-not-allowed  ${
                session ? "" : ""
              }   `}
            >
              <Play className="size-3" />
              {buildLabel}
            </Button>
            {session && !remote ? (
              <BuildTargetButton
                from={session.harness}
                model={session.model}
                settings={session.modelSettings}
                disabled={buildDisabled}
                onPick={(target) => onBuildPlan(plan.sessionId, block.id, target)}
              />
            ) : null}
          </div>
        }
        source={
          <SurfaceSelection
            className="h-full"
            active={active && mode === "source"}
            contentVersion={block.text}
            sessionId={plan.sessionId}
            cwd={session?.cwd ?? file.cwd}
          >
            <textarea
              aria-label={t("Plan markdown")}
              spellCheck={false}
              value={block.text}
              disabled={
                remote ||
                block.plan?.status === "streaming" ||
                block.plan?.status === "building" ||
                block.plan?.status === "built"
              }
              onChange={(event) =>
                onUpdatePlan(plan.sessionId, block.id, event.currentTarget.value)
              }
              className="h-full w-full resize-none overflow-auto font-mono leading-6"
            />
          </SurfaceSelection>
        }
      />
    </div>
  );
}
