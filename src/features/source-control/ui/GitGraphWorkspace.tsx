import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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
import { GitBranch, PanelLeft, MoreHorizontal } from "../../../shared/ui/icons";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Sash } from "../../../shared/ui/Sash";
import { Tooltip } from "../../../shared/ui/Tooltip";
import {
  GIT_ACTIONS,
  GIT_CONFLICTS,
  useRemoteSupports,
} from "../../connections/public/remoteCapabilities";
import { useGitResource } from "../hooks/useGitResource";
import { setGitFeedback, useGitPanelState, withGitOperation } from "../model/gitPanelState";
import { invalidateGitIndex } from "../model/gitIndexStore";
import { invalidateWatchedFiles } from "../../files/public/fileWatch";
import { confirmNative } from "../model/gitConfirmation";
import { GitGraphBranches } from "./GitGraphBranches";
import { GitGraphCommitInspector } from "./GitGraphCommitInspector";
import { GitGraphConflictEditor } from "./GitGraphConflictEditor";
import { GitChangesPanel } from "./GitChangesPanel";
import { WorkingTreeDiff } from "./WorkingTreeDiff";
import { GitStashSection } from "./GitStashSection";
import { GitFeedback } from "./GitFeedback";
import { GitOperationBanner } from "./GitOperationBanner";

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

type SashPaneOptions = {
  /** `vertical` sash between columns resizes a width, `horizontal` a height. */
  orientation: "vertical" | "horizontal";
  min: number;
  max: () => number;
  initial: number;
  defaultSize: number;
  /** The pane grows when the sash moves away from it (a pane at the end edge). */
  inverse?: boolean;
  onCommit: (size: number) => void;
};

/**
 * Sizes one pane from a shared `Sash`. The drag writes the pane's style directly, so the graph
 * beside it does not re-render for every frame; the size is committed to state on release.
 */
