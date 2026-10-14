import { useCallback, useEffect, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n/git";
import {
  gitDiffIndex,
  gitFetch,
  gitPull,
  gitPush,
  gitStash,
  gitStageAll,
  gitUnstageAll,
  notifyGitChanged,
  subscribeGitChanged,
  type GitFileDiffKind,
  type GitHistoryCommit,
} from "../../../platform/tauri/fs";
import { GitBranch, Loader, PanelLeft } from "../../../shared/ui/icons";
import {
  GIT_ACTIONS,
  GIT_CONFLICTS,
  useRemoteSupports,
} from "../../connections/model/remoteCapabilities";
import { useGitResource } from "../hooks/useGitResource";
import { setGitFeedback, useGitPanelState, withGitOperation } from "../model/gitPanelState";
import { invalidateGitIndex } from "../model/gitIndexStore";
import { invalidateWatchedFiles } from "../../files/model/fileWatch";
import { confirmNative } from "../model/gitConfirmation";
import { GitGraphBranches } from "./GitGraphBranches";
import { GitGraphCommitInspector } from "./GitGraphCommitInspector";
import { GitGraphConflictEditor } from "./GitGraphConflictEditor";
import { GitChangesPanel } from "./GitChangesPanel";
import { WorkingTreeDiff } from "./WorkingTreeDiff";
import { GitStashSection } from "./GitStashSection";
import { GitFeedback } from "./GitFeedback";
import { GitOperationBanner } from "./GitOperationBanner";
import { useDragResize } from "../../../shared/hooks/useDragResize";

type Props = {
  cwd: string;
  commit: GitHistoryCommit | null;
  commitMode?: "changes" | "blame";
  onCommitMode?: (mode: "changes" | "blame") => void;
  onCommit: (commit: GitHistoryCommit | null) => void;
  onDirty: (dirty: boolean) => void;
  onBranch: (commit: GitHistoryCommit) => void;
  graph: ReactNode;
};
const ACTION =
  "h-8 rounded-md border border-stroke px-3 text-[12px] text-content/85 hover:bg-content/8 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent";
let inspectorWidth = 520;

export function GitGraphWorkspace({
  cwd,
  commit,
  commitMode = "changes",
  onCommitMode,
  onCommit,
  onBranch,
  onDirty,
  graph,
}: Props) {
  useLocale();
  const supported = useRemoteSupports(cwd, GIT_ACTIONS) === true;
  const conflictSupported = useRemoteSupports(cwd, GIT_CONFLICTS) === true;
  const [busy] = useGitPanelState(cwd, "busy");
  const [feedback] = useGitPanelState(cwd, "feedback");
  const read = useCallback(() => gitDiffIndex(cwd), [cwd]);
  const index = useGitResource(cwd, `graph-index:${cwd}`, true, read);
  const [rail, setRail] = useState(true);
  const resize = useDragResize({
    min: 360,
    max: () => Math.max(360, window.innerWidth - (rail ? 208 : 0) - 370),
    initial: inspectorWidth,
    defaultWidth: 520,
    direction: "left",
    onCommit: (width) => {
      inspectorWidth = width;
    },
  });
  const [focus, setFocus] = useState<{
    path?: string;
    kind?: GitFileDiffKind;
    request: number;
  }>({ request: 0 });
  const [conflict, setConflict] = useState<{
    path: string;
    relative: string;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyChanged = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirty(value);
    },
    [onDirty],
  );
  useEffect(() => subscribeGitChanged(index.refresh, { cwd }), [cwd, index.refresh]);
  const changed = () => {
    invalidateGitIndex();
    index.refresh();
    invalidateWatchedFiles();
    notifyGitChanged(cwd, "refs");
  };
  const run = async (label: string, action: () => Promise<unknown>) => {
    if (!supported || busy) return false;
    if (dirty && label !== "Saving conflict resolution…" && label !== "Resolving conflict…") {
      if (!(await confirmNative(t("Discard the unsaved conflict resolution?"), t("Discard"))))
        return false;
      dirtyChanged(false);
      setConflict(null);
    }
    try {
      await withGitOperation(cwd, t(label), action);
      setGitFeedback(cwd, {
        kind: "success",
        title: t("Git operation complete"),
      });
      return true;
    } catch (error) {
      setGitFeedback(cwd, {
        kind: "error",
        title: t("Git operation failed"),
        detail: String(error),
      });
      onCommit(null);
      return false;
    } finally {
      changed();
    }
  };
  const leaveEditor = async () =>
    !dirty || (await confirmNative(t("Discard the unsaved conflict resolution?"), t("Discard")));
  const openFile = async (path: string, kind: GitFileDiffKind) => {
    if (!(await leaveEditor())) return;
    setConflict(null);
    setFocus((previous) => ({ path, kind, request: previous.request + 1 }));
  };
  const openConflict = async (path: string) => {
    if (!(await leaveEditor())) return;
    const relative =
      index.data?.conflicts?.find((file) => file.path === path)?.relative ??
      path.slice(cwd.length + 1).replace(/\\/g, "/");
    setConflict({ path, relative });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background-base text-content">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stroke bg-content/3 px-3 py-2">
        <button
          type="button"
          aria-label={t("Toggle branches")}
          aria-pressed={rail}
          onClick={() => setRail(!rail)}
          className="grid size-8 place-items-center rounded-md hover:bg-content/10"
        >
          <PanelLeft className="size-4" />
        </button>
        <span className="mr-2 flex min-w-0 items-center gap-2 text-[12px] font-medium">
          <GitBranch className="size-4 text-accent" />
          <span className="max-w-44 truncate">{index.data?.branch ?? t("Detached HEAD")}</span>
          <span className="text-[11px] text-content/60">
            ↑{index.data?.ahead ?? 0} ↓{index.data?.behind ?? 0}
          </span>
        </span>
        <button
          type="button"
          disabled={!supported || !!busy || !index.data?.remote}
          onClick={() => void run("Fetching…", () => gitFetch(cwd))}
          className={ACTION}
        >
          {t("Fetch")}
        </button>
        <button
          type="button"
          disabled={!supported || !!busy || !index.data?.upstream || !!index.data?.operation}
          onClick={() => void run("Pulling…", () => gitPull(cwd))}
          className={ACTION}
        >
          {t("Pull")}
        </button>
        <button
          type="button"
          disabled={!supported || !!busy || !index.data?.remote || !!index.data?.operation}
          onClick={() => void run("Pushing…", () => gitPush(cwd))}
          className={ACTION}
        >
          {t("Push")}
        </button>
        <button
          type="button"
          disabled={
            !supported || !!busy || !index.data?.files.length || !!index.data?.conflicts?.length
          }
          onClick={() => void run("Stashing…", () => gitStash(cwd))}
          className={ACTION}
        >
          {t("Stash")}
        </button>
        <button
          type="button"
          disabled={
            !supported ||
            !!busy ||
            !index.data?.files.some((file) => file.unstaged) ||
            !!index.data?.conflicts?.length
          }
          onClick={() => void run("Staging…", () => gitStageAll(cwd))}
          className={ACTION}
          title={t("Stage All Changes")}
        >
          {t("Stage")}
        </button>
        <button
          type="button"
          disabled={!supported || !!busy || !index.data?.files.some((file) => file.staged)}
          onClick={() => void run("Unstaging…", () => gitUnstageAll(cwd))}
          className={ACTION}
        >
          {t("Unstage")}
        </button>
        {busy ? (
          <span role="status" className="flex items-center gap-2 text-[12px] text-content/65">
            <Loader className="size-3.5 animate-spin" />
            {busy}
          </span>
        ) : null}
        <span title={cwd} className="ml-auto max-w-60 truncate text-[11px] text-content/50">
          {cwd.split(/[/\\]/).slice(-1)[0]}
        </span>
      </div>
      {index.error ? (
        <GitFeedback
          title={t("Couldn’t load source control")}
          detail={index.error}
          onRetry={index.refresh}
        />
      ) : null}
      {feedback && commit ? (
        <GitFeedback
          kind={feedback.kind}
          title={feedback.title}
          detail={feedback.detail}
          onDismiss={() => setGitFeedback(cwd, null)}
        />
      ) : null}
      {commit && index.data?.operation ? (
        <GitOperationBanner
          cwd={cwd}
          operation={index.data.operation}
          conflictCount={index.data.conflicts?.length ?? 0}
          onChanged={changed}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        {rail ? (
          <aside className="flex w-52 shrink-0 flex-col border-r border-stroke bg-content/2 max-h-full">
            <GitGraphBranches
              cwd={cwd}
              disabled={!supported || !!busy || !!index.data?.operation}
              run={run}
            />
            <div className="max-h-[35%] overflow-y-auto">
              <GitStashSection
                cwd={cwd}
                enabled
                hasChanges={!!index.data?.files.length}
                onOpenCommit={onCommit}
              />
            </div>
          </aside>
        ) : null}
        <section aria-label={t("Commit Graph")} className="flex min-w-[300px] flex-1 flex-col">
          <button
            type="button"
            aria-pressed={!commit}
            onClick={() => onCommit(null)}
            className={`flex h-11 shrink-0 items-center justify-between gap-3 border-b border-stroke px-3 text-left text-[12px] ${!commit ? "bg-selection" : "hover:bg-content/5"}`}
          >
            <span className="font-medium">{t("Working tree")}</span>
            <span className="text-content/65">
              {index.data?.files.length ?? 0} {t("files")}
              {index.data?.conflicts?.length
                ? ` · ${index.data.conflicts.length} ${t("conflicts")}`
                : ""}
            </span>
          </button>
          {graph}
        </section>
        <div
          {...resize.separatorProps}
          aria-label={t("Resize inspector")}
          onPointerDown={resize.onPointerDown}
          onDoubleClick={resize.onDoubleClick}
          className={`w-1 shrink-0 cursor-col-resize touch-none focus-visible:bg-accent ${resize.dragging ? "bg-accent" : "bg-stroke hover:bg-accent/50"}`}
        />
        <aside
          ref={resize.setPaneRef}
          aria-label={t("Git inspector")}
          className="flex min-w-[360px] shrink-0 flex-col"
        >
          {commit ? (
            <GitGraphCommitInspector
              disabled={!supported || !!busy || !!index.data?.operation}
              key={`${cwd}:${commit.sha}`}
              cwd={cwd}
              commit={commit}
              mode={commitMode}
              onMode={onCommitMode}
              onBranch={() => onBranch(commit)}
            />
          ) : (
            <>
              <div className="h-[43%] min-h-[220px] shrink-0 border-b border-stroke">
                <GitChangesPanel
                  cwd={cwd}
                  enabled
                  embedded
                  selectedPath={focus.path}
                  selectedKind={focus.kind}
                  onOpenCommit={onCommit}
                  onOpenFile={(path, kind) => void openFile(path, kind)}
                  onOpenInEditor={conflictSupported ? (path) => void openConflict(path) : undefined}
                  onOpenAllChanges={(kind) => void openFile("", kind)}
                />
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                {conflict ? (
                  <GitGraphConflictEditor
                    key={`${cwd}:${conflict.relative}`}
                    cwd={cwd}
                    path={conflict.path}
                    relative={conflict.relative}
                    disabled={!supported || !!busy}
                    run={run}
                    onDirty={dirtyChanged}
                    onResolved={() => {
                      dirtyChanged(false);
                      setConflict(null);
                    }}
                  />
                ) : (
                  <WorkingTreeDiff
                    cwd={cwd}
                    focusPath={focus.path}
                    focusKind={focus.kind}
                    focusRequest={focus.request}
                  />
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
