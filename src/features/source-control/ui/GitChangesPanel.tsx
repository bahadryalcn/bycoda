import { relativeDirname as dirname } from "../../../shared/lib/paths";
import { useOwnedTimeout } from "../../../shared/hooks/useOwnedTimeout";
import { t, useLocale } from "../../../shared/i18n/git";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  ExternalLink,
  FileDiff,
  FolderTree,
  GitPullRequest,
  ListBullet,
  Loader,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
  WandSparkles,
  X,
} from "../../../shared/ui/icons";
import {
  createContext,
  useContext,
  type MouseEvent as ReactMouseEvent,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { selectTreePaths, type TreeSelectionModifiers } from "../../files/model/treeSelection";
import { useChangedFileMenu } from "../../files/ui/useChangedFileMenu";
import {
  GitHistoryGraph,
  GraphResizeSash,
  GRAPH_PANEL_DEFAULT,
  GRAPH_PANEL_MIN,
  loadGraphPanelHeight,
  saveGraphPanelHeight,
} from "./GitHistoryGraph";
// Loaded on demand: it brings the diff view and CodeMirror with it.
const GitConflictCompare = lazy(() =>
  import("./GitConflictCompare").then((module) => ({
    default: module.GitConflictCompare,
  })),
);
import { GitConflictRows } from "./GitConflictRows";
import { GitOperationBanner } from "./GitOperationBanner";
import { GitStashSection } from "./GitStashSection";
import { GitActionsMenu, type ChangesActions } from "./GitActionsMenu";
import { BranchPicker } from "./BranchPicker";
import { applyCommit, applyIndexAction, type IndexAction } from "../model/optimisticIndex";
import { AUTO_FETCH_MS, loadAutoFetch, saveAutoFetch } from "../model/autoFetch";
import {
  basename,
  gitCommit,
  gitDiffIndex,
  gitDiscardAll,
  gitDiscardFile,
  gitFetch,
  gitTrustRepository,
  gitHeadMessage,
  gitPrCreate,
  gitPrStatus,
  gitPush,
  gitRangeContext,
  gitStageAll,
  gitStageFile,
  gitSync,
  gitUnstageAll,
  gitUnstageFile,
  subscribeGitChanged,
  type GitChangedFile,
  type GitChangeScope,
  type GitDiffIndex,
  type GitFileDiffKind,
  type GitHistoryCommit,
  type GitPr,
} from "../../../platform/tauri/fs";
import type { HarnessId } from "../../sessions/model/session";
import { recordInboxSelfActivity } from "../../inbox/model/inboxSelfActivity";
import {
  loadChangesView,
  saveChangesView,
  type ChangesView,
} from "../../settings/model/appearance";
import { generateCommitMessage, generatePrContent } from "../../../integrations/harness";
import { invalidateWatchedFiles } from "../../files/model/fileWatch";
import { MOD } from "../../../platform/tauri/platform";
import { applyProjectDiffStats } from "../hooks/useProjectDiffStats";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { isRemoteProjectPath } from "../../projects/model/recents";
import {
  GIT_ACTIONS,
  GIT_CONFLICTS,
  useRemoteSupports,
} from "../../connections/model/remoteCapabilities";
import {
  remotePollDue,
  reportRemoteLoad,
  useRemoteLoadFailure,
} from "../../connections/model/remoteHealth";
import { RemoteLoadError } from "../../connections/ui/RemoteLoadError";
import type { CommitMenuOptions } from "../model/gitActionsMenu";
import {
  commitBlockedMessage,
  needsLegacyConflictPoll,
  resolveConflictState,
  sameConflicts,
  type ConflictRow,
} from "../model/conflictSection";
import { useConflictActions } from "../hooks/useConflictActions";
import {
  gitPanelRuntime,
  useGitPanelState,
  setGitFeedback,
  withGitOperation,
} from "../model/gitPanelState";
import { useLegacyConflictStatus } from "../hooks/useLegacyConflictStatus";
import { confirmNative, confirmDiscardFile } from "../model/gitConfirmation";
import {
  fetchGitIndex,
  invalidateGitIndex,
  notifyGitChangedWith,
  type GitChangeHint,
} from "../model/gitIndexStore";

import { GitFeedback } from "./GitFeedback";
import { useGitResource } from "../hooks/useGitResource";
import { GitGenerationSettings, useGitGenerationChoice } from "./GitGenerationSettings";

export const GIT_POLL_MS = 15_000;

let stagedOpen = true;
let changesOpen = true;
let conflictsOpen = true;
let graphOpen = true;
let changesView: ChangesView = loadChangesView();
/** Folders the user collapsed in tree view, keyed `<kind>:<dir>`. */
const collapsedDirs = new Set<string>();
const indexByCwd = new Map<string, GitDiffIndex>();

/** Observations already contain a fresh index; mutations need a new read. */
let announcingObservedChange = false;

function announceGitChange(cwd: string, scope: GitChangeScope, hint: GitChangeHint = {}) {
  announcingObservedChange = hint.observed === true;
  try {
    notifyGitChangedWith(cwd, scope, hint);
  } finally {
    announcingObservedChange = false;
  }
}

const ACTION_LABEL: Record<IndexAction, string> = {
  get stage() {
    return t("Staging…");
  },
  get unstage() {
    return t("Unstaging…");
  },
  get discard() {
    return t("Discarding…");
  },
};

/** What the header says while `busy` is held and no step named itself. */
function busyLabel(busy: string): string {
  if (busy === "commit") return t("Committing…");
  if (busy === "pr") return t("Creating pull request…");
  if (busy === "sync") return t("Syncing…");
  if (busy === "generate") return t("Generating message…");
  if (busy in ACTION_LABEL) return ACTION_LABEL[busy as IndexAction];
  return t("Working…");
}

type Props = {
  /** Embedded in the graph workspace; its own history and stash rail stay outside. */
  embedded?: boolean;
  /** A compact row in the workspace's normal Source Control panel. */
  repository?: { name: string; expanded?: boolean; onToggle: (expanded: boolean) => void };
  cwd: string;
  enabled: boolean;
  textHarness?: HarnessId;
  selectedPath?: string;
  selectedKind?: GitFileDiffKind;
  selectedSha?: string;
  onOpenFile: (path: string, kind: GitFileDiffKind, pin?: boolean) => void;
  /** Opens a conflicted file in the editor, where its blocks can be resolved. */
  onOpenInEditor?: (path: string, pin?: boolean) => void;
  onOpenAllChanges: (kind: GitFileDiffKind) => void;
  onOpenCommit: (commit: GitHistoryCommit, pin?: boolean) => void;
};

export function GitChangesPanel({
  embedded = false,
  repository,
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
  const { index, reload, showOptimistic, error: loadError, loading } = useDiffIndex(cwd, enabled);
  // Fetch, and the merge status of a host that predates conflict info, need
  // this computer or a host with `git.actions`.
  const gitActions = useRemoteSupports(cwd, GIT_ACTIONS) === true;
  const legacyConflicts = useLegacyConflictStatus(
    cwd,
    enabled && gitActions && needsLegacyConflictPoll(index),
  );
  const conflictState = useMemo(
    () => resolveConflictState(cwd, index, legacyConflicts),
    [cwd, index, legacyConflicts],
  );
  const { files, conflicts, operation } = conflictState;
  const paneRef = useRef<HTMLDivElement>(null);
  // Lets the header menu drive the commit box and bulk stage actions below.
  const changesRef = useRef<ChangesActions | null>(null);
  // Shared across the header and the changed-files list so no two Git
  // mutations ever run against the same checkout at once.
  const [busy, setBusy] = useGitPanelState(cwd, "busy");
  const [status, setStatus] = useGitPanelState(cwd, "status");
  // The step a running action is on ("Pushing…"), shown beside the spinner.
  const [pending, setPending] = useGitPanelState(cwd, "pending");
  const [feedback] = useGitPanelState(cwd, "feedback");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [graphHeight, setGraphHeight] = useState(loadGraphPanelHeight);
  const [graphExpanded, setGraphExpanded] = useState(graphOpen);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 4000);
    return () => window.clearTimeout(timer);
  }, [status, setStatus]);

  useEffect(() => {
    if (feedback?.kind !== "success") return;
    const timer = window.setTimeout(() => {
      if (gitPanelRuntime(cwd).state.feedback === feedback) setGitFeedback(cwd, null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [cwd, feedback]);

  const canFetch = gitActions && Boolean(index?.remote);
  const [autoFetch, setAutoFetch] = useState(loadAutoFetch);

  const deferInvalidation = useOwnedTimeout();
  const onMutated = (paths?: string[], scope: GitChangeScope = "refs") => {
    // Our own action: the reload must not be answered from a shared result
    // read before it.
    invalidateGitIndex();
    reload();
    announceGitChange(cwd, scope, scope === "index" ? { paths } : {});
    invalidateWatchedFiles(paths);
    deferInvalidation(() => invalidateWatchedFiles(paths), 150);
  };

  useEffect(() => {
    if (!enabled || !autoFetch || !canFetch) return;
    const timer = window.setInterval(() => {
      if (document.hidden || !remotePollDue(cwd) || gitPanelRuntime(cwd).state.busy) return;
      // Quiet: a failed background fetch should not interrupt with a dialog.
      void withGitOperation(cwd, "Fetching…", () => gitFetch(cwd)).then(
        () => {
          setFetchError(null);
          reload();
          announceGitChange(cwd, "refs");
        },
        (error) => setFetchError(error instanceof Error ? error.message : String(error)),
      );
    }, AUTO_FETCH_MS);
    return () => window.clearInterval(timer);
  }, [autoFetch, canFetch, cwd, enabled, reload]);

  useLayoutEffect(() => {
    if (embedded || repository) return;
    const pane = paneRef.current;
    if (!pane || pane.clientHeight < GRAPH_PANEL_MIN + 160) return;
    const max = pane.clientHeight - 160;
    if (graphHeight > max) {
      setGraphHeight(max);
      saveGraphPanelHeight(max);
    }
  }, [graphHeight, embedded, repository]);

  if (!cwd || cwd === "~") {
    return <p className="px-3 py-2 text-[12px] text-content/50">{t("No project folder")}</p>;
  }

  const detailsOpen = !repository || (repository.expanded ?? !!operation);
  return (
    <div
      ref={paneRef}
      data-git-repository={repository ? cwd : undefined}
      className={`@container/changes flex min-h-0 flex-col ${repository ? "shrink-0 border-b border-stroke" : "h-full flex-1 overflow-hidden"}`}
    >
      <header
        className={`flex shrink-0 items-center gap-1.5 px-2 ${repository ? "min-h-7 flex-wrap py-0.5" : "h-9 border-b border-stroke"}`}
      >
        {repository ? (
          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => repository.onToggle(!detailsOpen)}
            title={cwd}
            className="flex min-w-0 flex-[1_1_7rem] items-center gap-1 rounded text-left text-xs font-medium text-content hover:bg-content/8 active:bg-selection focus-visible:outline-2 focus-visible:outline-accent"
          >
            {detailsOpen ? (
              <ChevronDown className="size-3 shrink-0" />
            ) : (
              <ChevronRight className="size-3 shrink-0" />
            )}
            <span className="truncate">{repository.name}</span>
            {index ? (
              <span className="shrink-0 text-[10px] tabular-nums text-content/50">
                {files.length + conflicts.length}
              </span>
            ) : null}
          </button>
        ) : (
          <span className="shrink-0 text-[12px] font-medium text-content">{t("Changes")}</span>
        )}
        {busy ? (
          <span
            role="status"
            className="flex min-w-0 items-center gap-1 text-[11px] text-content/50"
          >
            <Loader className="size-3 shrink-0 animate-spin" strokeWidth={1.75} />
            <span className="min-w-0 truncate">{pending ?? busyLabel(busy)}</span>
          </span>
        ) : status ? (
          <span role="status" className="min-w-0 truncate text-[11px] text-content/50">
            {status}
          </span>
        ) : null}
        <div
          className={`ms-auto flex min-w-0 items-center gap-1 ${repository ? "max-w-full flex-wrap justify-end" : ""}`}
        >
          <button
            type="button"
            aria-label={t("Refresh source control")}
            title={t("Refresh source control")}
            disabled={!enabled || !!busy || loading}
            className="rounded p-1 text-content/60 hover:bg-content/10 hover:text-content disabled:opacity-40"
            onClick={() => {
              onMutated();
              changesRef.current?.refreshPr?.();
            }}
          >
            <RefreshCw aria-hidden className="size-3.5" strokeWidth={1.75} />
          </button>
          {index?.repository !== false && (index?.branch || repository) ? (
            <span
              className={`flex min-w-0 items-center gap-1 text-[11px] text-content/50 ${repository ? "max-w-[min(12rem,35cqi)]" : ""}`}
            >
              <BranchPicker
                key={cwd}
                cwd={cwd}
                branch={index?.branch ?? undefined}
                enabled={enabled && !busy && !loading}
                popoverSide="bottom"
                onChange={() => {
                  onMutated();
                  changesRef.current?.refreshPr?.();
                }}
              />
              {(index?.ahead ?? 0) > 0 ? (
                <span className="shrink-0 tabular-nums text-content/40">↑{index?.ahead}</span>
              ) : null}
              {(index?.behind ?? 0) > 0 ? (
                <span className="shrink-0 tabular-nums text-content/40">↓{index?.behind}</span>
              ) : null}
            </span>
          ) : null}
          {index ? (
            <GitActionsMenu
              cwd={cwd}
              index={index}
              busy={busy}
              setBusy={setBusy}
              autoFetch={autoFetch}
              onToggleAutoFetch={() => {
                saveAutoFetch(!autoFetch);
                setAutoFetch(!autoFetch);
              }}
              changes={changesRef}
              onStatus={setStatus}
              onPending={setPending}
              onMutated={onMutated}
              onOpenCommit={onOpenCommit}
              toolbar={!!repository}
              onRevealChanges={repository ? () => repository.onToggle(true) : undefined}
            />
          ) : null}
        </div>
      </header>
      {repository && operation && !detailsOpen ? (
        <span className="px-2 text-[11px] text-amber-400">{operation}</span>
      ) : null}
      {repository && loadError && !detailsOpen ? (
        <p role="alert" className="break-words px-2 text-xs text-content/60">
          {loadError}
        </p>
      ) : null}
      {loadError?.includes("dubious ownership") ? (
        <button
          type="button"
          disabled={!enabled || !!busy}
          className="rounded px-2 py-1 text-xs text-accent hover:bg-content/10 active:bg-selection focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
          onClick={async () => {
            if (
              !(await confirmNative(
                t(
                  "Trust Git repository at {path}? This adds only this path to Git safe.directory.",
                ).replace("{path}", cwd),
                t("Trust this repository"),
              ))
            )
              return;
            setBusy("trust");
            try {
              await gitTrustRepository(cwd);
              onMutated();
            } catch (error) {
              setGitFeedback(cwd, {
                kind: "error",
                title: t("Could not trust repository"),
                detail: String(error),
              });
            } finally {
              setBusy(null);
            }
          }}
        >
          {t("Trust this repository")}
        </button>
      ) : null}
      {feedback ? (
        <>
          <GitFeedback
            kind={feedback.kind}
            title={feedback.title}
            detail={feedback.detail}
            onDismiss={() => setGitFeedback(cwd, null)}
            onRetry={
              feedback.retry && !busy
                ? () =>
                    void feedback.retry?.().catch((error) =>
                      setGitFeedback(cwd, {
                        kind: "error",
                        get title() {
                          return t("Retry failed");
                        },
                        detail: String(error),
                        retry: feedback.retry,
                      }),
                    )
                : undefined
            }
          />
          {feedback.url ? (
            <button
              type="button"
              className="mx-3 mb-2 text-left text-[12px] text-content/70 underline"
              onClick={() =>
                void openUrl(feedback.url!).catch((error) =>
                  setGitFeedback(cwd, { ...feedback, detail: String(error) }),
                )
              }
            >
              {t("Open pull request")}
            </button>
          ) : null}
        </>
      ) : null}
      {fetchError ? (
        <GitFeedback
          kind="warning"
          title={t("Automatic fetch failed; sync counts may be outdated")}
          detail={fetchError}
          onDismiss={() => setFetchError(null)}
        />
      ) : null}
      {detailsOpen && operation && gitActions ? (
        <GitOperationBanner
          cwd={cwd}
          operation={operation}
          conflictCount={conflicts.length}
          onChanged={() => onMutated()}
        />
      ) : null}
      <div className={detailsOpen ? "contents" : "hidden"}>
        <ChangedFiles
          cwd={cwd}
          textHarness={textHarness}
          index={index}
          loadError={loadError}
          loading={loading}
          files={files}
          conflicts={conflicts}
          selected={selectedPath}
          selectedKind={selectedKind}
          enabled={enabled}
          fill={!repository}
          busy={busy}
          setBusy={setBusy}
          pending={pending}
          setPending={setPending}
          showOptimistic={showOptimistic}
          actionsRef={changesRef}
          onOpenFile={onOpenFile}
          onOpenInEditor={onOpenInEditor}
          onOpenAllChanges={onOpenAllChanges}
          onMutated={onMutated}
        />
      </div>
      {!embedded ? (
        <GitStashSection
          cwd={cwd}
          enabled={enabled}
          hasChanges={files.length > 0 || conflicts.length > 0}
          onOpenCommit={onOpenCommit}
        />
      ) : null}
      {!embedded && graphExpanded ? (
        <GraphResizeSash
          height={graphHeight}
          onHeightPaint={setGraphHeight}
          onHeightCommit={(next) => {
            setGraphHeight(next);
            saveGraphPanelHeight(next);
          }}
          maxHeight={() => {
            const pane = paneRef.current;
            if (!pane) return GRAPH_PANEL_DEFAULT * 2;
            return Math.max(GRAPH_PANEL_MIN, pane.clientHeight - 160);
          }}
        />
      ) : null}
      {!embedded ? (
        <div
          className={`shrink-0 overflow-hidden border-t border-stroke ${
            graphExpanded ? "min-h-0" : "h-7"
          }`}
          // Cap the shown height, not the saved one, so a shorter window keeps the
          // file list visible and the chosen height returns when it grows again.
          style={
            graphExpanded ? { height: graphHeight, maxHeight: "calc(100% - 160px)" } : undefined
          }
        >
          <GitHistoryGraph
            cwd={cwd}
            enabled={enabled}
            expanded={graphExpanded}
            selectedSha={selectedSha}
            onToggleExpanded={() => {
              graphOpen = !graphExpanded;
              setGraphExpanded(graphOpen);
            }}
            onOpenCommit={onOpenCommit}
          />
        </div>
      ) : null}
    </div>
  );
}

function ChangedFiles({
  cwd,
  textHarness,
  index,
  loadError,
  loading,
  files,
  conflicts,
  selected,
  selectedKind,
  enabled,
  fill,
  busy,
  setBusy,
  pending,
  setPending,
  showOptimistic,
  actionsRef,
  onOpenFile,
  onOpenInEditor,
  onOpenAllChanges,
  onMutated,
}: {
  cwd: string;
  textHarness?: HarnessId;
  index: GitDiffIndex | null;
  loadError: string | null;
  loading: boolean;
  files: GitChangedFile[];
  /** Unmerged files, listed first and never as ordinary changes. */
  conflicts: ConflictRow[];
  selected?: string;
  selectedKind?: GitFileDiffKind;
  enabled: boolean;
  fill: boolean;
  busy: string | null;
  setBusy: (value: string | null) => void;
  pending: string | null;
  setPending: (value: string | null) => void;
  /** Shows the index an action is about to produce, ahead of the reload. */
  showOptimistic: (next: GitDiffIndex) => void;
  /** Filled with the handlers the header menu calls into. */
  actionsRef: RefObject<ChangesActions | null>;
  onOpenFile: (path: string, kind: GitFileDiffKind, pin?: boolean) => void;
  onOpenInEditor?: (path: string, pin?: boolean) => void;
  onOpenAllChanges: (kind: GitFileDiffKind) => void;
  onMutated: (paths?: string[], scope?: GitChangeScope) => void;
}) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const failure = useRemoteLoadFailure(cwd, "changes");
  const menuRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const runtime = gitPanelRuntime(cwd);
  const generateAbortRef = runtime.generateAbort;
  // Generating reads the changes without touching the index, so it does not
  // take `busy` and files can be staged while it runs.
  const [generating, setGenerating] = useGitPanelState(cwd, "generating");
  const fileActions = runtime.fileActions;
  const [message, setMessage] = useGitPanelState(cwd, "message");
  const [generationChoice, setGenerationChoice] = useGitGenerationChoice(cwd);
  const [amendTarget, setAmendTarget] = useGitPanelState(cwd, "amendTarget");
  const amend = amendTarget !== null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [stagedExpanded, setStagedExpanded] = useState(stagedOpen);
  const [changesExpanded, setChangesExpanded] = useState(changesOpen);
  const [conflictsExpanded, setConflictsExpanded] = useState(conflictsOpen);
  const [compareFile, setCompareFile] = useState<string | null>(null);
  const canCompare = useRemoteSupports(cwd, GIT_CONFLICTS) === true;
  const conflictActions = useConflictActions({ cwd, busy, setBusy, onMutated });
  // Git refuses to commit with unmerged paths; say which, instead of its error.
  const blockedMessage = commitBlockedMessage(conflicts);
  const [view, setView] = useState<ChangesView>(changesView);
  const {
    pr,
    reload: reloadPr,
    loading: prLoading,
    error: prError,
  } = usePrStatus(cwd, index?.branch, !!index?.remote);
  const staged = useMemo(() => files.filter((file) => file.staged), [files]);
  const unstaged = useMemo(() => files.filter((file) => file.unstaged), [files]);
  const hasRemote = Boolean(index?.remote);
  const hasOpenPr = pr?.state === "open";
  const diverged = (index?.ahead ?? 0) > 0 && (index?.behind ?? 0) > 0;
  const onDefault =
    !!index?.branch && !!index.defaultBranch && index.branch === index.defaultBranch;
  const committing = busy === "commit" || busy === "pr";
  const canGenerate = files.length > 0 && !committing && !isRemoteProjectPath(cwd);
  const canCommit =
    (staged.length > 0 || amend) &&
    message.trim().length > 0 &&
    !busy &&
    !generating &&
    !blockedMessage;
  const canCreatePr =
    hasRemote &&
    !!index?.branch &&
    !!index.defaultBranch &&
    !hasOpenPr &&
    !prLoading &&
    !prError &&
    !onDefault &&
    !diverged &&
    files.length === 0 &&
    conflicts.length === 0 &&
    (index?.aheadOfDefault ?? 0) > 0 &&
    (index?.behind ?? 0) === 0;
  const canViewPr = hasOpenPr && !!pr?.url;
  const canPublish = hasRemote && !!index?.branch && !index?.upstream;
  const canSync =
    hasRemote && Boolean(index?.upstream) && ((index?.ahead ?? 0) > 0 || (index?.behind ?? 0) > 0);
  const canCommitPush = canCommit && hasRemote && !diverged && (!amend || !index?.headPushed);
  const canCommitPushPr = canCommitPush && !hasOpenPr && !prLoading && !prError && !onDefault;
  // Drafting is independent of staging. Commit and generation retain their
  // own eligibility checks and every checkout retains its own message.
  const canEditMessage = !committing && !generating;

  useEffect(() => {
    if (!amendTarget || !index) return;
    if (amendTarget.branch === index?.branch && amendTarget.head === index?.head) {
      return;
    }
    setAmendTarget(null);
    setMessage("");
  }, [amendTarget, index?.branch, index?.head]);
  const canOpenMenu = !!index?.branch && !busy;

  useEffect(() => {
    if (!enabled) return;
    const el = messageRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [message, enabled]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [menuOpen]);

  const toggleView = () => {
    changesView = view === "tree" ? "list" : "tree";
    saveChangesView(changesView);
    setView(changesView);
  };

  const fail = (error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    setGitFeedback(cwd, {
      kind: "error",
      get title() {
        return t("Git operation failed");
      },
      detail: text,
    });
  };

  const recordPrActivity = (number = pr?.number) => {
    if (!number) return;
    recordInboxSelfActivity({
      provider: "github",
      kind: "pr",
      number,
      projectPath: cwd,
    });
  };

  const confirmDefault = async (kind: "push" | "pr") => {
    if (!onDefault || !index?.branch) return true;
    const branch = index.branch;
    return confirmNative(
      kind === "pr"
        ? `Create a pull request from default branch "${branch}"?`
        : `Push to default branch "${branch}"?`,
    );
  };

  const run = async (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
    confirmed = false,
    optimisticIndex?: GitDiffIndex,
  ) => {
    const queue = fileActions.current;
    // File actions queue behind each other; any other action holds them off.
    if (gitPanelRuntime(cwd).state.busy && queue.size === 0) return;
    if (action === "discard" && !confirmed) {
      const ok = await confirmDiscardFile(file);
      if (!ok) return;
    }
    if (gitPanelRuntime(cwd).state.busy && queue.size === 0) return;
    if (queue.size === 0) setGitFeedback(cwd, null);
    queue.size += 1;
    queue.paths.push(file.path);
    setBusy(file.relative);
    setPending(ACTION_LABEL[action]);
    // The row moves at once; the reload below confirms it or puts it back.
    if (index) showOptimistic(optimisticIndex ?? applyIndexAction(index, action, file.relative));
    // One git command at a time: two would fight over the index lock.
    const task = queue.tail.then(async () => {
      try {
        if (action === "stage") await gitStageFile(cwd, file.relative);
        else if (action === "unstage") await gitUnstageFile(cwd, file.relative);
        else await gitDiscardFile(cwd, file.relative);
      } catch (error) {
        fail(error);
      }
    });
    queue.tail = task;
    await task;
    queue.size -= 1;
    if (queue.size > 0) return;
    // Reloading earlier would put back the rows of actions still queued.
    onMutated(queue.paths.splice(0), "index");
    setBusy(null);
    setPending(null);
  };

  const runSelection = async (
    selectedFiles: GitChangedFile[],
    action: "stage" | "unstage" | "discard",
  ) => {
    if (!selectedFiles.length) return;
    if (selectedFiles.length === 1) return run(selectedFiles[0], action);
    if (gitPanelRuntime(cwd).state.busy && fileActions.current.size === 0) return;
    if (action === "discard") {
      const ok = await confirmNative(
        `Discard changes in ${selectedFiles.length} selected files? Untracked files will be deleted. This cannot be undone.`,
        "Discard",
      );
      if (!ok || (gitPanelRuntime(cwd).state.busy && fileActions.current.size === 0)) return;
    }
    // Enqueue together; the existing queue serializes Git commands and reloads once.
    let nextIndex = index;
    await Promise.all(
      selectedFiles.map((file) => {
        if (nextIndex) nextIndex = applyIndexAction(nextIndex, action, file.relative);
        return run(file, action, true, nextIndex ?? undefined);
      }),
    );
  };

  const runAll = async (action: "stage" | "unstage" | "discard") => {
    if (gitPanelRuntime(cwd).state.busy) return;
    if (action === "discard") {
      const n = unstaged.length;
      if (n === 0) return;
      const only = unstaged[0];
      const untrackedOnly = n === 1 && only?.status === "untracked";
      const ok = await confirmNative(
        untrackedOnly
          ? `Delete untracked file ${basename(only.relative)}?`
          : n === 1 && only
            ? `Discard changes in ${basename(only.relative)}? This cannot be undone.`
            : `Discard all unstaged changes in ${n} files? This cannot be undone.`,
        untrackedOnly ? "Delete" : "Discard",
      );
      if (!ok) return;
    }
    if (gitPanelRuntime(cwd).state.busy) return;
    setGitFeedback(cwd, null);
    setBusy(action);
    const discarded = action === "discard" ? unstaged.map((file) => file.path) : undefined;
    if (index) showOptimistic(applyIndexAction(index, action));
    try {
      if (action === "stage") await gitStageAll(cwd);
      else if (action === "unstage") await gitUnstageAll(cwd);
      else await gitDiscardAll(cwd);
      onMutated(discarded, "index");
    } catch (error) {
      onMutated(discarded, "index");
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const runFolder = async (relative: string, action: "stage" | "unstage") => {
    const queue = fileActions.current;
    if (gitPanelRuntime(cwd).state.busy && queue.size === 0) return;
    if (queue.size === 0) setGitFeedback(cwd, null);
    queue.size += 1;
    queue.paths.push(
      ...files.filter((file) => file.relative.startsWith(`${relative}/`)).map((file) => file.path),
    );
    setBusy(`folder:${action}:${relative}`);
    setPending(ACTION_LABEL[action]);
    // Share the existing index mutation queue with single-file actions.
    const task = queue.tail.then(async () => {
      try {
        if (action === "stage") await gitStageFile(cwd, relative);
        else await gitUnstageFile(cwd, relative);
      } catch (error) {
        fail(error);
      }
    });
    queue.tail = task;
    await task;
    queue.size -= 1;
    if (queue.size > 0) return;
    // Also refresh after failure: Git may have partially changed the index.
    onMutated(queue.paths.splice(0), "index");
    setBusy(null);
    setPending(null);
  };

  const generate = async () => {
    if (!canGenerate || generateAbortRef.current) return;
    const controller = new AbortController();
    generateAbortRef.current = controller;
    setGenerating(true);
    setGitFeedback(cwd, null);
    try {
      const generated = generationChoice
        ? await generateCommitMessage(cwd, textHarness, controller.signal, generationChoice)
        : await generateCommitMessage(cwd, textHarness, controller.signal);
      if (!controller.signal.aborted) {
        if (!generated.trim())
          throw new Error("The provider returned an empty commit message. Retry generation.");
        setMessage(generated);
      }
    } catch (error) {
      if (!controller.signal.aborted) fail(error);
    } finally {
      if (generateAbortRef.current === controller) {
        generateAbortRef.current = null;
        setGenerating(false);
      }
    }
  };

  const cancelGenerate = () => {
    generateAbortRef.current?.abort();
    generateAbortRef.current = null;
    setGenerating(false);
  };

  const toggleAmend = async () => {
    setMenuOpen(false);
    if (amend) {
      setAmendTarget(null);
      return;
    }
    try {
      const headMessage = await gitHeadMessage(cwd);
      if (!message.trim()) setMessage(headMessage);
      setAmendTarget({
        branch: index?.branch ?? null,
        head: index?.head ?? null,
      });
    } catch (error) {
      fail(error);
    }
  };

  const confirmAmend = async (amending: boolean) => {
    if (!amending || !index?.headPushed) return true;
    return confirmNative(
      `Amend a commit that is already pushed? ${PRODUCT_IDENTITY.displayName} cannot push the result. You will need a force push from the terminal.`,
      "Amend",
    );
  };

  /**
   * `options` come from the header menu, which picks what to stage, whether to
   * amend, and whether to sign off. Without them this is the Commit button.
   */
  const commit = async (push: boolean, createPr = false, options?: CommitMenuOptions) => {
    const amending = options ? options.amend : amend;
    if (options ? busy : !canCommit) return;
    if (blockedMessage) return;
    if (!message.trim() && !amending) {
      messageRef.current?.focus();
      return;
    }
    if ((push || createPr) && !(await confirmDefault(createPr ? "pr" : "push"))) {
      return;
    }
    if (!(await confirmAmend(amending))) return;
    // Nothing staged: Commit takes everything, but amending never sweeps in
    // files the user did not stage.
    const stageAll =
      options?.scope === "all" || (options?.scope === "smart" && !amending && staged.length === 0);
    if (gitPanelRuntime(cwd).state.busy) return;
    setGitFeedback(cwd, null);
    setBusy(createPr ? "pr" : "commit");
    setPending("Committing…");
    setMenuOpen(false);
    let committed = false;
    let pushed = false;
    try {
      if (stageAll) await gitStageAll(cwd);
      // Amending with an empty box keeps the message the commit already has.
      const text = message.trim() || (await gitHeadMessage(cwd));
      await gitCommit(cwd, text, amending, options?.signoff ?? false);
      committed = true;
      // The commit is made: its files leave the list now, not after the push
      // and the reload that follow.
      if (index) showOptimistic(applyCommit(index, stageAll));
      setMessage("");
      setAmendTarget(null);
      if (push || createPr) {
        setPending("Pushing…");
        await gitPush(cwd);
        pushed = true;
        recordPrActivity();
      }
      onMutated();
      if (createPr) {
        setPending("Creating pull request…");
        await openCreatedPr();
        reloadPr();
      }
    } catch (error) {
      if (committed)
        setGitFeedback(cwd, {
          kind: "warning",
          title: pushed
            ? "Commit pushed; pull request creation failed"
            : "Commit created; push failed",
          detail: error instanceof Error ? error.message : String(error),
          retry: () =>
            retryPublication(!pushed && (push || createPr), createPr, index?.branch ?? null),
        });
      else fail(error);
      onMutated();
    } finally {
      setBusy(null);
      setPending(null);
    }
  };

  actionsRef.current = {
    refreshPr: reloadPr,
    commit: (options) => commit(false, false, options),
    runAll,
  };

  const sync = async () => {
    if (!index || !(canSync || canPublish)) return;
    const pushesCommits = index.ahead > 0;
    if (gitPanelRuntime(cwd).state.busy) return;
    setGitFeedback(cwd, null);
    setBusy("sync");
    try {
      await gitSync(cwd);
      if (pushesCommits) recordPrActivity();
      onMutated();
      reloadPr();
    } catch (error) {
      fail(error);
      onMutated();
    } finally {
      setBusy(null);
    }
  };

  const openCreatedPr = async () => {
    const content = isRemoteProjectPath(cwd)
      ? await remotePrContent(cwd)
      : generationChoice
        ? await generatePrContent(cwd, textHarness, generationChoice)
        : await generatePrContent(cwd, textHarness);
    if (!content) throw new Error("Could not prepare pull request content");
    const url = await gitPrCreate(cwd, content.title, content.body, content.base, content.head);
    const number = Number(/\/pull\/(\d+)(?:[/?#]|$)/.exec(url)?.[1]);
    if (Number.isInteger(number) && number > 0) recordPrActivity(number);
    reloadPr();
    try {
      await openUrl(url.trim());
      setGitFeedback(cwd, {
        kind: "success",
        get title() {
          return t("Pull request created");
        },
        url: url.trim(),
      });
    } catch (error) {
      setGitFeedback(cwd, {
        kind: "warning",
        get title() {
          return t("Pull request created; couldn’t open the link");
        },
        detail: String(error),
        url: url.trim(),
      });
    }
  };

  const retryPublication = async (push: boolean, createPr: boolean, branch: string | null) => {
    let remainingPush = push;
    try {
      await withGitOperation(cwd, push ? "Pushing…" : "Creating pull request…", async () => {
        const current = await gitDiffIndex(cwd);
        if (current.branch !== branch)
          throw new Error("The branch changed. Review the current branch before publishing.");
        if (remainingPush) {
          await gitPush(cwd);
          remainingPush = false;
        }
        if (createPr) {
          const existing = await gitPrStatus(cwd);
          if (existing?.state === "open")
            setGitFeedback(cwd, {
              kind: "success",
              get title() {
                return t("Pull request already exists");
              },
              url: existing.url,
            });
          else await openCreatedPr();
        }
      });
    } catch (error) {
      setGitFeedback(cwd, {
        kind: "warning",
        title: remainingPush ? "Commit created; push failed" : "Publication incomplete",
        detail: String(error),
        retry: () => retryPublication(remainingPush, createPr, branch),
      });
    } finally {
      onMutated();
      reloadPr();
    }
  };

  const createPr = async () => {
    if (!canCreatePr) return;
    if (!(await confirmDefault("pr"))) return;
    if (gitPanelRuntime(cwd).state.busy) return;
    setGitFeedback(cwd, null);
    setBusy("pr");
    let pushed = false;
    try {
      if ((index?.ahead ?? 0) > 0) {
        setPending("Pushing…");
        await gitPush(cwd);
        pushed = true;
      }
      setPending("Creating pull request…");
      await openCreatedPr();
      onMutated();
      reloadPr();
    } catch (error) {
      setGitFeedback(cwd, {
        kind: pushed ? "warning" : "error",
        title: pushed
          ? "Branch pushed; pull request creation failed"
          : "Couldn’t create pull request",
        detail: String(error),
        retry: () =>
          retryPublication(!pushed && (index?.ahead ?? 0) > 0, true, index?.branch ?? null),
      });
      onMutated();
    } finally {
      setBusy(null);
      setPending(null);
    }
  };

  return (
    <aside className={`flex min-h-0 min-w-0 flex-col ${fill ? "flex-1" : "shrink-0"}`}>
      <div className="shrink-0 border-b border-stroke p-2">
        <div className="relative">
          <textarea
            ref={messageRef}
            rows={1}
            value={message}
            placeholder={
              amend
                ? t("Amend message ({p0}↩ to amend)", { p0: MOD })
                : t("Message ({p0}↩ to commit)", { p0: MOD })
            }
            disabled={!canEditMessage}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canCommit) {
                event.preventDefault();
                void commit(false);
              }
            }}
            className={`max-h-40 w-full resize-none overflow-y-auto rounded-md bg-content/10 py-1 ${isRemoteProjectPath(cwd) ? "pr-8" : "pr-12"} pl-2 text-[13px] leading-5 text-content outline-none placeholder:text-content/35 disabled:opacity-40`}
          />
          <div className="absolute top-1 right-1 flex items-center rounded-md bg-content/10">
            <button
              type="button"
              title={
                generating ? t("Cancel commit message generation") : t("Generate commit message")
              }
              aria-label={
                generating ? t("Cancel commit message generation") : t("Generate commit message")
              }
              disabled={!generating && !canGenerate}
              onClick={() => (generating ? cancelGenerate() : void generate())}
              className="group grid size-5 place-items-center rounded-md text-content hover:bg-content/20 hover:text-content disabled:opacity-40"
            >
              {generating ? (
                <>
                  <Loader
                    className="size-3.5 animate-spin group-hover:hidden group-focus-visible:hidden"
                    strokeWidth={1.75}
                  />
                  <X
                    className="hidden size-3.5 group-hover:block group-focus-visible:block"
                    strokeWidth={1.75}
                  />
                </>
              ) : (
                <WandSparkles className="size-3" strokeWidth={1} />
              )}
            </button>
            {!isRemoteProjectPath(cwd) && (
              <GitGenerationSettings
                cwd={cwd}
                preferred={textHarness}
                choice={generationChoice}
                onChange={setGenerationChoice}
                disabled={generating || committing}
              />
            )}
          </div>
        </div>
        <div ref={menuRef} className="relative mt-1.5 flex gap-1.5">
          <button
            type="button"
            disabled={!canCommit}
            onClick={() => void commit(false)}
            className={`flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] font-medium ${
              canCommit ? "bg-content text-background-base" : "bg-content/40 text-background-base"
            }`}
          >
            {busy === "commit" || busy === "pr" ? (
              <>
                <Loader className="size-3.5 shrink-0 animate-spin" strokeWidth={2} />
                <span className="min-w-0 truncate">{pending ?? busyLabel(busy)}</span>
              </>
            ) : (
              <>
                <Check className="size-3.5" strokeWidth={2} />
                {amend ? t("Amend Commit") : t("Commit")}
              </>
            )}
          </button>

          <button
            type="button"
            title={t("Commit options")}
            aria-label={t("Commit options")}
            aria-expanded={menuOpen}
            disabled={!canOpenMenu}
            onClick={() => setMenuOpen((open) => !open)}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
              canCommit
                ? "bg-content text-background-base hover:bg-content/80"
                : "bg-content/40 text-background-base hover:bg-content"
            } disabled:pointer-events-none aria-expanded:bg-content aria-expanded:text-background-base`}
          >
            <ChevronDown className="size-3.5" strokeWidth={2} />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              aria-label={t("Commit options")}
              className="absolute top-full right-0 z-30 mt-1 min-w-48 rounded-md border border-content/10 bg-background-base py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                disabled={!canCommitPush}
                onClick={() => void commit(true)}
                className="flex h-7 w-full items-center px-3 text-left text-[12px] text-content hover:bg-content/10 disabled:opacity-40"
              >
                {t("Commit & Push")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!canCommitPushPr}
                onClick={() => void commit(true, true)}
                className="flex h-7 w-full items-center px-3 text-left text-[12px] text-content hover:bg-content/10 disabled:opacity-40"
              >
                {t("Commit, Push & Create PR")}
              </button>
              <div className="my-1 border-t border-content/10" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={amend}
                onClick={() => void toggleAmend()}
                className="flex h-7 w-full items-center justify-between gap-2 px-3 text-left text-[12px] text-content hover:bg-content/10"
              >
                {t("Amend Last Commit")}
                <span className="grid size-3.5 shrink-0 place-items-center">
                  {amend ? <Check className="size-3.5" strokeWidth={2} /> : null}
                </span>
              </button>
            </div>
          ) : null}
        </div>
        {blockedMessage ? (
          <p role="alert" className="mt-1.5 text-[11px] leading-snug text-amber-400">
            {blockedMessage}
          </p>
        ) : null}
        {index ? (
          <GitSyncActions
            index={index}
            pr={pr}
            busy={busy}
            hasRemote={hasRemote}
            hasOpenPr={hasOpenPr}
            onDefault={onDefault}
            canSync={canSync}
            canPublish={canPublish}
            canCreatePr={canCreatePr}
            canViewPr={canViewPr}
            onSync={() => void sync()}
            onCreatePr={() => void createPr()}
            onViewPr={() => {
              if (pr?.url) void openUrl(pr.url);
            }}
          />
        ) : null}
      </div>
      {prLoading ? (
        <p role="status" className="px-3 py-1 text-[11px] text-content/50">
          {t("Checking pull request…")}
        </p>
      ) : prError ? (
        <GitFeedback title={t("Couldn’t check pull request")} detail={prError} onRetry={reloadPr} />
      ) : null}
      {loadError && !failure ? (
        <GitFeedback
          title={t("Couldn’t load Git changes")}
          detail={loadError}
          stale={!!index}
          onRetry={() => onMutated()}
        />
      ) : null}
      {index?.repository === false ? (
        <GitFeedback kind="info" title={t("This folder is not a Git repository")} />
      ) : null}
      {loading && index ? (
        <p role="status" className="px-3 py-1 text-[11px] text-content/50">
          {t("Refreshing changes…")}
        </p>
      ) : null}
      {failure ? (
        <RemoteLoadError cwd={cwd} failure={failure} stale={!!index} onRetry={() => onMutated()} />
      ) : null}
      <div
        ref={lockOverscroll}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-none py-1 ${failure ? "opacity-60" : ""}`}
      >
        {files.length === 0 && conflicts.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-content/45">
            {index?.repository === false
              ? ""
              : index
                ? index.ahead > 0 || index.behind > 0
                  ? syncStatusLabel(index)
                  : t("No uncommitted changes")
                : failure || loadError
                  ? ""
                  : t("Loading changes…")}
          </p>
        ) : (
          <>
            {conflicts.length > 0 ? (
              <FileSection
                title={t("Merge Conflicts")}
                count={conflicts.length}
                open={conflictsExpanded}
                onToggle={() => {
                  conflictsOpen = !conflictsExpanded;
                  setConflictsExpanded(conflictsOpen);
                }}
                headerActions={[
                  {
                    get title() {
                      return t("Accept All Current");
                    },
                    get label() {
                      return t("All Current");
                    },
                    onClick: () => void conflictActions.acceptAll(conflicts, "ours"),
                  },
                  {
                    get title() {
                      return t("Accept All Incoming");
                    },
                    get label() {
                      return t("All Incoming");
                    },
                    onClick: () => void conflictActions.acceptAll(conflicts, "theirs"),
                  },
                ]}
              >
                <GitConflictRows
                  rows={conflicts}
                  selected={selected}
                  busy={busy}
                  canCompare={canCompare}
                  onOpen={(row, pin) =>
                    (onOpenInEditor ?? ((path, pinned) => onOpenFile(path, "unstaged", pinned)))(
                      row.path,
                      pin,
                    )
                  }
                  onCompare={(row) => setCompareFile(row.relative)}
                  onChoose={(row, choice) => void conflictActions.choose(row, choice)}
                  onMarkResolved={(row) => void conflictActions.markResolved(row)}
                />
              </FileSection>
            ) : null}
            {staged.length > 0 ? (
              <FileSection
                title={t("Staged Changes")}
                count={staged.length}
                open={stagedExpanded}
                onToggle={() => {
                  stagedOpen = !stagedExpanded;
                  setStagedExpanded(stagedOpen);
                }}
                view={view}
                onToggleView={toggleView}
                headerActions={[
                  {
                    get title() {
                      return t("Open All Changes");
                    },
                    icon: <FileDiff className="size-3.5" strokeWidth={1.75} />,
                    onClick: () => onOpenAllChanges("staged"),
                  },
                  {
                    get title() {
                      return t("Unstage All Changes");
                    },
                    icon: <Minus className="size-3.5" strokeWidth={1.75} />,
                    onClick: () => void runAll("unstage"),
                  },
                ]}
              >
                <ChangeList
                  files={staged}
                  onOpenInEditor={onOpenInEditor}
                  view={view}
                  kind="staged"
                  selected={selected}
                  selectedKind={selectedKind}
                  busy={busy}
                  onOpenFile={onOpenFile}
                  onAction={run}
                  onSelectionAction={runSelection}
                  key={`${cwd}:staged`}
                  onFolderAction={runFolder}
                />
              </FileSection>
            ) : null}
            {unstaged.length > 0 ? (
              <FileSection
                title={t("Changes")}
                count={unstaged.length}
                open={changesExpanded}
                onToggle={() => {
                  changesOpen = !changesExpanded;
                  setChangesExpanded(changesOpen);
                }}
                view={view}
                onToggleView={toggleView}
                headerActions={[
                  {
                    get title() {
                      return t("Open All Changes");
                    },
                    icon: <FileDiff className="size-3.5" strokeWidth={1.75} />,
                    onClick: () => onOpenAllChanges("unstaged"),
                  },
                  {
                    get title() {
                      return t("Discard All Changes");
                    },
                    icon: <Undo2 className="size-3.5" strokeWidth={1.75} />,
                    onClick: () => void runAll("discard"),
                  },
                  {
                    get title() {
                      return t("Stage All Changes");
                    },
                    icon: <Plus className="size-3.5" strokeWidth={1.75} />,
                    onClick: () => void runAll("stage"),
                  },
                ]}
              >
                <ChangeList
                  files={unstaged}
                  onOpenInEditor={onOpenInEditor}
                  view={view}
                  kind="unstaged"
                  selected={selected}
                  selectedKind={selectedKind}
                  busy={busy}
                  onOpenFile={onOpenFile}
                  onAction={run}
                  onSelectionAction={runSelection}
                  key={`${cwd}:unstaged`}
                  onFolderAction={runFolder}
                />
              </FileSection>
            ) : null}
          </>
        )}
      </div>
      {compareFile ? (
        <Suspense fallback={null}>
          <GitConflictCompare
            cwd={cwd}
            relative={compareFile}
            onClose={() => setCompareFile(null)}
          />
        </Suspense>
      ) : null}
    </aside>
  );
}

function usePrStatus(cwd: string, branch: string | null | undefined, enabled: boolean) {
  const read = useCallback(() => gitPrStatus(cwd), [cwd, branch]);
  const resource = useGitResource(
    cwd,
    `pr:${cwd}:${branch ?? ""}`,
    enabled && !!cwd && cwd !== "~" && !!branch,
    read,
    true,
    600_000,
    true,
  );
  return {
    pr: resource.data,
    loading: resource.loading,
    error: resource.error,
    reload: resource.refresh,
  };
}

function syncStatusLabel(index: GitDiffIndex): string {
  if (index.ahead > 0 && index.behind > 0) {
    return t("Diverged from {p0}", { p0: index.upstream ?? "upstream" });
  }
  if (index.ahead > 0) {
    const n = index.ahead;
    return t(n === 1 ? "{p0} unpushed commit" : "{p0} unpushed commits", {
      p0: n,
    });
  }
  if (index.behind > 0) {
    const n = index.behind;
    return t(n === 1 ? "{p0} incoming commit" : "{p0} incoming commits", {
      p0: n,
    });
  }
  return t("No files");
}

function GitSyncActions({
  index,
  pr,
  busy,
  hasRemote,
  hasOpenPr,
  onDefault,
  canSync,
  canPublish,
  canCreatePr,
  canViewPr,
  onSync,
  onCreatePr,
  onViewPr,
}: {
  index: GitDiffIndex;
  pr: GitPr | null;
  busy: string | null;
  hasRemote: boolean;
  hasOpenPr: boolean;
  onDefault: boolean;
  canSync: boolean;
  canPublish: boolean;
  canCreatePr: boolean;
  canViewPr: boolean;
  onSync: () => void;
  onCreatePr: () => void;
  onViewPr: () => void;
}) {
  useLocale();
  if (!hasRemote) return null;
  const ahead = index.ahead;
  const behind = index.behind;
  const dest = index.upstream ?? `${index.remote ?? "origin"}/${index.branch ?? "HEAD"}`;
  const syncing = busy === "sync";
  const syncTitle = syncing
    ? "Synchronizing Changes..."
    : canPublish
      ? index.branch
        ? `Publish Branch "${index.branch}"`
        : "Publish Branch"
      : behind > 0 && ahead > 0
        ? `Pull ${behind} and push ${ahead} commits between ${dest}`
        : behind > 0
          ? `Pull ${behind} commit${behind === 1 ? "" : "s"} from ${dest}`
          : `Push ${ahead} commit${ahead === 1 ? "" : "s"} to ${dest}`;
  const createTitle = index.defaultBranch
    ? `Create a pull request into ${index.defaultBranch}`
    : "Create pull request";
  const viewTitle = pr?.title ? `View PR #${pr.number}: ${pr.title}` : "View pull request";
  const btn =
    "flex h-7 w-full min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium disabled:opacity-40";
  const secondary = `${btn} bg-content/10 text-content hover:bg-content/15`;
  const showCreatePr = !hasOpenPr && !onDefault;
  const showViewPr = hasOpenPr;
  if (!canPublish && !canSync && !showCreatePr && !showViewPr) return null;

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {canPublish ? (
        <button
          type="button"
          title={syncTitle}
          disabled={!!busy}
          onClick={onSync}
          className={secondary}
        >
          {syncing ? (
            <Loader className="size-3.5 shrink-0 animate-spin" strokeWidth={1.75} />
          ) : (
            <CloudUpload className="size-3.5 shrink-0" strokeWidth={1.75} />
          )}
          <span className="min-w-0 truncate">{t("Publish Branch")}</span>
        </button>
      ) : canSync ? (
        <button
          type="button"
          title={syncTitle}
          disabled={!!busy}
          onClick={onSync}
          className={secondary}
        >
          <RefreshCw
            className={`size-3.5 shrink-0 ${syncing ? "animate-spin" : ""}`}
            strokeWidth={1.75}
          />
          <span className="min-w-0 truncate">{t("Sync Changes")}</span>
          {behind > 0 ? (
            <span className="shrink-0 tabular-nums text-content/55">↓{behind}</span>
          ) : null}
          {ahead > 0 ? (
            <span className="shrink-0 tabular-nums text-content/55">↑{ahead}</span>
          ) : null}
        </button>
      ) : null}
      {showCreatePr ? (
        <button
          type="button"
          title={createTitle}
          disabled={!canCreatePr || !!busy}
          onClick={onCreatePr}
          className={secondary}
        >
          {busy === "pr" ? (
            <Loader className="size-3.5 shrink-0 animate-spin" strokeWidth={1.75} />
          ) : (
            <GitPullRequest className="size-3.5 shrink-0" strokeWidth={1.75} />
          )}
          {t("Create PR")}
        </button>
      ) : null}
      {showViewPr ? (
        <button
          type="button"
          title={viewTitle}
          disabled={!canViewPr || !!busy}
          onClick={onViewPr}
          className={secondary}
        >
          <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 truncate">
            {pr?.number ? t("View PR #{p0}", { p0: pr.number }) : t("View PR")}
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function FileSection({
  title,
  count,
  open,
  onToggle,
  view,
  onToggleView,
  headerActions,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  /** Without these there is no list/tree toggle: the section is always a list. */
  view?: ChangesView;
  onToggleView?: () => void;
  headerActions: {
    title: string;
    icon?: ReactNode;
    /** Short text shown instead of an icon. */
    label?: string;
    onClick: () => void;
  }[];
  children: ReactNode;
}) {
  useLocale();
  return (
    <div>
      <div className="flex h-7 items-center gap-1 px-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-content/50" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-content/50" strokeWidth={1.75} />
          )}
          <span className="min-w-0 truncate text-[10px] font-semibold tracking-[0.04em] text-content/55 uppercase">
            {title}
          </span>
          <span className="ml-1 grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-accent/80 px-1 text-[8px] text-white">
            {count}
          </span>
        </button>
        {view && onToggleView ? (
          <IconAction
            title={view === "tree" ? t("View as List") : t("View as Tree")}
            onClick={onToggleView}
          >
            {view === "tree" ? (
              <ListBullet className="size-3.5" strokeWidth={1.75} />
            ) : (
              <FolderTree className="size-3.5" strokeWidth={1.75} />
            )}
          </IconAction>
        ) : null}
        {headerActions.map((action) =>
          action.label ? (
            <button
              key={action.title}
              type="button"
              title={action.title}
              aria-label={action.title}
              onClick={action.onClick}
              className="h-5 shrink-0 rounded px-1 text-[10px] font-medium text-content/55 hover:bg-content/10 hover:text-content"
            >
              {action.label}
            </button>
          ) : (
            <IconAction key={action.title} title={action.title} onClick={action.onClick}>
              {action.icon}
            </IconAction>
          ),
        )}
      </div>
      {open ? <ul>{children}</ul> : null}
    </div>
  );
}

type ChangeDir = {
  name: string;
  /** Path relative to the repo root; "" for the implicit root. */
  path: string;
  dirs: ChangeDir[];
  files: GitChangedFile[];
  /** Status shared by every descendant, or null when they differ. */
  status: string | null;
};

async function remotePrContent(cwd: string) {
  const range = await gitRangeContext(cwd);
  const commits = range.commitSummary.trim();
  const firstCommit = commits
    .split(/\r?\n/, 1)[0]
    ?.replace(/^[0-9a-f]+\s+/i, "")
    .trim();
  const title = firstCommit || `Changes on ${range.head}`;
  const body = [
    commits && `## Commits\n\n${commits}`,
    range.diffSummary.trim() && `## Changes\n\n${range.diffSummary.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { title, body: body || title, base: range.base, head: range.head };
}

type ChangeRowProps = {
  onOpenInEditor?: (path: string, pin?: boolean) => void;
  files: GitChangedFile[];
  view: ChangesView;
  kind: GitFileDiffKind;
  selected?: string;
  selectedKind?: GitFileDiffKind;
  busy: string | null;
  onOpenFile: (path: string, kind: GitFileDiffKind, pin?: boolean) => void;
  onAction: (file: GitChangedFile, action: "stage" | "unstage" | "discard") => void;
  onSelectionAction?: (
    files: GitChangedFile[],
    action: "stage" | "unstage" | "discard",
  ) => void | Promise<void>;
  onFolderAction: (relative: string, action: "stage" | "unstage") => void;
};

type ChangeSelection = {
  paths: Set<string>;
  select: (path: string, modifiers?: TreeSelectionModifiers, preserve?: boolean) => void;
  targets: (file: GitChangedFile) => GitChangedFile[];
  action: (file: GitChangedFile, action: "stage" | "unstage" | "discard") => void;
};
const ChangeSelectionCtx = createContext<ChangeSelection | null>(null);

export function ChangeList({ files, view, ...rest }: ChangeRowProps) {
  useLocale();
  const tree = useMemo(() => buildChangeTree(files), [files]);
  const listRef = useRef<HTMLUListElement>(null);
  const [paths, setPaths] = useState(() => new Set<string>());
  const anchor = useRef<string | null>(null);
  useEffect(() => {
    const valid = new Set(files.map((file) => file.path));
    setPaths((current) =>
      [...current].every((path) => valid.has(path))
        ? current
        : new Set([...current].filter((path) => valid.has(path))),
    );
    if (anchor.current && !valid.has(anchor.current)) anchor.current = null;
  }, [files]);
  const rows = () => [
    ...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-git-file]") ?? []),
  ];
  const select = (path: string, modifiers: TreeSelectionModifiers = {}, preserve = false) => {
    if (preserve && paths.has(path)) return;
    const previousAnchor = anchor.current;
    const visible = modifiers.shiftKey ? rows().map((row) => row.dataset.gitFile!) : [];
    setPaths((current) => selectTreePaths(current, path, previousAnchor, visible, modifiers));
    if (!modifiers.shiftKey) anchor.current = path;
  };
  const targets = (file: GitChangedFile) =>
    paths.has(file.path) ? files.filter((value) => paths.has(value.path)) : [file];
  const action = (file: GitChangedFile, kind: "stage" | "unstage" | "discard") => {
    const chosen = targets(file);
    if (rest.onSelectionAction) void rest.onSelectionAction(chosen, kind);
    else for (const target of chosen) rest.onAction(target, kind);
  };
  const content =
    view === "tree" ? (
      <ChangeDirChildren dir={tree} depth={0} {...rest} />
    ) : (
      files.map((file) => (
        <ChangeRow
          key={`${rest.kind}:${file.relative}`}
          file={file}
          active={isActive(file, rest.selected, rest.selectedKind, rest.kind)}
          busy={rest.busy === file.relative || !!rest.busy?.startsWith("folder:")}
          kind={rest.kind}
          onOpenFile={rest.onOpenFile}
          onOpenInEditor={rest.onOpenInEditor}
          onAction={rest.onAction}
        />
      ))
    );
  return (
    <ChangeSelectionCtx.Provider value={{ paths, select, targets, action }}>
      <li className="list-none">
        <ul
          ref={listRef}
          role="listbox"
          aria-label={rest.kind === "staged" ? t("Staged Changes") : t("Changes")}
          aria-multiselectable="true"
          onKeyDown={(event) => {
            const row = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-git-file]");
            if (!row) return;
            const visible = rows();
            const mod = event.ctrlKey || event.metaKey;
            if (mod && !event.altKey && event.key.toLowerCase() === "a") {
              event.preventDefault();
              event.stopPropagation();
              setPaths(new Set(visible.map((value) => value.dataset.gitFile!)));
              anchor.current ??= row.dataset.gitFile!;
            } else if (mod && event.key === " ") {
              event.preventDefault();
              select(row.dataset.gitFile!, { ctrlKey: true });
            } else if (
              ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) &&
              !event.altKey
            ) {
              event.preventDefault();
              const index = visible.indexOf(row);
              const next =
                event.key === "Home"
                  ? visible[0]
                  : event.key === "End"
                    ? visible[visible.length - 1]
                    : visible[
                        Math.min(
                          visible.length - 1,
                          Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)),
                        )
                      ];
              if (next) {
                if (!mod || event.shiftKey) select(next.dataset.gitFile!, event);
                next.focus();
                next.scrollIntoView?.({ block: "nearest" });
              }
            } else if (event.key === "Escape") {
              setPaths(new Set([row.dataset.gitFile!]));
              anchor.current = row.dataset.gitFile!;
            } else if (event.key === "Enter") {
              event.preventDefault();
              const file = files.find((value) => value.path === row.dataset.gitFile);
              if (file)
                for (const value of targets(file)) rest.onOpenFile(value.path, rest.kind, true);
            }
          }}
        >
          {content}
        </ul>
      </li>
    </ChangeSelectionCtx.Provider>
  );
}

function ChangeDirChildren({
  dir,
  depth,
  kind,
  selected,
  selectedKind,
  busy,
  onOpenFile,
  onOpenInEditor,
  onAction,
  onFolderAction,
}: Omit<ChangeRowProps, "files" | "view"> & {
  dir: ChangeDir;
  depth: number;
}) {
  useLocale();
  return (
    <>
      {dir.dirs.map((child) => (
        <ChangeDirRow
          key={child.path}
          dir={child}
          depth={depth}
          kind={kind}
          selected={selected}
          selectedKind={selectedKind}
          busy={busy}
          onOpenFile={onOpenFile}
          onOpenInEditor={onOpenInEditor}
          onAction={onAction}
          onFolderAction={onFolderAction}
        />
      ))}
      {dir.files.map((file) => (
        <ChangeRow
          key={`${kind}:${file.relative}`}
          file={file}
          active={isActive(file, selected, selectedKind, kind)}
          busy={busy === file.relative || !!busy?.startsWith("folder:")}
          kind={kind}
          depth={depth}
          onOpenFile={onOpenFile}
          onOpenInEditor={onOpenInEditor}
          onAction={onAction}
        />
      ))}
    </>
  );
}

function ChangeDirRow({
  dir,
  depth,
  kind,
  ...rest
}: Omit<ChangeRowProps, "files" | "view"> & {
  dir: ChangeDir;
  depth: number;
}) {
  useLocale();
  const key = `${kind}:${dir.path}`;
  const [open, setOpen] = useState(() => !collapsedDirs.has(key));
  const toggle = () => {
    if (open) collapsedDirs.add(key);
    else collapsedDirs.delete(key);
    setOpen(!open);
  };
  return (
    <li>
      <div
        style={{ paddingLeft: 8 + depth * 12 }}
        className="group flex h-7 w-full items-center gap-1 pr-2 leading-none text-content hover:bg-content/5"
      >
        <button
          type="button"
          title={dir.path}
          aria-expanded={open}
          onClick={toggle}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="grid size-4 shrink-0 place-items-center text-content/50">
            {open ? (
              <ChevronDown className="size-3.5" strokeWidth={1.75} />
            ) : (
              <ChevronRight className="size-3.5" strokeWidth={1.75} />
            )}
          </span>
          <FileTypeIcon name={dir.name} isDir isOpen={open} size={16} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{dir.name}</span>
        </button>
        <div className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
          <IconAction
            title={t(kind === "staged" ? "Unstage Changes in {p1}" : "Stage Changes in {p1}", {
              p1: dir.path,
            })}
            disabled={rest.busy !== null}
            onClick={() => rest.onFolderAction(dir.path, kind === "staged" ? "unstage" : "stage")}
          >
            {kind === "staged" ? (
              <Minus className="size-3.5" strokeWidth={1.75} />
            ) : (
              <Plus className="size-3.5" strokeWidth={1.75} />
            )}
          </IconAction>
        </div>
        <span
          className={`grid w-3.5 shrink-0 place-items-center ${
            dir.status ? statusColor(dir.status) : "text-content/40"
          }`}
          aria-hidden
        >
          <span className="size-1.5 rounded-full bg-current" />
        </span>
      </div>
      {open ? (
        <ul>
          <ChangeDirChildren dir={dir} depth={depth + 1} kind={kind} {...rest} />
        </ul>
      ) : null}
    </li>
  );
}

function isActive(
  file: GitChangedFile,
  selected: string | undefined,
  selectedKind: GitFileDiffKind | undefined,
  kind: GitFileDiffKind,
): boolean {
  return selected === file.relative && (!selectedKind || selectedKind === kind);
}

/** Nests changed files under their directories, VS Code's tree view. */
function buildChangeTree(files: GitChangedFile[]): ChangeDir {
  const root: ChangeDir = {
    name: "",
    path: "",
    dirs: [],
    files: [],
    status: null,
  };
  for (const file of files) {
    const segments = file.relative.split("/");
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      const path = node.path ? `${node.path}/${segment}` : segment;
      let next = node.dirs.find((dir) => dir.path === path);
      if (!next) {
        next = { name: segment, path, dirs: [], files: [], status: null };
        node.dirs.push(next);
      }
      node = next;
    }
    node.files.push(file);
  }
  sortChangeDir(root);
  return root;
}

/** Sorts each level (folders first) and rolls descendant status upward. */
function sortChangeDir(dir: ChangeDir): string | null {
  dir.dirs.sort((a, b) => a.name.localeCompare(b.name));
  dir.files.sort((a, b) => basename(a.relative).localeCompare(basename(b.relative)));
  let status: string | null = null;
  let mixed = false;
  const merge = (next: string | null) => {
    if (next === null) mixed = true;
    else if (status === null) status = next;
    else if (status !== next) mixed = true;
  };
  for (const child of dir.dirs) merge(sortChangeDir(child));
  for (const file of dir.files) merge(file.status);
  dir.status = mixed ? null : status;
  return dir.status;
}

function ChangeRow({
  file,
  active,
  busy,
  kind,
  depth,
  onOpenFile,
  onOpenInEditor,
  onAction,
}: {
  file: GitChangedFile;
  onOpenInEditor?: (path: string, pin?: boolean) => void;
  active: boolean;
  busy: boolean;
  kind: GitFileDiffKind;
  /** Set in tree view: nesting level, and the folder path moves to the tree. */
  depth?: number;
  onOpenFile: (path: string, kind: GitFileDiffKind, pin?: boolean) => void;
  onAction: (file: GitChangedFile, action: "stage" | "unstage" | "discard") => void;
}) {
  useLocale();
  const selection = useContext(ChangeSelectionCtx);
  const chosen = selection?.targets(file) ?? [file];
  const selected = selection?.paths.size ? selection.paths.has(file.path) : active;
  const perform = (action: "stage" | "unstage" | "discard") =>
    selection ? selection.action(file, action) : onAction(file, action);
  const name = basename(file.relative);
  const tree = depth !== undefined;
  const dir = tree ? "" : dirname(file.relative);
  const canOpen = file.status !== "deleted";
  const { menu, ...menuHandlers } = useChangedFileMenu({
    languageDomain: "git",
    path: file.path,
    relative: file.relative,
    deleted: !canOpen,
    selection: chosen.map((value) => ({
      path: value.path,
      relative: value.relative,
      deleted: value.status === "deleted",
      onOpenChanges: () =>
        chosen.length > 1 ? onOpenFile(value.path, kind, true) : onOpenFile(value.path, kind),
      onOpenFile: onOpenInEditor ? () => onOpenInEditor(value.path, true) : undefined,
    })),
    onOpenChanges: () => onOpenFile(file.path, kind),
    onOpenFile: onOpenInEditor ? () => onOpenInEditor(file.path, true) : undefined,
    actions: [
      {
        id: "index",
        label: kind === "staged" ? "Unstage Changes" : "Stage Changes",
        disabled: busy,
        run: () => perform(kind === "staged" ? "unstage" : "stage"),
      },
      ...(kind === "unstaged"
        ? [
            {
              id: "discard",
              get label() {
                return t("Discard Changes");
              },
              danger: true,
              disabled: busy,
              run: () => perform("discard"),
            },
          ]
        : []),
    ],
  });
  return (
    <li
      role="option"
      aria-selected={selected}
      onContextMenu={(event) => {
        selection?.select(file.path, {}, true);
        menuHandlers.onContextMenu(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
          selection?.select(file.path, {}, true);
        menuHandlers.onKeyDown(event);
      }}
    >
      <div
        style={tree ? { paddingLeft: 8 + depth * 12 } : undefined}
        className={`group flex h-7 w-full items-center gap-1 pr-2 leading-none ${
          tree ? "" : "pl-2"
        } ${selected ? "bg-selection text-content" : "text-content hover:bg-content/5"}`}
      >
        <button
          type="button"
          title={file.relative}
          data-git-file={file.path}
          onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
            selection?.select(file.path, event);
            if (event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (canOpen) onOpenFile(file.path, kind);
          }}
          onDoubleClick={(event) => {
            if (canOpen && !event.ctrlKey && !event.metaKey && !event.shiftKey)
              onOpenFile(file.path, kind, true);
          }}
          className="flex h-full min-w-0 flex-1 select-none items-center gap-1.5 text-left active:bg-content/10 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent/40"
        >
          {tree ? <span className="size-4 shrink-0" /> : null}
          <FileTypeIcon name={name} isDir={false} size={16} />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-[13px] font-medium">{name}</span>
            {dir ? (
              <span className="ml-1.5 text-[11px] text-content/40 @max-[240px]/changes:hidden">
                {dir}
              </span>
            ) : null}
          </span>
        </button>
        {busy ? (
          <Loader
            aria-label={t("Working")}
            className="size-3.5 shrink-0 animate-spin text-content/55"
            strokeWidth={1.75}
          />
        ) : null}
        <div
          className={` shrink-0 items-center ${
            busy ? "hidden" : active ? "flex" : "hidden group-focus-within:flex group-hover:flex"
          }`}
        >
          {kind === "unstaged" ? (
            <IconAction
              title={t("Discard Changes")}
              disabled={busy}
              onClick={() => perform("discard")}
            >
              <Undo2 className="size-3.5" strokeWidth={1.75} />
            </IconAction>
          ) : null}
          {kind === "staged" ? (
            <IconAction
              title={t("Unstage Changes")}
              disabled={busy}
              onClick={() => perform("unstage")}
            >
              <Minus className="size-3.5" strokeWidth={1.75} />
            </IconAction>
          ) : (
            <IconAction title={t("Stage Changes")} disabled={busy} onClick={() => perform("stage")}>
              <Plus className="size-3.5" strokeWidth={1.75} />
            </IconAction>
          )}
        </div>
        <span
          className={`w-3.5 shrink-0 text-right font-mono text-[11px] font-semibold ${statusColor(file.status)}`}
        >
          {statusLetter(file.status)}
        </span>
      </div>
      {menu}
    </li>
  );
}

function IconAction({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  useLocale();
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="grid size-5 place-items-center rounded text-content/55 hover:bg-content/10 hover:text-content disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function statusLetter(status: string): string {
  if (status === "untracked") return "U";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  return "M";
}

function statusColor(status: string): string {
  if (status === "untracked") return "text-sky-400";
  if (status === "added") return "text-diff-add-fg";
  if (status === "deleted") return "text-diff-del-fg";
  return "text-amber-400";
}

function useDiffIndex(
  cwd: string,
  enabled: boolean,
): {
  index: GitDiffIndex | null;
  reload: () => void;
  showOptimistic: (next: GitDiffIndex) => void;
  error: string | null;
  loading: boolean;
} {
  // A remote project keeps its last good index when a load fails; the failure
  // is shown by `ChangedFiles`.
  const remote = isRemoteProjectPath(cwd);
  const [index, setIndex] = useState<GitDiffIndex | null>(() => cachedIndex(cwd));
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const indexRef = useRef(index);
  indexRef.current = index;
  // An optimistic index is on screen and its git command may still be
  // running: a poll that started earlier must not put the old rows back.
  const holdRef = useRef(false);
  // The caller of `reload` announces its change itself.
  const announcedRef = useRef(false);
  const reload = useCallback(() => {
    holdRef.current = false;
    announcedRef.current = true;
    setNonce((value) => value + 1);
  }, []);
  const showOptimistic = useCallback(
    (next: GitDiffIndex) => {
      holdRef.current = true;
      indexByCwd.set(cwd, next);
      indexRef.current = next;
      setIndex(next);
    },
    [cwd],
  );

  useEffect(() => {
    if (!enabled || !cwd || cwd === "~") {
      return;
    }
    const cached = cachedIndex(cwd);
    if (cached && !sameIndex(indexRef.current, cached)) {
      indexRef.current = cached;
      setIndex(cached);
    }
    let cancelled = false;
    let inFlight = false;
    let pending = false;

    const load = async (fresh = false) => {
      if (inFlight) {
        pending = true;
        return;
      }
      if (document.hidden && nonce === 0) return;
      inFlight = true;
      setLoading(!indexRef.current);
      try {
        // Opening the panel (or a reload that bumped `nonce`) reads git itself.
        const next = await fetchGitIndex(cwd, {
          full: true,
          since: fresh ? Date.now() : undefined,
        });
        if (cancelled || holdRef.current) return;
        setError(null);
        if (remote) reportRemoteLoad(cwd, "changes");
        const prev = indexRef.current;
        const announced = announcedRef.current;
        announcedRef.current = false;
        if (sameIndex(prev, next)) return;
        indexByCwd.set(cwd, next);
        indexRef.current = next;
        setIndex(next);
        applyProjectDiffStats(cwd, {
          files: next.files.length + (next.conflicts?.length ?? 0),
          additions: next.additions,
          deletions: next.deletions,
        });
        if (prev) {
          const paths = changedFilePaths(prev, next);
          invalidateWatchedFiles(paths);
          // Found by the poll (an agent, a terminal): tell the other git views,
          // and spare the commit graph when only files moved.
          if (!announced) {
            // The shared index was just read, so keep it; only an index change
            // can name the files whose contents moved.
            const index = sameRefs(prev, next);
            announceGitChange(cwd, index ? "index" : "refs", {
              observed: true,
              paths: index ? paths : undefined,
            });
          }
        }
      } catch (error) {
        if (cancelled) return;
        if (remote) {
          reportRemoteLoad(cwd, "changes", error);
        } else {
          setError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setLoading(false);
        inFlight = false;
        if (pending && !cancelled) {
          pending = false;
          void load();
        }
      }
    };

    void load(true);
    const onResume = () => {
      if (!document.hidden) void load();
    };
    // Polling slows while a remote machine is unreachable.
    const timer = window.setInterval(() => {
      // Local polls wait for window focus; `focus` above refreshes on return.
      if (remote ? remotePollDue(cwd) : document.hasFocus()) onResume();
    }, GIT_POLL_MS);
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    const unsubGit = subscribeGitChanged(
      () => {
        if (!announcingObservedChange) {
          // A mutation can finish in a panel that has already unmounted.
          // Release this mounted panel's optimistic hold and refresh it too.
          holdRef.current = false;
          announcedRef.current = true;
          onResume();
        }
      },
      { cwd },
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      unsubGit();
    };
  }, [cwd, enabled, nonce, remote]);

  return { index, reload, showOptimistic, error, loading };
}

/** Whether HEAD, its branch and its upstream counts are unchanged. */
function sameRefs(prev: GitDiffIndex, next: GitDiffIndex): boolean {
  return (
    prev.branch === next.branch &&
    prev.head === next.head &&
    prev.upstream === next.upstream &&
    prev.ahead === next.ahead &&
    prev.behind === next.behind &&
    prev.aheadOfDefault === next.aheadOfDefault &&
    prev.headPushed === next.headPushed &&
    (prev.operation ?? null) === (next.operation ?? null)
  );
}

function cachedIndex(cwd: string | undefined): GitDiffIndex | null {
  if (!cwd || cwd === "~") return null;
  return indexByCwd.get(cwd) ?? null;
}

function changedFilePaths(prev: GitDiffIndex, next: GitDiffIndex): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const previous = new Map(prev.files.map((file) => [file.relative, file]));
  const current = new Set(next.files.map((file) => file.relative));
  for (const file of next.files) {
    const before = previous.get(file.relative);
    if (
      !before ||
      before.status !== file.status ||
      before.additions !== file.additions ||
      before.deletions !== file.deletions ||
      before.staged !== file.staged ||
      before.unstaged !== file.unstaged
    ) {
      paths.push(file.path);
      seen.add(file.path);
    }
  }
  for (const file of prev.files) {
    if (!current.has(file.relative) && !seen.has(file.path)) {
      paths.push(file.path);
    }
  }
  // A file entering, leaving or changing kind has new contents on disk.
  const before = new Map((prev.conflicts ?? []).map((file) => [file.relative, file]));
  const after = new Map((next.conflicts ?? []).map((file) => [file.relative, file]));
  for (const [relative, file] of after) {
    if (before.get(relative)?.kind !== file.kind) paths.push(file.path);
  }
  for (const [relative, file] of before) if (!after.has(relative)) paths.push(file.path);
  return paths;
}

function sameIndex(prev: GitDiffIndex | null, next: GitDiffIndex): boolean {
  if (!prev) return false;
  if (
    prev.branch !== next.branch ||
    prev.head !== next.head ||
    prev.additions !== next.additions ||
    prev.deletions !== next.deletions ||
    prev.files.length !== next.files.length ||
    prev.remote !== next.remote ||
    prev.upstream !== next.upstream ||
    prev.defaultBranch !== next.defaultBranch ||
    prev.ahead !== next.ahead ||
    prev.behind !== next.behind ||
    prev.aheadOfDefault !== next.aheadOfDefault ||
    prev.headPushed !== next.headPushed ||
    (prev.operation ?? null) !== (next.operation ?? null) ||
    !sameConflicts(prev.conflicts, next.conflicts)
  ) {
    return false;
  }
  return prev.files.every((file, i) => {
    const other = next.files[i];
    return (
      other &&
      file.relative === other.relative &&
      file.status === other.status &&
      file.additions === other.additions &&
      file.deletions === other.deletions &&
      file.staged === other.staged &&
      file.unstaged === other.unstaged
    );
  });
}