function useSashPane({
  orientation,
  min,
  max,
  initial,
  defaultSize,
  inverse = false,
  onCommit,
}: SashPaneOptions) {
  const property = orientation === "vertical" ? "width" : "height";
  const limits = useRef({ min, max });
  limits.current = { min, max };
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const clamp = useCallback((value: number) => {
    const upper = Math.max(0, limits.current.max());
    return Math.min(upper, Math.max(Math.min(limits.current.min, upper), Math.round(value)));
  }, []);
  const [size, setSize] = useState(() => clamp(initial));
  const paneRef = useRef<HTMLElement | null>(null);
  const sizeRef = useRef(size);
  const start = useRef(size);
  const apply = useCallback(
    (next: number) => {
      sizeRef.current = next;
      if (paneRef.current) paneRef.current.style[property] = `${next}px`;
    },
    [property],
  );
  const setPaneRef = useCallback(
    (element: HTMLElement | null) => {
      paneRef.current = element;
      if (element) element.style[property] = `${sizeRef.current}px`;
    },
    [property],
  );
  // The size the user chose; a smaller window narrows the pane and a larger one restores it.
  const preferred = useRef(size);
  const dragging = useRef(false);
  const commit = (next: number) => {
    const value = clamp(next);
    preferred.current = value;
    apply(value);
    setSize(value);
    commitRef.current(value);
  };
  useEffect(() => {
    const resize = () => {
      if (dragging.current) return;
      const next = clamp(preferred.current);
      if (next === sizeRef.current) return;
      apply(next);
      setSize(next);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [apply, clamp]);
  const sashProps = {
    orientation,
    value: size,
    min,
    onResizeStart: () => {
      dragging.current = true;
      start.current = sizeRef.current;
    },
    onResize: (delta: number) => apply(clamp(start.current + (inverse ? -delta : delta))),
    onResizeEnd: (delta: number, info: { cancelled: boolean }) => {
      dragging.current = false;
      commit(info.cancelled ? start.current : start.current + (inverse ? -delta : delta));
    },
    onReset: () => commit(defaultSize),
    // Separator keys: Home/End jump to the smallest/largest size (arrows stay built in).
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      event.stopPropagation();
      commit(event.key === "Home" ? 0 : limits.current.max());
    },
  };
  return { size, setPaneRef, sashProps };
}

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
  const branchPane = useSashPane({
    orientation: "vertical",
    min: 180,
    max: () =>
      Math.max(180, Math.min(400, (workspaceRef.current?.clientWidth ?? window.innerWidth) - 720)),
    initial: branchWidth,
    defaultSize: 240,
    onCommit: (width) => {
      branchWidth = width;
    },
  });
  const railWidth = branchPane.size;
  const changesPane = useSashPane({
    orientation: "horizontal",
    min: 180,
    max: () => Math.max(180, window.innerHeight - 350),
    initial: changesHeight,
    defaultSize: 300,
    onCommit: (height) => {
      changesHeight = height;
    },
  });
  const inspectorPane = useSashPane({
    orientation: "vertical",
    min: 360,
    max: () =>
      Math.max(
        360,
        (workspaceRef.current?.clientWidth ?? window.innerWidth) -
          (railVisible ? railWidth : 0) -
          440,
      ),
    initial: inspectorWidth,
    defaultSize: 520,
    inverse: true,
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
  const folder = cwd.split(/[/\\]/).filter(Boolean).slice(-1)[0];
  const showBusy =
    busy &&
    !(conflict && (busy === t("Saving conflict resolution…") || busy === t("Resolving conflict…")));
  return (
    <Text
      ref={workspaceRef}
      as="div"
      size="inherit"
      tone="primary"
      {...surfaceAttributes({ variant: "workspace-panel" }, "flex min-h-0 min-w-0 flex-1 flex-col")}
    >
      <PaneHeader
        leading={
          <Button
            size="sm"
            iconOnly
            label={t("Toggle branches")}
            variant="ghost"
            motion="none"
            type="button"
            aria-pressed={railVisible}
            onClick={() => setRail(!railVisible)}
          >
            <PanelLeft className="icon-md" />
          </Button>
        }
        titleAs="div"
        title={
          <Tooltip label={cwd}>
            <span>{folder}</span>
          </Tooltip>
        }
        actions={
          <>
            {showBusy ? <LoadingText className="me-1">{busy}</LoadingText> : null}
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
              {index.data?.ahead ? (
                <span className="ms-1 tabular-nums">{index.data.ahead}</span>
              ) : null}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              motion="none"
              type="button"
              iconOnly
              label={t("Working tree actions")}
              aria-haspopup="menu"
              aria-expanded={!!actionAnchor}
              disabled={!supported || !!busy}
              onClick={(event) => setActionAnchor(actionAnchor ? null : event.currentTarget)}
            >
              <MoreHorizontal className="icon-md" />
            </Button>
          </>
        }
      >
        <GitBranch className="icon-md shrink-0" tone="accent" />
        <Text as="span" size="caption" tone="inherit" weight="medium" truncate className="max-w-44">
          {index.data ? (index.data.branch ?? t("Detached HEAD")) : "…"}
        </Text>
        <Tooltip
          label={
            t("Outgoing commits") +
            `: ${index.data?.ahead ?? 0} · ` +
            t("Incoming commits") +
            `: ${index.data?.behind ?? 0}`
          }
        >
          <Text size="caption" tone="secondary" className="tabular-nums">
            {index.data ? `↑${index.data.ahead ?? 0} ↓${index.data.behind ?? 0}` : null}
          </Text>
        </Tooltip>
      </PaneHeader>
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
              ref={branchPane.setPaneRef}
              className="flex max-h-full min-w-[180px] shrink-0 flex-col overflow-hidden"
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
            <Sash {...branchPane.sashProps} label={t("Resize branches")} />
          </>
        ) : null}
        {/* An explicitly reopened branch rail shares narrow windows with the inspector. The
            graph can yield to its compact commit column instead of pushing the inspector offscreen. */}
        <section aria-label={t("Commit Graph")} className="flex min-w-[180px] flex-1 flex-col">
          <div {...surfaceAttributes({ frame: "pane", edge: "bottom" }, "shrink-0")}>
            <Button
              size="sm"
              variant="item"
              motion="none"
              type="button"
              aria-pressed={!commit}
              selected={false}
              onClick={() => onCommit(null)}
              {...surfaceAttributes(
                { radius: "none" },
                "relative flex w-full items-center justify-between gap-3 text-left",
              )}
            >
              {commit ? null : (
                <span
                  aria-hidden
                  {...surfaceAttributes(
                    { radius: "pill", bar: "accent" },
                    "absolute inset-y-1 start-0 w-0.5",
                  )}
                />
              )}
              <Text as="span" size="inherit" tone="inherit" weight="medium">
                {t("Working tree")}
              </Text>
              <Text size="inherit" tone="secondary">
                {index.data?.files.length ?? 0} {t("files")}
                {index.data?.conflicts?.length
                  ? ` · ${index.data.conflicts.length} ${t("conflicts")}`
                  : ""}
              </Text>
            </Button>
          </div>
          {graph}
        </section>
        <Sash {...inspectorPane.sashProps} label={t("Resize inspector")} />
        <aside
          ref={inspectorPane.setPaneRef}
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
              <div ref={changesPane.setPaneRef} className="min-h-0 shrink-0 overflow-hidden">
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
              <Sash {...changesPane.sashProps} label={t("Resize changes")} />
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
    </Text>
  );
}
