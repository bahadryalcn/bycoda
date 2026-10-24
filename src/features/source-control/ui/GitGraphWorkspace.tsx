import { Button } from "../../../shared/ui/Button";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { GitBranch, Loader, PanelLeft, MoreHorizontal } from "../../../shared/ui/icons";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
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
const ACTION = "shrink-0";
let inspectorWidth = 520;
let branchWidth = 240;
let changesHeight = 300;

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
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  // An explicit toggle survives resizing; otherwise use the space available to this workspace.
  const [rail, setRail] = useState<boolean | null>(null);
  const railVisible = rail ?? !compact;
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const resize = () => setCompact(workspace.clientWidth < 960);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);
  const [actionAnchor, setActionAnchor] = useState<HTMLElement | null>(null);
  const {
    width: railWidth,
    setPaneRef: setBranchPaneRef,
    separatorProps: branchSeparatorProps,
    onPointerDown: onBranchPointerDown,
    onDoubleClick: onBranchDoubleClick,
  } = useDragResize({
    min: 180,
    max: () =>
      Math.max(180, Math.min(400, (workspaceRef.current?.clientWidth ?? window.innerWidth) - 720)),
    initial: branchWidth,
    defaultWidth: 240,
    onCommit: (width) => {
      branchWidth = width;
    },
  });
  const {
    setPaneRef: setChangesPaneRef,
    separatorProps: changesSeparatorProps,
    onPointerDown: onChangesPointerDown,
    onDoubleClick: onChangesDoubleClick,
  } = useDragResize({
    axis: "vertical",
    min: 180,
    max: () => Math.max(180, window.innerHeight - 350),
    initial: changesHeight,
    defaultWidth: 300,
    onCommit: (height) => {
      changesHeight = height;
    },
  });
  const {
    setPaneRef: setInspectorPaneRef,
    separatorProps: inspectorSeparatorProps,
    onPointerDown: onInspectorPointerDown,
    onDoubleClick: onInspectorDoubleClick,
    dragging: inspectorDragging,
  } = useDragResize({
    min: 360,
    max: () =>
      Math.max(
        360,
        (workspaceRef.current?.clientWidth ?? window.innerWidth) -
          (railVisible ? railWidth : 0) -
          440,
      ),
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
    <div
      ref={workspaceRef}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--ui-surface)] text-content"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stroke bg-[var(--ui-surface)] px-3 py-2">
        <Button
          size="sm"
          iconOnly
          label={t("Toggle branches")}
          variant="ghost"
          motion="none"
          type="button"
          aria-label={t("Toggle branches")}
          aria-pressed={railVisible}
          onClick={() => setRail(!railVisible)}
        >
          <PanelLeft className="size-4" />
        </Button>
        <span title={cwd} className="max-w-48 truncate text-sm font-medium">
          {cwd.split(/[/\\]/).filter(Boolean).slice(-1)[0]}
        </span>
        <span className="mr-auto flex min-w-0 items-center gap-2 text-[12px] font-medium">
          <GitBranch className="size-4 text-accent" />
          <span className="max-w-44 truncate">{index.data?.branch ?? t("Detached HEAD")}</span>
          <span
            title={
              t("Outgoing commits") +
              `: ${index.data?.ahead ?? 0} · ` +
              t("Incoming commits") +
              `: ${index.data?.behind ?? 0}`
            }
            className="text-[11px] tabular-nums text-[var(--ui-text-secondary)]"
          >
            ↑{index.data?.ahead ?? 0} ↓{index.data?.behind ?? 0}
          </span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          disabled={!supported || !!busy || !index.data?.remote}
          onClick={() => void run("Fetching…", () => gitFetch(cwd))}
          className={ACTION}
        >
          {t("Fetch")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          disabled={!supported || !!busy || !index.data?.upstream || !!index.data?.operation}
          onClick={() => void run("Pulling…", () => gitPull(cwd))}
          className={ACTION}
        >
          {t("Pull")}
          {index.data?.behind ? (
            <span className="ms-1 tabular-nums">{index.data.behind}</span>
          ) : null}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          disabled={!supported || !!busy || !index.data?.remote || !!index.data?.operation}
          onClick={() => void run("Pushing…", () => gitPush(cwd))}
          className={ACTION}
        >
          {t("Push")}
          {index.data?.ahead ? <span className="ms-1 tabular-nums">{index.data.ahead}</span> : null}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          iconOnly
          label={t("Working tree actions")}
          title={t("Working tree actions")}
          aria-haspopup="menu"
          aria-expanded={!!actionAnchor}
          disabled={!supported || !!busy}
          onClick={(event) => setActionAnchor(actionAnchor ? null : event.currentTarget)}
        >
          <MoreHorizontal className="size-4" />
        </Button>
        {actionAnchor ? (
          <DropdownMenu
            anchor={actionAnchor}
            label={t("Working tree actions")}
            items={[
              {
                kind: "item",
                id: "stage",
                label: t("Stage All Changes"),
                disabled:
                  !!busy ||
                  !index.data?.files.some((file) => file.unstaged) ||
                  !!index.data?.conflicts?.length,
              },
              {
                kind: "item",
                id: "unstage",
                label: t("Unstage All Changes"),
                disabled: !!busy || !index.data?.files.some((file) => file.staged),
              },
              { kind: "sep" },
              {
                kind: "item",
                id: "stash",
                label: t("Stash"),
                disabled: !!busy || !index.data?.files.length || !!index.data?.conflicts?.length,
              },
            ]}
            onClose={() => setActionAnchor(null)}
            onPick={(id) => {
              setActionAnchor(null);
              if (id === "stage") void run("Staging…", () => gitStageAll(cwd));
              else if (id === "unstage") void run("Unstaging…", () => gitUnstageAll(cwd));
              else if (id === "stash") void run("Stashing…", () => gitStash(cwd));
            }}
          />
        ) : null}
        {busy ? (
          <span
            role="status"
            className="flex items-center gap-2 text-[12px] text-[var(--ui-text-secondary)]"
          >
            <Loader className="size-3.5 animate-spin" />
            {busy}
          </span>
        ) : null}
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
        {railVisible ? (
          <>
            <aside
              ref={setBranchPaneRef}
              className="flex max-h-full min-w-[180px] shrink-0 flex-col overflow-hidden bg-[var(--ui-surface)]"
            >
              <GitGraphBranches
                cwd={cwd}
                disabled={!supported || !!busy || !!index.data?.operation}
                run={run}
              />
              <div className="max-h-[35%] shrink-0 overflow-y-auto">
                <GitStashSection
                  cwd={cwd}
                  enabled
                  hasChanges={!!index.data?.files.length}
                  onOpenCommit={onCommit}
                />
              </div>
            </aside>
            <div
              {...branchSeparatorProps}
              aria-label={t("Resize branches")}
              onPointerDown={onBranchPointerDown}
              onDoubleClick={onBranchDoubleClick}
              className="w-1 shrink-0 cursor-col-resize touch-none bg-stroke"
            />
          </>
        ) : null}
        <section aria-label={t("Commit Graph")} className="flex min-w-[300px] flex-1 flex-col">
          <Button
            size="sm"
            variant="ghost"
            motion="none"
            type="button"
            aria-pressed={!commit}
            onClick={() => onCommit(null)}
            className={" flex  shrink-0 items-center justify-between gap-3 text-left "}
          >
            <span className="font-medium">{t("Working tree")}</span>
            <span className="text-[var(--ui-text-secondary)]">
              {index.data?.files.length ?? 0} {t("files")}
              {index.data?.conflicts?.length
                ? ` · ${index.data.conflicts.length} ${t("conflicts")}`
                : ""}
            </span>
          </Button>
          {graph}
        </section>
        <div
          {...inspectorSeparatorProps}
          aria-label={t("Resize inspector")}
          onPointerDown={onInspectorPointerDown}
          onDoubleClick={onInspectorDoubleClick}
          className={`w-1 shrink-0 cursor-col-resize touch-none focus-visible:bg-accent ${inspectorDragging ? "bg-accent" : "bg-stroke hover:bg-[var(--ui-tone-accent-subtle)]"}`}
        />
        <aside
          ref={setInspectorPaneRef}
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
              onClose={() => onCommit(null)}
            />
          ) : (
            <>
              <div ref={setChangesPaneRef} className="min-h-0 shrink-0 overflow-hidden">
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
              <div
                {...changesSeparatorProps}
                aria-label={t("Resize changes")}
                onPointerDown={onChangesPointerDown}
                onDoubleClick={onChangesDoubleClick}
                className="h-1 shrink-0 cursor-row-resize touch-none bg-stroke"
              />
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
