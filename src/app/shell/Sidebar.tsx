import { Badge, type BadgeTone } from "../../shared/ui/Badge";
import { Alert } from "../../shared/ui/Alert";
import { TextField } from "../../shared/ui/TextField";
import { Button } from "../../shared/ui/Button";
import styles from "./Sidebar.module.css";
import {
  SourceControl,
  ProjectSearch,
  SearchableProjectPicker,
  InboxNotificationMenu,
  preloadSidebarSurfaces,
} from "./sidebarSurfaces";
import { RelativeSessionTime, useMinuteNow } from "./RelativeSessionTime";
import { SearchInput, SearchInputGroup } from "../../shared/ui/SearchInput";
import { themePalette } from "../../shared/theme/palette";
import { motion as layoutMotion } from "motion/react";
import { sessionStatusOrder } from "../../features/sessions/model/sessionStatusOrder";
import { WorkspaceFeatureGate } from "../../features/settings/ui/WorkspaceFeatureGate";
import { t, useLocale } from "../../shared/i18n";
import { SocialShortcut } from "../../features/social/ui/SocialShortcut";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { prefetchGithubWorkItem } from "../../features/inbox/model/githubTasks";
import { NO_BRANCH_LABEL } from "../../features/source-control/model/worktrees";
import { confirmSessionDelete } from "../../features/sessions/model/confirmSessionDelete";
import {
  type WorktreeFocus,
  inWorktreeFocus,
  useWorktreeFocus,
} from "../../features/source-control/model/worktreeFocus";
import { SidebarWorktreeSwitcher } from "../../features/source-control/ui/SidebarWorktreeSwitcher";
import { OrchestrationSidebarAgents } from "../../features/orchestration/ui/OrchestrationSidebarAgents";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Archive,
  Chatting,
  Loader,
  Check,
  CheckList,
  DashboardSquare,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  CircleDot,
  Clock,
  FileScript,
  Folder,
  FolderTree,
  GitBranch,
  GitPullRequest,
  Inbox,
  ListFilter,
  PanelLeft,
  Pin,
  Plus,
  Search,
  Share,
  Settings,
  SplitSquare,
  StickyNote,
  Trash2,
  Zap,
} from "../../shared/ui/icons";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useDeferredValue,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import {
  loadSessionSidebarWidth,
  loadSidebarTabOrder,
  saveSessionSidebarWidth,
  saveSidebarTabOrder,
  SESSION_SIDEBAR_WIDTH_DEFAULT,
  SESSION_SIDEBAR_WIDTH_MAX,
  SESSION_SIDEBAR_WIDTH_MIN,
  type SidebarTabId,
} from "../../features/settings/model/appearance";
import { formatInteger } from "../../shared/lib/numbers";
import { type GitFileDiffKind, type GitHistoryCommit } from "../../platform/tauri/fs";
import { IS_MAC, MOD } from "../../platform/tauri/platform";
import { copyText } from "../../platform/tauri/clipboard";
import { forgetRemoteQueue } from "../../features/connections/model/useRemoteQueue";
import { RemoteDataStatus } from "../../features/connections/ui/RemoteDataStatus";
import { RemoteLoadError } from "../../features/connections/ui/RemoteLoadError";
import { useRemoteConnection } from "../../features/connections/model/useRemoteConnection";
import {
  classifyRemoteError,
  isConnectionFailure,
} from "../../features/connections/model/remoteFailure";
import { resolveModel } from "../../features/sessions/model/models";
import {
  shortModelName,
  type SessionListDensity,
  useSessionListDisplay,
} from "../../features/sessions/model/sessionListDisplay";
import {
  applySessionOrder,
  loadSessionOrder,
  moveIdsInOrder,
  saveSessionOrder,
  type SessionOrder,
  type SessionOrderList,
} from "../../features/sessions/model/sessionOrder";
import { decorativeMotionEnabled } from "../../features/settings/model/decorativeMotion";
import { TransientNotice } from "../../shared/ui/TransientNotice";
import "./sessionList.css";
import type { OpenFileFn } from "../../features/search/model/search";
import { sessionDisplayTitle } from "../../features/sessions/model/session";
import { ParticleText } from "../../shared/ui/ParticleText";
import { nextUnseenFinishedSessions } from "../../features/sessions/model/sessionDone";
import { orchestrationTaskLabel } from "../../features/orchestration/model/orchestrationSummary";
import {
  orderedSessionActionIds,
  pruneSessionSelection,
  selectAllSessions,
  sessionSelectionRange,
  toggleSessionSelection,
} from "../../features/sessions/model/sessionSelection";
import {
  bulkDeleteConfirmMessage,
  bulkDeleteOutcome,
  bulkDeleteSummary,
  deleteSessionsInBulk,
  splitRunningSessions,
} from "../../features/sessions/model/bulkSessionDelete";
import { paneDropFromPoint, setExternalPaneDrop } from "../../features/workspace/model/paneDrop";
import type { PaneEdge } from "../../features/workspace/model/layout";
import { setDropFeedback, setGrabbing, suppressTextSelection } from "../../shared/lib/drag";
import {
  isPointerOutsideWindow,
  popOutPosition,
  type WindowMovePosition,
} from "../model/windowTransferPopout";
import {
  compareSessionSummaries,
  filterSessionsByArchive,
  filterSessionsByQuery,
} from "../../features/sessions/data/sessionHistory";
import {
  addSessionToFolder,
  arrangeFolderSessions,
  canMoveFolder,
  type FolderMoveTarget,
  moveFolder,
  folderDepth,
  MAX_FOLDER_DEPTH,
  moveFolderOut,
  setFolderPinned,
  buildSessionList,
  createFolderWithSessions,
  dissolveFolder,
  folderAccent,
  folderContaining,
  folderShellFill,
  loadPinnedSessionsCollapsed,
  loadReminderSessionsCollapsed,
  loadSessionFolders,
  mergeFolderSessionSummaries,
  pruneSessionFolders,
  removeSessionFromFolder,
  removeSessionsFromFolders,
  renameFolder,
  savePinnedSessionsCollapsed,
  saveReminderSessionsCollapsed,
  saveSessionFolders,
  sessionListNavigationIds,
  setFolderCollapsed,
  setFolderColor,
  setFolderCustomColor,
  subscribeSessionFolders,
  ungroupedSessions,
  type SessionFolder,
  type SessionListDropTarget,
  type SessionListEntry,
} from "../../features/sessions/model/sessionFolders";
import { LIST_PAGE_SIZE, listWindowSize } from "../../shared/lib/listWindow";
import {
  filterSessionsByHarness,
  filterSessionsByStatus,
  filterSessionsByTime,
  harnessesInSessions,
  hasActiveSessionFilters,
  DEFAULT_SESSION_SIDEBAR_FILTERS,
  loadSessionSidebarFilters,
  saveSessionSidebarFilters,
  type SessionSidebarFilters,
} from "../../features/sessions/model/sessionFilters";
import type { HarnessId, LinkedWorkItem } from "../../features/sessions/model/session";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { SettingsSectionId } from "../../features/settings/model/settings";
import type { InstalledUpdate } from "../model/updateNotice";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  TAB_GROUP_COLORS,
} from "../../features/workspace/model/tabGroups";
import { useTabGroupLogos } from "../../features/projects/hooks/useTabGroupLogos";
import { useDragResize } from "../../shared/hooks/useDragResize";
import { sidePaneMaxWidth } from "./sidePaneWidth";
import { useGitFileStatuses } from "../../features/source-control/hooks/useGitFileStatuses";
import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
import { useProjectDiffStats } from "../../features/source-control/hooks/useProjectDiffStats";
import { useAnimatedReorder } from "../../shared/hooks/useAnimatedReorder";
import { normalizeHex } from "../../shared/lib/colorUtils";
import { useVisibleProjects, useGroupLock } from "../../features/group-lock/hooks/useGroupLock";
import { loadProjectGroupAssignments } from "../../features/projects/model/projectGroups";
import {
  workspaceRepositoryPaths,
  workspaceSourceControlRoot,
  type RepositoryReviewRequest,
} from "../../features/source-control/model/workspaceRepositories";
import {
  collectRailProjects,
  looksLikeProject,
  isRemoteProjectPath,
  sameProjectPath,
  type RecentProject,
} from "../../features/projects/model/recents";
import { ColorPickerPopover, ColorSwatchRow } from "../../shared/ui/ColorPickerPopover";
import { ExplorerMenu, type ExplorerMenuItem } from "../../features/files/ui/ExplorerMenu";
import { FileTree } from "../../features/files/ui/FileTree";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import {
  LastSessionsRows,
  useLastSessionsRows,
  type RecentSessionsSource,
} from "./LastSessionsSection";
import { LiveAgentsPreview } from "../../features/sessions/ui/LiveAgentsPreview";
import { ProjectRail } from "./ProjectRail";
import { RailAction } from "./RailAction";
import { TerminalSpinner } from "../../features/sessions/ui/TerminalSpinner";
import { DevModeSlot, IconButton, TabVisitNav } from "./TitleBar";
import { Popover } from "../../shared/ui/Popover";
import { useProjectMenu } from "./useProjectMenu";
import { SessionFiltersMenu } from "../../features/sessions/ui/SessionFiltersMenu";
import { LinkSessionWorkItemDialog } from "../../features/sessions/ui/LinkSessionWorkItemDialog";
import { sessionReminderPresets } from "../../features/sessions/ui/sessionReminderPresets";
import {
  formatReminderTime,
  reminderTime,
  type SessionReminder,
} from "../../features/sessions/model/sessionReminders";
import { SessionsEmpty } from "../../features/sessions/ui/SessionsEmpty";
import { SidebarUpdateFooter } from "./SidebarUpdate";
import { GithubStarPrompt } from "./GithubStarPrompt";
import {
  refreshRemoteProjectSessions,
  sessionAccessForMachine,
  remotePendingWorktree,
  remoteSessionFor,
  useRemoteProjectSessions,
} from "../../features/connections/model/connections";
import {
  parseRemotePath,
  remotePath,
  remoteProjectFor,
} from "../../features/connections/model/remoteProjects";

const EMPTY_SESSIONS: SessionSummary[] = [];
const EMPTY_REMINDERS: SessionReminder[] = [];
const EMPTY_RECENTS: RecentProject[] = [];
const EMPTY_AGENTS: LiveAgent[] = [];
const EMPTY_IDS = new Set<string>();
const EMPTY_MENU_ITEMS: ExplorerMenuItem[] = [];

const MIN_WIDTH = SESSION_SIDEBAR_WIDTH_MIN;
const MAX_WIDTH = SESSION_SIDEBAR_WIDTH_MAX;
const DEFAULT_WIDTH = SESSION_SIDEBAR_WIDTH_DEFAULT;
const REMINDERS_COLOR = themePalette.hexf59e0b;

type SidebarTab = SidebarTabId;

const TAB_LABELS: Record<SidebarTab, string> = {
  sessions: "Sessions",
  inbox: "Inbox",
  files: "Explorer",
  changes: "Changes",
};

const COMPACT_TAB_ICONS: Record<SidebarTab, typeof PanelLeft> = {
  sessions: Chatting,
  inbox: Inbox,
  files: FileScript,
  changes: GitBranch,
};

function projectPathBusy(paths: Iterable<string> | undefined, cwd: string): boolean {
  if (!paths) return false;
  for (const path of paths) {
    if (sameProjectPath(path, cwd)) return true;
  }
  return false;
}

type Props = {
  recoveryControl?: ReactNode;
  cwd: string;
  /** Working copy for Changes / explorer git. Falls back to `cwd`. */
  gitCwd?: string;
  /** Branch identity shown for a worktree whose folder has a temporary name. */
  explorerRootLabel?: string;
  /** Open tabs per worktree path key, for the worktree switcher. */
  worktreeTabStats?: ReadonlyMap<string, { tabs: number; busy: boolean }>;
  onSelectWorkspace?: (focus?: WorktreeFocus) => void;
  workspaceSwitchPending?: boolean;
  workspaceSwitchError?: string;
  open: boolean;
  sessions: SessionSummary[];
  busySessionIds: Set<string>;
  approvalSessionIds: Set<string>;
  activeSessionId?: string;
  /** Open tabs, including blank ones not yet in history. */
  openSessions?: readonly SessionSummary[];
  status: "idle" | "error";
  /** First listing for this project has not arrived yet. */
  pending: boolean;
  onSelectSession: (sessionId: string) => void;
  onSelectRemoteSession?: (project: string, sessionId: string) => void;
  onRemoteSessionDeleted?: (sessionId: string) => void;
  onSessionNavigationOrder?: (ids: readonly string[]) => void;
  onPrefetchSession?: (sessionId: string) => void;
  onPlaceSessionOnPane?: (sessionId: string, targetId: string, edge: PaneEdge) => void;
  onPopOutSession?: (sessionId: string, position: WindowMovePosition) => void;
  /** Opens several sessions together as a grid in one new tab. */
  onOpenSessionsSideBySide?: (sessionIds: string[]) => void;
  onRenameSession?: (sessionId: string, title: string) => void;
  onArchiveSession?: (sessionId: string, archived: boolean) => void;
  onArchiveSessions?: (sessionIds: readonly string[], archived: boolean) => void;
  onPinSession?: (sessionId: string, pinned: boolean) => void;
  onPinSessions?: (sessionIds: readonly string[], pinned: boolean) => void;
  onSetSessionLinkedWorkItem?: (sessionId: string, item: LinkedWorkItem | undefined) => void;
  reminders?: readonly SessionReminder[];
  onSetReminders?: (sessionIds: readonly string[], dueAt: number) => void;
  onCancelReminders?: (sessionIds: readonly string[]) => void;
  onDeleteSession?: (sessionId: string) => void;
  onDeleteSessions?: (sessionIds: readonly string[]) => void;
  /** Delete without asking. Resolves false when the session was kept and
   * rejects on an error, so a bulk delete can report it. */
  onDeleteSessionNow?: (sessionId: string, skipWorktreeConfirm?: boolean) => Promise<boolean>;
  onOpenFile: OpenFileFn;
  onOpenTerminal?: (cwd: string) => void;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  filesSearchOpen: boolean;
  onFilesSearchOpenChange: (open: boolean) => void;
  onOpenFilesSearch?: () => void;
  searchFocusToken?: number;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onOpenDiff?: (path: string, kind?: GitFileDiffKind, pin?: boolean) => void;
  onOpenAllChanges?: (kind: GitFileDiffKind) => void;
  onOpenCommit?: (commit: GitHistoryCommit, pin?: boolean) => void;
  onOpenRepository?: (request: RepositoryReviewRequest) => void;
  selectedDiffPath?: string;
  selectedDiffKind?: GitFileDiffKind;
  selectedCommitSha?: string;
  textHarness?: HarnessId;
  recents?: RecentProject[];
  busyProjectPaths?: Iterable<string>;
  liveAgents?: LiveAgent[];
  onSelectAgent?: (sessionId: string) => void;
  recentSessions?: RecentSessionsSource;
  onSelectProject?: (path: string) => void;
  onOpenProject?: () => void;
  onOpenSyncedProject?: (projectId: string, name: string) => void | Promise<void>;
  onRemoveProject?: (path: string, options: { purgeData: boolean }) => void | Promise<void>;
  onRenameProjectFolder?: (path: string, name: string) => Promise<void>;
  onNew?: () => string | void;
  onNewTerminal?: () => void;
  onSearch?: () => void;
  onOpenInbox?: () => void;
  onOpenInboxItem?: (item: LinkedWorkItem, sessionId: string) => void;
  onOpenNotes?: () => void;
  onOpenAutomations?: () => void;
  onOpenTasks?: () => void;
  onGoToFile?: () => void;
  searchActive?: boolean;
  inboxActive?: boolean;
  notesActive?: boolean;
  automationsActive?: boolean;
  tasksActive?: boolean;
  socialActive?: boolean;
  notesEnabled?: boolean;
  onToggleProjectRail?: () => void;
  projectRailOpen?: boolean;
  compactProjectRail?: boolean;
  titleBarAbove?: boolean;
  unseenFinishedIds?: Set<string>;
  inboxUnseen?: boolean;
  /** Linked GitHub work changed after the session last advanced. */
  linkedSessionUpdateIds?: ReadonlySet<string>;
  settingsOpen?: boolean;
  settingsSection?: SettingsSectionId;
  onOpenSettings?: () => void;
  onOpenNotificationSettings?: (projectPath?: string) => void;
  onSelectSettingsSection?: (section: SettingsSectionId) => void;
  onCloseSettings?: () => void;
  updateNotice?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
};

const recentPath = (project: RecentProject) => project.path;

