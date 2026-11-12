import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { GitCommitActions } from "./GitCommitActions";
import { Text } from "../../../shared/ui/Text";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Popover } from "../../../shared/ui/Popover";
import { FileSection } from "./FileSection";
export { FileSection } from "./FileSection";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { useOwnedTimeout } from "../../../shared/hooks/useOwnedTimeout";
import { t, useLocale, useT } from "../../../shared/i18n/git";
import { amendPushedCopy, discardSelectedCopy, discardUnstagedCopy } from "./gitConfirmCopy";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
import {
  ChevronDown,
  ChevronRight,
  FileDiff,
  ListFilter,
  FolderTree,
  Minus,
  Plus,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Undo2,
  WandSparkles,
  X,
} from "../../../shared/ui/icons";
import {
  Suspense,
  lazy,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
// Loaded on demand: it brings the diff view and CodeMirror with it.
const GitConflictCompare = lazy(() =>
  import("./GitConflictCompare").then((module) => ({
    default: module.GitConflictCompare,
  })),
);
import { GitConflictRows } from "./GitConflictRows";
import { GitOperationBanner } from "./GitOperationBanner";
import { GitPanelSections, usePanelPreferencesMenu } from "./GitPanelSections";
import { GitActionsMenu, type ChangesActions } from "./GitActionsMenu";
import { BranchPicker } from "./BranchPicker";
import { applyCommit, applyIndexAction } from "../model/optimisticIndex";
import { ACTION_LABEL, busyLabel } from "../model/gitBusyLabel";
import { AUTO_FETCH_MS, loadAutoFetch, saveAutoFetch } from "../model/autoFetch";
import {
  basename,
  gitCommit,
  gitDiffIndex,
  gitDiscardAll,
  gitDiscardFile,
  gitFetch,
  gitInit,
  gitTrustRepository,
  gitHeadMessage,
  gitPrCreate,
  gitPrStatus,
  gitPush,
  gitRangeContext,
  gitStageAll,
  gitStageFile,
  gitStageFiles,
  gitDiscardFiles,
  gitUnstageFiles,
  gitSync,
  gitUnstageAll,
  gitUnstageFile,
  type GitChangedFile,
  type GitChangeScope,
  type GitDiffIndex,
  type GitFileDiffKind,
  type GitHistoryCommit,
} from "../../../platform/tauri/fs";
import type { HarnessId } from "../../sessions";
import { recordInboxSelfActivity } from "../../inbox/model/inboxSelfActivity";
import { loadChangesView, saveChangesView } from "../../settings/public/appearance";
import type { ChangesView } from "../../settings";
import { generatePrContent } from "../../../integrations/harness";
import { invalidateWatchedFiles } from "../../files/public/fileWatch";
import { MOD } from "../../../platform/tauri/platform";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { isRemoteProjectPath } from "../../projects/public/recents";
import {
  GIT_ACTIONS,
  GIT_CONFLICTS,
  useRemoteSupports,
} from "../../connections/public/remoteCapabilities";
import { remotePollDue, useRemoteLoadFailure } from "../../connections/public/remoteHealth";
import { RemoteLoadError } from "../../connections/public/RemoteLoadError";
import type { CommitMenuOptions } from "../model/gitActionsMenu";
import {
  commitBlockedMessage,
  needsLegacyConflictPoll,
  resolveConflictState,
  type ConflictRow,
} from "../model/conflictSection";
import { useConflictActions } from "../hooks/useConflictActions";
import {
  gitPanelRuntime,
  useGitPanelState,
  useGitPanelRuntime,
  withGitPanelRuntime,
  setGitFeedback,
  withGitOperation,
  withGitBackgroundFetch,
} from "../model/gitPanelState";
import { useLegacyConflictStatus } from "../hooks/useLegacyConflictStatus";
import { confirmNative, confirmDiscardFile } from "../model/gitConfirmation";
import { invalidateGitIndex } from "../model/gitIndexStore";

import { GitFeedback } from "./GitFeedback";
import { usePrStatus } from "../hooks/usePrStatus";
import { ACTIVE_PROJECT_REFRESH_MS } from "../model/gitRefreshPolicy";
import { GitGenerationSettings } from "./GitGenerationSettings";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import { DetailedInlineError } from "../../../shared/ui/ErrorDetails";
import { InlineMessage } from "../../../shared/ui/InlineError";
import type { Worktree } from "../model/worktrees";
import { requestWorktreeManagement } from "../model/worktreeManagement";
import styles from "./CheckoutHeader.module.css";
import { CheckoutIdentity } from "./CheckoutIdentity";
import { UpstreamLabel } from "./UpstreamLabel";
import { InlineAction } from "../../../shared/ui/ActionHost";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { ChangeList } from "./GitChangesList";
import { useDiffIndex, announceGitChange } from "../hooks/useDiffIndex";
import { useCommitDraft } from "../hooks/useCommitDraft";
import { useSubmodulePointers, type SubmoduleListing } from "../hooks/useSubmodulePointers";

export { ChangeList };

export const GIT_POLL_MS = ACTIVE_PROJECT_REFRESH_MS;

let stagedOpen = true;
let changesOpen = true;
let conflictsOpen = true;
let changesView: ChangesView = loadChangesView();

type Props = {
  /** Embedded in the graph workspace; its own history and stash rail stay outside. */
  embedded?: boolean;
  /** A compact row in the workspace's normal Source Control panel. */
  repository?: {
    name: string;
    checkout?: Worktree;
    current?: boolean;
    expanded?: boolean;
    onToggle: (expanded: boolean) => void;
    /** This repository's gitlink change in its parent, shown beside its name. */
    pointer?: ReactNode;
  };
  /** Repositories listed below this one: their gitlinks leave this list. */
  submodules?: SubmoduleListing;
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
  /** The target header above already offers refresh: keep one refresh control. */
  refreshInTarget?: boolean;
  /** The target header above already offers worktree management. */
  worktreesInTarget?: boolean;
};

export function GitChangesPanel({
  embedded = false,
  repository,
  submodules,
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
  refreshInTarget = false,
  worktreesInTarget = false,
}: Props) {
  "use memo";
  const t = useT();
  const paneRef = useRef<HTMLDivElement>(null);
  const {
    index,
    reload,
    showOptimistic,
    error: loadError,
    loading,
    checking,
  } = useDiffIndex(cwd, enabled, !repository || repository.expanded === true, paneRef);
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
  // A collapsed repository row shows only its summary; its hidden list stays
  // mounted for the header menu but does no background work.
  const detailsOpen = !repository || (repository.expanded ?? !!operation);
  // A plain folder has nothing to stage, commit, stash or graph.
  const notRepository = index?.repository === false;
  const [initError, setInitError] = useState<string | null>(null);
  // Lets the header menu drive the commit box and bulk stage actions below.
  const changesRef = useRef<ChangesActions | null>(null);
  // Shared across the header and the changed-files list so no two Git
  // mutations ever run against the same checkout at once.
  const [busy, setBusy] = useGitPanelState(cwd, "busy");
  const [status, setStatus] = useGitPanelState(cwd, "status");
  // The step a running action is on ("Pushing…"), shown beside the spinner.
  const [pending, setPending] = useGitPanelState(cwd, "pending");
  // Keep one progress cue while its action is visible; collapsed repositories
  // and operations launched from menus still need the header's status.
  const localProgressVisible =
    detailsOpen &&
    (busy === "commit" || busy === "pr" || (busy === "sync" && Boolean(index?.remote)));
  const [feedback] = useGitPanelState(cwd, "feedback");
  const [fetchError, setFetchError] = useState<string | null>(null);

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
  const toggleAutoFetch = () => {
    saveAutoFetch(!autoFetch);
    setAutoFetch(!autoFetch);
  };
  const preferences = usePanelPreferencesMenu({
    autoFetch,
    canFetch,
    onToggleAutoFetch: toggleAutoFetch,
  });

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
    if (!enabled || !autoFetch || !canFetch || !detailsOpen) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (document.hidden || !remotePollDue(cwd) || gitPanelRuntime(cwd).state.busy) return;
      // Quiet: a failed background fetch should not interrupt with a dialog.
      void withGitBackgroundFetch(cwd, () => gitFetch(cwd)).then(
        () => {
          // Ignore results that settle after cleanup (repository or setting changed).
          if (cancelled) return;
          setFetchError(null);
          reload();
          announceGitChange(cwd, "refs");
        },
        (error) => {
          if (cancelled) return;
          setFetchError(error instanceof Error ? error.message : String(error));
        },
      );
    }, AUTO_FETCH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [autoFetch, canFetch, cwd, detailsOpen, enabled, reload]);

  if (!cwd || cwd === "~") {
    return (
      <EmptyState
        size="inline"
        kind="empty"
        className="px-3 py-2"
        description={t("No project folder")}
      />
    );
  }

  // The one branch control: leads the header of the single panel and sits with
  // the actions in a grouped repository row.
  const branchControl =
    detailsOpen && index?.repository !== false && (index?.branch || repository) ? (
      <Text
        className={`flex min-w-0 items-center gap-1 ${repository ? "max-w-48 shrink-4" : "-ms-1.5 max-w-[65%] shrink-0"}`}
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
      </Text>
    ) : null;
  // Operation results sit next to the actions that produced them (below the commit
  // and sync controls); a collapsed repository row shows them in place.
  const notices = (
    <>
      {feedback ? (
        <>
          <GitFeedback
            cwd={cwd}
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
            <Button
              variant="link"
              size="sm"
              className="mx-3 mb-2 self-start"
              onClick={() =>
                void openUrl(feedback.url!).catch((error) =>
                  setGitFeedback(cwd, { ...feedback, detail: String(error) }),
                )
              }
            >
              {t("Open pull request")}
            </Button>
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
    </>
  );
  return (
    <div
      ref={paneRef}
      data-git-repository={repository ? cwd : undefined}
      className={`@container/changes flex min-h-0 flex-col ${repository ? `shrink-0 ${styles.repository}` : "h-full flex-1 overflow-hidden"}`}
      onContextMenu={embedded ? undefined : preferences.onContextMenu}
    >
      {preferences.menu}
      <Text
        as="header"
        size="inherit"
        tone={repository ? "primary" : "inherit"}
        className={repository ? styles.header : styles.branchHeader}
        data-current-checkout={repository?.current || undefined}
      >
        {repository ? (
          <Button
            size="sm"
            variant="item"
            motion="none"
            aria-expanded={detailsOpen}
            onClick={() => repository.onToggle(!detailsOpen)}
            tooltip={`${repository.name} · ${cwd}`}
            className={styles.disclosure}
          >
            {detailsOpen ? (
              <ChevronDown className="icon-xs shrink-0" />
            ) : (
              <ChevronRight className="icon-xs shrink-0" />
            )}
            <CheckoutIdentity
              cwd={cwd}
              name={repository.name}
              checkout={repository.checkout}
              index={index}
              showReference={!branchControl}
            />
            {repository.current ? (
              <Text size="caption" leading="inherit" tone="accent" className={styles.current}>
                {t("Current")}
              </Text>
            ) : null}
          </Button>
        ) : (
          <>
            {branchControl ?? (
              <Text as="span" size="secondary" tone="primary" weight="medium" className="shrink-0">
                {index?.repository === false || !index
                  ? t("Changes")
                  : `${t("Detached")} · ${(index.head ?? "").slice(0, 7)}`}
              </Text>
            )}
            {index?.upstream && detailsOpen ? <UpstreamLabel upstream={index.upstream} /> : null}
          </>
        )}
        {repository?.pointer}
        {busy && !localProgressVisible ? (
          <Text
            role="status"
            size="micro"
            tone="secondary"
            className="flex min-w-0 items-center gap-1"
          >
            <Spinner size="xs" className="shrink-0" />
            <Text size="inherit" tone="inherit" truncate className="min-w-0">
              {pending ?? busyLabel(busy)}
            </Text>
          </Text>
        ) : !busy && status ? (
          <Text role="status" size="micro" tone="secondary" truncate className="min-w-0">
            {status}
          </Text>
        ) : null}
        <div className={repository ? styles.actions : "ms-auto flex min-w-0 items-center gap-1"}>
          {repository && index ? (
            <Tooltip
              label={`${t("Changes")}: ${files.length}; ${t("Merge Conflicts")}: ${conflicts.length}`}
              asChild
            >
              <Text size="caption" leading="inherit" tone="secondary" className={styles.summary}>
                <FileDiff aria-hidden className="icon-xs" />
                <span aria-label={`${t("Changes")}: ${files.length + conflicts.length}`}>
                  {files.length + conflicts.length}
                </span>
                {conflicts.length > 0 ? (
                  <Text size="inherit" tone="warning" className={styles.conflicts}>
                    {t("Merge Conflicts")}: {conflicts.length}
                  </Text>
                ) : null}
                {!detailsOpen && (index.ahead ?? 0) > 0 ? <span>↑{index.ahead}</span> : null}
                {!detailsOpen && (index.behind ?? 0) > 0 ? <span>↓{index.behind}</span> : null}
              </Text>
            </Tooltip>
          ) : null}
          {repository ? branchControl : null}
          {/* Fixed icon columns keep these actions aligned with the section
              actions below; controls owned by the header above leave their
              column empty so the menu stays at the trailing edge. */}
          <div className={styles.branchSlots}>
            <span className={styles.branchSlot}>
              {detailsOpen && !refreshInTarget ? (
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  label={t("Refresh source control")}
                  disabled={!enabled || !!busy}
                  loading={loading}
                  loadingLabel={t("Refreshing…")}
                  onClick={() => {
                    onMutated();
                    changesRef.current?.refreshPr?.();
                  }}
                >
                  <RefreshCw aria-hidden className="icon-sm" strokeWidth={1.75} />
                </Button>
              ) : null}
            </span>
            <span className={styles.branchSlot}>
              {worktreesInTarget || notRepository ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  label={t("Manage worktrees…")}
                  disabled={!enabled || !!busy}
                  onClick={() => requestWorktreeManagement(cwd)}
                >
                  <FolderTree aria-hidden className="icon-sm" />
                </Button>
              )}
            </span>
            <span className={styles.branchSlot}>
              {index && !notRepository ? (
                <GitActionsMenu
                  cwd={cwd}
                  index={index}
                  busy={busy}
                  setBusy={setBusy}
                  autoFetch={autoFetch}
                  onToggleAutoFetch={toggleAutoFetch}
                  changes={changesRef}
                  onStatus={setStatus}
                  onPending={setPending}
                  onMutated={onMutated}
                  onOpenCommit={onOpenCommit}
                  toolbar={false}
                  onRevealChanges={repository ? () => repository.onToggle(true) : undefined}
                />
              ) : null}
            </span>
          </div>
        </div>
      </Text>
      {repository && operation && !detailsOpen ? (
        <InlineMessage tone="warning" live="off" className="px-2">
          {operation}
        </InlineMessage>
      ) : null}
      {repository && loadError && !detailsOpen ? (
        <DetailedInlineError className="px-2" error={loadError} />
      ) : null}
      {loadError?.includes("dubious ownership") ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={!enabled || !!busy}
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
        </Button>
      ) : null}
      {!detailsOpen ? notices : null}
      {detailsOpen && operation && gitActions ? (
        <GitOperationBanner
          cwd={cwd}
          operation={operation}
          conflictCount={conflicts.length}
          onChanged={() => onMutated()}
        />
      ) : null}
      {notRepository ? (
        detailsOpen ? (
          <>
            <EmptyState
              context="panel"
              kind="empty"
              title={t("This folder is not a Git repository")}
              description={t("Initialize a repository to track changes in this folder.")}
              action={
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!enabled || (!!busy && busy !== "init")}
                  loading={busy === "init"}
                  onClick={async () => {
                    setBusy("init");
                    setInitError(null);
                    try {
                      await gitInit(cwd);
                      onMutated();
                    } catch (error) {
                      setInitError(String(error).replace(/^Error: /, ""));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {t("Initialize Repository")}
                </Button>
              }
            />
            {initError ? (
              <GitFeedback
                title={t("Could not initialize the repository")}
                detail={initError}
                onDismiss={() => setInitError(null)}
              />
            ) : null}
          </>
        ) : null
      ) : (
        <div className={detailsOpen ? "contents" : "hidden"}>
          <ChangedFiles
            cwd={cwd}
            textHarness={textHarness}
            index={index}
            loadError={loadError}
            loading={loading}
            checking={checking}
            files={files}
            submodules={submodules}
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
            active={detailsOpen}
            onMutated={onMutated}
            notices={notices}
          />
        </div>
      )}
      {/* An overview row leaves Stashes and Graph to the one shared set below the rows. */}
      {!embedded && !repository && !notRepository ? (
        <GitPanelSections
          cwd={cwd}
          enabled={enabled}
          hasChanges={files.length > 0 || conflicts.length > 0}
          selectedSha={selectedSha}
          onOpenCommit={onOpenCommit}
          paneRef={paneRef}
        />
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
  checking,
  files,
  submodules,
  conflicts,
  selected,
  selectedKind,
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
  active,
  onMutated,
  notices,
}: {
  cwd: string;
  textHarness?: HarnessId;
  index: GitDiffIndex | null;
  loadError: string | null;
  loading: boolean;
  /** The entry read is still running; an empty cached list may not be final. */
  checking: boolean;
  files: GitChangedFile[];
  submodules?: SubmoduleListing;
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
  /** False while a repository row is collapsed: skip the pull request lookup. */
  active: boolean;
  onMutated: (paths?: string[], scope?: GitChangeScope) => void;
  /** Operation feedback, shown beside the commit and sync actions. */
  notices?: ReactNode;
}) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const failure = useRemoteLoadFailure(cwd, "changes");
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const runtime = useGitPanelRuntime(cwd);
  const generateAbortRef = runtime.generateAbort;
  const generationMutation = runtime.generationIndex;
  const fileActions = runtime.fileActions;
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
  const [fileQuery, setFileQuery] = useRetainedState(`git-file-filter:${cwd}`, "");
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const deferredFileQuery = useDeferredValue(fileQuery).trim().toLowerCase();
  const {
    pr,
    reload: reloadPr,
    loading: prLoading,
    error: prError,
  } = usePrStatus(cwd, index?.branch, active && !!index?.remote);
  // Gitlinks of submodules listed below show on their own rows, not twice.
  const [listed, pointers] = useSubmodulePointers(files, submodules, (...args) => run(...args));
  const staged = useMemo(() => listed.filter((file) => file.staged), [listed]);
  const unstaged = useMemo(() => listed.filter((file) => file.unstaged), [listed]);
  const collisionNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of files)
      counts.set(basename(file.relative), (counts.get(basename(file.relative)) ?? 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [files]);
  const visibleStaged = useMemo(
    () => staged.filter((file) => file.relative.toLowerCase().includes(deferredFileQuery)),
    [staged, deferredFileQuery],
  );
  const visibleUnstaged = useMemo(
    () => unstaged.filter((file) => file.relative.toLowerCase().includes(deferredFileQuery)),
    [unstaged, deferredFileQuery],
  );
  const fileFilter = (
    <Button
      size="sm"
      variant="ghost"
      motion="none"
      iconOnly
      label={t("Filter changed files")}
      aria-haspopup="dialog"
      aria-expanded={!!filterAnchor}
      aria-pressed={!!fileQuery.trim()}
      onClick={(event) => setFilterAnchor(filterAnchor ? null : event.currentTarget)}
    >
      <ListFilter className="icon-sm" />
    </Button>
  );
  const hasRemote = Boolean(index?.remote);
  const hasOpenPr = pr?.state === "open";
  const diverged = (index?.ahead ?? 0) > 0 && (index?.behind ?? 0) > 0;
  const onDefault =
    !!index?.branch && !!index.defaultBranch && index.branch === index.defaultBranch;
  const committing = busy === "commit" || busy === "pr";
  const canGenerate = files.length > 0 && !committing && !isRemoteProjectPath(cwd);
  const fail = (error: unknown, operation = "Git operation failed") => {
    const text = error instanceof Error ? error.message : String(error);
    setGitFeedback(cwd, {
      kind: "error",
      get title() {
        return t(operation);
      },
      detail: text,
    });
  };
  const {
    message,
    setMessage,
    generating,
    amend,
    generationChoice,
    setGenerationChoice,
    hasGenerationOverride,
    generate,
    cancelGenerate,
    toggleAmend: toggleAmendDraft,
    clearDraft,
  } = useCommitDraft({ cwd, index, textHarness, canGenerate, fail });
  // Nothing staged: Commit takes every change, as the header menu's Commit does.
  const canCommit =
    (staged.length > 0 || amend || unstaged.length > 0) &&
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
  const pushPossible = hasRemote && !diverged && (!amend || !index?.headPushed);
  const canCommitPush = canCommit && pushPossible;
  // Anything to commit: Commit leads and sync stays its own direct action; otherwise sync/PR leads.
  const commitIntent = files.length > 0 || amend;
  const canCommitPushPr = canCommitPush && !hasOpenPr && !prLoading && !prError && !onDefault;
  // Drafting is independent of staging. Commit and generation retain their
  // own eligibility checks and every checkout retains its own message.
  const canEditMessage = !committing && !generating;

  const canOpenMenu = !!index?.branch && !busy;

  const toggleView = () => {
    changesView = view === "tree" ? "list" : "tree";
    saveChangesView(changesView);
    setView(changesView);
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
    return withGitPanelRuntime(cwd, async () => {
      if (!onDefault || !index?.branch) return true;
      const branch = index.branch;
      return confirmNative(
        kind === "pr"
          ? t('Create a pull request from default branch "{p0}"?', { p0: branch })
          : t('Push to default branch "{p0}"?', { p0: branch }),
      );
    });
  };

  const run = async (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
    confirmed = false,
    optimisticIndex?: GitDiffIndex,
  ) => {
    return withGitPanelRuntime(cwd, async () => {
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
      generationMutation.version++;
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
          fail(
            error,
            action === "stage"
              ? "Couldn’t stage changes"
              : action === "unstage"
                ? "Couldn’t unstage changes"
                : "Couldn’t discard changes",
          );
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
    });
  };

  const runSelection = async (
    selectedFiles: GitChangedFile[],
    action: "stage" | "unstage" | "discard",
  ) => {
    return withGitPanelRuntime(cwd, async () => {
      if (!selectedFiles.length) return;
      if (selectedFiles.length === 1) return run(selectedFiles[0], action);
      const queue = fileActions.current;
      if (gitPanelRuntime(cwd).state.busy && queue.size === 0) return;
      if (action === "discard") {
        const ok = await confirmNative(...discardSelectedCopy(selectedFiles.length));
        if (!ok || (gitPanelRuntime(cwd).state.busy && queue.size === 0)) return;
      }
      if (queue.size === 0) setGitFeedback(cwd, null);
      queue.size += 1;
      queue.paths.push(...selectedFiles.map((file) => file.path));
      generationMutation.version++;
      setBusy(action);
      setPending(ACTION_LABEL[action]);
      if (index) {
        showOptimistic(
          applyIndexAction(index, action, new Set(selectedFiles.map((file) => file.relative))),
        );
      }
      const task = queue.tail.then(async () => {
        try {
          const paths = selectedFiles.map((file) => file.relative);
          if (action === "stage") await gitStageFiles(cwd, paths);
          else if (action === "unstage") await gitUnstageFiles(cwd, paths);
          else await gitDiscardFiles(cwd, paths);
        } catch (error) {
          fail(
            error,
            action === "stage"
              ? "Couldn’t stage changes"
              : action === "unstage"
                ? "Couldn’t unstage changes"
                : "Couldn’t discard changes",
          );
        }
      });
      queue.tail = task;
      await task;
      queue.size -= 1;
      if (queue.size > 0) return;
      onMutated(queue.paths.splice(0), "index");
      setBusy(null);
      setPending(null);
    });
  };

  const runAll = async (action: "stage" | "unstage" | "discard") => {
    return withGitPanelRuntime(cwd, async () => {
      if (gitPanelRuntime(cwd).state.busy) return;
      if (action === "discard") {
        const n = unstaged.length;
        if (n === 0) return;
        const only = unstaged[0];
        const untrackedOnly = n === 1 && only?.status === "untracked";
        const ok = await confirmNative(
          ...discardUnstagedCopy(n, only && basename(only.relative), untrackedOnly),
        );
        if (!ok) return;
      }
      if (gitPanelRuntime(cwd).state.busy) return;
      setGitFeedback(cwd, null);
      setBusy(action);
      const discarded = action === "discard" ? unstaged.map((file) => file.path) : undefined;
      generationMutation.version++;
      if (index) showOptimistic(applyIndexAction(index, action));
      try {
        if (action === "stage") await gitStageAll(cwd);
        else if (action === "unstage") await gitUnstageAll(cwd);
        else await gitDiscardAll(cwd);
        onMutated(discarded, "index");
      } catch (error) {
        onMutated(discarded, "index");
        fail(
          error,
          action === "stage"
            ? "Couldn’t stage changes"
            : action === "unstage"
              ? "Couldn’t unstage changes"
              : "Couldn’t discard changes",
        );
      } finally {
        setBusy(null);
      }
    });
  };

  const runFolder = async (relative: string, action: "stage" | "unstage") => {
    return withGitPanelRuntime(cwd, async () => {
      const queue = fileActions.current;
      if (gitPanelRuntime(cwd).state.busy && queue.size === 0) return;
      if (queue.size === 0) setGitFeedback(cwd, null);
      queue.size += 1;
      generationMutation.version++;
      queue.paths.push(
        ...files
          .filter((file) => file.relative.startsWith(`${relative}/`))
          .map((file) => file.path),
      );
      setBusy(`folder:${action}:${relative}`);
      setPending(ACTION_LABEL[action]);
      // Share the existing index mutation queue with single-file actions.
      const task = queue.tail.then(async () => {
        try {
          if (action === "stage") await gitStageFile(cwd, relative);
          else await gitUnstageFile(cwd, relative);
        } catch (error) {
          fail(error, action === "stage" ? "Couldn’t stage changes" : "Couldn’t unstage changes");
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
    });
  };

  const toggleAmend = async () => {
    return withGitPanelRuntime(cwd, async () => {
      setMenuOpen(false);
      await toggleAmendDraft();
    });
  };

  const confirmAmend = async (amending: boolean) => {
    return withGitPanelRuntime(cwd, async () => {
      if (!amending || !index?.headPushed) return true;
      return confirmNative(...amendPushedCopy());
    });
  };

  /**
   * `options` come from the header menu, which picks what to stage, whether to
   * amend, and whether to sign off. Without them this is the Commit button.
   */
  const commit = async (push: boolean, createPr = false, options?: CommitMenuOptions) => {
    return withGitPanelRuntime(cwd, async () => {
      const amending = options ? options.amend : amend;
      if (runtime.state.generating || generateAbortRef.current) return;
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
        options?.scope === "all" ||
        ((options?.scope ?? "smart") === "smart" && !amending && staged.length === 0);
      if (runtime.state.busy || runtime.state.generating || generateAbortRef.current) return;
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
        clearDraft();
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
              ? t("Commit pushed; pull request creation failed")
              : t("Commit created; push failed"),
            detail: error instanceof Error ? error.message : String(error),
            retry: () =>
              retryPublication(!pushed && (push || createPr), createPr, index?.branch ?? null),
          });
        else fail(error, "Couldn’t commit changes");
        onMutated();
      } finally {
        setBusy(null);
        setPending(null);
      }
    });
  };

  useLayoutEffect(() => {
    actionsRef.current = {
      refreshPr: reloadPr,
      commit: (options) => commit(false, false, options),
      runAll,
    };
  });

  const sync = async () => {
    return withGitPanelRuntime(cwd, async () => {
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
        fail(error, canPublish ? "Couldn’t publish branch" : "Couldn’t synchronize changes");
        onMutated();
      } finally {
        setBusy(null);
      }
    });
  };

  async function openCreatedPr() {
    return withGitPanelRuntime(cwd, async () => {
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
    });
  }

  async function retryPublication(push: boolean, createPr: boolean, branch: string | null) {
    return withGitPanelRuntime(cwd, async () => {
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
          title: remainingPush ? t("Commit created; push failed") : t("Publication incomplete"),
          detail: String(error),
          retry: () => retryPublication(remainingPush, createPr, branch),
        });
      } finally {
        onMutated();
        reloadPr();
      }
    });
  }

  const createPr = async () => {
    return withGitPanelRuntime(cwd, async () => {
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
            ? t("Branch pushed; pull request creation failed")
            : t("Couldn’t create pull request"),
          detail: String(error),
          retry: () =>
            retryPublication(!pushed && (index?.ahead ?? 0) > 0, true, index?.branch ?? null),
        });
        onMutated();
      } finally {
        setBusy(null);
        setPending(null);
      }
    });
  };

  return (
    <aside className={`flex min-h-0 min-w-0 flex-col ${fill ? "flex-1" : "shrink-0"}`}>
      <div className={`shrink-0 ${styles.commitSection}`}>
        <div className="flex flex-col gap-1.5 p-2">
          <div className="relative min-w-0">
            <TextareaField
              label={t("Commit message")}
              hideLabel
              fieldClassName={styles.messageField}
              textSize="caption"
              ref={messageRef}
              fieldSize="sm"
              minRows={1}
              maxRows={8}
              autosize
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
              className={styles.message}
              endAdornment={
                <>
                  {generating ? <WorkingIndicator label={t("Generating message…")} /> : null}
                  <InlineAction
                    reveal="always"
                    label={
                      generating
                        ? t("Cancel commit message generation")
                        : t("Generate commit message")
                    }
                    disabled={!generating && !canGenerate}
                    onClick={() => (generating ? cancelGenerate() : void generate())}
                  >
                    {generating ? (
                      <X className="icon-sm" strokeWidth={1.75} />
                    ) : (
                      <WandSparkles className="icon-sm" strokeWidth={1.75} />
                    )}
                  </InlineAction>
                  {!isRemoteProjectPath(cwd) && (
                    <GitGenerationSettings
                      cwd={cwd}
                      preferred={textHarness}
                      choice={generationChoice}
                      hasOverride={hasGenerationOverride}
                      onChange={setGenerationChoice}
                      disabled={generating || committing}
                    />
                  )}
                </>
              }
            />
          </div>
          <div className="min-w-0">
            <GitCommitActions
              index={index ?? null}
              pr={pr}
              busy={busy}
              pending={pending}
              hasRemote={hasRemote}
              hasOpenPr={hasOpenPr}
              onDefault={onDefault}
              amend={amend}
              commitIntent={commitIntent}
              canCommit={canCommit}
              blockedReason={blockedMessage}
              canCommitPush={canCommitPush}
              canCommitPushPr={canCommitPushPr}
              canSync={canSync}
              canPublish={canPublish}
              canCreatePr={canCreatePr}
              canViewPr={canViewPr}
              canOpenMenu={canOpenMenu}
              menuOpen={menuOpen}
              onMenuOpenChange={setMenuOpen}
              onCommit={(push, createPr) => void commit(push, createPr)}
              onToggleAmend={() => void toggleAmend()}
              onSync={() => void sync()}
              onCreatePr={() => void createPr()}
              onViewPr={() => {
                if (pr?.url)
                  openUrlSafely(pr.url, (error) =>
                    setGitFeedback(cwd, {
                      kind: "error",
                      get title() {
                        return t("Could not open the link");
                      },
                      detail: String(error),
                    }),
                  );
              }}
            />
          </div>
        </div>
        {notices}
      </div>
      {prLoading ? (
        <Text role="status" as="p" size="micro" tone="secondary" className="px-3 py-1">
          {t("Checking pull request…")}
        </Text>
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
      {loading && index ? (
        <Text role="status" as="p" size="micro" tone="secondary" className="px-3 py-1">
          {t("Refreshing changes…")}
        </Text>
      ) : null}
      {failure ? (
        <RemoteLoadError cwd={cwd} failure={failure} stale={!!index} onRetry={() => onMutated()} />
      ) : null}
      {filterAnchor ? (
        <Popover
          anchor={filterAnchor}
          side="bottom"
          align="end"
          width={280}
          role="dialog"
          aria-label={t("Filter changed files")}
          onDismiss={(reason) => {
            if (reason === "escape") filterAnchor.focus({ preventScroll: true });
            setFilterAnchor(null);
          }}
          className="p-3"
        >
          <SearchInput
            type="search"
            appearance="field"
            standalone
            autoFocus
            value={fileQuery}
            aria-label={t("File or folder name")}
            placeholder={t("File or folder name")}
            onChange={(event) => setFileQuery(event.target.value)}
            containerClassName="w-full"
          />
          <Button
            size="sm"
            variant="ghost"
            motion="none"
            disabled={!fileQuery}
            onClick={() => setFileQuery("")}
            className="mt-2"
          >
            {t("Reset filters")}
          </Button>
        </Popover>
      ) : null}
      <div
        // Grouped repositories scroll in the workspace list. A nested scroll
        // container would contain wheel gestures even when its files fit.
        ref={fill ? lockOverscroll : undefined}
        className={`min-h-0 py-1 ${fill ? "flex-1 overflow-y-auto overscroll-none" : "shrink-0"} ${failure ? "opacity-60" : ""}`}
      >
        {files.length === 0 &&
        conflicts.length === 0 &&
        index?.repository !== false &&
        !failure &&
        !loadError &&
        (!index || checking) ? (
          // A cached empty list may be stale until the entry read answers.
          <SurfaceLoading
            delay={!index}
            style={fill ? undefined : { minBlockSize: "6rem" }}
            title={t("Loading changes…")}
          />
        ) : files.length === 0 && conflicts.length === 0 ? (
          <Text as="p" size="caption" tone="muted" className="px-3 py-2">
            {index?.repository === false
              ? ""
              : index
                ? diverged
                  ? t("Diverged from {p0}", { p0: index.upstream ?? "upstream" })
                  : t("No uncommitted changes")
                : ""}
          </Text>
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
                    icon: <PanelLeft className="icon-sm" />,
                    onClick: () => void conflictActions.acceptAll(conflicts, "ours"),
                  },
                  {
                    get title() {
                      return t("Accept All Incoming");
                    },
                    icon: <PanelRight className="icon-sm" />,
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
                countLabel={
                  deferredFileQuery ? `${visibleStaged.length} / ${staged.length}` : undefined
                }
                headerExtra={fileFilter}
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
                    icon: <FileDiff className="icon-sm" strokeWidth={1.75} />,
                    overflow: true,
                    onClick: () => onOpenAllChanges("staged"),
                  },
                  {
                    get title() {
                      return t("Unstage All Changes");
                    },
                    icon: <Minus className="icon-sm" strokeWidth={1.75} />,
                    onClick: () => void runAll("unstage"),
                  },
                ]}
              >
                <ChangeList
                  files={visibleStaged}
                  collisionNames={collisionNames}
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
                countLabel={
                  deferredFileQuery ? `${visibleUnstaged.length} / ${unstaged.length}` : undefined
                }
                headerExtra={staged.length === 0 ? fileFilter : undefined}
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
                    icon: <FileDiff className="icon-sm" strokeWidth={1.75} />,
                    overflow: true,
                    onClick: () => onOpenAllChanges("unstaged"),
                  },
                  {
                    get title() {
                      return t("Discard All Changes");
                    },
                    icon: <Undo2 className="icon-sm" strokeWidth={1.75} />,
                    overflow: true,
                    danger: true,
                    onClick: () => void runAll("discard"),
                  },
                  {
                    get title() {
                      return t("Stage All Changes");
                    },
                    icon: <Plus className="icon-sm" strokeWidth={1.75} />,
                    onClick: () => void runAll("stage"),
                  },
                ]}
              >
                <ChangeList
                  files={visibleUnstaged}
                  collisionNames={collisionNames}
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
            {pointers.length > 0 ? (
              <Text as="p" size="caption" tone="secondary" className="px-3 py-1">
                {t("Submodule pointer changes: {p0}, shown on their submodule rows.", {
                  p0: pointers.length,
                })}
              </Text>
            ) : null}
            {deferredFileQuery ? (
              <Text role="status" as="p" size="caption" tone="secondary" className="px-3 py-1">
                {visibleStaged.length + visibleUnstaged.length} / {staged.length + unstaged.length}{" "}
                {t("staged and unstaged entries")}
                <span className="block">
                  {t("All actions affect the entire repository, including hidden entries.")}
                </span>
              </Text>
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