function SidebarComponent({
  recoveryControl,
  cwd,
  gitCwd,
  explorerRootLabel,
  worktreeTabStats,
  onSelectWorkspace,
  workspaceSwitchPending,
  workspaceSwitchError,
  open,
  sessions,
  busySessionIds,
  approvalSessionIds,
  activeSessionId,
  openSessions = EMPTY_SESSIONS,
  status,
  pending,
  onSelectSession: onSelectLocalSession,
  onSelectRemoteSession,
  onRemoteSessionDeleted,
  onSessionNavigationOrder,
  onPrefetchSession: onPrefetchLocalSession,
  onPlaceSessionOnPane: onPlaceLocalSessionOnPane,
  onPopOutSession: onPopOutLocalSession,
  onOpenSessionsSideBySide: onOpenLocalSessionsSideBySide,
  onRenameSession: onRenameLocalSession,
  onArchiveSession: onArchiveLocalSession,
  onArchiveSessions: onArchiveLocalSessions,
  onPinSession: onPinLocalSession,
  onPinSessions: onPinLocalSessions,
  onSetSessionLinkedWorkItem: onSetLocalSessionLinkedWorkItem,
  reminders = EMPTY_REMINDERS,
  onSetReminders,
  onCancelReminders,
  onDeleteSession: onDeleteLocalSession,
  onDeleteSessions: onDeleteLocalSessions,
  onDeleteSessionNow: onDeleteLocalSessionNow,
  onOpenFile,
  onOpenTerminal,
  onFileMoved,
  onFileDeleted,
  tab: requestedTab,
  onTabChange,
  filesSearchOpen,
  onFilesSearchOpenChange,
  onOpenFilesSearch,
  searchFocusToken = 0,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  onOpenDiff,
  onOpenAllChanges,
  onOpenCommit,
  onOpenRepository,
  selectedDiffPath,
  selectedDiffKind,
  selectedCommitSha,
  textHarness,
  recents = EMPTY_RECENTS,
  busyProjectPaths,
  liveAgents = EMPTY_AGENTS,
  onSelectAgent,
  recentSessions,
  onSelectProject,
  onOpenProject,
  onOpenSyncedProject,
  onRemoveProject,
  onRenameProjectFolder,
  onNew,
  onSearch,
  onOpenInbox,
  onOpenInboxItem,
  onOpenNotes,
  onOpenAutomations,
  onOpenTasks,
  onGoToFile,
  searchActive = false,
  inboxActive = false,
  notesActive = false,
  automationsActive = false,
  tasksActive = false,
  socialActive = false,
  notesEnabled = true,
  onToggleProjectRail,
  projectRailOpen = true,
  compactProjectRail = true,
  titleBarAbove = false,
  unseenFinishedIds: unseenFinishedIdsProp,
  inboxUnseen = false,
  linkedSessionUpdateIds = EMPTY_IDS,
  settingsOpen = false,
  settingsSection = "general",
  onOpenSettings,
  onOpenNotificationSettings,
  onSelectSettingsSection,
  onCloseSettings,
  updateNotice = null,
  onOpenWhatsNew,
  onDismissUpdate,
}: Props) {
  "use memo";
  useLocale();
  const remoteProject = isRemoteProjectPath(cwd);
  const tab: SidebarTabId = requestedTab;
  const remote = useRemoteProjectSessions(cwd, remoteProject);
  const closeFilesSearch = useCallback(
    () => onFilesSearchOpenChange(false),
    [onFilesSearchOpenChange],
  );
  const remoteConnection = useRemoteConnection(remoteProject ? cwd : undefined);
  const remoteConnectionIssue =
    (remoteConnection.status !== "connected" &&
      (remoteConnection.status !== "connecting" || remoteConnection.reconnecting)) ||
    (!!remote.dataState.error && isConnectionFailure(classifyRemoteError(remote.dataState.error)));
  const hostProject = remoteProject ? remoteProjectFor(cwd) : undefined;
  const remoteChange = async (
    sessionId: string,
    patch: {
      title?: string;
      archived?: boolean;
      pinned?: boolean;
      linkedWorkItem?: LinkedWorkItem | null;
    },
  ) => {
    if (!remote.machine || !hostProject) {
      window.alert("Connect this project's machine to change its sessions.");
      return;
    }
    try {
      await sessionAccessForMachine(remote.machine.id, false, true).update(sessionId, {
        projectId: hostProject.projectId,
        ...patch,
      });
      refreshRemoteProjectSessions();
    } catch (error) {
      window.alert(`Could not update this session.\n\n${String(error)}`);
    }
  };
  const remoteDelete = async (sessionIds: readonly string[]) => {
    if (sessionIds.length === 0) return;
    if (!remote.machine || !hostProject) {
      window.alert("Connect this project's machine to delete its sessions.");
      return;
    }
    if (
      !(await confirmSessionDelete(
        `Delete ${sessionIds.length === 1 ? "this conversation" : `${sessionIds.length} conversations`}? This can’t be undone.`,
      ))
    )
      return;
    try {
      for (const sessionId of sessionIds) {
        await sessionAccessForMachine(remote.machine.id, false, true).delete(
          sessionId,
          hostProject.projectId,
        );
        forgetRemoteQueue(sessionId);
        onRemoteSessionDeleted?.(sessionId);
      }
      refreshRemoteProjectSessions();
    } catch (error) {
      window.alert(`Could not delete this session.\n\n${String(error)}`);
      refreshRemoteProjectSessions();
    }
  };
  const onSelectSession = remoteProject
    ? (sessionId: string) => onSelectRemoteSession?.(cwd, sessionId)
    : onSelectLocalSession;
  const onPrefetchSession = remoteProject ? undefined : onPrefetchLocalSession;
  const onPlaceSessionOnPane = remoteProject ? undefined : onPlaceLocalSessionOnPane;
  const onPopOutSession = remoteProject ? undefined : onPopOutLocalSession;
  const onOpenSessionsSideBySide = remoteProject ? undefined : onOpenLocalSessionsSideBySide;
  const onRenameSession = remoteProject
    ? (sessionId: string, title: string) => {
        void remoteChange(sessionId, { title });
      }
    : onRenameLocalSession;
  const onArchiveSession = remoteProject
    ? (sessionId: string, archived: boolean) => {
        void remoteChange(sessionId, { archived });
      }
    : onArchiveLocalSession;
  const onArchiveSessions = remoteProject
    ? (sessionIds: readonly string[], archived: boolean) => {
        void Promise.all(sessionIds.map((id) => remoteChange(id, { archived })));
      }
    : onArchiveLocalSessions;
  const onPinSession = remoteProject
    ? (sessionId: string, pinned: boolean) => {
        void remoteChange(sessionId, { pinned });
      }
    : onPinLocalSession;
  const onPinSessions = remoteProject
    ? (sessionIds: readonly string[], pinned: boolean) => {
        void Promise.all(sessionIds.map((id) => remoteChange(id, { pinned })));
      }
    : onPinLocalSessions;
  const onDeleteSession = remoteProject
    ? (sessionId: string) => {
        void remoteDelete([sessionId]);
      }
    : onDeleteLocalSession;
  const onDeleteSessions = remoteProject
    ? (sessionIds: readonly string[]) => {
        void remoteDelete(sessionIds);
      }
    : onDeleteLocalSessions;
  const onSetSessionLinkedWorkItem = remoteProject
    ? (sessionId: string, item: LinkedWorkItem | undefined) => {
        void remoteChange(sessionId, { linkedWorkItem: item ?? null });
      }
    : onSetLocalSessionLinkedWorkItem;
  const activeRemoteId = activeSessionId ? remoteSessionFor(activeSessionId) : undefined;
  const activeListedSessionId = remoteProject ? activeRemoteId : activeSessionId;
  const listedBusySessionIds = remoteProject
    ? new Set(
        remote.sessions
          .filter((session) => session.status === "running" && !session.needsInput)
          .map((session) => session.id),
      )
    : busySessionIds;
  const listedApprovalSessionIds = remoteProject
    ? new Set(remote.sessions.filter((session) => session.needsInput).map((session) => session.id))
    : approvalSessionIds;
  const projectSessions: SessionSummary[] = useMemo(
    () =>
      remoteProject
        ? remote.sessions.map((session) => ({
            id: session.id,
            cwd,
            harness: session.harness,
            model: session.model ?? "",
            runtimeMode: session.runtimeMode ?? "supervised",
            providerSessionId: session.providerSessionId ?? undefined,
            title: session.title,
            createdAt: session.createdAt ?? session.updatedAt,
            updatedAt: session.updatedAt,
            archived: session.archived,
            issue: session.issue,
            pinned: session.pinned,
            linkedWorkItem: session.linkedWorkItem,
            draft: session.draft,
            repo: session.repo,
            branch: session.branch,
            worktreeCwd: session.worktreeCwd,
          }))
        : sessions,
    [remoteProject, remote.sessions, sessions, cwd],
  );
  // Count the whole workspace before search, pagination or worktree filters.
  // Local busy IDs also include sessions continued on this desktop's host.
  const workingSessionCount = new Set(
    [...projectSessions, ...(remoteProject ? [] : openSessions)]
      .filter(
        (session) =>
          sameProjectPath(session.cwd, cwd) &&
          !session.orchestrationLeadId &&
          listedBusySessionIds.has(session.id) &&
          !listedApprovalSessionIds.has(session.id),
      )
      .map((session) => session.id),
  ).size;
  const workingSessionsBadge =
    workingSessionCount > 0 ? (
      <span
        data-workspace-working-count
        aria-live="polite"
        aria-label={t(
          workingSessionCount === 1 ? "{p0} working session" : "{p0} working sessions",
          { p0: workingSessionCount },
        )}
        title={t(workingSessionCount === 1 ? "{p0} working session" : "{p0} working sessions", {
          p0: workingSessionCount,
        })}
        className="ml-2 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold tabular-nums leading-none text-accent"
      >
        {workingSessionCount}
      </span>
    ) : null;
  const remoteExecutionCwd =
    remote.sessions.find((session) => session.id === activeRemoteId)?.cwd ??
    (activeSessionId ? remotePendingWorktree(activeSessionId) : undefined) ??
    (remoteProject && gitCwd && gitCwd !== cwd
      ? (parseRemotePath(gitCwd)?.hostPath ?? gitCwd)
      : undefined) ??
    undefined;
  const executionGitRoot =
    remoteProject && hostProject
      ? remotePath(hostProject.environmentId, remoteExecutionCwd ?? hostProject.cwd)
      : gitCwd || cwd;
  const groupLockView = useGroupLock();
  const { groups: workspaceGroups, lock: workspaceLock } = groupLockView;
  const workspacePaths = useMemo(
    () =>
      workspaceRepositoryPaths(
        cwd,
        workspaceGroups,
        loadProjectGroupAssignments(workspaceGroups),
        recents.map((project) => project.path),
        workspaceLock,
      ),
    [cwd, workspaceGroups, workspaceLock, recents, groupLockView],
  );
  const gitRoot = workspaceSourceControlRoot(cwd, executionGitRoot, workspacePaths);
  const repositoryPaths = sameProjectPath(gitRoot, cwd) ? workspacePaths : undefined;
  const resize = useDragResize({
    min: MIN_WIDTH,
    max: () => sidePaneMaxWidth("workspace", MAX_WIDTH, 0.5, MIN_WIDTH),
    defaultWidth: DEFAULT_WIDTH,
    initial: loadSessionSidebarWidth(),
    onCommit: saveSessionSidebarWidth,
  });
  const [tabOrder, setTabOrder] = useState<SidebarTab[]>(loadSidebarTabOrder);

  const sessionsLock = useLockOverscroll<HTMLDivElement>();
  const sessionsScrollRef = useRef<HTMLDivElement>(null);
  const [sessionMenu, setSessionMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);
  const [linkingSession, setLinkingSession] = useState<SessionSummary | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set());
  const contextSelectionRef = useRef(false);
  const selectionAnchorRef = useRef<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const longPressSelectionRef = useRef(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const dismissBulkNotice = useCallback(() => setBulkNotice(null), []);
  const bulkDeleteActive = useRef(false);
  const [deleteProgress, setDeleteProgress] = useState<{
    cwd: string;
    completed: number;
    total: number;
  } | null>(null);
  const [deleteNoticeError, setDeleteNoticeError] = useState(false);
  const [deleteNoticeCwd, setDeleteNoticeCwd] = useState(cwd);
  const deleting = deleteProgress !== null;
  const [folderMenu, setFolderMenu] = useState<{
    x: number;
    y: number;
    folderId: string;
  } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [sessionOrder, setSessionOrder] = useState<SessionOrder>(() => loadSessionOrder(cwd));
  const [listNotice, setListNotice] = useState<{ message: string; undo: () => void } | null>(null);
  // Card positions just before a drop, so moved rows can glide to their place.
  const listMotionRef = useRef<Map<string, DOMRect> | null>(null);
  const [sessionFolders, setSessionFolders] = useState<SessionFolder[]>(() =>
    loadSessionFolders(cwd),
  );
  const [pinnedSessionsCollapsed, setPinnedSessionsCollapsed] = useState(() =>
    loadPinnedSessionsCollapsed(cwd),
  );
  const [reminderSessionsCollapsed, setReminderSessionsCollapsed] = useState(() =>
    loadReminderSessionsCollapsed(cwd),
  );
  const [sessionDrop, setSessionDrop] = useState<SessionListDropTarget | null>(null);
  const [sessionFilters, setSessionFilters] = useState(loadSessionSidebarFilters);
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sessionListLimit, setSessionListLimit] = useState(LIST_PAGE_SIZE);
  const loadMoreRef = useRef<HTMLLIElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingFolderSessionIds = useRef(new Set<string>());
  const busyIdsRef = useRef(busySessionIds);
  const focusedSessionIdRef = useRef(activeSessionId);
  const unseenFinishedLocalRef = useRef<Set<string>>(new Set());
  if (busyIdsRef.current !== busySessionIds || focusedSessionIdRef.current !== activeSessionId) {
    unseenFinishedLocalRef.current = nextUnseenFinishedSessions({
      previousBusyIds: busyIdsRef.current,
      busyIds: busySessionIds,
      previousUnseenIds: unseenFinishedLocalRef.current,
      focusedSessionId: activeSessionId,
    });
    busyIdsRef.current = busySessionIds;
    focusedSessionIdRef.current = activeSessionId;
  }
  const unseenFinishedIds = unseenFinishedIdsProp ?? unseenFinishedLocalRef.current;
  // Revisits render straight from cache, so this is only ever true the first
  // time a project is opened.
  const pendingFirstLoad = remoteProject
    ? !remote.loaded &&
      !remote.failed &&
      projectSessions.length === 0 &&
      (!!remote.machine || !remote.machinesLoaded)
    : pending && sessions.length === 0;
  // A remote list comes over SSH and can take seconds: say so, unlike the
  // local one, which lands within a frame or two.
  const remoteLoading = remoteProject && pendingFirstLoad;
  const worktreeFocus = useWorktreeFocus(cwd);
  const focusedWorktree = remoteProject ? undefined : worktreeFocus;
  useEffect(() => {
    const warm = () => {
      void preloadSidebarSurfaces().catch(() => {});
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 2_000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 500);
    return () => clearTimeout(id);
  }, []);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const now = useMinuteNow(tab === "sessions" && sessionFilters.time !== "all");
  const { listedSessions, visibleSessions } = useMemo(() => {
    const listedSessions = mergeFolderSessionSummaries(
      projectSessions,
      remoteProject ? [] : openSessions,
      sessionFolders,
    ).filter(
      (session) => !session.orchestrationLeadId && inWorktreeFocus(session, focusedWorktree),
    );
    const visibleSessions = [
      ...filterSessionsByQuery(
        filterSessionsByStatus(
          filterSessionsByTime(
            filterSessionsByHarness(
              filterSessionsByArchive(listedSessions, sessionFilters.showArchived),
              sessionFilters.hiddenHarnesses,
            ),
            sessionFilters.time,
            now,
          ),
          sessionFilters.status,
          listedBusySessionIds,
          listedApprovalSessionIds,
          unseenFinishedIds,
        ),
        deferredSearchQuery,
      ),
    ].sort(compareSessionSummaries);
    return { listedSessions, visibleSessions };
  }, [
    projectSessions,
    remoteProject,
    openSessions,
    sessionFolders,
    focusedWorktree,
    sessionFilters,
    now,
    listedBusySessionIds,
    listedApprovalSessionIds,
    unseenFinishedIds,
    deferredSearchQuery,
  ]);
  const filtersActive = hasActiveSessionFilters(sessionFilters);
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  useEffect(() => {
    if (!openingSessionId) return;
    if (openingSessionId === activeListedSessionId) {
      setOpeningSessionId(null);
      return;
    }
    // A load that fails or is cancelled must not leave the card spinning.
    const timer = window.setTimeout(() => setOpeningSessionId(null), 20_000);
    return () => window.clearTimeout(timer);
  }, [activeListedSessionId, openingSessionId]);
  const searchNarrowed = Boolean(deferredSearchQuery.trim());
  // Summaries for the whole project stay in `sessions` so filters still work.
  // Folders sit above the ungrouped list. Only a page of ungrouped cards
  // mounts; the sentinel below asks for the next page.
  const {
    reminderIds,
    ungroupedVisible,
    shownUngroupedCount,
    sessionListEntries,
    sessionNavigationIds,
  } = useMemo(() => {
    const reminderIds = new Set(reminders.map((reminder) => reminder.sessionId));
    const reminderGroup = {
      sessionIds: [...reminders]
        .sort((a, b) => a.dueAt - b.dueAt)
        .map((reminder) => reminder.sessionId),
      collapsed: reminderSessionsCollapsed,
    };
    const ungroupedFiltered = ungroupedSessions(visibleSessions, sessionFolders).filter(
      (session) => !reminderIds.has(session.id),
    );
    const compareStatus = sessionStatusOrder(
      listedApprovalSessionIds,
      listedBusySessionIds,
      unseenFinishedIds,
    );
    // Status leads within each group; saved order breaks ties.
    const ungroupedVisible = [
      ...applySessionOrder(
        ungroupedFiltered.filter((session) => session.pinned),
        sessionOrder.pinned,
      ),
      ...applySessionOrder(
        ungroupedFiltered.filter((session) => !session.pinned),
        sessionOrder.loose,
      ),
    ].sort(compareStatus);
    const activeUngroupedIndex = ungroupedVisible.findIndex(
      (session) => session.id === activeListedSessionId,
    );
    const shownUngroupedCount = listWindowSize(
      ungroupedVisible.length,
      sessionListLimit,
      activeUngroupedIndex,
    );
    const shownUngrouped = ungroupedVisible.slice(0, shownUngroupedCount);
    const sessionListEntries = buildSessionList(
      visibleSessions,
      sessionFolders,
      shownUngrouped,
      pinnedSessionsCollapsed,
      reminderGroup,
      compareStatus,
    );
    const sessionNavigationIds = sessionListNavigationIds(sessionListEntries, searchNarrowed);
    return {
      reminderIds,
      reminderGroup,
      ungroupedVisible,
      shownUngroupedCount,
      sessionListEntries,
      sessionNavigationIds,
      compareStatus,
    };
  }, [
    reminders,
    reminderSessionsCollapsed,
    visibleSessions,
    sessionFolders,
    listedApprovalSessionIds,
    listedBusySessionIds,
    unseenFinishedIds,
    sessionOrder,
    activeListedSessionId,
    sessionListLimit,
    pinnedSessionsCollapsed,
    searchNarrowed,
  ]);
  const sessionNavigationKey = sessionNavigationIds.join("\0");
  const listDisplay = useSessionListDisplay();
  useEffect(() => {
    onSessionNavigationOrder?.(sessionNavigationIds);
  }, [onSessionNavigationOrder, sessionNavigationKey]);
  useEffect(() => {
    if (tab !== "sessions") {
      selectionAnchorRef.current = null;
      setSelectedSessionIds(new Set());
      setSelectionMode(false);
      return;
    }
    const available = new Set(sessionNavigationIds);
    if (selectionAnchorRef.current && !available.has(selectionAnchorRef.current)) {
      selectionAnchorRef.current = null;
    }
    setSelectedSessionIds((current) => pruneSessionSelection(current, available));
  }, [cwd, tab, sessionNavigationKey]);
  const hasMoreSessions = shownUngroupedCount < ungroupedVisible.length;
  const sessionListKey = `${cwd}\0${sessionFilters.showArchived}\0${sessionFilters.time}\0${sessionFilters.hiddenHarnesses.join(",")}\0${sessionFilters.status.working}\0${sessionFilters.status.needsApproval}\0${sessionFilters.status.done}\0${searchQuery}`;
  const sessionHarnesses = harnessesInSessions(projectSessions);
  const narrowedByUser = searchNarrowed || filtersActive;
  const visibleTabs = tabOrder.filter((itemId) => itemId !== "inbox");
  const sortable = useAnimatedReorder(visibleTabs, (ids) => {
    let index = 0;
    const next = tabOrder.map((itemId) => (itemId === "inbox" ? itemId : ids[index++]));
    setTabOrder(next);
    saveSidebarTabOrder(next);
  });
  const cancelFolderDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelFolderDrag.current?.(), []);
  const skipFolderClickUntil = useRef(0);
  const sessionFoldersRef = useRef(sessionFolders);
  sessionFoldersRef.current = sessionFolders;
  // The full rail gets every project (it keeps their order and pins and hides
  // locked groups itself); the pickers and menus get only what is unlocked.
  const visibleRecents = useVisibleProjects(recents, recentPath);
  const showProjectRail = Boolean(onSelectProject && onOpenProject);
  // Settings own the full window and provide their own workspace back button.
  const railVisible = showProjectRail && projectRailOpen && !settingsOpen;
  // Keep the full rail mounted after its first reveal so reopening does not
  // recreate every project row and restart their Git-stat subscriptions.
  const railMounted = useRef(railVisible);
  if (railVisible) railMounted.current = true;
  const compactRailVisible = compactProjectRail && showProjectRail && !railVisible && !settingsOpen;
  const inProject = looksLikeProject(cwd);
  const showSidebarFooter = !projectRailOpen;
  // A blank session has no project to browse, so the shell stands alone until
  // one is picked — whether or not the rail is open.
  const sidebarAvailable =
    !searchActive &&
    !inboxActive &&
    !notesActive &&
    !automationsActive &&
    !tasksActive &&
    !socialActive &&
    !settingsOpen &&
    inProject;
  const sidebarVisible = open && sidebarAvailable;
  // With the sidebar collapsed beside the compact rail, its tab shortcuts
  // open the sidebar temporarily until the user clicks away.
  const drawerMode = compactRailVisible && !open;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerVisible = drawerMode && drawerOpen && sidebarAvailable;
  // A dismissed drawer stays mounted while it slides shut. Anything that takes
  // its place (the pinned sidebar, another view) drops it at once.
  const [drawerMounted, setDrawerMounted] = useState(false);
  const drawerClosing = drawerMounted && !drawerVisible && drawerMode && sidebarAvailable;
  const drawerRendered = drawerVisible || drawerClosing;
  const drawerAnimation = useRef<Animation | null>(null);
  const panelOpen = open || drawerVisible;
  const gitStatuses = useGitFileStatuses(gitRoot, panelOpen && tab === "files");
  const changeStats = useProjectDiffStats(gitRoot, panelOpen);

  useEffect(() => {
    if (!drawerMode || !sidebarAvailable) setDrawerOpen(false);
  }, [drawerMode, sidebarAvailable]);

  useEffect(() => {
    if (drawerVisible) setDrawerMounted(true);
    else if (!drawerClosing) setDrawerMounted(false);
  }, [drawerVisible, drawerClosing]);

  // Grow the drawer's width so the workspace is pushed along with it. A
  // reversal mid-slide starts from wherever the width currently is.
  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    if (!drawerRendered || !drawer) {
      drawerAnimation.current = null;
      return;
    }
    const full =
      drawer.firstElementChild instanceof HTMLElement ? drawer.firstElementChild.offsetWidth : 0;
    const from = drawerAnimation.current
      ? drawer.getBoundingClientRect().width
      : drawerClosing
        ? full
        : 0;
    drawerAnimation.current?.cancel();
    drawerAnimation.current = null;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (typeof drawer.animate !== "function" || reduceMotion) {
      if (drawerClosing) setDrawerMounted(false);
      return;
    }
    const animation = drawer.animate(
      [{ width: `${from}px` }, { width: `${drawerClosing ? 0 : full}px` }],
      drawerClosing
        ? {
            duration: 160,
            easing: "cubic-bezier(0.4, 0, 1, 1)",
            fill: "forwards",
          }
        : { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    drawerAnimation.current = animation;
    animation.onfinish = () => {
      if (drawerAnimation.current !== animation) return;
      drawerAnimation.current = null;
      if (drawerClosing) setDrawerMounted(false);
    };
  }, [drawerRendered, drawerClosing]);

  useEffect(() => {
    if (!drawerVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setDrawerOpen(false);
    };
    // The rail's own shortcuts toggle the drawer, and menus opened from it
    // stay usable; anything else dismisses it.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const el = target instanceof Element ? target : null;
      if (drawerRef.current?.contains(el)) return;
      if (el?.closest("[data-compact-project-rail],[data-popover-side]")) {
        return;
      }
      setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [drawerVisible]);

  useEffect(() => {
    setSessionListLimit(LIST_PAGE_SIZE);
    const scroller = sessionsScrollRef.current;
    if (scroller) scroller.scrollTop = 0;
  }, [sessionListKey]);

  useEffect(() => {
    if (tab !== "sessions" || !hasMoreSessions) return;
    const sentinel = loadMoreRef.current;
    const root = sessionsScrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setSessionListLimit((current) => current + LIST_PAGE_SIZE);
      },
      { root, rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [tab, hasMoreSessions, shownUngroupedCount]);

  useEffect(() => {
    setSessionFolders(loadSessionFolders(cwd));
    setSessionOrder(loadSessionOrder(cwd));
    setListNotice(null);
    setPinnedSessionsCollapsed(loadPinnedSessionsCollapsed(cwd));
    setReminderSessionsCollapsed(loadReminderSessionsCollapsed(cwd));
    setRenamingFolderId(null);
    setFolderMenu(null);
    setSessionDrop(null);
    setSelectionMode(false);
    pendingFolderSessionIds.current.clear();
  }, [cwd]);

  useEffect(
    () =>
      subscribeSessionFolders(cwd, () => {
        setSessionFolders(loadSessionFolders(cwd));
      }),
    [cwd],
  );

  useEffect(() => {
    if (pending || status === "error") return;
    if (remoteProject && !remote.loaded) return;
    const known = new Set(projectSessions.map((session) => session.id));
    const completedFolderSessions = new Map<string, string>();
    for (const session of remoteProject ? [] : openSessions) known.add(session.id);
    if (activeListedSessionId) known.add(activeListedSessionId);
    if (remoteProject && activeSessionId) known.add(activeSessionId);
    if (remoteProject) {
      for (const folder of sessionFolders) {
        for (const shellId of folder.sessionIds) {
          const hostId = remoteSessionFor(shellId);
          if (hostId && known.has(hostId)) completedFolderSessions.set(shellId, hostId);
        }
      }
    }
    for (const id of pendingFolderSessionIds.current) {
      known.add(id);
      const hostId = remoteProject ? remoteSessionFor(id) : undefined;
      if (hostId && known.has(hostId)) {
        completedFolderSessions.set(id, hostId);
        pendingFolderSessionIds.current.delete(id);
        continue;
      }
      if (
        projectSessions.some((session) => session.id === id) ||
        openSessions.some((session) => session.id === id)
      ) {
        pendingFolderSessionIds.current.delete(id);
      }
    }
    setSessionFolders((current) => {
      const migrated = completedFolderSessions.size
        ? current.map((folder) => ({
            ...folder,
            sessionIds: folder.sessionIds.map((id) => completedFolderSessions.get(id) ?? id),
          }))
        : current;
      const next = pruneSessionFolders(migrated, known);
      if (next === current) return current;
      saveSessionFolders(cwd, next);
      return next;
    });
  }, [
    activeListedSessionId,
    activeSessionId,
    cwd,
    openSessions,
    pending,
    projectSessions,
    remoteProject,
    remote.loaded,
    sessionFolders,
    status,
  ]);

  useEffect(() => {
    if (tab !== "sessions") {
      setFilterMenu(null);
      setSearchQuery("");
    }
  }, [tab]);

  useEffect(() => {
    if (!sessionMenu && !folderMenu && !filterMenu) return;
    const onScroll = () => {
      closeSessionMenu();
      setFolderMenu(null);
      setFilterMenu(null);
    };
    const scrollParent = sessionsScrollRef.current ?? window;
    scrollParent.addEventListener("scroll", onScroll, true);
    return () => scrollParent.removeEventListener("scroll", onScroll, true);
  }, [sessionMenu, folderMenu, filterMenu]);

  const selectionKeys = useRef({
    selectAll: () => {},
    deleteSelected: () => {},
  });
  useEffect(() => {
    if (selectedSessionIds.size === 0 && !selectionMode) return;
    const clear = () => {
      selectionAnchorRef.current = null;
      contextSelectionRef.current = false;
      setSelectedSessionIds(new Set());
      setSelectionMode(false);
      longPressSelectionRef.current = false;
      setSessionMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clear();
        return;
      }
      if (event.defaultPrevented || contextSelectionRef.current) return;
      const target = event.target instanceof Element ? event.target : null;
      // Typing, dialogs and menus keep their own keys.
      if (target?.closest("input,textarea,select,[contenteditable],[role='dialog'],[role='menu']"))
        return;
      if (target && target !== document.body && !target.closest("[data-session-list-panel]"))
        return;
      const mod = event.ctrlKey || event.metaKey;
      if (selectionMode && mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectionKeys.current.selectAll();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && !mod && !event.altKey) {
        event.preventDefault();
        selectionKeys.current.deleteSelected();
      }
    };
    // A pointer landing off the cards drops the selection; a menu acting on
    // it stays open, and the cards handle their own clicks. Selection mode
    // also survives the rest of the session list, such as its search field.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const el = target instanceof Element ? target : null;
      if (el?.closest("[data-session-card],[data-popover-side],[data-session-selection-keep]"))
        return;
      if (selectionMode && el?.closest("[data-session-list-panel]")) return;
      clear();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [selectedSessionIds.size, selectionMode]);

  const commitSessionFolders = (next: SessionFolder[]) => {
    setSessionFolders(next);
    saveSessionFolders(cwd, next);
  };

  const onNewInFolder = (folderId: string) => {
    const sessionId = onNew?.();
    if (!sessionId) return;
    pendingFolderSessionIds.current.add(sessionId);
    setSearchQuery("");
    setSessionFolders((current) => {
      const next = setFolderCollapsed(
        addSessionToFolder(current, folderId, sessionId),
        folderId,
        false,
      );
      saveSessionFolders(cwd, next);
      return next;
    });
  };

  const menuSessionIds = sessionMenu
    ? orderedSessionActionIds(sessionMenu.sessionId, selectedSessionIds, sessionNavigationIds)
    : [];
  const menuSessions = menuSessionIds.flatMap((sessionId) => {
    const session = listedSessions.find((entry) => entry.id === sessionId);
    return session ? [session] : [];
  });
  const multipleMenuSessions = menuSessionIds.length > 1;
  const menuReminderTimes = [
    ...new Set(
      reminders
        .filter((reminder) => menuSessionIds.includes(reminder.sessionId))
        .map((reminder) => reminder.dueAt),
    ),
  ];
  const allMenuSessionsPinned =
    menuSessions.length > 0 && menuSessions.every((session) => session.pinned);
  const allMenuSessionsArchived =
    menuSessions.length > 0 && menuSessions.every((session) => session.archived);
  const menuSessionFolder =
    menuSessionIds.length === 1 ? folderContaining(sessionFolders, menuSessionIds[0]) : undefined;
  const anyMenuSessionFoldered = menuSessionIds.some((sessionId) =>
    sessionFolders.some((folder) => folder.sessionIds.includes(sessionId)),
  );
  const canRemoveMenuSessionsFromFolders = multipleMenuSessions
    ? anyMenuSessionFoldered
    : !!menuSessionFolder;
  const menuFolder = folderMenu
    ? sessionFolders.find((folder) => folder.id === folderMenu.folderId)
    : undefined;
  const folderMenuItems: ExplorerMenuItem[] = !folderMenu
    ? EMPTY_MENU_ITEMS
    : [
        {
          kind: "item",
          id: "rename",
          get label() {
            return t("Rename");
          },
          shortcut: "F2",
        },
        ...(menuFolder?.parentId
          ? [
              {
                kind: "item" as const,
                id: "move-out",
                get label() {
                  return t("Move out of folder");
                },
              },
            ]
          : menuFolder
            ? [
                {
                  kind: "item" as const,
                  id: "pin-folder",
                  get label() {
                    return menuFolder.pinned ? t("Unpin") : t("Pin");
                  },
                },
              ]
            : []),
        { kind: "sep" },
        {
          kind: "item",
          id: "ungroup",
          get label() {
            return t("Ungroup");
          },
        },
      ];
  const sessionMenuItems: ExplorerMenuItem[] = !sessionMenu
    ? EMPTY_MENU_ITEMS
    : [
        ...(onCancelReminders && menuReminderTimes.length > 0
          ? [
              {
                kind: "item" as const,
                id: "reminder:cancel",
                get label() {
                  return t("Cancel reminder");
                },
                description:
                  menuReminderTimes.length === 1
                    ? formatReminderTime(menuReminderTimes[0])
                    : "Multiple reminder times",
              },
              { kind: "sep" as const },
            ]
          : []),
        ...(onPinSession || onPinSessions
          ? [
              {
                kind: "item" as const,
                id: "pin",
                label: allMenuSessionsPinned ? "Unpin" : "Pin",
              },
            ]
          : []),
        ...(multipleMenuSessions && onOpenSessionsSideBySide
          ? [
              {
                kind: "item" as const,
                id: "side-by-side",
                get label() {
                  return t("Open Side by Side");
                },
              },
            ]
          : []),
        ...(!multipleMenuSessions && onRenameSession
          ? [
              {
                kind: "item" as const,
                id: "rename",
                get label() {
                  return t("Rename");
                },
                shortcut: "F2",
              },
            ]
          : []),
        ...(!multipleMenuSessions
          ? [
              {
                kind: "item" as const,
                id: "copy-session-id",
                get label() {
                  return t("Copy session ID");
                },
                submenu: [
                  {
                    kind: "item" as const,
                    id: "copy-harness-session-id",
                    get label() {
                      return t("Harness session ID");
                    },
                    disabled: !menuSessions[0]?.providerSessionId,
                  },
                  {
                    kind: "item" as const,
                    id: "copy-bycoda-session-id",
                    get label() {
                      return t("{p0} session ID", { p0: PRODUCT_IDENTITY.displayName });
                    },
                  },
                ],
              },
            ]
          : []),
        ...(!multipleMenuSessions && onSetSessionLinkedWorkItem
          ? [
              {
                kind: "item" as const,
                id: "link-work-item",
                label: menuSessions[0]?.linkedWorkItem
                  ? "Edit GitHub issue or PR link…"
                  : "Link GitHub issue or PR…",
              },
            ]
          : []),
        {
          kind: "item",
          id: "reminder",
          get label() {
            return t("Remind me");
          },
          disabled: !onSetReminders,
          submenu: sessionReminderPresets(),
        },
        ...(!multipleMenuSessions && !selectionMode
          ? [
              {
                kind: "item" as const,
                id: "select",
                get label() {
                  return t("Select");
                },
              },
            ]
          : []),
        { kind: "sep" as const },
        {
          kind: "item" as const,
          id: "folder-new",
          get label() {
            return t("New folder");
          },
        },
        ...(sessionFolders.length > 0 ? [{ kind: "sep" as const }] : []),
        ...sessionFolders.map((folder) => ({
          kind: "item" as const,
          id: `folder-add:${folder.id}`,
          get label() {
            return t("Add to {p0}", { p0: folder.name });
          },
          checked:
            menuSessionIds.length > 0 &&
            menuSessionIds.every((sessionId) => folder.sessionIds.includes(sessionId)),
        })),
        ...(canRemoveMenuSessionsFromFolders
          ? [
              {
                kind: "item" as const,
                id: "folder-remove",
                label: multipleMenuSessions ? "Remove from folders" : "Remove from folder",
              },
            ]
          : []),
        ...(onArchiveSession || onArchiveSessions || onDeleteSession || onDeleteSessions
          ? [
              { kind: "sep" as const },
              ...(onArchiveSession || onArchiveSessions
                ? [
                    {
                      kind: "item" as const,
                      id: "archive",
                      label: allMenuSessionsArchived ? "Unarchive" : "Archive",
                    },
                  ]
                : []),
              ...(onDeleteSession || onDeleteSessions
                ? [
                    {
                      kind: "item" as const,
                      id: "delete",
                      get label() {
                        return t("Delete");
                      },
                      shortcut: "⌫",
                      danger: true,
                    },
                  ]
                : []),
            ]
          : []),
      ];

  const onSessionContextMenu = (sessionId: string, e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    contextSelectionRef.current = !selectedSessionIds.has(sessionId);
    if (contextSelectionRef.current) {
      setSelectedSessionIds(new Set([sessionId]));
    }
    setFilterMenu(null);
    setFolderMenu(null);
    setSessionMenu({ x: e.clientX, y: e.clientY, sessionId });
  };

  function closeSessionMenu() {
    setSessionMenu(null);
    if (!contextSelectionRef.current) return;
    contextSelectionRef.current = false;
    selectionAnchorRef.current = null;
    setSelectedSessionIds(new Set());
  }

  const onFolderContextMenu = (folderId: string, e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setFilterMenu(null);
    setSessionMenu(null);
    setFolderMenu({ x: e.clientX, y: e.clientY, folderId });
  };

  const onSessionMenuPick = (id: string) => {
    if (!sessionMenu) return;
    const sessionId = sessionMenu.sessionId;
    const sessionIds = menuSessionIds;
    const providerSessionId = menuSessions[0]?.providerSessionId;
    const archived = allMenuSessionsArchived;
    const pinned = allMenuSessionsPinned;
    closeSessionMenu();
    if (id === "select") {
      selectionAnchorRef.current = sessionId;
      setSelectionMode(true);
      setSelectedSessionIds(new Set([sessionId]));
      return;
    }
    if (id === "reminder:cancel") {
      onCancelReminders?.(sessionIds);
      return;
    }
    if (id.startsWith("reminder:")) {
      const dueAt = reminderTime(id);
      if (dueAt != null) {
        setReminderSessionsCollapsed(false);
        saveReminderSessionsCollapsed(cwd, false);
        onSetReminders?.(sessionIds, dueAt);
      }
      return;
    }
    if (id === "pin") {
      pinSessions(sessionIds, !pinned);
      return;
    }
    if (id === "side-by-side") {
      onOpenSessionsSideBySide?.(sessionIds);
      return;
    }
    if (id === "rename") {
      setRenamingSessionId(sessionId);
      return;
    }
    if (id === "copy-harness-session-id" || id === "copy-bycoda-session-id") {
      const value = id === "copy-harness-session-id" ? providerSessionId : sessionId;
      if (value) {
        void copyText(value).catch((error) => {
          console.error("Failed to copy session ID:", error);
        });
      }
      return;
    }
    if (id === "link-work-item") {
      setLinkingSession(menuSessions[0] ?? null);
      return;
    }
    if (id === "folder-new") {
      const { folders, id: createdId } = createFolderWithSessions(sessionFolders, sessionIds);
      if (!createdId) return;
      commitSessionFolders(folders);
      setRenamingFolderId(createdId);
      return;
    }
    if (id.startsWith("folder-add:")) {
      const folderId = id.slice("folder-add:".length);
      const folders = sessionIds.reduce(
        (current, id) => addSessionToFolder(current, folderId, id),
        sessionFolders,
      );
      commitSessionFolders(setFolderCollapsed(folders, folderId, false));
      return;
    }
    if (id === "folder-remove") {
      commitSessionFolders(
        sessionIds.reduce((current, id) => removeSessionFromFolder(current, id), sessionFolders),
      );
      return;
    }
    if (id === "archive") {
      archiveSessions(sessionIds, !archived);
      return;
    }
    if (id === "delete") {
      if (!remoteProject && !onDeleteLocalSessionNow && sessionIds.length === 1) {
        onDeleteSession?.(sessionIds[0]);
        return;
      }
      void bulkDeleteSessions(sessionIds);
    }
  };

  const archiveSessions = (sessionIds: readonly string[], archived: boolean) => {
    if (sessionIds.length > 1 && onArchiveSessions) {
      onArchiveSessions(sessionIds, archived);
    } else {
      for (const id of sessionIds) onArchiveSession?.(id, archived);
    }
  };

  const pinSessions = (sessionIds: readonly string[], pinned: boolean) => {
    if (sessionIds.length > 1 && onPinSessions) {
      onPinSessions(sessionIds, pinned);
    } else {
      for (const id of sessionIds) onPinSession?.(id, pinned);
    }
  };

  // Read at delete time, so a conversation that starts running while the
  // confirmation is open is still left alone.
  const runningSessionIdsRef = useRef<ReadonlySet<string>>(new Set());
  runningSessionIdsRef.current = new Set([...listedBusySessionIds, ...listedApprovalSessionIds]);

  const bulkDeleteSessions = async (sessionIds: readonly string[]) => {
    if (bulkDeleteActive.current || sessionIds.length === 0) return;
    const machine = remote.machine;
    if (remoteProject && (!machine || !hostProject)) {
      window.alert("Connect this project's machine to delete its sessions.");
      return;
    }
    const deleteOne =
      remoteProject && machine && hostProject
        ? async (sessionId: string) => {
            await sessionAccessForMachine(machine.id, false, true).delete(
              sessionId,
              hostProject.projectId,
            );
            forgetRemoteQueue(sessionId);
            onRemoteSessionDeleted?.(sessionId);
          }
        : onDeleteLocalSessionNow
          ? (sessionId: string) =>
              sessionIds.length === 1
                ? onDeleteLocalSessionNow(sessionId, false)
                : onDeleteLocalSessionNow(sessionId)
          : undefined;
    if (!deleteOne) {
      // Without the reporting delete, only a handler that asks first may run.
      onDeleteSessions?.(sessionIds);
      return;
    }
    const { deletable, running } = splitRunningSessions(sessionIds, runningSessionIdsRef.current);
    if (deletable.length === 0) {
      setDeleteNoticeCwd(cwd);
      setDeleteNoticeError(false);
      setBulkNotice(bulkDeleteSummary({ skipped: running, failed: [] }));
      return;
    }
    bulkDeleteActive.current = true;
    try {
      if (!(await confirmSessionDelete(bulkDeleteConfirmMessage(deletable.length, running.length))))
        return;
      setBulkNotice(null);
      setDeleteNoticeCwd(cwd);
      setDeleteProgress({ cwd, completed: 0, total: deletable.length });
      const result = await deleteSessionsInBulk(deletable, {
        isRunning: (id) => runningSessionIdsRef.current.has(id),
        deleteOne,
        onProgress: (completed, total) => setDeleteProgress({ cwd, completed, total }),
      });
      setDeleteNoticeError(result.failed.length > 0);
      setBulkNotice(
        bulkDeleteOutcome({
          ...result,
          skipped: [...running, ...result.skipped],
        }),
      );
      const deleted = new Set(result.deleted);
      setSelectedSessionIds((current) => new Set([...current].filter((id) => !deleted.has(id))));
    } catch (error) {
      setDeleteNoticeCwd(cwd);
      setDeleteNoticeError(true);
      setBulkNotice(
        `Could not delete conversations: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      bulkDeleteActive.current = false;
      setDeleteProgress(null);
      if (remoteProject) refreshRemoteProjectSessions();
    }
  };

  // The bar acts on the selection in list order, like the context menu.
  const selectedOrderedIds = sessionNavigationIds.filter((id) => selectedSessionIds.has(id));
  const selectedSessions = listedSessions.filter((session) => selectedSessionIds.has(session.id));
  const allSelectedArchived =
    selectedSessions.length > 0 && selectedSessions.every((session) => session.archived);
  const allSelectedPinned =
    selectedSessions.length > 0 && selectedSessions.every((session) => session.pinned);
  const selectAllListedSessions = () => {
    contextSelectionRef.current = false;
    setSelectedSessionIds((current) => selectAllSessions(current, sessionNavigationIds));
  };
  const clearSessionSelection = () => {
    selectionAnchorRef.current = null;
    contextSelectionRef.current = false;
    setSelectedSessionIds(new Set());
    setSelectionMode(false);
  };
  selectionKeys.current = {
    selectAll: selectAllListedSessions,
    deleteSelected: () => {
      if (onDeleteSession || onDeleteSessions) {
        void bulkDeleteSessions(selectedOrderedIds);
      }
    },
  };
  const showBulkBar =
    selectionMode || (selectedSessionIds.size > 0 && !contextSelectionRef.current);

  const onFolderMenuPick = (id: string) => {
    if (!folderMenu) return;
    const folderId = folderMenu.folderId;
    setFolderMenu(null);
    if (id === "rename") {
      setRenamingFolderId(folderId);
      return;
    }
    if (id === "move-out") {
      commitSessionFolders(moveFolderOut(sessionFolders, folderId));
      return;
    }
    if (id === "pin-folder") {
      const folder = sessionFolders.find((entry) => entry.id === folderId);
      if (folder) commitSessionFolders(setFolderPinned(sessionFolders, folderId, !folder.pinned));
      return;
    }
    if (id === "ungroup") {
      commitSessionFolders(dissolveFolder(sessionFolders, folderId));
    }
  };

  const onFolderColorChange = (colorIndex: number | null) => {
    if (!folderMenu) return;
    commitSessionFolders(setFolderColor(sessionFolders, folderMenu.folderId, colorIndex));
  };

  const onFolderCustomColorChange = (color: string) => {
    if (!folderMenu) return;
    commitSessionFolders(setFolderCustomColor(sessionFolders, folderMenu.folderId, color));
  };

  const summaryById = useMemo(
    () => new Map(listedSessions.map((session) => [session.id, session])),
    [listedSessions],
  );
  const byRecency = (a: string, b: string) => {
    const left = summaryById.get(a);
    const right = summaryById.get(b);
    if (left && right) return compareSessionSummaries(left, right);
    return left ? -1 : right ? 1 : 0;
  };
  // A folder's rows as shown: by hand once arranged, by recency until then.
  const folderMemberIds = (folder: SessionFolder) =>
    folder.ordered ? folder.sessionIds : [...folder.sessionIds].sort(byRecency);
  // The whole list, including rows a filter or search hides right now.
  const orderListIds = (list: SessionOrderList) =>
    applySessionOrder(
      ungroupedSessions([...listedSessions].sort(compareSessionSummaries), sessionFolders).filter(
        (session) => !reminderIds.has(session.id) && !!session.pinned === (list === "pinned"),
      ),
      sessionOrder[list],
    ).map((session) => session.id);

  const captureListMotion = () => {
    const root = sessionsScrollRef.current;
    if (!root || !decorativeMotionEnabled()) return;
    const rects = new Map<string, DOMRect>();
    for (const card of root.querySelectorAll<HTMLElement>("[data-session-card]")) {
      rects.set(card.dataset.sessionCard!, card.getBoundingClientRect());
    }
    listMotionRef.current = rects;
  };
  useLayoutEffect(() => {
    const before = listMotionRef.current;
    const root = sessionsScrollRef.current;
    if (!before || !root) return;
    listMotionRef.current = null;
    for (const card of root.querySelectorAll<HTMLElement>("[data-session-card]")) {
      const from = before.get(card.dataset.sessionCard!);
      if (!from || typeof card.animate !== "function") continue;
      const dy = from.top - card.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      card.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
        duration: 220,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
    }
  });

  const onSessionListDrop = (draggedId: string, target: SessionListDropTarget) => {
    // A selected card carries the whole selection along.
    const dragged =
      selectedSessionIds.has(draggedId) && !contextSelectionRef.current
        ? selectedOrderedIds
        : [draggedId];
    if ((target.kind === "insert" || target.kind === "session") && dragged.includes(target.id)) {
      return;
    }
    const before = { folders: sessionFolders, order: sessionOrder };
    let folders = sessionFolders;
    let order = sessionOrder;
    let pinTo: boolean | null = null;
    let destFolderId: string | undefined;
    let message = "";
    let createdId = "";
    if (target.kind === "session") {
      const host = folderContaining(sessionFolders, target.id);
      if (host && folderDepth(sessionFolders, host.id) >= MAX_FOLDER_DEPTH) {
        destFolderId = host.id;
        folders = arrangeFolderSessions(
          folders,
          host.id,
          moveIdsInOrder(folderMemberIds(host), dragged, target.id, "after"),
        );
      } else {
        const created = createFolderWithSessions(folders, [target.id, ...dragged], undefined, {
          parentId: host?.id,
          pinned: !host && !!summaryById.get(target.id)?.pinned,
        });
        folders = created.folders;
        createdId = created.id;
        message = t("Group created");
      }
    } else if (target.kind === "folder") {
      const host = sessionFolders.find((folder) => folder.id === target.id);
      if (!host) return;
      destFolderId = host.id;
      folders = arrangeFolderSessions(folders, host.id, [
        ...folderMemberIds(host).filter((id) => !dragged.includes(id)),
        ...dragged,
      ]);
      if (!host.ordered) {
        folders = folders.map((folder) =>
          folder.id === host.id ? { ...folder, ordered: undefined } : folder,
        );
      }
    } else if (target.kind === "pinned") {
      folders = removeSessionsFromFolders(folders, dragged);
      pinTo = true;
    } else {
      const host = folderContaining(sessionFolders, target.id);
      if (host) {
        destFolderId = host.id;
        folders = arrangeFolderSessions(
          folders,
          host.id,
          moveIdsInOrder(folderMemberIds(host), dragged, target.id, target.place),
        );
      } else {
        const list: SessionOrderList = summaryById.get(target.id)?.pinned ? "pinned" : "loose";
        folders = removeSessionsFromFolders(folders, dragged);
        order = {
          ...order,
          [list]: moveIdsInOrder(orderListIds(list), dragged, target.id, target.place),
        };
        pinTo = list === "pinned";
      }
    }
    const pinChanges =
      pinTo === null ? [] : dragged.filter((id) => !!summaryById.get(id)?.pinned !== pinTo);
    if (folders === sessionFolders && order === sessionOrder && pinChanges.length === 0) return;
    const leftFolder = dragged.some(
      (id) => folderContaining(sessionFolders, id)?.id !== destFolderId,
    );
    if (!message && destFolderId && leftFolder) {
      const name = sessionFolders.find((folder) => folder.id === destFolderId)?.name ?? "";
      message = t("Moved to {p0}", { p0: name });
    } else if (!message && pinChanges.length > 0) {
      message = pinTo ? t("Pinned") : t("Unpinned");
    } else if (!message && leftFolder) {
      message = t("Removed from folder");
    }
    captureListMotion();
    if (folders !== sessionFolders) commitSessionFolders(folders);
    if (order !== sessionOrder) {
      setSessionOrder(order);
      saveSessionOrder(cwd, order);
    }
    if (pinChanges.length > 0) pinSessions(pinChanges, pinTo!);
    if (createdId) setRenamingFolderId(createdId);
    setListNotice(
      message
        ? {
            message,
            undo: () => {
              captureListMotion();
              commitSessionFolders(before.folders);
              setSessionOrder(before.order);
              saveSessionOrder(cwd, before.order);
              if (pinChanges.length > 0) pinSessions(pinChanges, !pinTo);
            },
          }
        : null,
    );
  };

  const isSessionDrop = (kind: "folder" | "session", id: string) =>
    (sessionDrop?.kind === "folder" || sessionDrop?.kind === "session") &&
    sessionDrop.kind === kind &&
    sessionDrop.id === id;

  const onSessionCardSelect = (
    sessionId: string,
    event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  ) => {
    contextSelectionRef.current = false;
    setSessionMenu(null);
    if (event.shiftKey) {
      const visibleIds = sessionListNavigationIds(sessionListEntries, searchNarrowed);
      if (selectionAnchorRef.current && !visibleIds.includes(selectionAnchorRef.current)) {
        selectionAnchorRef.current = null;
      }
      const anchor = selectionAnchorRef.current ?? activeListedSessionId ?? sessionId;
      const range = sessionSelectionRange(visibleIds, anchor, sessionId);
      selectionAnchorRef.current = visibleIds.includes(anchor) ? anchor : sessionId;
      setSelectedSessionIds(
        (current) =>
          new Set(event.ctrlKey || event.metaKey || selectionMode ? [...current, ...range] : range),
      );
      return;
    }
    selectionAnchorRef.current = sessionId;
    if (event.ctrlKey || event.metaKey || selectionMode) {
      const next = toggleSessionSelection(selectedSessionIds, sessionId);
      if (next.size === 0) {
        selectionAnchorRef.current = null;
        if (longPressSelectionRef.current) {
          longPressSelectionRef.current = false;
          setSelectionMode(false);
        }
      }
      setSelectedSessionIds(next);
      return;
    }
    setSelectedSessionIds(new Set());
    setDrawerOpen(false);
    // Opening reads the conversation first (from disk, or over SSH for a
    // remote one); the card says so until it is the open session.
    if (sessionId !== activeListedSessionId) setOpeningSessionId(sessionId);
    onSelectSession(sessionId);
  };

  // Cards are memoized. Their handlers go through one stable set that calls
  // the latest version, so a sidebar render no longer re-renders every card.
  const onSessionCardDelete = (sessionId: string) => {
    if (selectedSessionIds.has(sessionId) && !contextSelectionRef.current) {
      void bulkDeleteSessions(selectedOrderedIds);
      return;
    }
    if (!remoteProject && !onDeleteLocalSessionNow) {
      onDeleteSession?.(sessionId);
      return;
    }
    void bulkDeleteSessions([sessionId]);
  };

  // Holding a card starts selecting from it, like the menu's Select item.
  const onSessionCardLongPress = (sessionId: string) => {
    contextSelectionRef.current = false;
    setSessionMenu(null);
    selectionAnchorRef.current = sessionId;
    if (!selectionMode) longPressSelectionRef.current = true;
    setSelectionMode(true);
    setSelectedSessionIds((current) => new Set([...current, sessionId]));
  };

  const cardHandlers = useRef({
    onSessionCardSelect,
    onSessionCardLongPress,
    onOpenInboxItem,
    onPrefetchSession,
    onPlaceSessionOnPane,
    onPopOutSession,
    onSessionListDrop,
    onSessionContextMenu,
    onArchiveSession,
    setRenamingSessionId,
    onSessionCardDelete,
  });
  cardHandlers.current = {
    onSessionCardSelect,
    onSessionCardLongPress,
    onOpenInboxItem,
    onPrefetchSession,
    onPlaceSessionOnPane,
    onPopOutSession,
    onSessionListDrop,
    onSessionContextMenu,
    onArchiveSession,
    setRenamingSessionId,
    onSessionCardDelete,
  };
  const cardActions = useMemo(
    () => ({
      select: (
        sessionId: string,
        event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
      ) => cardHandlers.current.onSessionCardSelect(sessionId, event),
      longPress: (sessionId: string) => cardHandlers.current.onSessionCardLongPress(sessionId),
      openWorkItem: (item: LinkedWorkItem, sessionId: string) =>
        cardHandlers.current.onOpenInboxItem?.(item, sessionId),
      prefetch: (sessionId: string) => cardHandlers.current.onPrefetchSession?.(sessionId),
      placeOnPane: (sessionId: string, targetId: string, edge: PaneEdge) =>
        cardHandlers.current.onPlaceSessionOnPane?.(sessionId, targetId, edge),
      popOut: (sessionId: string, position: WindowMovePosition) =>
        cardHandlers.current.onPopOutSession?.(sessionId, position),
      listDrop: (draggedId: string, target: SessionListDropTarget) =>
        cardHandlers.current.onSessionListDrop(draggedId, target),
      contextMenu: (sessionId: string, e: ReactMouseEvent<HTMLDivElement>) =>
        cardHandlers.current.onSessionContextMenu(sessionId, e),
      archive: (sessionId: string, archived: boolean) =>
        cardHandlers.current.onArchiveSession?.(sessionId, archived),
      rename: (sessionId: string) => cardHandlers.current.setRenamingSessionId(sessionId),
      delete: (sessionId: string) => cardHandlers.current.onSessionCardDelete(sessionId),
    }),
    [],
  );

  const sessionInsertMotion = useRef<SessionInsertMotion>({
    cwd: "",
    since: Date.now(),
    seen: new Set(),
  });
  // Runs after the rows' mount effects: a project's first paint never animates,
  // and rows that mount later (drawer opened, folder expanded) are not new.
  useLayoutEffect(() => {
    const motion = sessionInsertMotion.current;
    if (motion.cwd !== cwd) {
      motion.cwd = cwd;
      motion.since = Date.now();
      motion.seen.clear();
    }
    for (const session of listedSessions) motion.seen.add(session.id);
    while (motion.seen.size > 2048) {
      const oldest = motion.seen.values().next().value;
      if (oldest === undefined) break;
      motion.seen.delete(oldest);
    }
  }, [cwd, listedSessions]);

  const renderSessionCard = (session: SessionSummary) =>
    renamingSessionId === session.id && onRenameSession ? (
      <SessionRenameRow
        session={session}
        isActive={session.id === activeListedSessionId}
        onCommit={(title) => {
          onRenameSession(session.id, title);
          setRenamingSessionId(null);
        }}
        onCancel={() => setRenamingSessionId(null)}
      />
    ) : (
      <SessionCard
        session={session}
        isActive={session.id === activeListedSessionId}
        isSelected={selectedSessionIds.has(session.id)}
        selectionMode={showBulkBar}
        busy={listedBusySessionIds.has(session.id)}
        opening={openingSessionId === session.id}
        done={unseenFinishedIds.has(session.id)}
        linkedUpdate={linkedSessionUpdateIds.has(session.id)}
        needsApproval={listedApprovalSessionIds.has(session.id)}
        dropTarget={isSessionDrop("session", session.id)}
        dropInsert={
          sessionDrop?.kind === "insert" && sessionDrop.id === session.id
            ? sessionDrop.place
            : undefined
        }
        dropDwell={
          sessionDrop?.kind === "insert" && sessionDrop.id === session.id && !!sessionDrop.dwell
        }
        groupDelayMs={listDisplay.groupDelayMs}
        density={listDisplay.density}
        showModel={listDisplay.showModel}
        showBranch={listDisplay.showBranch}
        onSelect={cardActions.select}
        onLongPress={cardActions.longPress}
        onOpenWorkItem={onOpenInboxItem && !remoteProject ? cardActions.openWorkItem : undefined}
        onPrefetch={onPrefetchSession ? cardActions.prefetch : undefined}
        onPlaceOnPane={onPlaceSessionOnPane ? cardActions.placeOnPane : undefined}
        onPopOut={onPopOutSession ? cardActions.popOut : undefined}
        onListDrop={reminderIds.has(session.id) ? undefined : cardActions.listDrop}
        onListDropTargetChange={setSessionDrop}
        onContextMenu={cardActions.contextMenu}
        onArchive={onArchiveSession ? cardActions.archive : undefined}
        onRename={onRenameSession ? cardActions.rename : undefined}
        onDelete={onDeleteSession ? cardActions.delete : undefined}
      />
    );

  const onFolderMove = (folderId: string, target: FolderMoveTarget) => {
    const before = sessionFolders;
    const next = moveFolder(before, folderId, target);
    if (next === before) return;
    const prev = before.find((folder) => folder.id === folderId);
    const moved = next.find((folder) => folder.id === folderId);
    captureListMotion();
    commitSessionFolders(next);
    if (!prev || !moved) return;
    if (prev.parentId === moved.parentId && !!prev.pinned === !!moved.pinned) {
      setListNotice(null);
      return;
    }
    const parentName = moved.parentId
      ? next.find((folder) => folder.id === moved.parentId)?.name
      : undefined;
    setListNotice({
      message: parentName
        ? t("Moved to {p0}", { p0: parentName })
        : moved.pinned
          ? t("Pinned")
          : t("Moved to the top level"),
      undo: () => {
        captureListMotion();
        commitSessionFolders(before);
      },
    });
  };

  // A folder header drags the folder with everything inside it: onto a
  // folder (header middle or body) nests it, a header's top edge places it
  // before that folder, the pinned header pins it, anywhere else lifts it to
  // the top level. Moves into itself or past the depth limit are refused.
  const startFolderDrag = (folderId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    cancelFolderDrag.current?.();
    const handle = event.currentTarget;
    const source = handle.closest<HTMLElement>("[data-session-folder]");
    let highlighted: HTMLElement | null = null;
    const clearHighlight = () => {
      highlighted?.removeAttribute("data-folder-drop");
      highlighted = null;
    };
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let target: FolderMoveTarget | null = null;
    let reported: { target: FolderMoveTarget | null; allowed: boolean } | undefined;
    handle.setPointerCapture(pointerId);
    const restoreSelection = suppressTextSelection();
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        active = true;
        setGrabbing(true);
        source?.setAttribute("data-folder-dragging", "true");
      }
      target = folderMoveTargetAt(ev.clientX, ev.clientY, sessionsScrollRef.current);
      const allowed = !!target && canMoveFolder(sessionFoldersRef.current, folderId, target);
      const before = reported?.target;
      const sameTarget =
        before === target ||
        (!!before &&
          !!target &&
          before.kind === target.kind &&
          (!("id" in before) || ("id" in target && before.id === target.id)) &&
          (!("place" in before) || ("place" in target && before.place === target.place)));
      if (!reported || reported.allowed !== allowed || !sameTarget) {
        reported = { target, allowed };
        clearHighlight();
        const root = sessionsScrollRef.current;
        if (root && target && allowed) {
          highlighted =
            "id" in target
              ? ([...root.querySelectorAll<HTMLElement>("[data-session-folder]")].find(
                  (el) => el.dataset.sessionFolder === (target as { id: string }).id,
                ) ?? null)
              : target.kind === "pinned"
                ? root.querySelector<HTMLElement>("[data-pinned-sessions]")
                : null;
          highlighted?.setAttribute(
            "data-folder-drop",
            target.kind === "beside" ? target.place : target.kind,
          );
        }
      }
      if (!target || !allowed) setDropFeedback("blocked", ev, t("Cannot drop here"));
      else setDropFeedback("move", ev, folderMoveLabel(target));
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(true);
    };
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      finish(false);
    };
    function finish(commit: boolean) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      restoreSelection();
      setGrabbing(false);
      clearHighlight();
      source?.removeAttribute("data-folder-dragging");
      cancelFolderDrag.current = null;
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      if (!active) return;
      skipFolderClickUntil.current = performance.now() + 400;
      if (commit && target) onFolderMove(folderId, target);
    }
    cancelFolderDrag.current = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
  };

  // Folders draw recursively: subfolders first, then the folder's sessions.
  const renderFolderEntry = (
    entry: FolderEntry,
    depth: number,
    beforeUngrouped = false,
  ): ReactNode => {
    const expanded = searchNarrowed || !entry.folder.collapsed;
    const shellFill = folderShellFill(entry.folder.colorIndex, entry.folder.customColor);
    const topLevel = depth === 0 && !entry.folder.pinned;
    return (
      <li
        key={entry.folder.id}
        data-session-folder={entry.folder.id}
        data-folder-collapsed={expanded ? undefined : "true"}
        className={`relative ${styles.folder} ${
          topLevel && (expanded || beforeUngrouped) ? "mb-1.5" : ""
        }`}
      >
        <div
          data-folder-insert="before"
          className="pointer-events-none absolute inset-x-1 top-0 z-20 h-0.5 rounded-full bg-accent"
        />
        <div
          data-folder-insert="after"
          className="pointer-events-none absolute inset-x-1 bottom-0 z-20 h-0.5 rounded-full bg-accent"
        />
        <div
          className={`overflow-hidden rounded-md ${shellFill ? "" : "bg-content/5"}`}
          style={shellFill ? { background: shellFill } : undefined}
        >
          {renamingFolderId === entry.folder.id ? (
            <FolderRenameRow
              folder={entry.folder}
              memberCount={entry.allSessions.length}
              dropTarget={isSessionDrop("folder", entry.folder.id)}
              onCommit={(name) => {
                commitSessionFolders(renameFolder(sessionFolders, entry.folder.id, name));
                setRenamingFolderId(null);
              }}
              onCancel={() => setRenamingFolderId(null)}
            />
          ) : (
            <FolderRow
              folder={entry.folder}
              sessions={entry.allSessions}
              expanded={expanded}
              dropTarget={isSessionDrop("folder", entry.folder.id)}
              busy={entry.allSessions.some((session) => listedBusySessionIds.has(session.id))}
              done={entry.allSessions.some((session) => unseenFinishedIds.has(session.id))}
              needsApproval={entry.allSessions.some((session) =>
                listedApprovalSessionIds.has(session.id),
              )}
              onPointerDown={(event) => startFolderDrag(entry.folder.id, event)}
              onToggle={() => {
                if (performance.now() < skipFolderClickUntil.current) return;
                if (searchNarrowed) return;
                commitSessionFolders(
                  setFolderCollapsed(sessionFolders, entry.folder.id, !entry.folder.collapsed),
                );
              }}
              onContextMenu={(event) => onFolderContextMenu(entry.folder.id, event)}
              onRename={() => setRenamingFolderId(entry.folder.id)}
            />
          )}
          {expanded ? (
            <>
              {entry.folders.length > 0 ? (
                <ul className="flex flex-col gap-1 px-1 pt-1">
                  {entry.folders.map((child) => renderFolderEntry(child, depth + 1))}
                </ul>
              ) : null}
              <ul className={`flex flex-col gap-px p-1 ${entry.sessions.length ? "" : "hidden"}`}>
                {entry.sessions.map((session) => (
                  <SessionListItem
                    key={session.id}
                    session={session}
                    cwd={cwd}
                    motion={sessionInsertMotion}
                  >
                    {renderSessionCard(session)}
                  </SessionListItem>
                ))}
              </ul>
              {onNew ? (
                <div className="border-t border-stroke p-1">
                  <Button
                    variant="ghost"
                    motion="none"
                    type="button"
                    data-no-drag
                    data-tauri-drag-region="false"
                    title={t("New session")}
                    aria-label={t("New session")}
                    onClick={() => onNewInFolder(entry.folder.id)}
                    className="relative flex w-full items-center gap-1"
                  >
                    <Plus className="size-3 shrink-0" strokeWidth={1.75} />
                    <span className="text-[13px] font-semibold leading-snug">
                      {t("New session")}
                    </span>
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </li>
    );
  };

  const onSessionFiltersChange = (next: SessionSidebarFilters) => {
    setSessionFilters(next);
    saveSessionSidebarFilters(next);
  };

  const onFilterButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (filterMenu) {
      setFilterMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setSessionMenu(null);
    setFolderMenu(null);
    setFilterMenu({
      x: rect.right - 228,
      y: rect.bottom + 2,
    });
  };

  const sessionSearchInput = (
    <SearchInput
      focusOwner="group"
      ref={searchInputRef}
      type="text"
      value={searchQuery}
      placeholder={t("Search conversations...")}
      aria-label={t("Search conversations")}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      onChange={(event) => setSearchQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (searchQuery) {
          setSearchQuery("");
        }
      }}
      className="w-full min-w-0"
    />
  );

  const onTabPick = (itemId: SidebarTab) => {
    onTabChange(itemId);
  };

  const onCompactTabPick = (itemId: SidebarTab) => {
    if (drawerMode) {
      setDrawerOpen(!(drawerVisible && tab === itemId));
    }
    onTabChange(itemId);
  };

  const changeAdditions = changeStats?.additions ?? 0;
  const changeDeletions = changeStats?.deletions ?? 0;
  const hasChanges = (changeStats?.files ?? 0) > 0;
  const hasChangeStats = changeAdditions > 0 || changeDeletions > 0;
  const changesLabel = hasChangeStats
    ? [
        "Changes",
        changeAdditions > 0 ? `+${changeAdditions}` : "",
        changeDeletions > 0 ? `-${changeDeletions}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "Changes";

  const workspaceTabItems = visibleTabs.map((itemId) => {
    const active = tab === itemId;
    const isChangesTab = itemId === "changes";
    const Icon = COMPACT_TAB_ICONS[itemId];
    const label = isChangesTab ? changesLabel : TAB_LABELS[itemId];
    return (
      <div
        key={itemId}
        ref={(el) => sortable.setItemRef(itemId, el)}
        className="reorder-item workspace-tab relative flex min-w-0 flex-1 touch-none items-stretch"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          sortable.onItemPointerDown(itemId, event);
        }}
      >
        <Button
          variant="tab"
          motion="none"
          type="button"
          role="tab"
          aria-selected={active}
          aria-label={label}
          title={label}
          data-usage-guide={isChangesTab ? "changes" : undefined}
          data-tauri-drag-region="false"
          onClick={() => {
            if (sortable.consumeClick()) return;
            onTabPick(itemId);
          }}
          size="sm"
          className="flex min-w-0 flex-1 items-center justify-center self-center overflow-hidden leading-none"
        >
          <Icon className="workspace-tab-icon" aria-hidden="true" />
          <span className="workspace-tab-content flex min-w-0 items-center justify-center">
            {isChangesTab && hasChangeStats ? (
              <DiffStat additions={changeAdditions} deletions={changeDeletions} />
            ) : (
              <span className="block truncate leading-label">{TAB_LABELS[itemId]}</span>
            )}
          </span>
          {itemId === "sessions" ? workingSessionsBadge : null}
        </Button>
      </div>
    );
  });

  const workspaceHeader = (
    <div
      className="flex h-10 shrink-0 select-none items-center gap-1 border-b border-stroke pl-3 pr-1.5"
      data-tauri-drag-region="deep"
    >
      <div className="flex min-w-0 flex-1 items-center">
        {!remoteProject && cwd && cwd !== "~" ? (
          <SidebarWorktreeSwitcher
            cwd={cwd}
            tabStats={worktreeTabStats}
            onSelect={onSelectWorkspace}
            pending={workspaceSwitchPending}
            switchError={workspaceSwitchError}
          />
        ) : (
          <span className="min-w-0 truncate text-sm font-medium leading-tight">
            {t("Workspace")}
          </span>
        )}
      </div>
      <WorkspaceTitleActions onSearch={onGoToFile} onNew={onNew} />
    </div>
  );

  const sidebarContent = (
    <aside
      onPointerEnter={() => {
        void preloadSidebarSurfaces().catch(() => {});
      }}
      onFocusCapture={() => {
        void preloadSidebarSurfaces().catch(() => {});
      }}
      ref={resize.setPaneRef}
      data-side-pane="workspace"
      className="bycoda-sidebar body-glass sidebar-pane relative flex h-full min-h-0 shrink-0 flex-col border-r border-stroke pe-1.5"
    >
      {railVisible ? (
        <>
          {workspaceHeader}
          <div
            role="tablist"
            aria-label={t("Workspace")}
            className="bycoda-workspace-tabs flex shrink-0 items-center gap-px border-b border-stroke"
          >
            {workspaceTabItems}
          </div>
        </>
      ) : (
        <>
          {titleBarAbove ? null : (
            <div
              className="flex h-10 shrink-0 select-none items-center border-b border-stroke pr-1.5"
              data-tauri-drag-region="deep"
            >
              {IS_MAC ? <div className="w-[78px] shrink-0" /> : null}
              <DevModeSlot />
              <TabVisitNav
                canGoBack={canGoBack}
                canGoForward={canGoForward}
                onGoBack={onGoBack}
                onGoForward={onGoForward}
                onTogglePanel={compactProjectRail ? undefined : onToggleProjectRail}
              />
            </div>
          )}
          {compactRailVisible ? workspaceHeader : null}
          {onSelectProject && !compactRailVisible ? (
            <SidebarProjectPicker
              cwd={cwd}
              recents={visibleRecents}
              busy={projectPathBusy(busyProjectPaths, cwd)}
              onSelectProject={onSelectProject}
              onOpenProject={onOpenProject}
              onRemoveProject={onRemoveProject}
              onNew={onNew}
              onSearch={onSearch}
              onOpenInbox={onOpenInbox}
              onOpenNotificationSettings={onOpenNotificationSettings}
              onOpenNotes={notesEnabled ? onOpenNotes : undefined}
              onOpenAutomations={onOpenAutomations}
              onOpenTasks={onOpenTasks}
              searchActive={searchActive}
              inboxActive={inboxActive}
              notesActive={notesActive}
              automationsActive={automationsActive}
              tasksActive={tasksActive}
              socialActive={socialActive}
              inboxUnseen={inboxUnseen}
            />
          ) : null}
          <div
            role="tablist"
            aria-label={t("Workspace")}
            className="bycoda-workspace-tabs flex shrink-0 items-center gap-px overflow-visible border-b border-stroke"
          >
            {workspaceTabItems}
          </div>
        </>
      )}
      <>
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
            tab === "files" ? "" : "hidden"
          }`}
        >
          {cwd && cwd !== "~" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <FileTree
                key={gitRoot}
                cwd={gitRoot}
                rootLabel={explorerRootLabel}
                onOpenFile={onOpenFile}
                onOpenTerminal={remoteProject ? undefined : onOpenTerminal}
                onFileMoved={onFileMoved}
                onFileDeleted={onFileDeleted}
                onSearch={onOpenFilesSearch}
                onCloseSearch={closeFilesSearch}
                search={
                  filesSearchOpen ? (
                    <ProjectSearch
                      cwd={gitRoot}
                      focusToken={searchFocusToken}
                      showHeader={false}
                      onOpenFile={onOpenFile}
                      onClose={closeFilesSearch}
                    />
                  ) : undefined
                }
                gitStatuses={gitStatuses}
              />
            </div>
          ) : filesSearchOpen ? (
            <ProjectSearch
              cwd={gitRoot}
              focusToken={searchFocusToken}
              onOpenFile={onOpenFile}
              onClose={closeFilesSearch}
            />
          ) : (
            <p className="px-3 py-2 text-[12px] text-content/50">{t("No project folder")}</p>
          )}
        </div>
        {tab === "sessions" && cwd && cwd !== "~" ? (
          <div
            data-session-list-panel
            className="flex h-9 shrink-0 items-center gap-1 border-b border-stroke px-2"
          >
            <SearchInputGroup appearance="field" className="min-w-0 flex-1">
              <Search className="size-3 shrink-0" />
              {sessionSearchInput}
            </SearchInputGroup>
            <span data-session-selection-keep className="contents">
              <SessionsHeaderButton
                label={selectionMode ? t("Stop selecting") : t("Select conversations")}
                active={selectionMode}
                onClick={() => {
                  if (selectionMode) {
                    clearSessionSelection();
                    return;
                  }
                  contextSelectionRef.current = false;
                  setSessionMenu(null);
                  setSelectionMode(true);
                }}
              >
                <CheckList className="size-3" strokeWidth={1.75} />
              </SessionsHeaderButton>
            </span>
            <SessionsHeaderButton
              label={t("Filter sessions")}
              active={filtersActive}
              open={!!filterMenu}
              hasPopup
              onClick={onFilterButtonClick}
            >
              <ListFilter className="size-3" strokeWidth={1.75} />
            </SessionsHeaderButton>
          </div>
        ) : null}
        {tab === "sessions" && cwd && cwd !== "~" && showBulkBar ? (
          <div
            role="toolbar"
            aria-label={t("Selected conversations")}
            data-session-bulk-bar
            data-session-selection-keep
            className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-stroke bg-content/5 px-2 py-1 text-[11px] text-content/70"
          >
            <span className="mr-auto shrink-0 pl-0.5 tabular-nums text-content">
              {selectedSessionIds.size}
              {t(" selected")}
            </span>
            <Button
              variant="ghost"
              motion="none"
              type="button"
              disabled={
                sessionNavigationIds.length === 0 ||
                selectedSessionIds.size === sessionNavigationIds.length
              }
              onClick={selectAllListedSessions}
              className="disabled:pointer-events-none"
            >
              {t("Select all")}
            </Button>
            <Button
              variant="ghost"
              motion="none"
              type="button"
              onClick={clearSessionSelection}
              className=""
            >
              {selectedSessionIds.size > 0 ? t("Clear") : t("Done")}
            </Button>
            {selectedSessionIds.size > 0 ? (
              <span className="flex shrink-0 items-center gap-px">
                {onOpenSessionsSideBySide && selectedOrderedIds.length > 1 ? (
                  <BulkBarAction
                    label={t("Open Side by Side")}
                    onClick={() => {
                      onOpenSessionsSideBySide(selectedOrderedIds);
                      clearSessionSelection();
                    }}
                  >
                    <SplitSquare className="size-3" strokeWidth={1.75} />
                  </BulkBarAction>
                ) : null}
                {onPinSession || onPinSessions ? (
                  <BulkBarAction
                    label={allSelectedPinned ? t("Unpin") : t("Pin")}
                    disabled={deleting}
                    onClick={() => pinSessions(selectedOrderedIds, !allSelectedPinned)}
                  >
                    <Pin className="size-3" strokeWidth={1.75} />
                  </BulkBarAction>
                ) : null}
                {onArchiveSession || onArchiveSessions ? (
                  <BulkBarAction
                    label={allSelectedArchived ? t("Unarchive") : t("Archive")}
                    disabled={deleting}
                    onClick={() => archiveSessions(selectedOrderedIds, !allSelectedArchived)}
                  >
                    <Archive className="size-3" strokeWidth={1.75} />
                  </BulkBarAction>
                ) : null}
                {onDeleteSession || onDeleteSessions ? (
                  <BulkBarAction
                    label={deleting ? t("Deleting…") : t("Delete")}
                    disabled={deleting}
                    danger
                    onClick={() => void bulkDeleteSessions(selectedOrderedIds)}
                  >
                    {deleting ? (
                      <Loader className="size-3 motion-safe:animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-3" strokeWidth={1.75} />
                    )}
                  </BulkBarAction>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}
        {tab === "sessions" &&
        (deleteProgress?.cwd === cwd || (bulkNotice && deleteNoticeCwd === cwd)) ? (
          <div
            role={deleteProgress ? "status" : deleteNoticeError ? "alert" : "status"}
            aria-live={deleteNoticeError && !deleteProgress ? "assertive" : "polite"}
            aria-atomic="true"
            data-session-delete-status
            className={`flex shrink-0 items-start gap-2 border-b border-stroke px-3 py-2 text-[12px] ${deleteNoticeError && !deleteProgress ? "text-danger" : "text-content/70"}`}
          >
            {deleteProgress ? (
              <Loader className="mt-0.5 size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />
            ) : deleteNoticeError ? (
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            ) : (
              <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 break-words">
              {deleteProgress
                ? t("Deleting conversations… {p0}/{p1} completed", {
                    p0: deleteProgress.completed,
                    p1: deleteProgress.total,
                  })
                : bulkNotice}
            </span>
            {!deleteProgress ? (
              <Button
                variant="ghost"
                motion="none"
                type="button"
                onClick={dismissBulkNotice}
                aria-label={t("Dismiss deletion result")}
                className="shrink-0"
              >
                {t("Dismiss")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {tab === "sessions" && remoteProject ? (
          !remote.machine && remote.dataState.error && remoteConnectionIssue ? (
            <RemoteLoadError cwd={cwd} failure={classifyRemoteError(remote.dataState.error)} />
          ) : (
            <RemoteDataStatus
              state={remote.dataState}
              connectionIssueHandled={remoteConnectionIssue}
              label={
                remote.machine
                  ? t("sessions from {p0}", { p0: remote.machine.name })
                  : t("sessions")
              }
              onRefresh={remote.refresh}
              disabled={!remote.machine && !remote.dataState.error}
            />
          )
        ) : null}
        <layoutMotion.div
          layoutScroll
          ref={(el) => {
            sessionsLock(el);
            sessionsScrollRef.current = el;
          }}
          data-session-list-panel
          className={`sidebar-session-scroll min-h-0 flex-1 overflow-y-auto overscroll-none ${
            tab === "sessions" ? "" : "hidden"
          }`}
        >
          {!cwd || cwd === "~" ? (
            <p className="px-3 py-2 text-[12px] text-content/50">{t("No project folder")}</p>
          ) : (
            <div>
              {/* Loading and errors precede empty results, so an unfinished
                  request never claims this project has no conversations. */}
              {remoteProject &&
              projectSessions.length === 0 &&
              !["ready", "empty"].includes(remote.dataState.phase) ? null : pendingFirstLoad ? (
                <p
                  role="status"
                  className="flex items-center gap-2 px-3 py-2 text-[12px] text-content/50"
                >
                  <Loader
                    className="size-3.5 shrink-0 motion-safe:animate-spin"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  {remoteLoading
                    ? remote.machine
                      ? t("Loading sessions from {p0}…", { p0: remote.machine.name })
                      : t("Connecting to this project’s machine…")
                    : t("Loading conversations…")}
                </p>
              ) : remoteProject && remote.failed && projectSessions.length === 0 ? (
                <Alert tone="danger" role="alert">
                  <p>
                    {remote.machine
                      ? t("Couldn’t reach {p0}. Trying again…", { p0: remote.machine.name })
                      : t("Couldn’t load sessions")}
                  </p>
                  <Button
                    variant="ghost"
                    motion="none"
                    type="button"
                    onClick={refreshRemoteProjectSessions}
                    className="mt-2"
                  >
                    {t("Retry")}
                  </Button>
                </Alert>
              ) : status === "error" && projectSessions.length === 0 ? (
                <Alert tone="danger" role="alert">
                  {t("Couldn’t load sessions")}
                </Alert>
              ) : visibleSessions.length === 0 ? (
                // A narrowed-down result is a transient answer to what the user
                // just typed, so it stays a quiet line of text. Only the genuine
                // "this project has nothing in it" case earns the illustration.
                narrowedByUser ? (
                  <div className="flex flex-col items-start gap-1.5 px-3 py-2 text-[12px] text-content/50">
                    <p>
                      {searchNarrowed
                        ? t("No matching sessions")
                        : t("No sessions match these filters")}
                    </p>
                    {filtersActive && listedSessions.length > 0 ? (
                      <Button
                        variant="ghost"
                        motion="none"
                        type="button"
                        className=""
                        onClick={() => onSessionFiltersChange(DEFAULT_SESSION_SIDEBAR_FILTERS)}
                      >
                        {t("Clear filters (")}
                        {listedSessions.length}{" "}
                        {listedSessions.length === 1 ? t("session") : t("sessions")} {t("hidden)")}
                      </Button>
                    ) : null}
                  </div>
                ) : remoteProject && !remote.machine ? (
                  <p className="px-3 py-2 text-[12px] text-content/45">
                    {t("This project’s machine isn’t connected on this computer.")}
                  </p>
                ) : (
                  <SessionsEmpty message="Sessions you start will show up here" />
                )
              ) : (
                <ul data-session-list className="flex flex-col gap-0.5 p-1.5 pb-10">
                  {sessionListEntries.map((entry, index) => {
                    if (entry.kind === "pinned" || entry.kind === "reminders") {
                      const isReminders = entry.kind === "reminders";
                      const expanded = searchNarrowed || !entry.collapsed;
                      const beforeUngrouped = sessionListEntries[index + 1]?.kind === "session";
                      return (
                        <li
                          key={`${entry.kind}-sessions`}
                          data-pinned-sessions={isReminders ? undefined : ""}
                          data-reminder-sessions={isReminders ? "" : undefined}
                          className={`relative ${styles.folder} ${expanded || beforeUngrouped ? "mb-1.5" : ""}`}
                        >
                          <div className="overflow-hidden rounded-md bg-content/5">
                            <FolderRow
                              folder={
                                isReminders
                                  ? {
                                      name: "Reminders",
                                      customColor: REMINDERS_COLOR,
                                    }
                                  : { name: "Pinned" }
                              }
                              sessions={
                                entry.kind === "pinned"
                                  ? [
                                      ...entry.folders.flatMap((folder) => folder.allSessions),
                                      ...entry.sessions,
                                    ]
                                  : entry.sessions
                              }
                              expanded={expanded}
                              dropTarget={!isReminders && sessionDrop?.kind === "pinned"}
                              busy={entry.sessions.some((session) =>
                                listedBusySessionIds.has(session.id),
                              )}
                              done={entry.sessions.some((session) =>
                                unseenFinishedIds.has(session.id),
                              )}
                              needsApproval={entry.sessions.some((session) =>
                                listedApprovalSessionIds.has(session.id),
                              )}
                              groupIcon={
                                isReminders ? (
                                  <Clock className="size-3.5" strokeWidth={1.75} />
                                ) : (
                                  <Pin className="size-3.5 text-content" strokeWidth={1.75} />
                                )
                              }
                              onToggle={() => {
                                if (searchNarrowed) return;
                                const collapsed = !entry.collapsed;
                                if (isReminders) {
                                  setReminderSessionsCollapsed(collapsed);
                                  saveReminderSessionsCollapsed(cwd, collapsed);
                                  return;
                                }
                                setPinnedSessionsCollapsed(collapsed);
                                savePinnedSessionsCollapsed(cwd, collapsed);
                              }}
                            />
                            {expanded && entry.kind === "pinned" && entry.folders.length > 0 ? (
                              <ul className="flex flex-col gap-1 px-1 pt-1">
                                {entry.folders.map((child) => renderFolderEntry(child, 0))}
                              </ul>
                            ) : null}
                            {expanded && entry.sessions.length > 0 ? (
                              <ul className="flex flex-col gap-px p-1">
                                {entry.sessions.map((session) => (
                                  <SessionListItem
                                    key={session.id}
                                    session={session}
                                    cwd={cwd}
                                    motion={sessionInsertMotion}
                                  >
                                    {renderSessionCard(session)}
                                  </SessionListItem>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        </li>
                      );
                    }
                    if (entry.kind === "folder") {
                      return renderFolderEntry(
                        entry,
                        0,
                        sessionListEntries[index + 1]?.kind === "session",
                      );
                    }
                    return (
                      <SessionListItem
                        key={entry.session.id}
                        session={entry.session}
                        cwd={cwd}
                        motion={sessionInsertMotion}
                      >
                        {renderSessionCard(entry.session)}
                      </SessionListItem>
                    );
                  })}
                  {hasMoreSessions ? (
                    <li ref={loadMoreRef} aria-hidden className="h-px list-none" />
                  ) : null}
                </ul>
              )}
            </div>
          )}
        </layoutMotion.div>
        {tab === "changes" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SourceControl
              cwd={gitRoot}
              repositoryPaths={repositoryPaths}
              onOpenRepository={onOpenRepository}
              enabled={panelOpen}
              textHarness={textHarness}
              selectedPath={selectedDiffPath}
              selectedKind={selectedDiffKind}
              selectedSha={selectedCommitSha}
              onOpenFile={onOpenDiff ?? ((path) => onOpenFile(path, undefined, { exact: true }))}
              onOpenInEditor={(path, pin) => onOpenFile(path, undefined, { exact: true, pin })}
              onOpenAllChanges={onOpenAllChanges ?? (() => {})}
              onOpenCommit={onOpenCommit ?? (() => {})}
            />
          </div>
        ) : null}
        {showSidebarFooter ? (
          <>
            <div className="shrink-0 px-2">
              <LiveAgentsPreview
                agents={liveAgents}
                activeSessionId={activeSessionId}
                onSelect={onSelectAgent}
                bottomSpacing={compactRailVisible}
                collapsible
              />
            </div>
            <SidebarUpdateFooter
              update={updateNotice}
              onOpenWhatsNew={onOpenWhatsNew}
              onDismissUpdate={onDismissUpdate}
            />
            <div className="flex shrink-0 flex-col gap-px p-2 empty:hidden">
              <GithubStarPrompt />
              {!compactProjectRail ? (
                <RailAction
                  label={t("Settings")}
                  icon={Settings}
                  onClick={onOpenSettings}
                  shortcut={`${MOD},`}
                  ariaLabel={`Settings (${MOD},)`}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </>
      {sessionMenu ? (
        <ExplorerMenu
          x={sessionMenu.x}
          y={sessionMenu.y}
          items={sessionMenuItems}
          ariaLabel={
            multipleMenuSessions
              ? `${menuSessionIds.length} selected session actions`
              : "Session actions"
          }
          onPick={onSessionMenuPick}
          onClose={closeSessionMenu}
        />
      ) : null}
      {folderMenu ? (
        <ExplorerMenu
          x={folderMenu.x}
          y={folderMenu.y}
          items={folderMenuItems}
          ariaLabel="Folder actions"
          width={260}
          header={
            <FolderColorSwatches
              colorIndex={menuFolder?.colorIndex}
              customColor={menuFolder?.customColor}
              onChange={onFolderColorChange}
              onCustomChange={onFolderCustomColorChange}
            />
          }
          onPick={onFolderMenuPick}
          onClose={() => setFolderMenu(null)}
        />
      ) : null}
      {listNotice ? (
        <TransientNotice
          message={listNotice.message}
          action={{
            label: t("Undo"),
            onClick: () => {
              listNotice.undo();
              setListNotice(null);
            },
          }}
          onDismiss={() => setListNotice(null)}
        />
      ) : null}
      {filterMenu ? (
        <SessionFiltersMenu
          x={filterMenu.x}
          y={filterMenu.y}
          harnesses={sessionHarnesses}
          filters={sessionFilters}
          onChange={onSessionFiltersChange}
          onClose={() => setFilterMenu(null)}
        />
      ) : null}
      {linkingSession ? (
        <LinkSessionWorkItemDialog
          initial={linkingSession.linkedWorkItem}
          sessionTitle={sessionDisplayTitle(linkingSession.title, linkingSession.harness)}
          onSave={(item) => {
            onSetSessionLinkedWorkItem?.(linkingSession.id, item);
            setLinkingSession(null);
          }}
          onClose={() => setLinkingSession(null)}
        />
      ) : null}
      <div
        {...resize.separatorProps}
        aria-label={t("Resize sidebar")}
        className={`absolute inset-y-0 end-0 z-10 w-1.5 cursor-col-resize touch-none ${
          resize.dragging ? "bg-content/15" : "hover:bg-content/10"
        }`}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
      />
    </aside>
  );

  return (
    <div
      className={`flex h-full shrink-0 ${
        railVisible || compactRailVisible || sidebarVisible ? "" : "hidden"
      }`}
    >
      {compactRailVisible ? (
        <CompactProjectRail
          recoveryControl={recoveryControl}
          cwd={cwd}
          workingSessionsBadge={workingSessionsBadge}
          recents={visibleRecents}
          busy={projectPathBusy(busyProjectPaths, cwd)}
          tabs={visibleTabs}
          activeTab={tab}
          tabShown={panelOpen}
          changesLabel={changesLabel}
          hasChanges={hasChanges}
          inboxUnseen={inboxUnseen}
          onSelectProject={onSelectProject}
          onOpenProject={onOpenProject}
          onRemoveProject={onRemoveProject}
          onTabChange={onCompactTabPick}
          onSearch={onSearch}
          searchActive={searchActive}
          onOpenInbox={onOpenInbox}
          inboxActive={inboxActive}
          onOpenNotificationSettings={onOpenNotificationSettings}
          onOpenNotes={notesEnabled ? onOpenNotes : undefined}
          notesActive={notesActive}
          onOpenAutomations={onOpenAutomations}
          onOpenTasks={onOpenTasks}
          automationsActive={automationsActive}
          tasksActive={tasksActive}
          socialActive={socialActive}
          onOpenSettings={onOpenSettings}
          onTogglePanel={onToggleProjectRail}
          onLeaveActive={onGoBack}
          titleBarAbove={titleBarAbove}
          recentSessions={recentSessions}
          activeSessionId={activeSessionId}
          onSelectAgent={onSelectAgent}
        />
      ) : null}
      {railMounted.current && onSelectProject && onOpenProject ? (
        <ProjectRail
          onRenameProjectFolder={onRenameProjectFolder}
          recoveryControl={recoveryControl}
          visible={railVisible}
          cwd={cwd}
          recents={recents}
          inboxUnseen={inboxUnseen}
          busyPaths={busyProjectPaths}
          liveAgents={liveAgents}
          activeSessionId={activeSessionId}
          onSelectAgent={onSelectAgent}
          recentSessions={recentSessions}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onGoBack={onGoBack}
          onGoForward={onGoForward}
          onSearch={onSearch}
          searchActive={searchActive}
          onOpenInbox={onOpenInbox}
          inboxActive={inboxActive}
          notesEnabled={notesEnabled}
          onOpenNotes={onOpenNotes}
          notesActive={notesActive}
          onOpenAutomations={onOpenAutomations}
          onOpenTasks={onOpenTasks}
          automationsActive={automationsActive}
          tasksActive={tasksActive}
          socialActive={socialActive}
          onTogglePanel={onToggleProjectRail}
          onSelectProject={onSelectProject}
          onOpenProject={onOpenProject}
          onOpenSyncedProject={onOpenSyncedProject}
          onRemoveProject={onRemoveProject}
          settingsOpen={settingsOpen}
          settingsSection={settingsSection}
          onOpenSettings={onOpenSettings}
          onOpenNotificationSettings={onOpenNotificationSettings}
          onSelectSettingsSection={onSelectSettingsSection}
          onCloseSettings={onCloseSettings}
          updateNotice={updateNotice}
          onOpenWhatsNew={onOpenWhatsNew}
          onDismissUpdate={onDismissUpdate}
        />
      ) : null}
      {sidebarVisible ? sidebarContent : null}
      {drawerRendered ? (
        // Pinned to the right edge, so the sidebar slides in as the width grows.
        <div
          ref={drawerRef}
          data-sidebar-drawer={drawerClosing ? "closing" : "open"}
          inert={drawerClosing || undefined}
          className={`flex shrink-0 justify-end overflow-hidden ${
            drawerClosing ? "pointer-events-none" : ""
          }`}
        >
          {sidebarContent}
        </div>
      ) : null}
    </div>
  );
}

export const Sidebar = memo(SidebarComponent);

/** Project picker whose rows open the shared project context menu. */
function SearchableProjectPickerWithMenu({
  onRemoveProject,
  onOpenNotificationSettings,
  ...pickerProps
}: Omit<
  ComponentProps<typeof SearchableProjectPicker>,
  "onProjectContextMenu" | "projectMenuActive"
> & {
  onRemoveProject?: Props["onRemoveProject"];
  onOpenNotificationSettings?: (projectPath?: string) => void;
}) {
  useLocale();
  const projectMenu = useProjectMenu({
    onRemoveProject,
    onOpenNotificationSettings,
  });
  return (
    <>
      <SearchableProjectPicker
        {...pickerProps}
        onProjectContextMenu={projectMenu.open}
        projectMenuActive={projectMenu.isActive}
      />
      {projectMenu.element}
    </>
  );
}

function SidebarProjectPicker({
  cwd,
  recents,
  busy,
  onSelectProject,
  onOpenProject,
  onRemoveProject,
  onNew,
  onSearch,
  onOpenInbox,
  onOpenNotificationSettings,
  onOpenNotes,
  onOpenAutomations,
  onOpenTasks,
  searchActive = false,
  inboxActive = false,
  notesActive = false,
  automationsActive = false,
  tasksActive = false,
  socialActive = false,
  inboxUnseen = false,
}: {
  cwd: string;
  recents: RecentProject[];
  busy: boolean;
  onSelectProject: (path: string) => void;
  onOpenProject?: () => void;
  onRemoveProject?: Props["onRemoveProject"];
  onNew?: () => string | void;
  onSearch?: () => void;
  onOpenInbox?: () => void;
  onOpenNotificationSettings?: (projectPath?: string) => void;
  onOpenNotes?: () => void;
  onOpenAutomations?: () => void;
  onOpenTasks?: () => void;
  searchActive?: boolean;
  inboxActive?: boolean;
  notesActive?: boolean;
  automationsActive?: boolean;
  tasksActive?: boolean;
  socialActive?: boolean;
  inboxUnseen?: boolean;
}) {
  useLocale();
  const [inboxMenu, setInboxMenu] = useState<{ x: number; y: number } | null>(null);
  const inboxTrigger = useRef<HTMLElement | null>(null);
  return (
    <div
      className="@container/picker flex h-9 items-center gap-0.5 border-b border-stroke px-2"
      data-tauri-drag-region="deep"
    >
      <SearchableProjectPickerWithMenu
        cwd={cwd}
        recents={recents}
        busy={busy}
        className="flex-1"
        onSelectProject={onSelectProject}
        onOpenProject={onOpenProject}
        onRemoveProject={onRemoveProject}
        onOpenNotificationSettings={onOpenNotificationSettings}
      />
      <div className="ml-auto flex shrink-0 items-center">
        {onNew ? (
          <IconButton label={t("New tab ({p0}T)", { p0: MOD })} onClick={onNew}>
            <Plus className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {onSearch ? (
          <IconButton
            label={t("Search ({p0}K)", { p0: MOD })}
            active={searchActive}
            onClick={onSearch}
          >
            <Search className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {onOpenInbox ? (
          <WorkspaceFeatureGate id="inbox" active={inboxActive}>
            <IconButton
              label={inboxUnseen ? t("Inbox, new items") : t("Inbox")}
              active={inboxActive}
              onClick={onOpenInbox}
              onOpenContextMenu={(x, y) => {
                inboxTrigger.current =
                  document.activeElement instanceof HTMLElement ? document.activeElement : null;
                setInboxMenu({ x, y });
              }}
            >
              <span className="relative">
                <Inbox className="size-3.5" strokeWidth={1.75} />
                {inboxUnseen ? (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent"
                  />
                ) : null}
              </span>
            </IconButton>
          </WorkspaceFeatureGate>
        ) : null}
        {onOpenNotes ? (
          <span className="contents @max-[230px]/picker:hidden">
            <IconButton label={t("Notes")} active={notesActive} onClick={onOpenNotes}>
              <StickyNote className="size-3.5" strokeWidth={1.75} />
            </IconButton>
          </span>
        ) : null}
        {onOpenAutomations ? (
          <span className="contents @max-[260px]/picker:hidden">
            <WorkspaceFeatureGate id="automations" active={automationsActive}>
              <IconButton
                label={t("Automations")}
                active={automationsActive}
                onClick={onOpenAutomations}
              >
                <Zap className="size-3.5" strokeWidth={1.75} />
              </IconButton>
            </WorkspaceFeatureGate>
          </span>
        ) : null}
        <SocialShortcut active={socialActive} cwd={cwd} compact />
        {onOpenTasks ? (
          <span className="contents @max-[290px]/picker:hidden">
            <WorkspaceFeatureGate id="tasks" active={tasksActive}>
              <IconButton label={t("Tasks")} active={tasksActive} onClick={onOpenTasks}>
                <DashboardSquare className="size-3.5" strokeWidth={1.75} />
              </IconButton>
            </WorkspaceFeatureGate>
          </span>
        ) : null}
      </div>
      {inboxMenu ? (
        <InboxNotificationMenu
          {...inboxMenu}
          projectPaths={[...collectRailProjects(recents, cwd).keys()]}
          onOpenSettings={onOpenNotificationSettings}
          onClose={() => {
            setInboxMenu(null);
            inboxTrigger.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

function CompactProjectRail({
  recoveryControl,
  cwd,
  workingSessionsBadge,
  recents,
  busy,
  tabs,
  activeTab,
  tabShown,
  changesLabel,
  hasChanges,
  inboxUnseen,
  onSelectProject,
  onOpenProject,
  onRemoveProject,
  onTabChange,
  onSearch,
  searchActive,
  onOpenInbox,
  inboxActive,
  onOpenNotificationSettings,
  onOpenNotes,
  notesActive,
  onOpenAutomations,
  onOpenTasks,
  automationsActive,
  tasksActive,
  socialActive,
  onOpenSettings,
  onTogglePanel,
  onLeaveActive,
  titleBarAbove,
  recentSessions,
  activeSessionId,
  onSelectAgent,
}: {
  cwd: string;
  workingSessionsBadge?: ReactNode;
  recoveryControl?: ReactNode;
  recents: RecentProject[];
  busy: boolean;
  tabs: SidebarTab[];
  activeTab: SidebarTab;
  tabShown: boolean;
  changesLabel: string;
  hasChanges: boolean;
  inboxUnseen: boolean;
  onSelectProject?: (path: string) => void;
  onOpenProject?: () => void;
  onRemoveProject?: Props["onRemoveProject"];
  onTabChange: (tab: SidebarTab) => void;
  onSearch?: () => void;
  searchActive: boolean;
  onOpenInbox?: () => void;
  inboxActive: boolean;
  onOpenNotificationSettings?: (projectPath?: string) => void;
  onOpenNotes?: () => void;
  notesActive: boolean;
  onOpenAutomations?: () => void;
  onOpenTasks?: () => void;
  automationsActive: boolean;
  tasksActive: boolean;
  socialActive: boolean;
  onOpenSettings?: () => void;
  onTogglePanel?: () => void;
  onLeaveActive?: () => void;
  titleBarAbove: boolean;
  recentSessions?: RecentSessionsSource;
  activeSessionId?: string;
  onSelectAgent?: (sessionId: string) => void;
}) {
  useLocale();
  const [inboxMenu, setInboxMenu] = useState<{ x: number; y: number } | null>(null);
  const inboxTrigger = useRef<HTMLElement | null>(null);
  const action = (active: boolean, open?: () => void) =>
    active && onLeaveActive ? onLeaveActive : open;
  const workspaceActive =
    !searchActive &&
    !inboxActive &&
    !notesActive &&
    !automationsActive &&
    !tasksActive &&
    !socialActive;
  const openWorkspaceTab = (nextTab: SidebarTab) => {
    if (!workspaceActive) onLeaveActive?.();
    onTabChange(nextTab);
  };

  return (
    <nav
      aria-label={t("Project shortcuts")}
      data-compact-project-rail
      className="sidebar-glass relative flex h-full w-12 shrink-0 flex-col items-center"
    >
      {titleBarAbove ? null : (
        <div
          className="h-10 w-full shrink-0 border-b border-stroke"
          data-tauri-drag-region="deep"
        />
      )}
      <span
        aria-hidden
        data-compact-rail-divider
        className={`pointer-events-none absolute bottom-0 right-0 w-px bg-stroke ${
          titleBarAbove ? "top-0" : "top-10"
        }`}
      />
      <div
        data-compact-rail-actions
        className="flex w-full shrink-0 flex-col items-center gap-1.5 py-1.5"
      >
        {recoveryControl}
        <CompactRailAction label={t("Expand projects")} icon={PanelLeft} onClick={onTogglePanel} />
        {onSelectProject ? (
          <SearchableProjectPickerWithMenu
            cwd={cwd}
            recents={recents}
            busy={busy}
            compact
            className="w-full justify-center"
            onSelectProject={onSelectProject}
            onOpenProject={onOpenProject}
            onRemoveProject={onRemoveProject}
            onOpenNotificationSettings={onOpenNotificationSettings}
          />
        ) : null}
        {recentSessions && onSelectProject ? (
          <CompactLastSessionsAction
            cwd={cwd}
            recents={recents}
            source={recentSessions}
            activeSessionId={activeSessionId}
            searchActive={searchActive}
            onOpenSession={onSelectAgent}
            onOpenProject={onSelectProject}
          />
        ) : null}
        <div
          role="tablist"
          aria-label={t("Workspace")}
          aria-orientation="vertical"
          className="flex flex-col items-center gap-1.5"
        >
          {tabs.map((itemId) => (
            <CompactRailAction
              key={itemId}
              tab
              usageGuideTarget={itemId === "changes" ? "changes" : undefined}
              label={itemId === "changes" ? changesLabel : TAB_LABELS[itemId]}
              icon={COMPACT_TAB_ICONS[itemId]}
              active={workspaceActive && tabShown && activeTab === itemId}
              dot={itemId === "changes" && hasChanges}
              badge={itemId === "sessions" ? workingSessionsBadge : undefined}
              onClick={() => openWorkspaceTab(itemId)}
            />
          ))}
        </div>
        <CompactRailAction
          label={t("Search ({p0}K)", { p0: MOD })}
          icon={Search}
          active={searchActive}
          onClick={action(searchActive, onSearch)}
        />
        <WorkspaceFeatureGate id="inbox" active={inboxActive}>
          <CompactRailAction
            label={inboxUnseen ? t("Inbox, new items") : t("Inbox")}
            icon={Inbox}
            active={inboxActive}
            dot={inboxUnseen}
            onClick={action(inboxActive, onOpenInbox)}
            onOpenContextMenu={(x, y) => {
              inboxTrigger.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
              setInboxMenu({ x, y });
            }}
          />
        </WorkspaceFeatureGate>
        {onOpenNotes ? (
          <CompactRailAction
            label={t("Notes")}
            icon={StickyNote}
            active={notesActive}
            onClick={action(notesActive, onOpenNotes)}
          />
        ) : null}
        <WorkspaceFeatureGate id="automations" active={automationsActive}>
          <CompactRailAction
            label={t("Automations")}
            icon={Zap}
            active={automationsActive}
            onClick={action(automationsActive, onOpenAutomations)}
          />
        </WorkspaceFeatureGate>
        <SocialShortcut active={socialActive} cwd={cwd} rail />
        <WorkspaceFeatureGate id="tasks" active={tasksActive}>
          <CompactRailAction
            label={t("Tasks")}
            icon={DashboardSquare}
            active={tasksActive}
            onClick={action(tasksActive, onOpenTasks)}
          />
        </WorkspaceFeatureGate>
      </div>
      <div className="min-h-2 flex-1" />
      <div className="flex w-full flex-col items-center gap-1 py-1.5">
        <CompactRailAction
          label={t("Settings ({p0},)", { p0: MOD })}
          icon={Settings}
          onClick={onOpenSettings}
        />
      </div>
      {inboxMenu ? (
        <InboxNotificationMenu
          {...inboxMenu}
          projectPaths={[...collectRailProjects(recents, cwd).keys()]}
          onOpenSettings={onOpenNotificationSettings}
          onClose={() => {
            setInboxMenu(null);
            inboxTrigger.current?.focus();
          }}
        />
      ) : null}
    </nav>
  );
}

function CompactRailAction({
  label,
  usageGuideTarget,
  icon: Icon,
  tab = false,
  active = false,
  dot = false,
  badge,
  onClick,
  onOpenContextMenu,
  ref,
}: {
  label: string;
  usageGuideTarget?: string;
  icon: typeof PanelLeft;
  tab?: boolean;
  active?: boolean;
  dot?: boolean;
  badge?: ReactNode;
  onClick?: () => void;
  onOpenContextMenu?: (x: number, y: number) => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  useLocale();
  return (
    <Button
      variant="ghost"
      motion="none"
      ref={ref}
      data-usage-guide={usageGuideTarget}
      type="button"
      role={tab ? "tab" : undefined}
      title={label}
      aria-label={label}
      aria-selected={tab ? active : undefined}
      aria-pressed={tab ? undefined : active}
      disabled={!onClick}
      onClick={onClick}
      onContextMenu={
        onOpenContextMenu
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.focus();
              onOpenContextMenu(event.clientX, event.clientY);
            }
          : undefined
      }
      onKeyDown={
        onOpenContextMenu
          ? (event) => {
              if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.focus();
              const rect = event.currentTarget.getBoundingClientRect();
              onOpenContextMenu(rect.right, rect.top);
            }
          : undefined
      }
      className={`relative grid shrink-0 place-items-center `}
    >
      <Icon className={`size-4 ${dot ? "compact-rail-icon-with-dot" : ""}`} strokeWidth={1.75} />
      {dot ? (
        <span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" />
      ) : null}
      {badge ? (
        <span className="pointer-events-none absolute -right-1 -top-1 [&>span]:ml-0 [&>span]:h-4 [&>span]:min-w-4 [&>span]:text-[10px]">
          {badge}
        </span>
      ) : null}
    </Button>
  );
}

/** The compact rail's own way into "Last sessions": a button that opens the list in a popover, since there's no room for the full section. */
function CompactLastSessionsAction({
  cwd,
  recents,
  source,
  activeSessionId,
  searchActive,
  onOpenSession,
  onOpenProject,
}: {
  cwd: string;
  recents: RecentProject[];
  source: RecentSessionsSource;
  activeSessionId?: string;
  searchActive: boolean;
  onOpenSession?: (sessionId: string) => void;
  onOpenProject: (path: string) => void;
}) {
  useLocale();
  const projectKeys = useMemo(
    () => new Set(collectRailProjects(recents, cwd).keys()),
    [recents, cwd],
  );
  const { rows, hasRows, togglePin } = useLastSessionsRows({
    source,
    projectKeys,
    enabled: true,
  });
  const [groupLabels] = useState(loadTabGroupLabels);
  const [groupColors] = useState(loadTabGroupColors);
  const [groupCustomColors] = useState(loadTabGroupCustomColors);
  const [groupMascots] = useState(loadTabGroupMascots);
  const groupLogos = useTabGroupLogos();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!hasRows) return null;

  return (
    <>
      <CompactRailAction
        ref={anchor}
        label={t("Last sessions")}
        icon={Clock}
        active={open}
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <Popover
          anchor={anchor}
          side="right"
          align="start"
          width={280}
          onDismiss={() => setOpen(false)}
          role="menu"
          aria-label={t("Last sessions")}
          className="p-1"
        >
          <LastSessionsRows
            rows={rows}
            activeSessionId={activeSessionId}
            searchActive={searchActive}
            onOpenSession={(sessionId) => {
              setOpen(false);
              onOpenSession?.(sessionId);
            }}
            onOpenProject={(path) => {
              setOpen(false);
              onOpenProject(path);
            }}
            onTogglePin={togglePin}
            className="flex max-h-80"
            groupLabels={groupLabels}
            groupColors={groupColors}
            groupCustomColors={groupCustomColors}
            groupLogos={groupLogos}
            groupMascots={groupMascots}
          />
        </Popover>
      ) : null}
    </>
  );
}

function WorkspaceTitleActions({ onSearch, onNew }: { onSearch?: () => void; onNew?: () => void }) {
  useLocale();
  if (!onSearch && !onNew) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-tauri-drag-region="false">
      {onSearch ? (
        <IconButton label={t("Go to File ({p0}P)", { p0: MOD })} onClick={onSearch}>
          <Search className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      ) : null}
      {onNew ? (
        <IconButton label={t("New session ({p0}T)", { p0: MOD })} onClick={onNew}>
          <Plus className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      ) : null}
    </div>
  );
}

function BulkBarAction({
  label,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  useLocale();
  return (
    <Button
      tone={danger ? "danger" : "neutral"}
      iconOnly
      label={t("{p0} selected", { p0: label })}
      variant="ghost"
      motion="none"
      type="button"
      title={t("{p0} selected", { p0: label })}
      aria-label={t("{p0} selected", { p0: label })}
      disabled={disabled}
      onClick={onClick}
      className={`grid place-items-center disabled:pointer-events-none `}
    >
      {children}
    </Button>
  );
}

function SessionsHeaderButton({
  label,
  active = false,
  open = false,
  hasPopup = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  open?: boolean;
  hasPopup?: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  useLocale();
  return (
    <Button
      iconOnly
      label={label}
      selected={open || active}
      variant="ghost"
      motion="none"
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={open}
      aria-haspopup={hasPopup ? "menu" : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={`relative z-50 grid place-items-center `}
    >
      {children}
    </Button>
  );
}

type FolderEntry = Extract<SessionListEntry, { kind: "folder" }>;

type SessionListHit =
  | { kind: "folder"; id: string }
  | { kind: "pinned" }
  | { kind: "card"; id: string; place: "before" | "after"; middle: boolean };

function sessionListHitFromPoint(x: number, y: number, draggedId: string): SessionListHit | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (el.closest("[data-reminder-sessions]")) return null;
  const card = el.closest("[data-session-card]") as HTMLElement | null;
  const cardId = card?.dataset.sessionCard;
  if (card && cardId) {
    if (cardId === draggedId) return null;
    const rect = card.getBoundingClientRect();
    const at = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
    return {
      kind: "card",
      id: cardId,
      place: at < 0.5 ? "before" : "after",
      middle: at > 0.25 && at < 0.75,
    };
  }
  // A folder inside the pinned group takes the drop before the group does.
  const folderId = (el.closest("[data-session-folder]") as HTMLElement | null)?.dataset
    .sessionFolder;
  if (folderId) return { kind: "folder", id: folderId };
  return el.closest("[data-pinned-sessions]") ? { kind: "pinned" } : null;
}

function folderMoveTargetAt(
  x: number,
  y: number,
  list: HTMLElement | null,
): FolderMoveTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el || !list?.contains(el) || el.closest("[data-reminder-sessions]")) return null;
  const folder = el.closest("[data-session-folder]") as HTMLElement | null;
  const id = folder?.dataset.sessionFolder;
  if (folder && id) {
    const row = el.closest("[data-folder-row]");
    if (row && folder.contains(row) && row.closest("[data-session-folder]") === folder) {
      const rect = row.getBoundingClientRect();
      const at = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
      if (at < 0.3) return { kind: "beside", id, place: "before" };
      if (at > 0.7 && folder.dataset.folderCollapsed === "true") {
        return { kind: "beside", id, place: "after" };
      }
    }
    return { kind: "into", id };
  }
  return el.closest("[data-pinned-sessions]") ? { kind: "pinned" } : { kind: "root" };
}

function folderMoveLabel(target: FolderMoveTarget): string {
  switch (target.kind) {
    case "into":
      return t("Release to add to the folder");
    case "beside":
      return t("Release to move here");
    case "pinned":
      return t("Release to pin");
    case "root":
      return t("Release to move to the top level");
  }
}

function sameDropTarget(a: SessionListDropTarget | null, b: SessionListDropTarget | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "pinned") return true;
  if (a.kind === "insert" && b.kind === "insert") {
    return a.id === b.id && a.place === b.place && !!a.dwell === !!b.dwell;
  }
  return (a as { id: string }).id === (b as { id: string }).id;
}

function dropTargetLabel(target: SessionListDropTarget): string {
  switch (target.kind) {
    case "session":
      return t("Release to group");
    case "pinned":
      return t("Release to pin");
    case "folder":
      return t("Release to add to the folder");
    case "insert":
      return target.dwell ? t("Hold to group") : t("Release to move here");
  }
}

function FolderColorSwatches({
  colorIndex,
  customColor,
  onChange,
  onCustomChange,
}: {
  colorIndex: number | undefined;
  customColor: string | undefined;
  onChange: (index: number | null) => void;
  onCustomChange: (color: string) => void;
}) {
  useLocale();
  const paletteColor = colorIndex != null ? TAB_GROUP_COLORS[colorIndex] : TAB_GROUP_COLORS[0];
  const pickerValue = customColor ?? normalizeHex(paletteColor ?? TAB_GROUP_COLORS[0]);
  return (
    <div className="px-1 py-1">
      <ColorSwatchRow
        colors={TAB_GROUP_COLORS}
        colorIndex={colorIndex}
        customColor={customColor}
        customPickerOpen
        customHighlighted={customColor != null}
        onPickIndex={(index) => onChange(index === 0 ? null : index)}
      />
      <ColorPickerPopover value={pickerValue} onChange={onCustomChange} />
    </div>
  );
}

function FolderRow({
  folder,
  sessions,
  expanded,
  dropTarget,
  busy,
  done,
  needsApproval,
  groupIcon,
  onPointerDown,
  onToggle,
  onContextMenu,
  onRename,
}: {
  folder: Pick<SessionFolder, "name" | "colorIndex" | "customColor">;
  sessions: SessionSummary[];
  expanded: boolean;
  dropTarget: boolean;
  busy: boolean;
  done: boolean;
  needsApproval: boolean;
  groupIcon?: ReactNode;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onToggle: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onRename?: () => void;
}) {
  useLocale();
  const count = sessions.length;
  const accent = folderAccent(folder.colorIndex, folder.customColor);
  return (
    <Button
      selected={expanded || dropTarget}
      variant="ghost"
      motion="none"
      type="button"
      title={folder.name}
      data-folder-row=""
      aria-expanded={expanded}
      data-tauri-drag-region="false"
      onPointerDown={onPointerDown}
      onClick={onToggle}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === "F2" && onRename) {
          event.preventDefault();
          onRename();
        }
      }}
      className={`group relative flex w-full touch-none items-center gap-1.5  `}
    >
      <div
        data-drop-highlight={dropTarget ? "true" : "false"}
        className="pointer-events-none absolute inset-0 hidden rounded-md bg-accent/20 data-[drop-highlight=true]:block"
      />
      <span
        className={`relative grid size-4 shrink-0 place-items-center ${
          accent ? "" : "text-content/50"
        }`}
        style={accent ? { color: accent } : undefined}
      >
        {expanded ? (
          groupIcon ? (
            <>
              <span className="group-hover:hidden group-focus-visible:hidden">{groupIcon}</span>
              <ChevronDown
                className="hidden size-3.5 text-content group-hover:block group-focus-visible:block"
                strokeWidth={1.75}
              />
            </>
          ) : (
            <ChevronDown className="size-3.5 text-content" strokeWidth={1.75} />
          )
        ) : (
          <>
            <span className="group-hover:hidden group-focus-visible:hidden">
              {groupIcon ?? <Folder className="size-3.5 text-content" strokeWidth={1.75} />}
            </span>
            <ChevronRight
              className="hidden size-3.5 group-hover:block group-focus-visible:block text-content"
              strokeWidth={1.75}
            />
          </>
        )}
      </span>
      <span className="relative min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug text-content">
        {folder.name}
      </span>
      <span className="relative flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-content/45">
        {!expanded && needsApproval ? (
          <CircleAlert className="size-3 text-warning" strokeWidth={1.75} />
        ) : !expanded && busy ? (
          <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none text-active" />
        ) : !expanded && done ? (
          <Check className="size-3 text-success" strokeWidth={2.25} />
        ) : null}
        <span>{count}</span>
      </span>
    </Button>
  );
}

function FolderRenameRow({
  folder,
  memberCount,
  dropTarget,
  onCommit,
  onCancel,
}: {
  folder: SessionFolder;
  memberCount: number;
  dropTarget: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(folder.name);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const finish = (success: boolean) => {
    if (finished.current) return;
    if (success) {
      const trimmed = value.trim();
      if (!trimmed) {
        onCancel();
        return;
      }
      finished.current = true;
      onCommit(trimmed);
      return;
    }
    finished.current = true;
    onCancel();
  };

  return (
    <div
      className={`relative flex w-full items-center gap-1.5 px-2 py-1.5 ${
        dropTarget ? "" : "text-content"
      }`}
    >
      <div
        data-drop-highlight={dropTarget ? "true" : "false"}
        className="pointer-events-none absolute inset-0 hidden rounded-md bg-accent/20 data-[drop-highlight=true]:block"
      />
      <span className="relative grid size-4 shrink-0 place-items-center text-content/50">
        <ChevronDown className="size-3.5" strokeWidth={1.75} />
      </span>
      <TextField
        fieldClassName="min-w-0 flex-1"
        hideLabel
        label={t("Name")}
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        }}
        className="relative min-w-0 flex-1 leading-snug"
      />
      <span className="relative shrink-0 text-[11px] tabular-nums text-content/45">
        {memberCount}
      </span>
    </div>
  );
}

const SESSION_PREFETCH_DELAY_MS = 120;
/** Rows created this recently slide in; older ones are just being listed. */
const SESSION_INSERT_WINDOW_MS = 15_000;

type SessionInsertMotion = { cwd: string; since: number; seen: Set<string> };

/** List row that grows open when a new session lands, pushing rows below it down. */
function SessionListItem({
  session,
  cwd,
  motion,
  children,
}: {
  session: SessionSummary;
  cwd: string;
  motion: RefObject<SessionInsertMotion>;
  children: ReactNode;
}) {
  useLocale();
  const ref = useRef<HTMLLIElement>(null);
  // Decided once per row: effects can replay (StrictMode, reordering), and a
  // row that already slid in must not do it again.
  const played = useRef(false);
  useLayoutEffect(() => {
    if (played.current) return;
    played.current = true;
    const state = motion.current;
    const fresh =
      state.cwd === cwd &&
      !state.seen.has(session.id) &&
      !document.hidden &&
      ((session.createdAt === 0 && !remoteProjectFor(session.cwd)) ||
        (session.createdAt >= state.since &&
          Date.now() - session.createdAt < SESSION_INSERT_WINDOW_MS));
    state.seen.add(session.id);
    const el = ref.current;
    const content = el?.firstElementChild;
    if (
      !fresh ||
      !el ||
      !(content instanceof HTMLElement) ||
      typeof el.animate !== "function" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    // The card takes its place at once; everything below starts where it was
    // and slides down, uncovering it as it fades in.
    const offset =
      el.offsetHeight + (parseFloat(getComputedStyle(el.parentElement ?? el).rowGap) || 0);
    const animations: Animation[] = [];
    const timing = {
      duration: 380,
      easing: "cubic-bezier(0.32, 0.72, 0, 1)",
    };
    for (
      let node: Element | null = el;
      node && !node.hasAttribute("data-session-list");
      node = node.parentElement
    ) {
      for (let below = node.nextElementSibling; below; below = below.nextElementSibling) {
        if (!(below instanceof HTMLElement)) continue;
        animations.push(
          below.animate(
            [{ transform: `translateY(${-offset}px)` }, { transform: "none" }],
            // Stack with a push already in flight instead of restarting it.
            { ...timing, composite: "add" },
          ),
        );
      }
    }
    animations.push(
      content.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 220,
        easing: "ease-out",
      }),
    );
    // Web Animations rejects finished on cancellation; teardown is expected.
    for (const animation of animations) void animation?.finished?.catch(() => undefined);
    const stop = () => animations.forEach((animation) => animation?.cancel());
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, []);
  return <li ref={ref}>{children}</li>;
}

/** How long a still press takes to start selecting. */
const LONG_PRESS_MS = 450;

const SessionCard = memo(function SessionCard({
  session,
  isActive,
  isSelected,
  selectionMode = false,
  busy,
  opening = false,
  done,
  linkedUpdate,
  needsApproval,
  dropTarget,
  dropInsert,
  dropDwell = false,
  groupDelayMs,
  density,
  showModel,
  showBranch,
  onSelect,
  onLongPress,
  onOpenWorkItem,
  onPrefetch,
  onPlaceOnPane,
  onPopOut,
  onListDrop,
  onListDropTargetChange,
  onContextMenu,
  onArchive,
  onRename,
  onDelete,
}: {
  session: SessionSummary;
  isActive: boolean;
  isSelected: boolean;
  selectionMode?: boolean;
  busy: boolean;
  /** Clicked and still loading before it opens. */
  opening?: boolean;
  done: boolean;
  linkedUpdate: boolean;
  needsApproval: boolean;
  /** Ready to group with the dragged session. */
  dropTarget?: boolean;
  /** The dragged session would land on this side of the card. */
  dropInsert?: "before" | "after";
  /** The dragged session rests on this card, counting down to grouping. */
  dropDwell?: boolean;
  groupDelayMs: number;
  density: SessionListDensity;
  showModel: boolean;
  showBranch: boolean;
  onSelect: (
    sessionId: string,
    event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  ) => void;
  /** Held without moving: start selecting from this card. */
  onLongPress?: (sessionId: string) => void;
  onOpenWorkItem?: (item: LinkedWorkItem, sessionId: string) => void;
  onPrefetch?: (sessionId: string) => void;
  onPlaceOnPane?: (sessionId: string, targetId: string, edge: PaneEdge) => void;
  onPopOut?: (sessionId: string, position: WindowMovePosition) => void;
  onListDrop?: (draggedId: string, target: SessionListDropTarget) => void;
  onListDropTargetChange?: (target: SessionListDropTarget | null) => void;
  onContextMenu?: (sessionId: string, e: ReactMouseEvent<HTMLDivElement>) => void;
  onArchive?: (sessionId: string, archived: boolean) => void;
  onRename?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
}) {
  "use memo";
  useLocale();
  const skipClickUntil = useRef(0);
  const skipNextClick = useRef(false);
  const cancelSessionDrag = useRef<(() => void) | null>(null);
  const cancelLongPress = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      cancelSessionDrag.current?.();
      cancelLongPress.current?.();
    },
    [],
  );
  const [pressing, setPressing] = useState(false);
  const prefetchTimer = useRef<number | null>(null);
  const orchestrationTooltipRootRef = useRef<HTMLDivElement>(null);
  const orchestrationTooltipId = useId();
  const [dragging, setDragging] = useState(false);
  const [orchestrationTooltipOpen, setOrchestrationTooltipOpen] = useState(false);
  const orchestration = session.orchestration;
  const draft = !!session.draft;
  const orchestrationExpanded = !!orchestration && (isActive || isSelected || busy);
  const orchestrationDone =
    orchestration?.tasks.filter((task) => task.status === "completed").length ?? 0;
  const title = sessionDisplayTitle(session.title, session.harness);
  const gitLabel = session.worktreeRemoved
    ? NO_BRANCH_LABEL
    : formatGitLabel(session.repo, session.branch);
  const compact = density === "compact";
  const model = resolveModel(session.harness, session.model).name;
  const worktree = !!session.worktreeCwd && !session.worktreeRemoved;
  // Standard rows name the branch only; the repo prefix needs its own line.
  const branchText =
    density === "detailed" || session.worktreeRemoved ? gitLabel : session.branch || gitLabel;
  const issue = session.issue;
  const statusTone: BadgeTone =
    issue === "failed"
      ? "danger"
      : issue === "retrying" || needsApproval
        ? "warning"
        : busy
          ? "info"
          : done
            ? "success"
            : "neutral";
  const status =
    !issue && !needsApproval && !busy && !opening && !done && !draft ? (
      <span className="shrink-0 text-[11px] tabular-nums text-(--ui-text-secondary)">
        <RelativeSessionTime at={session.updatedAt} />
      </span>
    ) : (
      <Badge tone={statusTone} className="shrink-0 tabular-nums">
        {issue ? (
          <>
            <CircleAlert className="size-3" strokeWidth={1.75} />
            <span>{t(issue === "retrying" ? "Retrying" : "Failed")}</span>
          </>
        ) : needsApproval ? (
          <>
            <CircleAlert className="size-3" strokeWidth={1.75} />
            <span>{orchestration ? t("Needs input") : t("Need approval")}</span>
          </>
        ) : busy ? (
          <>
            <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none text-active" />
            <span>{t("Working...")}</span>
          </>
        ) : opening ? (
          <>
            <Loader className="size-3 motion-safe:animate-spin" strokeWidth={1.75} aria-hidden />
            <span>{t("Opening…")}</span>
          </>
        ) : done ? (
          <>
            <Check className="size-3" strokeWidth={2.25} />
            <span>{t("Done")}</span>
          </>
        ) : draft ? (
          <>
            <CircleDashed className="size-3" strokeWidth={1.75} />
            <span>{t("Draft")}</span>
          </>
        ) : (
          <RelativeSessionTime at={session.updatedAt} />
        )}
      </Badge>
    );

  const linkedWorkItem = session.linkedWorkItem;
  const linkedUpdateDot = linkedUpdate ? (
    <span
      title={t(
        linkedWorkItem?.kind === "pr"
          ? "Linked PR updated since this session"
          : "Linked issue updated since this session",
      )}
      aria-label={t("Linked work item updated")}
      className="size-1.5 shrink-0 rounded-full bg-accent"
    />
  ) : null;
  const workItemBadge = linkedWorkItem ? (
    <Button
      variant="ghost"
      motion="none"
      type="button"
      data-no-drag
      data-tauri-drag-region="false"
      title={t(
        linkedWorkItem.kind === "pr"
          ? "Open PR #{p1} beside this session ({p2}-click for GitHub)"
          : "Open issue #{p1} beside this session ({p2}-click for GitHub)",
        { p1: linkedWorkItem.number, p2: MOD },
      )}
      aria-label={t(linkedWorkItem.kind === "pr" ? "Open PR #{p1}" : "Open issue #{p1}", {
        p1: linkedWorkItem.number,
      })}
      onMouseEnter={() => {
        if (onOpenWorkItem) prefetchGithubWorkItem(session.cwd, linkedWorkItem);
      }}
      onFocus={() => {
        if (onOpenWorkItem) prefetchGithubWorkItem(session.cwd, linkedWorkItem);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.metaKey || event.ctrlKey) {
          void openUrl(linkedWorkItem.url).catch(() => undefined);
          return;
        }
        if (onOpenWorkItem) onOpenWorkItem(linkedWorkItem, session.id);
        else void openUrl(linkedWorkItem.url).catch(() => undefined);
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        void openUrl(linkedWorkItem.url).catch(() => undefined);
      }}
      className="flex shrink-0 items-center gap-0.5 tabular-nums"
    >
      {linkedWorkItem.kind === "pr" ? (
        <GitPullRequest className="size-3" strokeWidth={1.75} />
      ) : (
        <CircleDot className="size-3" strokeWidth={1.75} />
      )}
      <span>#{linkedWorkItem.number}</span>
    </Button>
  ) : null;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(session.id, e);
      return;
    }
    if (e.key === "F2" && onRename) {
      e.preventDefault();
      onRename(session.id);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && onDelete) {
      e.preventDefault();
      onDelete(session.id);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Warm the transcript during the press. Opening stays on click so a
    // drag-to-pane gesture does not switch conversations.
    if (prefetchTimer.current != null) {
      window.clearTimeout(prefetchTimer.current);
      prefetchTimer.current = null;
    }
    onPrefetch?.(session.id);
    startLongPress(event);
    if (!onPlaceOnPane && !onListDrop && !onPopOut) return;
    cancelSessionDrag.current?.();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let lastX = startX;
    let lastY = startY;
    let screenX = event.screenX;
    let screenY = event.screenY;
    let lastList: SessionListDropTarget | null = null;
    // Runs on time, not movement: a pointer held still sends no events.
    let dwell: { id: string; ready: boolean; timer: number } | null = null;
    handle.setPointerCapture(pointerId);
    const restoreSelection = suppressTextSelection();

    const setListTarget = (next: SessionListDropTarget | null) => {
      if (sameDropTarget(lastList, next)) return;
      lastList = next;
      onListDropTargetChange?.(next);
    };
    const clearDwell = () => {
      if (dwell) window.clearTimeout(dwell.timer);
      dwell = null;
    };
    const listTargetAt = (x: number, y: number): SessionListDropTarget | null => {
      const hit = onListDrop ? sessionListHitFromPoint(x, y, session.id) : null;
      if (hit?.kind !== "card" || !hit.middle) clearDwell();
      if (!hit || hit.kind !== "card") return hit;
      if (!hit.middle) return { kind: "insert", id: hit.id, place: hit.place };
      if (dwell?.id !== hit.id) {
        clearDwell();
        const id = hit.id;
        const timer = window.setTimeout(() => {
          if (dwell?.id !== id) return;
          dwell.ready = true;
          const ready: SessionListDropTarget = { kind: "session", id };
          setListTarget(ready);
          setDropFeedback("move", { clientX: lastX, clientY: lastY }, dropTargetLabel(ready));
        }, groupDelayMs);
        dwell = { id, ready: false, timer };
      }
      return dwell.ready
        ? { kind: "session", id: hit.id }
        : { kind: "insert", id: hit.id, place: hit.place, dwell: true };
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      screenX = ev.screenX;
      screenY = ev.screenY;
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        cancelLongPress.current?.();
        active = true;
        setDragging(true);
        setGrabbing(true);
        if (onPlaceOnPane) {
          setExternalPaneDrop({
            fromId: session.id,
            overId: null,
            edge: "left",
          });
        }
      }
      setListTarget(listTargetAt(ev.clientX, ev.clientY));
      if (
        onPopOut &&
        isPointerOutsideWindow(ev.clientX, ev.clientY, window.innerWidth, window.innerHeight)
      ) {
        setDropFeedback("window", ev, busy ? "Move after response finishes" : undefined);
        setExternalPaneDrop(null);
        return;
      }
      if (lastList) {
        setDropFeedback("move", ev, dropTargetLabel(lastList));
        setExternalPaneDrop(null);
        return;
      }
      if (!onPlaceOnPane) {
        setDropFeedback("blocked", ev);
        return;
      }
      const over = paneDropFromPoint(ev.clientX, ev.clientY);
      if (!over || over.id === session.id) {
        setDropFeedback("blocked", ev);
        setExternalPaneDrop({
          fromId: session.id,
          overId: over?.id === session.id ? session.id : null,
          edge: over?.edge ?? "left",
        });
        return;
      }
      setExternalPaneDrop({
        fromId: session.id,
        overId: over.id,
        edge: over.edge,
      });
      setDropFeedback("move", ev, `Place ${over.edge}`);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      onMove(ev);
      finish(true);
    };
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      finish(false);
    };

    function finish(commit: boolean) {
      const listOver = lastList;
      clearDwell();
      cancelSessionDrag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      restoreSelection();
      setDragging(false);
      setGrabbing(false);
      setExternalPaneDrop(null);
      setListTarget(null);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      if (!active) return;
      skipClickUntil.current = performance.now() + 400;
      if (!commit) return;
      if (onPopOut && isPointerOutsideWindow(lastX, lastY, window.innerWidth, window.innerHeight)) {
        onPopOut(session.id, {
          ...popOutPosition(screenX, screenY),
          clientX: lastX,
          clientY: lastY,
        });
        return;
      }
      if (listOver) {
        onListDrop?.(session.id, listOver);
        return;
      }
      const over = paneDropFromPoint(lastX, lastY);
      if (over && over.id !== session.id) {
        onPlaceOnPane?.(session.id, over.id, over.edge);
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    cancelSessionDrag.current = onCancel;
  };

  // A still press of LONG_PRESS_MS selects the card. Moving first is a drag,
  // releasing first is a click; either cancels it.
  function startLongPress(event: ReactPointerEvent<HTMLDivElement>) {
    cancelLongPress.current?.();
    skipNextClick.current = false;
    if (!onLongPress || selectionMode || event.shiftKey || event.ctrlKey || event.metaKey) return;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const timer = window.setTimeout(() => {
      stop();
      skipNextClick.current = true;
      cancelSessionDrag.current?.();
      onLongPress(session.id);
    }, LONG_PRESS_MS);
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) >= 5) stop();
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) stop();
    };
    function stop() {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      cancelLongPress.current = null;
      setPressing(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    cancelLongPress.current = stop;
    setPressing(true);
  }

  useEffect(
    () => () => {
      if (prefetchTimer.current != null) {
        window.clearTimeout(prefetchTimer.current);
        prefetchTimer.current = null;
      }
    },
    [onPrefetch, session.id],
  );

  const schedulePrefetch = () => {
    if (!onPrefetch || prefetchTimer.current != null) return;
    prefetchTimer.current = window.setTimeout(() => {
      prefetchTimer.current = null;
      onPrefetch(session.id);
    }, SESSION_PREFETCH_DELAY_MS);
  };

  const cancelScheduledPrefetch = () => {
    if (prefetchTimer.current == null) return;
    window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = null;
  };

  const archiveLabel = session.archived ? "Unarchive" : "Archive";
  // Expanding an orchestration card must not move its existing header. Keep
  // the collapsed top inset and give only the new detail area extra room at
  // the bottom.
  const cardPaddingY = orchestrationExpanded
    ? compact
      ? "pb-2.5 pt-1"
      : "pb-2.5 pt-1.5"
    : compact
      ? "py-1"
      : "py-1.5";

  const modelLabel = showModel ? (
    <span
      data-session-row-model
      title={model}
      className="flex min-w-0 shrink items-center gap-1 text-[11px] font-medium text-content/55"
    >
      <HarnessIcon harness={session.harness} className="size-3 shrink-0" />
      {compact ? null : <span className="session-row-model-full min-w-0 truncate">{model}</span>}
      <span
        className={`min-w-0 truncate ${compact ? "session-row-compact-model" : "session-row-model-short"}`}
      >
        {shortModelName(model)}
      </span>
    </span>
  ) : null;
  const BranchIcon = worktree ? FolderTree : GitBranch;
  const branchLabel =
    showBranch && !compact && branchText ? (
      <span
        data-session-row-branch
        className="session-row-branch flex min-w-0 items-center gap-1 text-[11px] text-content/45"
        title={session.worktreeCwd ? `${gitLabel}\n${session.worktreeCwd}` : gitLabel}
      >
        <BranchIcon className="size-3 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 truncate">{branchText}</span>
      </span>
    ) : null;
  const actions = (
    <span data-session-row-actions className="relative flex shrink-0 items-center gap-px">
      {onArchive ? (
        <Button
          iconOnly
          label={`${archiveLabel} ${title}`}
          variant="ghost"
          motion="none"
          type="button"
          data-no-drag
          data-tauri-drag-region="false"
          title={archiveLabel}
          aria-label={`${archiveLabel} ${title}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onArchive(session.id, !session.archived);
          }}
          className="pointer-events-none grid size-5 place-items-center opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
        >
          <Archive className="size-3 shrink-0" strokeWidth={1.75} />
        </Button>
      ) : null}
      {onDelete ? (
        <Button
          iconOnly
          label={`${t("Delete")} ${title}`}
          variant="ghost"
          motion="none"
          type="button"
          data-no-drag
          data-tauri-drag-region="false"
          title={t("Delete")}
          aria-label={`${t("Delete")} ${title}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onDelete(session.id);
          }}
          className="pointer-events-none grid size-5 place-items-center opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
        >
          <Trash2 className="size-3 shrink-0" strokeWidth={1.75} />
        </Button>
      ) : null}
      {workItemBadge}
      {session.automationId ? (
        <span
          data-automation-icon
          role="img"
          title={t("Started by an automation")}
          aria-label={t("Started by an automation")}
          className="grid size-5 -mr-1 shrink-0 place-items-center text-warning"
        >
          <Zap className="size-3" strokeWidth={1.75} />
        </span>
      ) : null}
      {orchestration ? (
        <div
          ref={orchestrationTooltipRootRef}
          className="relative shrink-0"
          onMouseEnter={() => setOrchestrationTooltipOpen(true)}
          onMouseLeave={() => setOrchestrationTooltipOpen(false)}
        >
          <Button
            iconOnly
            label={t(
              orchestration.tasks.length === 1
                ? "Orchestrator, {p0} subagent, {p2} done"
                : "Orchestrator, {p0} subagents, {p2} done",
              { p0: orchestration.tasks.length, p2: orchestrationDone },
            )}
            variant="ghost"
            motion="none"
            type="button"
            data-no-drag
            data-tauri-drag-region="false"
            data-orchestration-icon
            title=""
            aria-label={t(
              orchestration.tasks.length === 1
                ? "Orchestrator, {p0} subagent, {p2} done"
                : "Orchestrator, {p0} subagents, {p2} done",
              { p0: orchestration.tasks.length, p2: orchestrationDone },
            )}
            aria-describedby={orchestrationTooltipOpen ? orchestrationTooltipId : undefined}
            onPointerDown={(event) => event.stopPropagation()}
            onFocus={() => setOrchestrationTooltipOpen(true)}
            onBlur={() => setOrchestrationTooltipOpen(false)}
            onClick={(event) => {
              event.stopPropagation();
              setOrchestrationTooltipOpen(false);
              onSelect(session.id, event);
            }}
            className="grid shrink-0 place-items-center"
          >
            <Share className="size-3" />
          </Button>
        </div>
      ) : null}
    </span>
  );
  // Fixed-height lines: the hover-only actions never change the row height.
  const metaLine = (children: ReactNode) => (
    <span className="relative flex h-5 min-w-0 items-center gap-1.5">{children}</span>
  );

  return (
    <div className="group relative">
      <div
        title={title}
        data-session-card={session.id}
        data-session-density={density}
        data-orchestration-card={orchestration ? "true" : undefined}
        data-session-selected={isSelected ? "true" : undefined}
        data-tauri-drag-region="false"
        onPointerDown={onPointerDown}
        onDragStart={(event) => event.preventDefault()}
        onPointerEnter={schedulePrefetch}
        onPointerLeave={cancelScheduledPrefetch}
        onClick={(event) => {
          if (skipNextClick.current) {
            skipNextClick.current = false;
            return;
          }
          if (performance.now() < skipClickUntil.current) return;
          onSelect(session.id, event);
        }}
        onContextMenu={onContextMenu ? (event) => onContextMenu(session.id, event) : undefined}
        className={`relative border flex w-full ${onPlaceOnPane || onListDrop || onPopOut ? "cursor-grab" : "cursor-default"} select-none touch-none flex-col rounded-md px-2.5 text-left ${cardPaddingY} ${
          dragging ? "opacity-40" : ""
        } ${draft && !dropTarget ? "border-dashed border-content/25" : "border-transparent"} ${
          dropTarget
            ? "text-content"
            : isSelected
              ? "bg-accent/15 text-content"
              : pressing
                ? "bg-content/10 text-content transition-colors duration-500 ease-linear"
                : isActive
                  ? "bg-selection text-content"
                  : "text-content/80 hover:bg-content/5 hover:text-content"
        }`}
      >
        {dropTarget ? (
          <div className="pointer-events-none absolute inset-0 rounded-md bg-accent/20" />
        ) : null}
        {isSelected ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent"
          />
        ) : null}
        {dropInsert && !dropTarget ? (
          <span
            aria-hidden
            data-session-drop-line={dropInsert}
            className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-accent ${
              dropInsert === "before" ? "-top-[3px]" : "-bottom-[3px]"
            }`}
          />
        ) : null}
        {dropDwell || dropTarget ? (
          <span
            aria-hidden
            data-session-dwell={dropTarget ? "ready" : "waiting"}
            style={{ "--session-dwell-ms": `${groupDelayMs}ms` } as CSSProperties}
            className="pointer-events-none absolute right-1.5 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-stroke bg-background-base py-0.5 pl-1 pr-2 text-[11px] text-content/80 shadow-sm"
          >
            <svg viewBox="0 0 16 16" className="session-row-dwell-ring size-3.5 -rotate-90">
              <circle
                cx="8"
                cy="8"
                r="6"
                className="fill-none stroke-content/15"
                strokeWidth="2.5"
              />
              <circle
                cx="8"
                cy="8"
                r="6"
                pathLength={100}
                className="session-row-dwell-progress fill-none stroke-accent"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            <span>{dropTarget ? t("Release to group") : t("Hold to group")}</span>
          </span>
        ) : null}
        {density === "detailed"
          ? metaLine(
              <>
                {modelLabel}
                <span className="min-w-0 flex-1" />
                <span className="flex shrink-0 items-center gap-1.5">
                  {linkedUpdateDot}
                  {status}
                </span>
              </>,
            )
          : null}
        {/* Actions sit beside the row's button, never inside it. */}
        <span className="relative flex min-h-5 min-w-0 items-center gap-1.5">
          <div
            role="button"
            tabIndex={0}
            aria-current={isActive ? "true" : undefined}
            aria-pressed={isSelected}
            data-session-select={session.id}
            onKeyDown={onKeyDown}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              // Shift-click can trigger :focus-visible. Mouse selection should
              // only highlight the card; Tab can still focus this button.
              event.preventDefault();
              // Clear prior focus too, so shortcuts cannot target another card.
              const focused = event.currentTarget.ownerDocument.activeElement;
              if (focused instanceof HTMLElement) focused.blur();
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
          >
            {selectionMode ? (
              <span
                aria-hidden
                data-session-checkbox={isSelected ? "checked" : "unchecked"}
                className={`grid size-3.5 shrink-0 place-items-center rounded-[4px] border ${
                  isSelected ? "border-active bg-active text-on-solid" : "border-content/35"
                }`}
              >
                {isSelected ? <Check className="size-2.5" strokeWidth={2.5} /> : null}
              </span>
            ) : null}
            {session.pinned ? (
              <Pin className="size-3 shrink-0 text-content/45" strokeWidth={1.75} />
            ) : null}
            <ParticleText
              text={title}
              className={`line-clamp-1 min-w-0 flex-1 text-[13px] font-medium leading-snug ${
                isActive || isSelected ? "text-content" : "text-content/85"
              }`}
            />
            {compact ? modelLabel : null}
            {density === "detailed" ? null : (
              <span className="flex shrink-0 items-center gap-1.5">
                {linkedUpdateDot}
                {status}
              </span>
            )}
          </div>
          {compact ? actions : null}
        </span>
        {density === "standard"
          ? metaLine(
              <>
                {modelLabel}
                {modelLabel && branchLabel ? (
                  <span
                    aria-hidden
                    className="session-row-separator size-0.5 shrink-0 rounded-full bg-content/30"
                  />
                ) : null}
                {branchLabel}
                <span className="min-w-0 flex-1" />
                {actions}
              </>,
            )
          : null}
        {density === "detailed" ? (
          <>
            {metaLine(
              <>
                {branchLabel}
                <span className="min-w-0 flex-1" />
                {actions}
              </>,
            )}
          </>
        ) : null}
        {orchestrationExpanded ? (
          <OrchestrationSidebarAgents leadId={session.id} summary={orchestration!} />
        ) : null}
      </div>
      {orchestration && orchestrationTooltipOpen ? (
        <Popover
          anchor={orchestrationTooltipRootRef}
          side="right"
          align="end"
          width={248}
          maxHeight={320}
          role="tooltip"
          id={orchestrationTooltipId}
          className="pointer-events-none overflow-y-auto p-2.5"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold text-content/85">{t("Subagents")}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-content/45">
              {orchestrationDone}/{orchestration.tasks.length}
              {t(" done")}
            </span>
          </div>
          <div className="mt-1.5 flex flex-col gap-0.5">
            {orchestration.tasks.map((task) => {
              const label = orchestrationTaskLabel(task, orchestration);
              return (
                <div
                  key={task.sessionId}
                  className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1"
                >
                  <HarnessIcon harness={task.harness} className="size-3.5 shrink-0 opacity-75" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-content/75">
                    {task.title}
                  </span>
                  <span
                    className={`shrink-0 text-[10px] ${
                      task.needsInput ||
                      task.status === "failed" ||
                      task.status === "blocked" ||
                      task.status === "interrupted"
                        ? "text-warning"
                        : label === "Working"
                          ? "text-accent"
                          : task.status === "completed"
                            ? "text-success"
                            : "text-content/45"
                    }`}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </Popover>
      ) : null}
    </div>
  );
});

function SessionRenameRow({
  session,
  isActive,
  onCommit,
  onCancel,
}: {
  session: SessionSummary;
  isActive: boolean;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(() => sessionDisplayTitle(session.title, session.harness));

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const finish = (success: boolean) => {
    if (finished.current) return;
    if (success) {
      const trimmed = value.trim();
      if (!trimmed) {
        onCancel();
        return;
      }
      finished.current = true;
      onCommit(trimmed);
      return;
    }
    finished.current = true;
    onCancel();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  };

  return (
    <div
      className={`flex w-full flex-col rounded-md px-2.5 py-2 ${
        isActive ? "bg-selection text-content" : "text-content/80"
      }`}
    >
      <TextField
        fieldClassName="min-w-0 flex-1"
        hideLabel
        label={t("Name")}
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={onKeyDown}
        className="w-full leading-snug"
      />
    </div>
  );
}

function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  useLocale();
  if (additions <= 0 && deletions <= 0) return null;

  const label = [
    additions > 0 ? `+${formatInteger(additions)}` : "",
    deletions > 0 ? `-${formatInteger(deletions)}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      title={t("{p0} uncommitted", { p0: label })}
      className="scrollbar-none flex h-full w-full min-w-0 items-center [justify-content:safe_center] overflow-x-auto overflow-y-hidden overscroll-contain"
    >
      <span className="flex shrink-0 items-center gap-[0.55em] whitespace-nowrap font-sans text-[11px] font-semibold tabular-nums">
        {additions > 0 ? (
          <span className="text-diff-add-fg">
            +<TightDiffNumber value={additions} />
          </span>
        ) : null}
        {deletions > 0 ? (
          <span className="text-diff-del-fg">
            -<TightDiffNumber value={deletions} />
          </span>
        ) : null}
      </span>
    </span>
  );
}

function TightDiffNumber({ value }: { value: number }) {
  useLocale();
  const [first, ...rest] = formatInteger(value).split(",");
  return (
    <>
      {first}
      {rest.map((part, index) => (
        <span key={index}>
          <span className="-mr-px">,</span>
          {part}
        </span>
      ))}
    </>
  );
}

function formatGitLabel(repo?: string, branch?: string): string {
  if (repo && branch) return `${repo}/${branch}`;
  return branch || repo || "";
}
