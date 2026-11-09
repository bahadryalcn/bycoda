import { folderCandidates, projectSessionCollection } from "./sidebarSessionCollections";
import { isUserConversation } from "../../shared/model/host-contracts/delegation";
import { snapshotSessionList } from "../../features/sessions/ui/sessionListDropZones";
import { NewSessionProjectDialog } from "../../features/projects/ui/NewSessionProjectDialog";
import { useSessionProjectAppearance } from "./useSessionProjectAppearance";
import { sessionProviderHistory } from "../../features/sessions/model/sessionProviderHistory";
import { AssistantManagedBadge } from "../../features/sessions/ui/AssistantManagedBadge";
import { Badge } from "../../shared/ui/Badge";
import { StatusDot } from "../../shared/ui/StatusDot";
import { localReferenceForSession } from "../../features/sessions/model/localSessionNavigation";
import { localSessionLinkFields } from "../../features/sessions/model/localSessionReference";
import { Alert } from "../../shared/ui/Alert";
import { TextField } from "../../shared/ui/TextField";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Tab } from "../../shared/ui/Tabs";
import { DescriptionItem, DescriptionList } from "../../shared/ui/DescriptionList";
import { WorkspaceTabList } from "./WorkspaceTabList";
import { Divider } from "../../shared/ui/Divider";
import styles from "./Sidebar.module.css";
import {
  SourceControl,
  ProjectSearch,
  SearchableProjectPicker,
  InboxNotificationMenu,
  preloadSidebarSurfaces,
} from "./sidebarSurfaces";
import { RelativeSessionTime } from "./RelativeSessionTime";
import { SessionDetailTimes } from "./SessionDetailTimes";
import { useMinuteNow } from "../../shared/hooks/useMinuteNow";
import { SIDE_BY_SIDE_LIMIT } from "../../features/workspace/model/workspaceTabGroups";
import { SearchInput, SearchInputGroup } from "../../shared/ui/SearchInput";
import {
  ExpandingSearch,
  type ExpandingSearchHandle,
  type ExpandingSearchItem,
} from "../../shared/ui/ExpandingSearch";
import { MatchText } from "../../shared/ui/MatchText";
import { fuzzyMatch, prepareFuzzyQuery } from "../../shared/lib/fuzzy";
import { themePalette } from "../../shared/theme/palette";
import { motion as layoutMotion } from "motion/react";
import { sessionStatusOrder } from "../../features/sessions/model/sessionStatusOrder";
import { WorkspaceFeatureGate } from "../../features/settings/ui/WorkspaceFeatureGate";
import { t, useLocale, useT } from "../../shared/i18n";
import { formatInteger } from "../../shared/lib/numbers";
import { formatGitLabel } from "./sessionGitLabel";
import { SocialShortcut } from "../../features/social/ui/SocialShortcut";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { prefetchGithubWorkItem } from "../../features/inbox/model/githubTasks";
import { NO_BRANCH_LABEL } from "../../features/source-control/model/worktrees";
import { confirmSessionDelete } from "../../features/sessions/model/confirmSessionDelete";
import { SessionDeletionNotice } from "../../features/sessions/ui/SessionDeletionNotice";
import {
  type WorktreeFocus,
  inWorktreeFocus,
  useWorktreeFocus,
} from "../../features/source-control/model/worktreeFocus";
import { SidebarWorktreeSwitcher } from "../../features/source-control/ui/SidebarWorktreeSwitcher";
import { OrchestrationSidebarAgents } from "../../features/orchestration/ui/OrchestrationSidebarAgents";
import { nextCrewManagedSessions } from "../../features/crews/model/crewPresentation";
import { CrewSidebar } from "../../features/crews/ui/CrewSessions";
import { useUnsentComposerDraft } from "../../features/sessions/hooks/useUnsentComposerDraft";
import { useSessionRankSignals } from "../../features/sessions/hooks/useSessionRankSignals";
import { useSettledShelf } from "../../features/sessions/hooks/useSettledShelf";
import type { BackgroundSessionTarget } from "../../features/tasks/model/backgroundSession";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Archive,
  Chatting,
  Check,
  CheckList,
  DashboardSquare,
  Bot,
  CircleDot,
  Clock,
  FileScript,
  FolderTree,
  GitBranch,
  GitPullRequest,
  Inbox,
  ListFilter,
  PanelLeft,
  Pin,
  PinOff,
  Plus,
  Search,
  Share,
  Sparkles,
  SplitSquare,
  StickyNote,
  Server,
  Trash2,
  Zap,
} from "../../shared/ui/icons";
import {
  openAssistantRoom,
  useAssistantRoomLabel,
} from "../../features/assistant/model/assistantClient";
import {
  memo,
  createContext,
  useContext,
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
import { type GitFileDiffKind, type GitHistoryCommit } from "../../platform/tauri/fs";
import { MOD } from "../../platform/tauri/platform";
import { copyText } from "../../platform/tauri/clipboard";
import { forgetRemoteQueue } from "../../features/connections/model/useRemoteQueue";
import { RemoteDataStatus } from "../../features/connections/ui/RemoteDataStatus";
import { RemoteLoadError } from "../../features/connections/ui/RemoteLoadError";
import { useRemoteConnectionFeedback } from "../../features/connections/ui/RemoteConnectionFeedback";
import { useRemoteConnection } from "../../features/connections/model/useRemoteConnection";
import {
  classifyRemoteError,
  isConnectionFailure,
} from "../../features/connections/model/remoteFailure";
import { resolveModel } from "../../features/sessions/model/models";
import {
  type SessionListDensity,
  useSessionListDisplay,
} from "../../features/sessions/model/sessionListDisplay";
import {
  applySessionOrder,
  loadSessionOrder,
  moveIdsInOrder,
  orderLooseRows,
  saveSessionOrder,
  type SessionOrder,
  type SessionOrderList,
} from "../../features/sessions/model/sessionOrder";
import { TransientNotice } from "../../shared/ui/TransientNotice";
import "./sessionList.css";
import type { OpenFileFn } from "../../features/search/model/search";
import { sessionDisplayTitle } from "../../features/sessions/model/session";
import { MiddleTruncate } from "../../shared/ui/MiddleTruncate";
import { ParticleText } from "../../shared/ui/ParticleText";
import { nextUnseenFinishedSessions } from "../../features/sessions/model/sessionDone";
import { orchestrationTaskLabel } from "../../features/orchestration/model/orchestrationSummary";
import { orderedSessionActionIds } from "../../features/sessions/model/sessionSelection";
import { paneDropFromPoint, setExternalPaneDrop } from "../../features/workspace/model/paneDrop";
import type { PaneEdge } from "../../features/workspace/model/layout";
import {
  announceDrag,
  clearDropIndicator,
  createDragPreview,
  createListGap,
  setDropFeedback,
  setDropIndicator,
  setGrabbing,
  suppressTextSelection,
} from "../../shared/lib/drag";
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
  folderContaining,
  loadPinnedSessionsCollapsed,
  loadReminderSessionsCollapsed,
  loadSessionFolders,
  mergeFolderSessionSummaries,
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
import { createFolderCollapseQueue } from "../../features/sessions/model/folderCollapseQueue";
import {
  executeOrganizationOperation,
  organizationFoldersForProject,
  organizationOrderForProject,
  type OrganizationOperation,
} from "../../features/sessions/model/sessionOrganizationOperations";
import {
  cachedSessionOrganization,
  hydrateSessionOrganization,
  NATIVE_SESSION_ORGANIZATION_ACTIVE,
  subscribeSessionOrganization,
  unresolvedSessionOrganizationGestures,
  type SessionOrganizationState,
} from "../../features/sessions/model/sessionOrganizationStore";
import { isProjectPasswordLocked } from "../../features/group-lock/model/groupLock";
import { withRoomPrivacyMutation } from "../../features/group-lock/model/roomPrivacyProjection";
import { roomPrivacyRetryAction } from "../../features/group-lock/ui/roomPrivacyRetry";
import {
  pinState,
  resolvePinTarget,
  samePinTarget,
  type PinTarget,
} from "../../features/sessions/data/sessionPinReceipts";
import {
  acknowledgePartialPinSaga,
  listPinSagas,
  preparePinSaga,
  resumePinSaga,
  type PinSaga,
  type PinSagaStep,
} from "../../features/sessions/model/sessionPinSaga";
import {
  folderMoveTargetAt,
  flattenSessionList,
  SessionListWindow,
  type SessionListRow,
  type SessionListVirtualProps,
} from "./sessionListWindow";
import { SessionFolderListHeader, SessionGroupListRow } from "./SessionFolderListRows";
import { SessionListItem } from "./SessionListItem";
import { GlobalSessionListWindow } from "./GlobalSessionListWindow";
import { CollectionFooter } from "../../shared/ui/ContinuousList";
import {
  filterSessionsByHarness,
  filterAssistantManagedSessions,
  filterSessionsByStatus,
  filterSessionsByTime,
  harnessesInSessions,
  filterSettledSessions,
  hasActiveSessionFilters,
  DEFAULT_SESSION_SIDEBAR_FILTERS,
  loadSessionSidebarFilters,
  saveSessionSidebarFilters,
  type SessionSidebarFilters,
} from "../../features/sessions/model/sessionFilters";
import { HARNESS_TITLE } from "../../features/sessions/model/session";
import type { HarnessId, LinkedWorkItem } from "../../features/sessions/model/session";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { SettingsSectionId } from "../../features/settings/model/settings";
import type { InstalledUpdate } from "../model/updateNotice";
import { TAB_GROUP_COLORS } from "../../features/workspace/model/tabGroups";
import { useDragResize } from "../../shared/hooks/useDragResize";
import { sidePaneMaxWidth } from "./sidePaneWidth";
import { useGitFileStatuses } from "../../features/source-control/hooks/useGitFileStatuses";
import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
import { useRetainedScroll } from "../../shared/hooks/useRetainedScroll";
import { useCheckoutChangeStats } from "./useCheckoutChangeStats";
import { changesTooltipDetails } from "./ChangesTabTooltip";
import { useCompactRailDrawer } from "./useCompactRailDrawer";
import { useSessionListMotion } from "./useSessionListMotion";
import { useSessionSelection } from "./useSessionSelection";
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
import {
  SessionRowStatus,
  sessionRowStatusKind,
} from "../../features/sessions/ui/SessionRowStatus";
import type { SessionWait } from "../../features/sessions/model/sessionWait";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import type { RecentSessionsSource } from "./LastSessionsSection";
import { LiveAgentsPreview } from "../../features/sessions/ui/LiveAgentsPreview";
import { ProjectRail } from "./ProjectRail";
import { SidebarAccountFooter } from "./SidebarAccountFooter";
import { TerminalSpinner } from "../../features/sessions/ui/TerminalSpinner";
import { ActionHost, InlineAction } from "../../shared/ui/ActionHost";
import { Tooltip } from "../../shared/ui/Tooltip";
import { Spinner } from "../../shared/ui/Spinner";
import { InlineMessage } from "../../shared/ui/InlineError";
import { PaneHeader } from "../../shared/ui/PaneHeader";
import { Sash } from "../../shared/ui/Sash";
import { DevModeIndicator, IconButton, TabVisitNav } from "./TitleBar";
import { useKeybindingShortcut } from "../../features/settings/model/useKeybindingShortcut";
import { Popover } from "../../shared/ui/Popover";
import { useProjectMenu } from "./useProjectMenu";
import { SessionFiltersMenu } from "../../features/sessions/ui/SessionFiltersMenu";
import { SessionSettleAction } from "../../features/sessions/ui/SessionSettleAction";
import { LinkSessionWorkItemDialog } from "../../features/sessions/ui/LinkSessionWorkItemDialog";
import { sessionReminderPresets } from "../../features/sessions/ui/sessionReminderPresets";
import {
  formatReminderTime,
  reminderTime,
  type SessionReminder,
} from "../../features/sessions/model/sessionReminders";
import { SessionsEmpty } from "../../features/sessions/ui/SessionsEmpty";
import { SessionsNoMatch } from "../../features/sessions/ui/SessionsNoMatch";
import { SidebarUpdateFooter } from "./SidebarUpdate";
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
import { newRequestId } from "../../shared/lib/id/requestId";

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

const TAB_LABELS: Record<SidebarTabId, string> = {
  sessions: "Sessions",
  inbox: "Inbox",
  files: "Explorer",
  changes: "Changes",
};

const COMPACT_TAB_ICONS: Record<SidebarTabId, typeof PanelLeft> = {
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
  lastSessionsOpen?: boolean;
  lastSessionsData?: {
    rows: SessionSummary[];
    loading: boolean;
    error: string | null;
    refresh: () => void;
    remoteHistoryLimited?: boolean;
  };
  newListedSessionRequest?: number;
  onNewListedSession?: (projectPath: string) => void | Promise<void>;
  onOpenLastSessions?: () => void;
  onCloseLastSessions?: () => void;
  onSelectListedSession?: (
    sessionId: string,
    cwd: string,
    options?: { keepOpen?: boolean },
  ) => void;
  onPinListedSession?: (sessionId: string, cwd: string, pinned: boolean) => void;
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
  /** Sessions whose agent yielded while background work or delegated children run. */
  sessionWaits?: ReadonlyMap<string, SessionWait>;
  approvalSessionIds: Set<string>;
  activeSessionId?: string;
  /** Open tabs, including blank ones not yet in history. */
  openSessions?: readonly SessionSummary[];
  status: "idle" | "error";
  /** First listing for this project has not arrived yet. */
  pending: boolean;
  onSelectSession: (sessionId: string, options?: { keepOpen?: boolean }) => void;
  onSelectRemoteSession?: (
    project: string,
    sessionId: string,
    options?: { preview?: boolean },
  ) => void;
  onRemoteSessionDeleted?: (sessionId: string) => void;
  onSessionNavigationOrder?: (ids: readonly string[]) => void;
  onPrefetchSession?: (sessionId: string) => void;
  onPlaceSessionOnPane?: (sessionId: string, targetId: string, edge: PaneEdge) => void;
  onPopOutSession?: (sessionId: string, position: WindowMovePosition) => void;
  /** Opens several sessions together as a grid in one new tab. */
  onOpenSessionsSideBySide?: (sessionIds: string[]) => void;
  onRenameSession?: (sessionId: string, title: string) => void | Promise<void>;
  onRegenerateSessionTitle?: (sessionId: string, cwd?: string) => Promise<void>;
  onArchiveSession?: (
    sessionId: string,
    archived: boolean,
    listed?: SessionSummary,
  ) => void | Promise<unknown>;
  onArchiveSessions?: (sessionIds: readonly string[], archived: boolean) => void;
  onPinSession?: (sessionId: string, pinned: boolean) => void;
  onPinSessions?: (sessionIds: readonly string[], pinned: boolean) => void;
  onConfirmedPin?: (
    sessionId: string,
    cwd: string,
    pinned: boolean,
    target: PinTarget,
  ) => Promise<void>;
  onPreparePin?: (sessionId: string, cwd: string) => Promise<void>;
  onSetSessionLinkedWorkItem?: (sessionId: string, item: LinkedWorkItem | undefined) => void;
  reminders?: readonly SessionReminder[];
  onSetReminders?: (sessionIds: readonly string[], dueAt: number) => void;
  onCancelReminders?: (sessionIds: readonly string[]) => void;
  onDeleteSession?: (sessionId: string, listed?: SessionSummary) => void | Promise<unknown>;
  onDeleteSessions?: (sessionIds: readonly string[]) => void;
  /** Delete without asking. Resolves false when the session was kept and
   * rejects on an error, so a bulk delete can report it. */
  onDeleteSessionNow?: (sessionId: string, skipWorktreeConfirm?: boolean) => Promise<boolean>;
  onOpenFile: OpenFileFn;
  onOpenTerminal?: (cwd: string) => void;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  tab: SidebarTabId;
  onTabChange: (tab: SidebarTabId, project?: string) => void;
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
  onPreviewSession?: (sessionId: string, options?: { keepOpen?: boolean }) => void;
  onOpenCrewSession?: (target: BackgroundSessionTarget) => void | Promise<void>;
  recentSessions?: RecentSessionsSource;
  onSelectProject?: (path: string) => void;
  onOpenProject?: () => void;
  onOpenSyncedProject?: (projectId: string, name: string) => void | Promise<void>;
  onRemoveProject?: (path: string, options: { purgeData: boolean }) => void | Promise<void>;
  onRenameProjectFolder?: (path: string, name: string) => Promise<void>;
  onNew?: () => string | void;
  onNewTerminal?: () => void;
  onSearch?: () => void;
  onSearchConversations?: (query?: string) => void;
  onOpenInbox?: () => void;
  onOpenInboxItem?: (item: LinkedWorkItem, sessionId: string) => void;
  onOpenNotes?: () => void;
  onOpenServers?: () => void;
  onOpenAutomations?: () => void;
  onOpenTasks?: () => void;
  onGoToFile?: () => void;
  searchActive?: boolean;
  inboxActive?: boolean;
  notesActive?: boolean;
  serversActive?: boolean;
  automationsActive?: boolean;
  tasksActive?: boolean;
  socialActive?: boolean;
  assistantActive?: boolean;
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
  /** Settings dialog is open; the rail selects its Settings tool but stays fully visible. */
  settingsDialogOpen?: boolean;
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
const GLOBAL_SESSION_FILTERS = { ...DEFAULT_SESSION_SIDEBAR_FILTERS, time: "7d" } as const;
const GLOBAL_SESSION_TIME_FILTERS = ["today", "7d"] as const;

function SidebarComponent({
  lastSessionsOpen = false,
  lastSessionsData,
  onNewListedSession,
  newListedSessionRequest = 0,
  onOpenLastSessions,
  onSelectListedSession,
  onPinListedSession,
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
  sessionWaits,
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
  onRegenerateSessionTitle,
  onArchiveSession: onArchiveLocalSession,
  onArchiveSessions: onArchiveLocalSessions,
  onPinSession: onPinLocalSession,
  onPinSessions: onPinLocalSessions,
  onConfirmedPin,
  onPreparePin,
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
  onPreviewSession,
  recentSessions,
  onSelectProject,
  onOpenProject,
  onOpenSyncedProject,
  onRemoveProject,
  onRenameProjectFolder,
  onNew,
  onSearch,
  onSearchConversations,
  onOpenInbox,
  onOpenInboxItem,
  onOpenNotes,
  onOpenServers,
  onOpenAutomations,
  onOpenTasks,
  searchActive = false,
  inboxActive = false,
  notesActive = false,
  serversActive = false,
  automationsActive = false,
  tasksActive = false,
  socialActive = false,
  assistantActive = false,
  notesEnabled = true,
  onToggleProjectRail,
  projectRailOpen = true,
  compactProjectRail = true,
  titleBarAbove = false,
  unseenFinishedIds: unseenFinishedIdsProp,
  inboxUnseen = false,
  linkedSessionUpdateIds = EMPTY_IDS,
  settingsOpen = false,
  settingsDialogOpen = false,
  onOpenCrewSession,
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
  const t = useT();
  const remoteProject = isRemoteProjectPath(cwd);
  const tab: SidebarTabId = requestedTab;
  const remote = useRemoteProjectSessions(cwd, remoteProject);
  const closeFilesSearch = useCallback(
    () => onFilesSearchOpenChange(false),
    [onFilesSearchOpenChange],
  );
  const remoteConnection = useRemoteConnection(remoteProject ? cwd : undefined);
  useRemoteConnectionFeedback(remoteProject ? cwd : undefined);
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
        authorityGeneration: remote.sessions.find((entry) => entry.id === sessionId)
          ?.authorityGeneration,
        ...patch,
      });
      refreshRemoteProjectSessions();
    } catch (error) {
      window.alert(`Could not update this session.\n\n${String(error)}`);
    }
  };
  const remoteDelete = async (sessionIds: readonly string[]) => {
    if (sessionIds.length === 0) return;
    const authorityById = new Map(
      remote.sessions.map((entry) => [entry.id, entry.authorityGeneration]),
    );
    if (!remote.machine || !hostProject) {
      window.alert("Connect this project's machine to delete its sessions.");
      return;
    }
    if (
      !(await confirmSessionDelete({
        count: sessionIds.length,
        title:
          sessionIds.length === 1
            ? remote.sessions.find((entry) => entry.id === sessionIds[0])?.title
            : undefined,
      }))
    )
      return;
    try {
      for (const sessionId of sessionIds) {
        await sessionAccessForMachine(remote.machine.id, false, true).delete(
          sessionId,
          hostProject.projectId,
          authorityById.get(sessionId),
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
    ? (sessionId: string, options?: { keepOpen?: boolean }) =>
        onSelectRemoteSession?.(cwd, sessionId, { preview: !options?.keepOpen })
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
    () => projectSessionCollection(remoteProject, remote.sessions, sessions, cwd),
    [remoteProject, remote.sessions, sessions, cwd],
  );
  // Count the whole workspace before search, pagination or worktree filters.
  // Local busy IDs also include sessions continued on this desktop's host.
  const workingSessionCount = new Set(
    (lastSessionsOpen
      ? (lastSessionsData?.rows ?? [])
      : [...projectSessions, ...(remoteProject ? [] : openSessions)]
    )
      .filter(
        (session) =>
          (lastSessionsOpen || sameProjectPath(session.cwd, cwd)) &&
          !session.orchestrationLeadId &&
          isUserConversation(session) &&
          !sessionWaits?.has(session.id) &&
          (lastSessionsOpen
            ? (busySessionIds.has(session.id) && !approvalSessionIds.has(session.id)) ||
              liveAgents.some(
                (agent) =>
                  sameProjectPath(agent.cwd, session.cwd) &&
                  (agent.id === session.id || remoteSessionFor(agent.id) === session.id) &&
                  !agent.done &&
                  !agent.needsApproval,
              )
            : listedBusySessionIds.has(session.id) && !listedApprovalSessionIds.has(session.id)),
      )
      .map((session) => `${session.cwd}\0${session.id}`),
  ).size;
  const workingSessionsBadge =
    workingSessionCount > 0 ? (
      // Shell totals use the compact accent count; the shared live mark preserves
      // the distinction between working conversations and a plain total.
      <Badge
        variant="count"
        size="sm"
        tone="accent"
        appearance="subtle"
        icon={<TerminalSpinner />}
        data-workspace-working-count
        aria-live="polite"
        aria-label={t(
          workingSessionCount === 1 ? "{p0} working session" : "{p0} working sessions",
          { p0: workingSessionCount },
        )}
        className="ms-1 shrink-0"
      >
        {workingSessionCount}
      </Badge>
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
  const [tabOrder, setTabOrder] = useState<SidebarTabId[]>(loadSidebarTabOrder);

  const sessionsLock = useLockOverscroll<HTMLDivElement>();
  const sessionsScrollRef = useRef<HTMLDivElement>(null);
  const [sessionMenu, setSessionMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);
  const [linkingSession, setLinkingSession] = useState<SessionSummary | null>(null);
  const [copyIdFailure, setCopyIdFailure] = useState<{
    value: string;
    error: string;
  } | null>(null);
  const [referenceCopy, setReferenceCopy] = useState<{
    id: string;
    pending: boolean;
    error?: string;
    copied?: boolean;
  } | null>(null);
  const referenceCopyRequest = useRef(0);
  const [copyIdRetrying, setCopyIdRetrying] = useState(false);
  const [folderMenu, setFolderMenu] = useState<{
    x: number;
    y: number;
    folderId: string;
  } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const regeneratingTitles = useRef(new Set<string>());
  const [titleActions, setTitleActions] = useState<
    Record<string, { pending: boolean; error?: string }>
  >({});
  const regenerateTitle = async (session: SessionSummary) => {
    if (!onRegenerateSessionTitle || regeneratingTitles.current.has(session.id)) return;
    regeneratingTitles.current.add(session.id);
    setTitleActions((current) => ({ ...current, [session.id]: { pending: true } }));
    try {
      await onRegenerateSessionTitle(session.id, session.cwd);
      setTitleActions((current) => {
        const next = { ...current };
        delete next[session.id];
        return next;
      });
    } catch (reason) {
      setTitleActions((current) => ({
        ...current,
        [session.id]: {
          pending: false,
          error: reason instanceof Error ? reason.message : String(reason),
        },
      }));
    } finally {
      regeneratingTitles.current.delete(session.id);
    }
  };
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [sessionOrder, setSessionOrder] = useState<SessionOrder>(() =>
    NATIVE_SESSION_ORGANIZATION_ACTIVE ? {} : loadSessionOrder(cwd),
  );
  const [organizationNotice, setOrganizationNotice] = useState<string | null>(null);
  const [partialPinSagas, setPartialPinSagas] = useState<PinSaga[]>([]);
  const organizationBusy = useRef(false);
  const organizationUnresolved = useRef(false);
  const organizationRefreshRequired = useRef(false);
  const organizationReady = useRef(!NATIVE_SESSION_ORGANIZATION_ACTIVE);
  const [sessionFolders, setSessionFolders] = useState<SessionFolder[]>(() =>
    NATIVE_SESSION_ORGANIZATION_ACTIVE ? [] : loadSessionFolders(cwd),
  );
  const quietOrganizationOperation = useRef<(op: OrganizationOperation) => Promise<boolean>>(
    async () => false,
  );
  const folderCollapse = useMemo(
    () =>
      createFolderCollapseQueue({
        persist: async (changes) => {
          if (organizationBusy.current) return "retry";
          const operations = changes.map(({ folderId, collapsed }) => ({
            kind: "folderCollapsed" as const,
            cwd,
            folderId,
            collapsed,
          }));
          const applied = await quietOrganizationOperation.current(
            operations.length === 1 ? operations[0] : { kind: "batch", cwd, operations },
          );
          return applied ? "applied" : "failed";
        },
        onFailed: () => {
          const snapshot = cachedSessionOrganization();
          if (snapshot) setSessionFolders(organizationFoldersForProject(snapshot, cwd));
        },
      }),
    [cwd],
  );
  useEffect(() => () => folderCollapse.dispose(), [folderCollapse]);
  const [pinnedSessionsCollapsed, setPinnedSessionsCollapsed] = useState(() =>
    loadPinnedSessionsCollapsed(cwd),
  );
  const [reminderSessionsCollapsed, setReminderSessionsCollapsed] = useState(() =>
    loadReminderSessionsCollapsed(cwd),
  );
  const {
    shelve: shelveSettled,
    isSettled,
    setCollapsed: setSettledCollapsed,
  } = useSettledShelf(!remoteProject);
  const [sessionDrop, setSessionDrop] = useState<SessionListDropTarget | null>(null);
  const [sessionFilters, setSessionFilters] = useState(loadSessionSidebarFilters);
  const [globalSessionFilters, setGlobalSessionFilters] =
    useState<SessionSidebarFilters>(GLOBAL_SESSION_FILTERS);
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sessionSearchExpanded, setSessionSearchExpanded] = useState(false);
  const sessionSearchRef = useRef<ExpandingSearchHandle>(null);
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
  const now = useMinuteNow(
    tab === "sessions" &&
      (lastSessionsOpen ? globalSessionFilters.time : sessionFilters.time) !== "all",
  );
  const [crewManaged, setCrewManaged] = useState<{
    cwd: string;
    ids: Set<string>;
  }>({
    cwd: "",
    ids: new Set(),
  });
  const onCrewManagedChange = useCallback((path: string, ids: string[]) => {
    setCrewManaged((previous) => nextCrewManagedSessions(previous, path, ids));
  }, []);
  const { listedSessions, visibleSessions } = useMemo(() => {
    const listedSessions = mergeFolderSessionSummaries(
      projectSessions,
      folderCandidates(remoteProject, openSessions),
      sessionFolders,
    ).filter(
      (session) =>
        !session.orchestrationLeadId &&
        !(crewManaged.cwd === cwd && crewManaged.ids.has(session.id)) &&
        inWorktreeFocus(session, focusedWorktree),
    );
    const filteredSessions = filterSessionsByStatus(
      filterSessionsByTime(
        filterSessionsByHarness(
          filterAssistantManagedSessions(
            filterSettledSessions(
              filterSessionsByArchive(listedSessions, sessionFilters.showArchived),
              sessionFilters.showSettled,
              isSettled,
            ),
            sessionFilters.assistantManaged,
          ),
          sessionFilters.hiddenHarnesses,
        ),
        sessionFilters.time,
        now,
      ),
      sessionFilters.status,
      listedBusySessionIds,
      listedApprovalSessionIds,
      unseenFinishedIds,
    );
    // The inline filter matches title, model, branch and the names of the groups holding a session.
    const textMatches = filterSessionsByQuery(filteredSessions, deferredSearchQuery);
    const groupMatches = deferredSearchQuery.trim()
      ? sessionIdsInMatchingFolders(sessionFolders, deferredSearchQuery)
      : null;
    const textMatched = new Set(textMatches);
    const visibleSessions = (
      groupMatches
        ? filteredSessions.filter(
            (session) => groupMatches.has(session.id) || textMatched.has(session),
          )
        : textMatches
    )
      .slice()
      .sort(compareSessionSummaries);
    return { listedSessions, visibleSessions };
  }, [
    projectSessions,
    crewManaged,
    cwd,
    remoteProject,
    openSessions,
    sessionFolders,
    focusedWorktree,
    sessionFilters,
    isSettled,
    now,
    listedBusySessionIds,
    listedApprovalSessionIds,
    unseenFinishedIds,
    deferredSearchQuery,
  ]);
  const filtersActive = hasActiveSessionFilters(
    lastSessionsOpen ? globalSessionFilters : sessionFilters,
    lastSessionsOpen ? "7d" : "all",
  );
  const [newSessionProjectOpen, setNewSessionProjectOpen] = useState(false);
  const [handledNewSessionRequest, setHandledNewSessionRequest] = useState(newListedSessionRequest);
  if (newListedSessionRequest !== handledNewSessionRequest) {
    setHandledNewSessionRequest(newListedSessionRequest);
    if (newListedSessionRequest > 0) setNewSessionProjectOpen(true);
  }
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  // Once the opened session is the active one, its card stops spinning.
  if (openingSessionId && openingSessionId === activeListedSessionId) setOpeningSessionId(null);
  useEffect(() => {
    if (!openingSessionId) return;
    // A load that fails or is cancelled must not leave the card spinning.
    const timer = window.setTimeout(() => setOpeningSessionId(null), 20_000);
    return () => window.clearTimeout(timer);
  }, [activeListedSessionId, openingSessionId]);
  const searchNarrowed = Boolean(deferredSearchQuery.trim());
  const listFilters = lastSessionsOpen ? globalSessionFilters : sessionFilters;
  const sessionListKey = JSON.stringify([
    lastSessionsOpen ? "last-sessions" : "project-sessions",
    lastSessionsOpen ? "all-projects" : cwd,
    lastSessionsOpen
      ? "all-machines"
      : (remote.machine?.environmentId ?? (remoteProject ? "remote-offline" : "local")),
    listFilters.showArchived,
    listFilters.showSettled,
    listFilters.assistantManaged,
    listFilters.time,
    listFilters.hiddenHarnesses,
    listFilters.status,
    deferredSearchQuery,
  ]);
  const retainSessionsScroll = useRetainedScroll<HTMLDivElement>(sessionListKey, {
    ready: tab === "sessions",
  });
  const rank = useSessionRankSignals(visibleSessions, unseenFinishedIds, activeListedSessionId);
  // Keep the complete loaded collection in the model; the shared window bounds the mounted rows.
  const { reminderIds, sessionListEntries, sessionNavigationIds } = useMemo(() => {
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
    const compareStatus = sessionStatusOrder(listedApprovalSessionIds, listedBusySessionIds, {
      ...rank,
      now,
      waitingIds: new Set(sessionWaits?.keys()),
    });
    // Status leads within each group; pins keep their saved order, loose rows stay by recency.
    const ungroupedVisible = orderLooseRows(ungroupedFiltered, sessionOrder.pinned, compareStatus);
    const builtList = buildSessionList(
      visibleSessions,
      sessionFolders,
      ungroupedVisible,
      pinnedSessionsCollapsed,
      reminderGroup,
      compareStatus,
    );
    // The Settled filter lists settled sessions in place instead of on the shelf.
    const sessionListEntries = sessionFilters.showSettled ? builtList : shelveSettled(builtList);
    const sessionNavigationIds = sessionListNavigationIds(sessionListEntries, searchNarrowed);
    return {
      reminderIds,
      reminderGroup,
      ungroupedVisible,
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
    rank,
    now,
    sessionWaits,
    sessionOrder,
    activeListedSessionId,
    pinnedSessionsCollapsed,
    shelveSettled,
    sessionFilters.showSettled,
    searchNarrowed,
  ]);
  const flatSessionRows = useMemo(
    () => flattenSessionList(sessionListEntries, searchNarrowed),
    [sessionListEntries, searchNarrowed],
  );
  const sessionNavigationKey = sessionNavigationIds.join("\0");
  const listDisplay = useSessionListDisplay();
  // The workspace keeps this order in a ref for keyboard navigation between
  // sessions: an external sync that has to follow the committed list.
  useEffect(() => {
    onSessionNavigationOrder?.(sessionNavigationIds);
  }, [onSessionNavigationOrder, sessionNavigationKey]);
  const selection = useSessionSelection({
    scope: tab === "sessions" ? cwd : null,
    navigationIds: sessionNavigationIds,
    navigationKey: sessionNavigationKey,
    canDelete: Boolean(onDeleteSession || onDeleteSessions),
    onDismissMenu: () => setSessionMenu(null),
    bulkDelete: {
      cwd,
      remoteProject,
      remote,
      hostProject,
      runningSessionIds: new Set([...listedBusySessionIds, ...listedApprovalSessionIds]),
      onDeleteLocalSessionNow,
      onDeleteSessions,
      onRemoteSessionDeleted,
    },
  });
  const {
    selectedSessionIds,
    selectionMode,
    contextSelection,
    selectedOrderedIds,
    showBulkBar,
    deleting,
    deleteProgress,
    deleteNoticeError,
    deleteNoticeCwd,
    bulkNotice,
    dismissBulkNotice,
    bulkDeleteSessions,
  } = selection;
  // A session drop lets the list settle first: the gap it opened is released here, in the commit
  // that reorders the list and before the motion hook measures where each card ended up.
  useLayoutEffect(() => {
    const settle = afterSessionListCommit;
    afterSessionListCommit = null;
    settle?.();
  });
  const { captureListMotion, insertMotion: sessionInsertMotion } = useSessionListMotion(
    sessionsScrollRef,
    cwd,
    listedSessions,
  );
  const sessionHarnesses = harnessesInSessions(
    lastSessionsOpen ? (lastSessionsData?.rows ?? []) : projectSessions,
  );
  const narrowedByUser = searchNarrowed || filtersActive;
  const visibleTabs = tabOrder.filter((itemId) => itemId !== "inbox");
  const sortable = useAnimatedReorder(
    visibleTabs,
    (ids) => {
      let index = 0;
      const next = tabOrder.map((itemId) => (itemId === "inbox" ? itemId : ids[index++]));
      setTabOrder(next);
      saveSidebarTabOrder(next);
    },
    "x",
    undefined,
    { label: (itemId) => t(TAB_LABELS[itemId]) },
  );
  const [viewTabMenu, setViewTabMenu] = useState<{
    x: number;
    y: number;
    tabId: Exclude<SidebarTabId, "inbox">;
  } | null>(null);
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
  const openAccountSettings =
    onOpenSettings && onSelectSettingsSection
      ? () => {
          onOpenSettings();
          onSelectSettingsSection("account");
        }
      : undefined;
  // A blank session has no project to browse, so the shell stands alone until
  // one is picked — whether or not the rail is open.
  const sidebarAvailable =
    !searchActive &&
    !inboxActive &&
    !notesActive &&
    !serversActive &&
    !automationsActive &&
    !tasksActive &&
    !socialActive &&
    !settingsOpen &&
    (inProject || lastSessionsOpen);
  const sidebarVisible = open && sidebarAvailable;
  // With the sidebar collapsed beside the compact rail, its tab shortcuts
  // open the sidebar temporarily until the user clicks away.
  const {
    drawerVisible,
    drawerRendered,
    drawerClosing,
    drawerRef,
    setDrawerOpen,
    projectNavigationAnchor,
    setProjectNavigationAnchor,
    closeProjectNavigationThen,
  } = useCompactRailDrawer({ compactRailVisible, open, sidebarAvailable });
  const panelOpen = open || drawerVisible;
  const gitStatuses = useGitFileStatuses(gitRoot, panelOpen && tab === "files");
  const { changeStats, changeScope, changeScopeLabel } = useCheckoutChangeStats({
    gitRoot,
    repositoryPaths,
    active: panelOpen && sidebarAvailable,
  });

  const [sessionStateCwd, setSessionStateCwd] = useState(cwd);
  // Reset project-owned state before children render the next project. React
  // retries this component immediately instead of committing stale folder rows.
  if (sessionStateCwd !== cwd) {
    setSessionStateCwd(cwd);
    organizationReady.current = !NATIVE_SESSION_ORGANIZATION_ACTIVE;
    setSessionFolders(NATIVE_SESSION_ORGANIZATION_ACTIVE ? [] : loadSessionFolders(cwd));
    setSessionOrder(NATIVE_SESSION_ORGANIZATION_ACTIVE ? {} : loadSessionOrder(cwd));
    setPinnedSessionsCollapsed(loadPinnedSessionsCollapsed(cwd));
    setReminderSessionsCollapsed(loadReminderSessionsCollapsed(cwd));
    setRenamingFolderId(null);
    setFolderMenu(null);
    setSessionDrop(null);
  }
  useEffect(() => {
    pendingFolderSessionIds.current.clear();
  }, [cwd]);

  useEffect(() => {
    if (!NATIVE_SESSION_ORGANIZATION_ACTIVE) return;
    setOrganizationNotice(t("Loading folders…"));
    let alive = true;
    let reconciliation = 0;
    const unsubscribe = subscribeSessionOrganization(
      () => {
        const snapshot = cachedSessionOrganization();
        if (!snapshot) return;
        try {
          setSessionFolders(folderCollapse.overlay(organizationFoldersForProject(snapshot, cwd)));
          setSessionOrder(organizationOrderForProject(snapshot, cwd));
          organizationRefreshRequired.current = false;
          if (!organizationBusy.current) {
            const generation = ++reconciliation;
            void Promise.all([unresolvedSessionOrganizationGestures(), listPinSagas()])
              .then(([pending, sagas]) => {
                if (!alive || organizationBusy.current || generation !== reconciliation) return;
                const openSagas = sagas.filter(
                  (saga) => saga.state !== "applied" && saga.state !== "accepted",
                );
                setPartialPinSagas(openSagas.filter((saga) => saga.state === "partial"));
                organizationUnresolved.current = pending.length > 0 || openSagas.length > 0;
                organizationReady.current = true;
                if (pending.length)
                  setOrganizationNotice(
                    `Folder change outcome is unknown: ${pending[0].operationId}`,
                  );
                else if (openSagas.length)
                  setOrganizationNotice(`Pin change needs review: ${openSagas[0].id}`);
                else
                  setOrganizationNotice((current) =>
                    current === t("Loading folders…") ? null : current,
                  );
              })
              .catch((error: unknown) => {
                if (alive && generation === reconciliation) setOrganizationNotice(String(error));
              });
          }
        } catch (error) {
          setOrganizationNotice(String(error));
        }
      },
      (error) => setOrganizationNotice(String(error)),
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [cwd]);

  useEffect(() => {
    if (!NATIVE_SESSION_ORGANIZATION_ACTIVE) return;
    const onFeedback = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          cwd: string;
          sessionId: string;
          runId: string;
          result?: { state: string; operationId?: string };
          error?: string;
        }>
      ).detail;
      if (!detail || !sameProjectPath(detail.cwd, cwd)) return;
      if (detail.result?.state === "unknown") organizationUnresolved.current = true;
      if (isProjectPasswordLocked(detail.cwd)) {
        setOrganizationNotice("Folder placement needs review after unlocking the project.");
        return;
      }
      setOrganizationNotice(
        detail.result?.state === "unknown"
          ? `Automation session ${detail.sessionId} retained; folder outcome is unknown: ${detail.result.operationId}`
          : detail.result?.state === "applied-unavailable"
            ? `Automation session ${detail.sessionId} retained; folder change was applied but refresh failed.`
            : `Automation session ${detail.sessionId} retained; folder placement needs review${detail.error ? `: ${detail.error}` : "."}`,
      );
    };
    window.addEventListener("bycoda:organization-operation-feedback", onFeedback);
    return () => window.removeEventListener("bycoda:organization-operation-feedback", onFeedback);
  }, [cwd]);

  useEffect(
    () =>
      NATIVE_SESSION_ORGANIZATION_ACTIVE
        ? undefined
        : subscribeSessionFolders(cwd, () => {
            setSessionFolders(loadSessionFolders(cwd));
          }),
    [cwd],
  );
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        !NATIVE_SESSION_ORGANIZATION_ACTIVE &&
        (event.key === null || event.key === "bycoda.sessionFolders")
      )
        setSessionFolders(loadSessionFolders(cwd));
      if (
        !NATIVE_SESSION_ORGANIZATION_ACTIVE &&
        (event.key === null || event.key === "bycoda.sessionOrder")
      )
        setSessionOrder(loadSessionOrder(cwd));
      if (event.key === null || event.key === "bycoda.pinnedSessionsCollapsed")
        setPinnedSessionsCollapsed(loadPinnedSessionsCollapsed(cwd));
      if (event.key === null || event.key === "bycoda.reminderSessionsCollapsed")
        setReminderSessionsCollapsed(loadReminderSessionsCollapsed(cwd));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [cwd]);

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
    // This effect reruns for every committed folder snapshot, so it reads the
    // current state directly and persists once, outside a state updater.
    const migrated = completedFolderSessions.size
      ? sessionFolders.map((folder) => ({
          ...folder,
          sessionIds: folder.sessionIds.map((id) => completedFolderSessions.get(id) ?? id),
        }))
      : sessionFolders;
    // Session history may be partial. Absence from this view does not prove
    // deletion, so retain unknown IDs until an explicit operation removes them.
    const next = migrated;
    if (next === sessionFolders) return;
    if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
      void performOrganizationOperation({
        kind: "replaceSessionIds",
        cwd,
        aliases: [...completedFolderSessions].map(([from, to]) => ({ from, to })),
      }).catch((error: unknown) => setOrganizationNotice(String(error)));
      return;
    }
    setSessionFolders(next);
    // StrictMode replays this effect with the same snapshot. Storage already holding
    // the pruned value means the write and its cross-window event already happened.
    if (JSON.stringify(loadSessionFolders(cwd)) === JSON.stringify(next)) return;
    saveSessionFolders(cwd, next);
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

  // Search and the filter menu belong to the sessions tab: leaving it drops them.
  const [sessionsTabShown, setSessionsTabShown] = useState(tab === "sessions");
  if (sessionsTabShown !== (tab === "sessions")) {
    setSessionsTabShown(tab === "sessions");
    if (tab !== "sessions") {
      setFilterMenu(null);
      setSearchQuery("");
    }
  }

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

  const commitSessionFolders = (next: SessionFolder[]) => {
    sessionFoldersRef.current = next;
    setSessionFolders(next);
    saveSessionFolders(cwd, next);
  };

  const performOrganizationOperation = async (
    operation: OrganizationOperation,
    onApplied?: (state: SessionOrganizationState, previous?: SessionOrganizationState) => void,
    quiet = false,
  ): Promise<boolean> => {
    if (
      !organizationReady.current ||
      organizationBusy.current ||
      organizationUnresolved.current ||
      organizationRefreshRequired.current
    )
      return false;
    organizationBusy.current = true;
    if (!quiet) setOrganizationNotice(t("Saving…"));
    const gestureId = crypto.randomUUID();
    let admitted = false;
    try {
      const result = await withRoomPrivacyMutation(() => {
        if (isProjectPasswordLocked(operation.cwd)) throw new Error("Project is locked.");
        admitted = true;
        return executeOrganizationOperation(gestureId, operation);
      });
      if (result.state === "applied") {
        if (!quiet) setOrganizationNotice(null);
        try {
          onApplied?.(result.value, result.previous);
        } catch (error) {
          setOrganizationNotice(
            `Change was applied, but the display could not be updated: ${String(error)}`,
          );
        }
        return true;
      }
      if (result.state === "unknown") organizationUnresolved.current = true;
      if (result.state === "applied-unavailable") organizationRefreshRequired.current = true;
      setOrganizationNotice(
        result.state === "unknown"
          ? `Folder change outcome is unknown: ${result.operationId}`
          : result.state === "applied-unavailable"
            ? `Folder change was applied, but refresh failed: ${result.operationId}`
            : "Folder change conflicted; refresh before retrying.",
      );
      return false;
    } catch (error) {
      if (admitted) organizationUnresolved.current = true;
      setOrganizationNotice(
        admitted ? `Folder change outcome needs verification: ${gestureId}` : String(error),
      );
      return false;
    } finally {
      organizationBusy.current = false;
    }
  };
  quietOrganizationOperation.current = (op) => performOrganizationOperation(op, undefined, true);

  const onNewInFolder = (folderId: string) => {
    const sessionId = onNew?.();
    if (!sessionId) return;
    pendingFolderSessionIds.current.add(sessionId);
    setSearchQuery("");
    if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
      void performOrganizationOperation({
        kind: "batch",
        cwd,
        operations: [
          { kind: "assign", cwd, folderId, sessionIds: [sessionId] },
          { kind: "folderCollapsed", cwd, folderId, collapsed: false },
        ],
      }).catch((error: unknown) => setOrganizationNotice(String(error)));
      return;
    }
    commitSessionFolders(
      setFolderCollapsed(
        addSessionToFolder(sessionFoldersRef.current, folderId, sessionId),
        folderId,
        false,
      ),
    );
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
        ...(onNew
          ? [
              {
                kind: "item" as const,
                id: "new-session",
                get label() {
                  return t("New session");
                },
              },
            ]
          : []),
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
                disabled: menuSessions.length > SIDE_BY_SIDE_LIMIT,
                description:
                  menuSessions.length > SIDE_BY_SIDE_LIMIT
                    ? t("Select at most {p0} conversations to open side by side.", {
                        p0: SIDE_BY_SIDE_LIMIT,
                      })
                    : undefined,
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
                disabled: !!titleActions[menuSessions[0]?.id]?.pending,
                get label() {
                  return t("Rename");
                },
                shortcut: "F2",
              },
            ]
          : []),
        ...(!multipleMenuSessions && onRegenerateSessionTitle
          ? [
              {
                kind: "item" as const,
                id: "regenerate-title",
                label: t("Regenerate title"),
                disabled: !!titleActions[menuSessions[0]?.id]?.pending,
              },
            ]
          : []),
        ...(!multipleMenuSessions
          ? [
              {
                kind: "item" as const,
                id: "copy",
                get label() {
                  return t("Copy");
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
                  ...(!remoteProject
                    ? [
                        {
                          kind: "item" as const,
                          id: "copy-session-link",
                          label: t("Copy session link"),
                          disabled: !!referenceCopy?.pending,
                          description:
                            referenceCopy?.id === "copy-session-link"
                              ? referenceCopy.pending
                                ? t("Loading…")
                                : (referenceCopy.error ??
                                  (referenceCopy.copied ? t("Copied") : undefined))
                              : undefined,
                        },
                        {
                          kind: "item" as const,
                          id: "copy-session-markdown",
                          label: t("Copy Markdown reference"),
                          disabled: !!referenceCopy?.pending,
                          description:
                            referenceCopy?.id === "copy-session-markdown"
                              ? referenceCopy.pending
                                ? t("Loading…")
                                : (referenceCopy.error ??
                                  (referenceCopy.copied ? t("Copied") : undefined))
                              : undefined,
                        },
                      ]
                    : []),
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
        ...(sessionFolders.length > 0
          ? [
              {
                kind: "item" as const,
                id: "folder-add",
                label: t("Add to"),
                submenuSearch: { placeholder: t("Search folders"), emptyLabel: t("No results") },
                submenu: sessionFolders.map((folder) => ({
                  kind: "item" as const,
                  id: `folder-add:${folder.id}`,
                  label: folder.name,
                  checked:
                    menuSessionIds.length > 0 &&
                    menuSessionIds.every((sessionId) => folder.sessionIds.includes(sessionId)),
                })),
              },
            ]
          : []),
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
    selection.beginContextMenu(sessionId);
    referenceCopyRequest.current++;
    setReferenceCopy(null);
    setFilterMenu(null);
    setFolderMenu(null);
    setSessionMenu({ x: e.clientX, y: e.clientY, sessionId });
  };

  function closeSessionMenu() {
    referenceCopyRequest.current++;
    setReferenceCopy(null);
    setSessionMenu(null);
    selection.endContextMenu();
  }

  const onFolderContextMenu = (folderId: string, e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setFilterMenu(null);
    setSessionMenu(null);
    setFolderMenu({ x: e.clientX, y: e.clientY, folderId });
  };
  // The header's `…` (and the context-menu key) open the same menu under the control.
  const openFolderMenuAt = (folderId: string, anchor: HTMLElement) => {
    if (folderMenu?.folderId === folderId) {
      setFolderMenu(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    setFilterMenu(null);
    setSessionMenu(null);
    // Right-aligned to the action, like the filter menu; the menu keeps itself on screen.
    setFolderMenu({ x: Math.max(4, rect.right - 260), y: rect.bottom + 2, folderId });
  };

  const onSessionMenuPick = (id: string) => {
    if (!sessionMenu) return;
    const sessionId = sessionMenu.sessionId;
    const sessionIds = menuSessionIds;
    const providerSessionId = menuSessions[0]?.providerSessionId;
    const archived = allMenuSessionsArchived;
    const pinned = allMenuSessionsPinned;
    if (id === "copy-session-link" || id === "copy-session-markdown") {
      if (referenceCopy?.pending || remoteProject) return;
      const request = ++referenceCopyRequest.current;
      const session = menuSessions[0];
      if (!session) return;
      setReferenceCopy({ id, pending: true });
      void localReferenceForSession(session)
        .then(async (locator) => {
          if (request !== referenceCopyRequest.current) return;
          const fields = localSessionLinkFields(locator, session.title);
          await copyText(id === "copy-session-link" ? fields.link : fields.markdownReference);
          if (request === referenceCopyRequest.current)
            setReferenceCopy({ id, pending: false, copied: true });
        })
        .catch((error) => {
          if (request === referenceCopyRequest.current)
            setReferenceCopy({
              id,
              pending: false,
              error: String(error instanceof Error ? error.message : error),
            });
        });
      return;
    }
    closeSessionMenu();
    if (id === "select") {
      selection.startSelecting(sessionId);
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
    if (id === "regenerate-title") {
      const session = listedSessions.find((entry) => entry.id === sessionId);
      if (session) void regenerateTitle(session).catch(() => {});
      return;
    }
    if (id === "copy-harness-session-id" || id === "copy-bycoda-session-id") {
      const value = id === "copy-harness-session-id" ? providerSessionId : sessionId;
      if (value) {
        void copyText(value).catch((error) => {
          setCopyIdFailure({ value, error: String(error) });
        });
      }
      return;
    }
    if (id === "link-work-item") {
      setLinkingSession(menuSessions[0] ?? null);
      return;
    }
    if (id === "folder-new") {
      if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
        const folderId = crypto.randomUUID();
        void performOrganizationOperation({ kind: "create", cwd, folderId, sessionIds })
          .then((applied) => {
            if (applied) setRenamingFolderId(folderId);
          })
          .catch((error: unknown) => setOrganizationNotice(String(error)));
        return;
      }
      const { folders, id: createdId } = createFolderWithSessions(sessionFolders, sessionIds);
      if (!createdId) return;
      commitSessionFolders(folders);
      setRenamingFolderId(createdId);
      return;
    }
    if (id.startsWith("folder-add:")) {
      const folderId = id.slice("folder-add:".length);
      if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
        void performOrganizationOperation({
          kind: "batch",
          cwd,
          operations: [
            { kind: "assign", cwd, folderId, sessionIds },
            { kind: "folderCollapsed", cwd, folderId, collapsed: false },
          ],
        }).catch((error: unknown) => setOrganizationNotice(String(error)));
        return;
      }
      const folders = sessionIds.reduce(
        (current, id) => addSessionToFolder(current, folderId, id),
        sessionFolders,
      );
      commitSessionFolders(setFolderCollapsed(folders, folderId, false));
      return;
    }
    if (id === "folder-remove") {
      if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
        void performOrganizationOperation({
          kind: "assign",
          cwd,
          folderId: null,
          sessionIds,
        }).catch((error: unknown) => setOrganizationNotice(String(error)));
        return;
      }
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
    if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
      void performPinSaga(null, [...sessionIds], pinned).catch((error: unknown) =>
        setOrganizationNotice(String(error)),
      );
      return;
    }
    if (sessionIds.length > 1 && onPinSessions) {
      onPinSessions(sessionIds, pinned);
    } else {
      for (const id of sessionIds) onPinSession?.(id, pinned);
    }
  };

  // The bar acts on the selection in list order, like the context menu.
  const selectedSessions = listedSessions.filter((session) => selectedSessionIds.has(session.id));
  const allSelectedArchived =
    selectedSessions.length > 0 && selectedSessions.every((session) => session.archived);
  const allSelectedPinned =
    selectedSessions.length > 0 && selectedSessions.every((session) => session.pinned);
  const selectAllListedSessions = selection.selectAll;
  const clearSessionSelection = selection.clear;

  const onFolderMenuPick = (id: string) => {
    if (!folderMenu) return;
    const folderId = folderMenu.folderId;
    setFolderMenu(null);
    if (id === "new-session") {
      onNewInFolder(folderId);
      return;
    }
    if (id === "rename") {
      setRenamingFolderId(folderId);
      return;
    }
    if (id === "move-out") {
      if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
        void performOrganizationOperation({ kind: "moveFolderOut", cwd, folderId }).catch(
          (error: unknown) => setOrganizationNotice(String(error)),
        );
        return;
      }
      commitSessionFolders(moveFolderOut(sessionFolders, folderId));
      return;
    }
    if (id === "pin-folder") {
      const folder = sessionFolders.find((entry) => entry.id === folderId);
      if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
        if (folder)
          void performOrganizationOperation({
            kind: "folderPinned",
            cwd,
            folderId,
            pinned: !folder.pinned,
          }).catch((error: unknown) => setOrganizationNotice(String(error)));
        return;
      }
      if (folder) commitSessionFolders(setFolderPinned(sessionFolders, folderId, !folder.pinned));
      return;
    }
    if (id === "ungroup") {
      if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
        void performOrganizationOperation({ kind: "deleteFolder", cwd, folderId }).catch(
          (error: unknown) => setOrganizationNotice(String(error)),
        );
        return;
      }
      commitSessionFolders(dissolveFolder(sessionFolders, folderId));
    }
  };

  const onFolderColorChange = (colorIndex: number | null) => {
    if (!folderMenu) return;
    if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
      void performOrganizationOperation({
        kind: "folderColor",
        cwd,
        folderId: folderMenu.folderId,
        colorIndex,
      }).catch((error: unknown) => setOrganizationNotice(String(error)));
      return;
    }
    commitSessionFolders(setFolderColor(sessionFolders, folderMenu.folderId, colorIndex));
  };

  const onFolderCustomColorChange = (color: string) => {
    if (!folderMenu) return;
    if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
      void performOrganizationOperation({
        kind: "folderCustomColor",
        cwd,
        folderId: folderMenu.folderId,
        color,
      }).catch((error: unknown) => setOrganizationNotice(String(error)));
      return;
    }
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

  const performPinSaga = async (
    operation: OrganizationOperation | null,
    sessionIds: string[],
    desiredPinned: boolean,
  ) => {
    if (
      !organizationReady.current ||
      organizationBusy.current ||
      organizationUnresolved.current ||
      organizationRefreshRequired.current
    )
      return;
    organizationBusy.current = true;
    setOrganizationNotice(t("Saving…"));
    let sagaPrepared = false;
    let pinConfirmed = false;
    try {
      await withRoomPrivacyMutation(async () => {
        if (isProjectPasswordLocked(cwd)) throw new Error("Project is locked.");
        const steps: PinSagaStep[] = [];
        for (const sessionId of sessionIds) {
          let target: PinTarget;
          if (remoteProject) {
            if (!remote.machine || !hostProject)
              throw new Error("The session's machine is unavailable.");
            const authorityGeneration = remote.sessions.find(
              (item) => item.id === sessionId,
            )?.authorityGeneration;
            target = {
              kind: "host",
              machineId: remote.machine.id,
              environmentId: hostProject.environmentId,
              projectId: hostProject.projectId,
              sessionId,
              ...(authorityGeneration == null ? {} : { authorityGeneration }),
            };
          } else {
            if (!onPreparePin || !onConfirmedPin) throw new Error("Pin owner is unavailable.");
            const sessionCwd = summaryById.get(sessionId)?.cwd;
            if (!sessionCwd) throw new Error("Session project identity is unavailable.");
            target = await resolvePinTarget(sessionId, sessionCwd);
            await onPreparePin(sessionId, sessionCwd);
            if (!samePinTarget(target, await resolvePinTarget(sessionId, sessionCwd)))
              throw new Error("The pin owner changed; refresh before retrying.");
          }
          const current = await pinState(target);
          if (current.state !== "current" || current.pinned === null)
            throw new Error("Pin state is unavailable.");
          steps.push({
            viewSessionId: sessionId,
            viewCwd: remoteProject ? cwd : summaryById.get(sessionId)!.cwd,
            viewKind: remoteProject ? "remote" : "local",
            target,
            operationId: newRequestId(),
            desiredPinned,
            expectedVersion: current.version,
            expectedAuthority: current.authority ?? null,
            previousPinned: current.pinned,
            state: "not-started",
          });
        }
        const saga: PinSaga = {
          id: crypto.randomUUID(),
          organizationId: crypto.randomUUID(),
          organization: operation,
          steps,
          state: "prepared",
        };
        const prepared = await preparePinSaga(saga);
        if (prepared !== "applied") {
          organizationUnresolved.current = prepared === "unknown";
          setOrganizationNotice(
            prepared === "unknown"
              ? "Pin preparation outcome is unknown. Check again before another change."
              : "Pin preparation conflicted; refresh before retrying.",
          );
          return;
        }
        sagaPrepared = true;
        const result = await resumePinSaga(saga.id);
        pinConfirmed = result.saga.steps.some((step) => step.state === "applied");
        for (const step of result.saga.steps)
          if (step.state === "applied") {
            if (step.viewKind === "remote") {
              if (remoteProject) refreshRemoteProjectSessions();
            } else
              await onConfirmedPin!(
                step.viewSessionId,
                step.viewCwd,
                step.desiredPinned,
                step.target,
              );
          }
        if (result.state !== "applied" || (operation && result.organization?.state !== "applied")) {
          organizationUnresolved.current = result.state !== "conflict";
          setOrganizationNotice(
            result.state === "unknown"
              ? `Pin change outcome is unknown: ${result.operationId ?? saga.id}`
              : result.state === "applied-unavailable"
                ? `${operation ? "Pin and folder changes were" : "Pin changes were"} applied, but final confirmation failed: ${result.operationId ?? saga.id}`
                : "Pin change is partial. Review the confirmed state before continuing.",
          );
          return;
        }
        setOrganizationNotice(null);
      });
    } catch (error) {
      if (sagaPrepared) organizationUnresolved.current = true;
      setOrganizationNotice(
        pinConfirmed
          ? `A pin was applied; final confirmation failed: ${String(error)}`
          : String(error),
      );
    } finally {
      organizationBusy.current = false;
    }
  };

  const onSessionListDrop = (draggedId: string, target: SessionListDropTarget) => {
    // A selected card carries the whole selection along.
    const dragged =
      selectedSessionIds.has(draggedId) && !contextSelection ? selectedOrderedIds : [draggedId];
    if ((target.kind === "insert" || target.kind === "session") && dragged.includes(target.id)) {
      return;
    }
    let folders = sessionFolders;
    let order = sessionOrder;
    let pinTo: boolean | null = null;
    let createdId = "";
    if (target.kind === "session") {
      const host = folderContaining(sessionFolders, target.id);
      if (host && folderDepth(sessionFolders, host.id) >= MAX_FOLDER_DEPTH) {
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
      }
    } else if (target.kind === "folder") {
      const host = sessionFolders.find((folder) => folder.id === target.id);
      if (!host) return;
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
        folders = arrangeFolderSessions(
          folders,
          host.id,
          moveIdsInOrder(folderMemberIds(host), dragged, target.id, target.place),
        );
      } else {
        // Loose rows always sort by recency; only pins keep a hand-made order.
        pinTo = !!summaryById.get(target.id)?.pinned;
        folders = removeSessionsFromFolders(folders, dragged);
        const pinned = moveIdsInOrder(orderListIds("pinned"), dragged, target.id, target.place);
        if (pinTo) order = { ...order, pinned };
      }
    }
    const pinChanges =
      pinTo === null ? [] : dragged.filter((id) => !!summaryById.get(id)?.pinned !== pinTo);
    if (folders === sessionFolders && order === sessionOrder && pinChanges.length === 0) return;
    if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
      let operation: OrganizationOperation;
      if (target.kind === "session") {
        const host = folderContaining(sessionFolders, target.id);
        operation =
          host && folderDepth(sessionFolders, host.id) >= MAX_FOLDER_DEPTH
            ? {
                kind: "folderInsert",
                cwd,
                folderId: host.id,
                sessionIds: dragged,
                anchorId: target.id,
                place: "after",
                seedOrder: folderMemberIds(host),
              }
            : {
                kind: "create",
                cwd,
                folderId: createdId,
                sessionIds: [target.id, ...dragged],
                parentId: host?.id,
                pinned: !host && !!summaryById.get(target.id)?.pinned,
              };
      } else if (target.kind === "folder") {
        const host = sessionFolders.find((folder) => folder.id === target.id);
        if (!host) return;
        operation = {
          kind: "folderInsert",
          cwd,
          folderId: host.id,
          sessionIds: dragged,
          seedOrder: folderMemberIds(host),
          preserveUnordered: true,
        };
      } else if (target.kind === "pinned") {
        operation = { kind: "assign", cwd, folderId: null, sessionIds: dragged };
      } else {
        const host = folderContaining(sessionFolders, target.id);
        operation = host
          ? {
              kind: "folderInsert",
              cwd,
              folderId: host.id,
              sessionIds: dragged,
              anchorId: target.id,
              place: target.place,
              seedOrder: folderMemberIds(host),
            }
          : {
              kind: "looseInsert",
              cwd,
              list: summaryById.get(target.id)?.pinned ? "pinned" : "loose",
              sessionIds: dragged,
              anchorId: target.id,
              place: target.place,
              seedOrder: orderListIds(summaryById.get(target.id)?.pinned ? "pinned" : "loose"),
            };
      }
      if (pinChanges.length) {
        void performPinSaga(operation, pinChanges, pinTo!).catch((error: unknown) =>
          setOrganizationNotice(String(error)),
        );
        return;
      }
      void performOrganizationOperation(operation, () => {
        if (createdId) setRenamingFolderId(createdId);
      }).catch((error: unknown) => setOrganizationNotice(String(error)));
      return;
    }
    captureListMotion();
    if (folders !== sessionFolders) commitSessionFolders(folders);
    if (order !== sessionOrder) {
      setSessionOrder(order);
      saveSessionOrder(cwd, order);
    }
    if (pinChanges.length > 0) pinSessions(pinChanges, pinTo!);
    if (createdId) setRenamingFolderId(createdId);
  };

  const isSessionDrop = (kind: "folder" | "session", id: string) =>
    (sessionDrop?.kind === "folder" || sessionDrop?.kind === "session") &&
    sessionDrop.kind === kind &&
    sessionDrop.id === id;

  const onSessionCardSelect = (
    sessionId: string,
    event: {
      shiftKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      detail?: number;
    },
  ) => {
    setSessionMenu(null);
    if (selection.select(sessionId, event, sessionNavigationIds, activeListedSessionId)) return;
    setDrawerOpen(false);
    // Opening reads the conversation first (from disk, or over SSH for a
    // remote one); the card says so until it is the open session.
    if (sessionId !== activeListedSessionId) setOpeningSessionId(sessionId);
    // Following another project restores its remembered tab; keep this list in view.
    const target = tab === "sessions" ? summaryById.get(sessionId) : undefined;
    if (target) onTabChange("sessions", target.cwd);
    onSelectSession(sessionId, { keepOpen: (event.detail ?? 0) > 1 });
  };

  // Last sessions rows may sit outside the current project's history, so reload the list.
  const afterListedChange = (work: void | Promise<unknown>) => {
    void Promise.resolve(work)
      .finally(() => lastSessionsData?.refresh())
      .catch((error: unknown) => console.error("Last sessions action failed", error));
  };

  // Cards are memoized. Their handlers go through one stable set that calls
  // the latest version, so a sidebar render no longer re-renders every card.
  const onSessionCardDelete = (sessionId: string) => {
    if (selectedSessionIds.has(sessionId) && !contextSelection) {
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
    setSessionMenu(null);
    selection.longPress(sessionId);
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
    onPinSession: NATIVE_SESSION_ORGANIZATION_ACTIVE
      ? (sessionId: string, pinned: boolean) => pinSessions([sessionId], pinned)
      : onPinSession,
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
    onPinSession: NATIVE_SESSION_ORGANIZATION_ACTIVE
      ? (sessionId: string, pinned: boolean) => pinSessions([sessionId], pinned)
      : onPinSession,
  };
  const cardActions = useMemo(
    () => ({
      select: (
        sessionId: string,
        event: {
          shiftKey: boolean;
          ctrlKey: boolean;
          metaKey: boolean;
          detail?: number;
        },
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
      pin: (sessionId: string, pinned: boolean) =>
        cardHandlers.current.onPinSession?.(sessionId, pinned),
      archive: (sessionId: string, archived: boolean) =>
        cardHandlers.current.onArchiveSession?.(sessionId, archived),
      rename: (sessionId: string) => cardHandlers.current.setRenamingSessionId(sessionId),
      delete: (sessionId: string) => cardHandlers.current.onSessionCardDelete(sessionId),
    }),
    [],
  );

  const liveAgentsById = useMemo(
    () => new Map(liveAgents.filter((agent) => !agent.done).map((agent) => [agent.id, agent])),
    [liveAgents],
  );

  const renderSessionCard = (session: SessionSummary, inPinnedSection = false) => (
    <SessionCard
      session={session}
      renameEditor={
        renamingSessionId === session.id && onRenameSession ? (
          <SessionRenameRow
            session={session}
            onCommit={(title) => {
              const result = onRenameSession(session.id, title);
              if (result) return result.then(() => setRenamingSessionId(null));
              setRenamingSessionId(null);
            }}
            onCancel={() => setRenamingSessionId(null)}
          />
        ) : undefined
      }
      titleFeedback={
        titleActions[session.id] ? (
          titleActions[session.id].pending ? (
            <span className="text-ui-caption text-(--ui-text-secondary)">
              {t("Regenerating title…")}
            </span>
          ) : (
            <Alert tone="danger">
              {titleActions[session.id].error}
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  void regenerateTitle(session).catch(() => {});
                }}
              >
                {t("Retry")}
              </Button>
            </Alert>
          )
        ) : undefined
      }
      isActive={session.id === activeListedSessionId}
      isSelected={selectedSessionIds.has(session.id)}
      selectionMode={showBulkBar}
      busy={listedBusySessionIds.has(session.id)}
      wait={sessionWaits?.get(session.id)}
      startedAt={liveAgentsById.get(session.id)?.startedAt}
      opening={openingSessionId === session.id}
      done={unseenFinishedIds.has(session.id)}
      linkedUpdate={linkedSessionUpdateIds.has(session.id)}
      needsApproval={listedApprovalSessionIds.has(session.id)}
      inputKind={liveAgentsById.get(session.id)?.inputKind}
      dropTarget={isSessionDrop("session", session.id)}
      dropDwell={
        sessionDrop?.kind === "insert" && sessionDrop.id === session.id && !!sessionDrop.dwell
      }
      groupDelayMs={listDisplay.groupDelayMs}
      density={listDisplay.density}
      showModel={listDisplay.showModel}
      showBranch={listDisplay.showBranch}
      inPinnedSection={inPinnedSection}
      onPin={onPinSession ? cardActions.pin : undefined}
      onSelect={cardActions.select}
      onLongPress={cardActions.longPress}
      onOpenWorkItem={onOpenInboxItem && !remoteProject ? cardActions.openWorkItem : undefined}
      onPrefetch={onPrefetchSession ? cardActions.prefetch : undefined}
      onPlaceOnPane={onPlaceSessionOnPane ? cardActions.placeOnPane : undefined}
      onPopOut={onPopOutSession ? cardActions.popOut : undefined}
      onListDrop={reminderIds.has(session.id) || searchNarrowed ? undefined : cardActions.listDrop}
      onListDropTargetChange={setSessionDrop}
      onContextMenu={cardActions.contextMenu}
      settleable={!remoteProject}
      onArchive={onArchiveSession ? cardActions.archive : undefined}
      onRename={
        onRenameSession && !titleActions[session.id]?.pending ? cardActions.rename : undefined
      }
      onDelete={onDeleteSession ? cardActions.delete : undefined}
    />
  );

  const onFolderMove = (folderId: string, target: FolderMoveTarget) => {
    const before = sessionFolders;
    const next = moveFolder(before, folderId, target);
    if (next === before) return;
    if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
      void performOrganizationOperation({ kind: "moveFolder", cwd, folderId, target }).catch(
        (error: unknown) => setOrganizationNotice(String(error)),
      );
      return;
    }
    captureListMotion();
    commitSessionFolders(next);
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
        announceDrag(
          t("Picked up folder {p0}. Escape cancels.", {
            p0: sessionFoldersRef.current.find((item) => item.id === folderId)?.name ?? t("Folder"),
          }),
        );
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
      const folderName = sessionFoldersRef.current.find((item) => item.id === folderId)?.name;
      if (!reported || reported.allowed !== allowed || !sameTarget) {
        reported = { target, allowed };
        markFolderMoveTarget(sessionsScrollRef.current, target, allowed);
        // One sentence per change of target, never per pointer move.
        announceDrag(
          !target || !allowed
            ? t("Cannot drop here")
            : t("{p0}: {p1}", { p0: folderName ?? t("Folder"), p1: folderMoveLabel(target) }),
        );
      }
      if (!target || !allowed) setDropFeedback("blocked", ev, t("Cannot drop here"), folderName);
      else setDropFeedback("move", ev, folderMoveLabel(target), folderName);
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
      window.removeEventListener("blur", onCancel);
      restoreSelection();
      // Also clears the cursor badge and the target mark, committed or not.
      setGrabbing(false);
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
      else announceDrag(t("Move cancelled"));
    }
    cancelFolderDrag.current = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onCancel);
  };

  const renderFolderHeader = (
    entry: FolderEntry,
    depth: number,
    virtual: SessionListVirtualProps,
  ): ReactNode => {
    const expanded = searchNarrowed || !entry.folder.collapsed;
    const folderBusy = entry.allSessions.some((session) => listedBusySessionIds.has(session.id));
    const folderDone = entry.allSessions.some((session) => unseenFinishedIds.has(session.id));
    const folderNeedsApproval = entry.allSessions.some((session) =>
      listedApprovalSessionIds.has(session.id),
    );
    return (
      <SessionFolderListHeader
        entry={entry}
        depth={depth}
        virtual={virtual}
        expanded={expanded}
        renaming={renamingFolderId === entry.folder.id}
        busy={folderBusy}
        done={folderDone}
        needsApproval={folderNeedsApproval}
        nameNode={<SessionSearchText text={entry.folder.name} />}
        menuOpen={folderMenu?.folderId === entry.folder.id}
        onRenameCommit={(name) => {
          if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
            void performOrganizationOperation({
              kind: "rename",
              cwd,
              folderId: entry.folder.id,
              name,
            })
              .then((applied) => {
                if (applied) setRenamingFolderId(null);
              })
              .catch((error: unknown) => setOrganizationNotice(String(error)));
            return;
          }
          commitSessionFolders(renameFolder(sessionFolders, entry.folder.id, name));
          setRenamingFolderId(null);
        }}
        onRenameCancel={() => setRenamingFolderId(null)}
        onPointerDown={
          searchNarrowed ? undefined : (event) => startFolderDrag(entry.folder.id, event)
        }
        onToggle={() => {
          if (performance.now() < skipFolderClickUntil.current || searchNarrowed) return;
          if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
            const collapsed = !entry.folder.collapsed;
            setSessionFolders((folders) => setFolderCollapsed(folders, entry.folder.id, collapsed));
            folderCollapse.toggle(entry.folder.id, collapsed);
            return;
          }
          commitSessionFolders(
            setFolderCollapsed(sessionFolders, entry.folder.id, !entry.folder.collapsed),
          );
        }}
        onContextMenu={(event) => onFolderContextMenu(entry.folder.id, event)}
        onRename={() => setRenamingFolderId(entry.folder.id)}
        onNewSession={onNew ? () => onNewInFolder(entry.folder.id) : undefined}
        onOpenMenu={(anchor) => openFolderMenuAt(entry.folder.id, anchor)}
      />
    );
  };

  const renderSessionListRow = (
    row: SessionListRow,
    virtual: SessionListVirtualProps,
  ): ReactNode => {
    if (row.kind === "folder") return renderFolderHeader(row.entry, row.depth, virtual);
    if (row.kind === "session") {
      return (
        <SessionListItem
          key={row.key}
          session={row.session}
          cwd={cwd}
          motion={sessionInsertMotion}
          virtual={virtual}
          depth={row.depth}
          folderId={row.folderId}
          groupSection={row.groupSection}
        >
          {renderSessionCard(row.session, row.section === "pinned" || row.section === "reminders")}
        </SessionListItem>
      );
    }
    return (
      <SessionGroupListRow
        entry={row.entry}
        virtual={virtual}
        expanded={searchNarrowed || !row.entry.collapsed}
        busyIds={listedBusySessionIds}
        doneIds={unseenFinishedIds}
        approvalIds={listedApprovalSessionIds}
        reminderColor={REMINDERS_COLOR}
        renderName={(name) => <SessionSearchText text={name} />}
        onArchiveAll={onArchiveSessions && ((ids) => onArchiveSessions(ids, true))}
        onDeleteAll={onDeleteSessions}
        onToggle={() => {
          if (searchNarrowed) return;
          const collapsed = !row.entry.collapsed;
          if (row.entry.kind === "settled") setSettledCollapsed(collapsed);
          else if (row.entry.kind === "reminders") {
            setReminderSessionsCollapsed(collapsed);
            saveReminderSessionsCollapsed(cwd, collapsed);
          } else {
            setPinnedSessionsCollapsed(collapsed);
            savePinnedSessionsCollapsed(cwd, collapsed);
          }
        }}
      />
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
    // The menu aligns its end edge to this point, under the button's end edge.
    setFilterMenu({ x: rect.right, y: rect.bottom + 2 });
  };

  // The session list's own tools sit in the Workspace header row: an inline filter that opens from
  // its icon, bulk select and the filter popover. The global search stays the top-left Search.
  const showSessionTools =
    tab === "sessions" && (lastSessionsOpen || (Boolean(cwd) && cwd !== "~"));
  if (!showSessionTools && sessionSearchExpanded) setSessionSearchExpanded(false);
  const sessionToolbar = showSessionTools ? (
    <div
      data-session-selection-keep
      data-session-tools=""
      className="ms-auto flex min-w-fit flex-1 items-center justify-end gap-0.5"
      data-tauri-drag-region="false"
    >
      {remoteProject && !lastSessionsOpen ? (
        <RemoteDataStatus
          cwd={cwd}
          presentation="indicator"
          state={remote.dataState}
          connectionIssueHandled={remoteConnectionIssue}
          label={
            remote.machine ? t("sessions from {p0}", { p0: remote.machine.name }) : t("sessions")
          }
          onRefresh={remote.refresh}
          disabled={!remote.machine && !remote.dataState.error}
        />
      ) : null}
      <div
        className="min-w-(--ui-control-height-compact) max-w-[248px] flex-1"
        style={
          sessionSearchExpanded
            ? { minWidth: "calc(var(--ui-control-height-compact) * 3)" }
            : undefined
        }
      >
        <ExpandingSearch
          ref={sessionSearchRef}
          inline
          constrainToSlot
          onExpandedChange={setSessionSearchExpanded}
          anchor="end"
          expandedWidth={248}
          items={NO_SEARCH_ITEMS}
          label={t("Search conversations")}
          activeLabel={t("Search conversations, filtering by “{p0}”", {
            p0: searchQuery.trim(),
          })}
          placeholder={t("Search conversations...")}
          query={searchQuery}
          onQueryChange={setSearchQuery}
        />
      </div>
      {!sessionSearchExpanded && !lastSessionsOpen ? (
        <SessionsHeaderButton
          label={selectionMode ? t("Stop selecting") : t("Select conversations")}
          active={selectionMode}
          onClick={() => {
            if (selectionMode) {
              clearSessionSelection();
              return;
            }
            setSessionMenu(null);
            selection.enterMode();
          }}
        >
          <CheckList className="icon-xs" strokeWidth={1.75} />
        </SessionsHeaderButton>
      ) : null}
      {!sessionSearchExpanded ? (
        <SessionsHeaderButton
          label={t("Filter sessions")}
          active={filtersActive}
          open={!!filterMenu}
          hasPopup
          onClick={onFilterButtonClick}
        >
          <ListFilter className="icon-xs" strokeWidth={1.75} />
        </SessionsHeaderButton>
      ) : null}
    </div>
  ) : null;

  const onTabPick = (itemId: SidebarTabId) => {
    onTabChange(itemId);
  };

  // The menu alternative to dragging a view tab, disabled at the ends of the row.
  const viewTabIndex = viewTabMenu ? visibleTabs.indexOf(viewTabMenu.tabId) : -1;
  const viewTabMenuItems: ExplorerMenuItem[] =
    viewTabIndex < 0
      ? EMPTY_MENU_ITEMS
      : [
          {
            kind: "item",
            id: "move-left",
            get label() {
              return t("Move Left");
            },
            disabled: viewTabIndex === 0,
          },
          {
            kind: "item",
            id: "move-right",
            get label() {
              return t("Move Right");
            },
            disabled: viewTabIndex === visibleTabs.length - 1,
          },
        ];
  const onViewTabMenuPick = (id: string) => {
    const tabId = viewTabMenu?.tabId;
    setViewTabMenu(null);
    if (tabId && (id === "move-left" || id === "move-right")) {
      sortable.moveBy(tabId, id === "move-left" ? -1 : 1);
    }
  };

  const changeAdditions = changeStats?.additions ?? 0;
  const changeDeletions = changeStats?.deletions ?? 0;
  // Two different measures: how many files changed, and how many lines (churn).
  // Each is named wherever it is shown so the two are never read as one number.
  const changeFileCount = changeStats?.files ?? 0;
  const hasChangeStats = changeAdditions > 0 || changeDeletions > 0;
  const changedFilesText =
    changeFileCount > 0
      ? t(changeFileCount === 1 ? "{p0} changed file" : "{p0} changed files", {
          p0: changeFileCount,
        })
      : "";
  const changeChurnText = hasChangeStats
    ? [
        changeAdditions > 0 ? t("{p0} lines added", { p0: changeAdditions }) : "",
        changeDeletions > 0 ? t("{p0} lines removed", { p0: changeDeletions }) : "",
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  const changesLabel = [TAB_LABELS.changes, changeScopeLabel, changedFilesText, changeChurnText]
    .filter(Boolean)
    .join(", ");
  // The Sessions badge counts working sessions, not all sessions.
  const sessionsLabel = workingSessionCount
    ? `${TAB_LABELS.sessions}, ${t(
        workingSessionCount === 1 ? "{p0} working session" : "{p0} working sessions",
        { p0: workingSessionCount },
      )}`
    : TAB_LABELS.sessions;

  const workspaceTabItems = visibleTabs.map((itemId) => {
    const isChangesTab = itemId === "changes";
    const Icon = COMPACT_TAB_ICONS[itemId];
    const label = isChangesTab
      ? changesLabel
      : itemId === "sessions"
        ? sessionsLabel
        : TAB_LABELS[itemId];
    const tabDetails = isChangesTab
      ? changesTooltipDetails({
          scope: changeScope,
          path: lastSessionsOpen ? gitRoot : undefined,
          files: changeFileCount,
          additions: changeAdditions,
          deletions: changeDeletions,
        })
      : itemId === "sessions" && workingSessionCount > 0
        ? [
            t(workingSessionCount === 1 ? "{p0} working session" : "{p0} working sessions", {
              p0: workingSessionCount,
            }),
          ]
        : [];
    return (
      <div
        key={itemId}
        ref={(el) => sortable.setItemRef(itemId, el)}
        className={`reorder-item workspace-tab relative flex min-w-0 touch-none items-stretch ${(itemId === "sessions" && workingSessionsBadge) || (isChangesTab && hasChangeStats) ? "flex-[1.4]" : "flex-1"}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          sortable.onItemPointerDown(itemId, event);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setViewTabMenu({ x: event.clientX, y: event.clientY, tabId: itemId });
        }}
      >
        <Tab
          value={itemId}
          type="button"
          // Alt+Arrow moves the view tab without dragging; the menu offers the same move.
          onKeyDown={(event) => {
            sortable.onItemKeyDown(itemId, event);
          }}
          data-workspace-tab-counted={
            (itemId === "sessions" && workingSessionsBadge) ||
            (isChangesTab && (changeFileCount > 0 || hasChangeStats))
              ? ""
              : undefined
          }
          data-workspace-tab-churn={isChangesTab && hasChangeStats ? "" : undefined}
          aria-label={label}
          tooltip={TAB_LABELS[itemId]}
          tooltipWhen="overflow"
          tooltipDetails={tabDetails}
          tooltipWide
          data-usage-guide={isChangesTab ? "changes" : itemId === "files" ? "files-tab" : undefined}
          data-tauri-drag-region="false"
          onClick={(event) => {
            event.preventDefault();
            if (sortable.consumeClick()) return;
            onTabPick(itemId);
          }}
          className="flex min-w-0 flex-1 items-center justify-center gap-1 self-center overflow-hidden px-1 leading-none"
        >
          <Icon className="workspace-tab-icon" aria-hidden="true" />
          <span className="workspace-tab-content flex min-w-0 items-center justify-center">
            {/* The label is never clipped: the container steps in bycoda.css drop it, then the
                churn, then the badge before any of them would need an ellipsis. */}
            <span className="workspace-tab-label block whitespace-nowrap leading-label">
              {TAB_LABELS[itemId]}
            </span>
          </span>
          {/* Outside the label so the churn outlives it: the icon already names the tab. */}
          {isChangesTab && hasChangeStats ? (
            <span className="workspace-tab-stats ms-1 min-w-0">
              <DiffStat additions={changeAdditions} deletions={changeDeletions} />
            </span>
          ) : null}
          {/* Outside .workspace-tab-content so they survive the icon-only widths. Wide and medium
              tabs show the badge, narrow tabs a smaller one, the narrowest only a presence dot.
              The file count is its own measure, with or without line churn (binary, mode-only,
              conflict and count-only changes have no +/-). */}
          {isChangesTab && changeFileCount > 0 ? (
            <>
              <span className="workspace-tab-badge">
                <Badge
                  variant="count"
                  size="sm"
                  tone="accent"
                  appearance="subtle"
                  max={99}
                  data-workspace-tab-file-count=""
                  role="img"
                  label={[changeScopeLabel, changedFilesText].filter(Boolean).join(", ")}
                  className="ms-1 shrink-0"
                >
                  {changeFileCount}
                </Badge>
              </span>
              <StatusDot label={changedFilesText} aria-hidden className="workspace-tab-dot" />
            </>
          ) : isChangesTab && hasChangeStats ? (
            <span
              className="workspace-tab-stats-compact"
              role="img"
              aria-label={[changeScopeLabel, changeChurnText].filter(Boolean).join(", ")}
            >
              <StatusDot
                label={changeChurnText}
                tone="neutral"
                aria-hidden
                className="self-center"
              />
            </span>
          ) : null}
          {itemId === "sessions" && workingSessionsBadge ? (
            <>
              <span className="workspace-tab-badge">{workingSessionsBadge}</span>
              <StatusDot label={t("Working")} aria-hidden className="workspace-tab-dot" />
            </>
          ) : null}
        </Tab>
      </div>
    );
  });

  // With no title bar above, back/forward and the workspace controls share this one row instead
  // of leaving an empty row over the Workspace selector.
  const workspaceHeader = (withVisitNav = false) => {
    const switcher = !lastSessionsOpen && !remoteProject && cwd && cwd !== "~";
    return (
      <PaneHeader
        dragRegion
        chromeInset={withVisitNav}
        leading={
          withVisitNav ? (
            <TabVisitNav
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onGoBack={onGoBack}
              onGoForward={onGoForward}
            />
          ) : undefined
        }
        title={switcher ? undefined : t(lastSessionsOpen ? "Last sessions" : "Workspace")}
        titleAs="div"
        actions={
          <>
            <WorkspaceTitleActions
              onNew={
                lastSessionsOpen
                  ? onNewListedSession
                    ? () => setNewSessionProjectOpen(true)
                    : undefined
                  : onNew
              }
            />
          </>
        }
      >
        {switcher ? (
          <SidebarWorktreeSwitcher
            cwd={cwd}
            tabStats={worktreeTabStats}
            onSelect={onSelectWorkspace}
            pending={workspaceSwitchPending}
            switchError={workspaceSwitchError}
          />
        ) : null}
        {sessionToolbar}
      </PaneHeader>
    );
  };

  const sidebarContent = (
    <aside
      onPointerEnter={() => {
        void preloadSidebarSurfaces().catch(() => {});
      }}
      onFocusCapture={() => {
        void preloadSidebarSurfaces().catch(() => {});
      }}
      onKeyDown={(event) => {
        // "/" and Ctrl/Cmd+F open the session filter while focus is in the Sessions panel.
        if (!showSessionTools || event.defaultPrevented) return;
        const target = event.target instanceof Element ? event.target : null;
        if (
          target?.closest("input,textarea,select,[contenteditable],[role='dialog'],[role='menu']")
        )
          return;
        const find =
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === "f";
        const slash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey;
        if (!find && !slash) return;
        event.preventDefault();
        sessionSearchRef.current?.expand();
      }}
      ref={resize.setPaneRef}
      data-side-pane="workspace"
      className={`bycoda-sidebar body-glass sidebar-pane ${styles.pane} relative flex h-full min-h-0 shrink-0 flex-col border-r border-(--ui-pane-border) pe-1.5`}
    >
      {railVisible ? (
        <>
          {workspaceHeader()}
          <WorkspaceTabList
            value={tab}
            className="bycoda-workspace-tabs flex shrink-0 items-center gap-px border-b border-(--ui-pane-border)"
          >
            {workspaceTabItems}
          </WorkspaceTabList>
        </>
      ) : (
        <>
          {titleBarAbove || compactRailVisible ? null : (
            <PaneHeader
              dragRegion
              chromeInset
              actions={
                <TabVisitNav
                  canGoBack={canGoBack}
                  canGoForward={canGoForward}
                  onGoBack={onGoBack}
                  onGoForward={onGoForward}
                  onTogglePanel={compactProjectRail ? undefined : onToggleProjectRail}
                />
              }
            />
          )}
          {compactRailVisible ? workspaceHeader(!titleBarAbove) : null}
          {lastSessionsOpen && !compactRailVisible ? (
            workspaceHeader()
          ) : onSelectProject && !compactRailVisible ? (
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
              onOpenServers={onOpenServers}
              serversActive={serversActive}
              onOpenAutomations={onOpenAutomations}
              onOpenTasks={onOpenTasks}
              searchActive={searchActive}
              inboxActive={inboxActive}
              notesActive={notesActive}
              automationsActive={automationsActive}
              tasksActive={tasksActive}
              socialActive={socialActive}
              assistantActive={assistantActive}
              inboxUnseen={inboxUnseen}
            />
          ) : null}
          <WorkspaceTabList
            value={tab}
            className="bycoda-workspace-tabs flex shrink-0 items-center gap-px overflow-visible border-b border-(--ui-pane-border)"
          >
            {workspaceTabItems}
          </WorkspaceTabList>
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
                visible={tab === "files"}
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
            <p className="px-3 py-2 text-ui-caption text-(--ui-text-secondary)">
              {t("No project folder")}
            </p>
          )}
        </div>
        {/* The tools live in the Workspace header row; without that row they get their own slim one. */}
        {sessionToolbar && !railVisible && !compactRailVisible ? (
          <PaneHeader actions={sessionToolbar} />
        ) : null}
        {tab === "sessions" && !lastSessionsOpen && cwd && cwd !== "~" && showBulkBar ? (
          <div
            role="toolbar"
            aria-label={t("Selected conversations")}
            data-session-bulk-bar
            data-session-selection-keep
            className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-(--ui-pane-border) px-2 py-1 text-ui-caption text-(--ui-text-secondary)"
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
                    <SplitSquare className="icon-xs" strokeWidth={1.75} />
                  </BulkBarAction>
                ) : null}
                {onPinSession || onPinSessions ? (
                  <BulkBarAction
                    label={allSelectedPinned ? t("Unpin") : t("Pin")}
                    disabled={deleting}
                    onClick={() => pinSessions(selectedOrderedIds, !allSelectedPinned)}
                  >
                    <Pin className="icon-xs" strokeWidth={1.75} />
                  </BulkBarAction>
                ) : null}
                {onArchiveSession || onArchiveSessions ? (
                  <BulkBarAction
                    label={allSelectedArchived ? t("Unarchive") : t("Archive")}
                    disabled={deleting}
                    onClick={() => archiveSessions(selectedOrderedIds, !allSelectedArchived)}
                  >
                    <Archive className="icon-xs" strokeWidth={1.75} />
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
                      <Spinner size="xs" />
                    ) : (
                      <Trash2 className="icon-xs" strokeWidth={1.75} />
                    )}
                  </BulkBarAction>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}
        <SessionDeletionNotice cwd={cwd} />
        {tab === "sessions" &&
        (deleteProgress?.cwd === cwd || (bulkNotice && deleteNoticeCwd === cwd)) ? (
          <InlineMessage
            tone={deleteNoticeError && !deleteProgress ? "danger" : "neutral"}
            live={deleteNoticeError && !deleteProgress ? "assertive" : "polite"}
            icon={
              deleteProgress ? (
                <Spinner />
              ) : deleteNoticeError ? undefined : (
                <Check className="icon-xs" aria-hidden />
              )
            }
            action={
              deleteProgress ? undefined : (
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
              )
            }
            data-session-delete-status
            className="shrink-0 border-b border-(--ui-pane-border) px-3 py-2"
          >
            {deleteProgress
              ? t("Deleting conversations… {p0}/{p1} completed", {
                  p0: deleteProgress.completed,
                  p1: deleteProgress.total,
                })
              : bulkNotice}
          </InlineMessage>
        ) : null}
        {tab === "sessions" && remoteProject && !lastSessionsOpen ? (
          !remote.machine && remote.dataState.error && remoteConnectionIssue ? (
            <RemoteLoadError cwd={cwd} failure={classifyRemoteError(remote.dataState.error)} />
          ) : (
            <RemoteDataStatus
              cwd={cwd}
              presentation="notice"
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
            retainSessionsScroll(el);
            sessionsScrollRef.current = el;
          }}
          data-session-list-panel
          className={`sidebar-session-scroll min-h-0 flex-1 overflow-y-auto overscroll-none ${
            tab === "sessions" ? "" : "hidden"
          }`}
        >
          {lastSessionsOpen ? (
            <SessionSearchQueryContext.Provider value={deferredSearchQuery}>
              {lastSessionsData?.remoteHistoryLimited && !lastSessionsData.rows.length ? (
                <p className="px-3 py-2 text-ui-caption text-(--ui-text-secondary)">
                  {t("Remote sessions shown from available history")}
                </p>
              ) : null}
              {lastSessionsData?.error && !lastSessionsData.rows.length ? (
                <Alert tone="danger">
                  <p>{t("Couldn’t load sessions")}</p>
                  <Button
                    variant="ghost"
                    motion="none"
                    type="button"
                    onClick={lastSessionsData.refresh}
                  >
                    {t("Retry")}
                  </Button>
                </Alert>
              ) : null}
              {lastSessionsData?.loading && !lastSessionsData.rows.length ? (
                <p role="status" className="px-3 py-2 text-ui-caption text-(--ui-text-secondary)">
                  {t("Loading conversations…")}
                </p>
              ) : lastSessionsData?.error && !lastSessionsData.rows.length ? null : (
                (() => {
                  const rows = filterSessionsByQuery(
                    filterSessionsByStatus(
                      filterSessionsByTime(
                        filterSessionsByHarness(
                          filterAssistantManagedSessions(
                            filterSessionsByArchive(
                              lastSessionsData?.rows ?? [],
                              globalSessionFilters.showArchived,
                            ),
                            globalSessionFilters.assistantManaged,
                          ),
                          globalSessionFilters.hiddenHarnesses,
                        ),
                        globalSessionFilters.time,
                        now,
                      ),
                      globalSessionFilters.status,
                      busySessionIds,
                      approvalSessionIds,
                      unseenFinishedIds,
                    ),
                    deferredSearchQuery,
                  );
                  return rows.length ? (
                    <GlobalSessionListWindow
                      sessions={rows}
                      scrollRef={sessionsScrollRef}
                      isActive={(session) =>
                        sameProjectPath(session.cwd, cwd) &&
                        (session.id === activeSessionId ||
                          (isRemoteProjectPath(session.cwd) && session.id === activeRemoteId))
                      }
                      renderSession={(session, active) => (
                        <SessionCard
                          session={session}
                          isActive={active}
                          isSelected={false}
                          busy={busySessionIds.has(session.id)}
                          wait={sessionWaits?.get(session.id)}
                          done={unseenFinishedIds.has(session.id)}
                          linkedUpdate={linkedSessionUpdateIds.has(session.id)}
                          needsApproval={approvalSessionIds.has(session.id)}
                          startedAt={liveAgentsById.get(session.id)?.startedAt}
                          inputKind={liveAgentsById.get(session.id)?.inputKind}
                          groupDelayMs={listDisplay.groupDelayMs}
                          density={listDisplay.density}
                          showModel={listDisplay.showModel}
                          showBranch={listDisplay.showBranch}
                          showProjectAppearance
                          onPin={
                            !isRemoteProjectPath(session.cwd) &&
                            session.cwd !== "~" &&
                            onPinListedSession
                              ? (id, pinned) => onPinListedSession(id, session.cwd, pinned)
                              : undefined
                          }
                          onArchive={
                            !isRemoteProjectPath(session.cwd) && onArchiveLocalSession
                              ? (id, archived) =>
                                  afterListedChange(onArchiveLocalSession(id, archived, session))
                              : undefined
                          }
                          onDelete={
                            !isRemoteProjectPath(session.cwd) && onDeleteLocalSession
                              ? (id) => afterListedChange(onDeleteLocalSession(id, session))
                              : undefined
                          }
                          onSelect={(id, event) =>
                            onSelectListedSession?.(id, session.cwd, {
                              keepOpen: (event.detail ?? 0) > 1,
                            })
                          }
                        />
                      )}
                    />
                  ) : (
                    <SessionsEmpty
                      message={
                        narrowedByUser ? "No matching sessions" : "No sessions in the last 7 days"
                      }
                    />
                  );
                })()
              )}
              {lastSessionsData?.rows.length ? (
                <CollectionFooter
                  loading={lastSessionsData.loading}
                  error={lastSessionsData.error && t("Couldn’t load sessions")}
                  onRetry={lastSessionsData.refresh}
                  partial={
                    lastSessionsData.remoteHistoryLimited
                      ? t("Remote sessions shown from available history")
                      : null
                  }
                />
              ) : null}
            </SessionSearchQueryContext.Provider>
          ) : !cwd || cwd === "~" ? (
            <p className="px-3 py-2 text-ui-caption text-(--ui-text-secondary)">
              {t("No project folder")}
            </p>
          ) : (
            <SessionSearchQueryContext.Provider value={deferredSearchQuery}>
              <div>
                {onOpenCrewSession && (
                  <CrewSidebar
                    key={cwd}
                    cwd={cwd}
                    query={searchQuery}
                    onOpen={onOpenCrewSession}
                    onManagedChange={onCrewManagedChange}
                  />
                )}
                {/* Loading and errors precede empty results, so an unfinished
                  request never claims this project has no conversations. */}
                {remoteProject &&
                projectSessions.length === 0 &&
                !["ready", "empty"].includes(remote.dataState.phase) ? null : pendingFirstLoad ? (
                  <p
                    role="status"
                    className="flex items-center gap-2 px-3 py-2 text-ui-caption text-(--ui-text-secondary)"
                  >
                    <Spinner className="shrink-0" />
                    {remoteLoading
                      ? remote.machine
                        ? t("Loading sessions from {p0}…", { p0: remote.machine.name })
                        : t("Connecting to this project’s machine…")
                      : t("Loading conversations…")}
                  </p>
                ) : remoteProject && remote.failed && projectSessions.length === 0 ? (
                  <Alert tone="danger">
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
                  <Alert tone="danger">{t("Couldn’t load sessions")}</Alert>
                ) : visibleSessions.length === 0 ? (
                  // A narrowed-down result is a transient answer to what the user
                  // just typed, so it stays compact. Only the genuine
                  // "this project has nothing in it" case earns the illustration.
                  narrowedByUser ? (
                    (() => {
                      const clearFilters =
                        filtersActive && listedSessions.length > 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            motion="none"
                            type="button"
                            onClick={() => onSessionFiltersChange(DEFAULT_SESSION_SIDEBAR_FILTERS)}
                          >
                            {t("Clear filters (")}
                            {listedSessions.length}{" "}
                            {listedSessions.length === 1 ? t("session") : t("sessions")}{" "}
                            {t("hidden)")}
                          </Button>
                        ) : null;
                      return searchNarrowed ? (
                        <SessionsNoMatch
                          query={searchQuery.trim()}
                          onSearchAll={
                            onSearchConversations || onSearch
                              ? () => {
                                  if (onSearchConversations)
                                    onSearchConversations(searchQuery.trim());
                                  else onSearch?.();
                                }
                              : undefined
                          }
                          onClear={() => setSearchQuery("")}
                        >
                          {clearFilters}
                        </SessionsNoMatch>
                      ) : (
                        <div className="flex flex-col items-start gap-1.5 px-3 py-2 text-ui-caption text-(--ui-text-secondary)">
                          <p role="status">{t("No sessions match these filters")}</p>
                          {clearFilters}
                        </div>
                      );
                    })()
                  ) : remoteProject && !remote.machine ? (
                    <p className="px-3 py-2 text-ui-caption text-(--ui-text-secondary)">
                      {t("This project’s machine isn’t connected on this computer.")}
                    </p>
                  ) : (
                    <SessionsEmpty message="Sessions you start will show up here" />
                  )
                ) : (
                  <SessionListWindow
                    rows={flatSessionRows}
                    scrollRef={sessionsScrollRef}
                    activeKey={activeListedSessionId ?? null}
                    renderRow={renderSessionListRow}
                  />
                )}
              </div>
            </SessionSearchQueryContext.Provider>
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
            {/* The live-session summary is its own band: a thin divider and a surface step
                set it apart from the scrolling list above, whatever the tab. */}
            <div
              data-live-agents-band
              className="mt-1 shrink-0 border-t border-(--ui-pane-border) px-2 pt-2 empty:hidden"
            >
              <LiveAgentsPreview
                agents={liveAgents}
                currentProject={lastSessionsOpen ? undefined : cwd}
                activeSessionId={activeSessionId}
                onSelect={onSelectAgent}
                bottomSpacing={compactRailVisible}
                collapsible
              />
            </div>
            <SidebarUpdateFooter
              noticesOnly
              update={updateNotice}
              onOpenWhatsNew={onOpenWhatsNew}
              onDismissUpdate={onDismissUpdate}
            />
            {!compactProjectRail ? (
              <SidebarAccountFooter
                onOpenSettings={onOpenSettings}
                onOpenAccountSettings={openAccountSettings}
              />
            ) : null}
          </>
        ) : null}
        {railVisible || titleBarAbove ? null : <DevModeIndicator />}
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
      {viewTabMenu && viewTabIndex >= 0 ? (
        <ExplorerMenu
          x={viewTabMenu.x}
          y={viewTabMenu.y}
          items={viewTabMenuItems}
          ariaLabel={`${t(TAB_LABELS[viewTabMenu.tabId])} tab actions`}
          onPick={onViewTabMenuPick}
          onClose={() => setViewTabMenu(null)}
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
      {newSessionProjectOpen && onNewListedSession ? (
        <NewSessionProjectDialog
          projects={visibleRecents}
          onPick={onNewListedSession}
          onClose={() => setNewSessionProjectOpen(false)}
        />
      ) : null}
      {organizationNotice ? (
        <TransientNotice
          message={organizationNotice}
          action={
            organizationUnresolved.current
              ? {
                  label: t("Check and continue"),
                  onClick: () => {
                    void (async () => {
                      const sagas = (await listPinSagas()).filter(
                        (saga) => saga.state !== "applied" && saga.state !== "accepted",
                      );
                      for (const saga of sagas) {
                        const result = await withRoomPrivacyMutation(() => {
                          if (
                            saga.steps.some((step) => isProjectPasswordLocked(step.viewCwd)) ||
                            (saga.organization && isProjectPasswordLocked(saga.organization.cwd))
                          )
                            throw new Error("Project is locked.");
                          return resumePinSaga(saga.id);
                        });
                        for (const step of result.saga.steps)
                          if (step.state === "applied" && step.viewKind === "local")
                            await onConfirmedPin?.(
                              step.viewSessionId,
                              step.viewCwd,
                              step.desiredPinned,
                              step.target,
                            );
                      }
                      if (remoteProject) refreshRemoteProjectSessions();
                      const remaining = (await listPinSagas()).filter(
                        (saga) => saga.state !== "applied" && saga.state !== "accepted",
                      );
                      setPartialPinSagas(remaining.filter((saga) => saga.state === "partial"));
                      if (remaining.length) {
                        setOrganizationNotice(`Pin change needs review: ${remaining[0].id}`);
                        return;
                      }
                      const pending = await unresolvedSessionOrganizationGestures();
                      if (pending.length) {
                        setOrganizationNotice(
                          `Folder change outcome is unknown: ${pending[0].operationId}`,
                        );
                        return;
                      }
                      await hydrateSessionOrganization();
                      organizationUnresolved.current = false;
                      setOrganizationNotice("Folder state refreshed. Review your change.");
                    })().catch((error: unknown) => setOrganizationNotice(String(error)));
                  },
                }
              : roomPrivacyRetryAction(
                  () => setOrganizationNotice(null),
                  (error) => setOrganizationNotice(String(error)),
                )
          }
          actions={
            partialPinSagas.length ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void (async () => {
                    for (const saga of partialPinSagas) {
                      const acknowledged = await withRoomPrivacyMutation(() => {
                        if (saga.steps.some((step) => isProjectPasswordLocked(step.viewCwd)))
                          throw new Error("Project is locked.");
                        return acknowledgePartialPinSaga(saga.id);
                      });
                      if (acknowledged !== "applied")
                        throw new Error("Pin acknowledgement could not be confirmed.");
                    }
                    setPartialPinSagas([]);
                    const remaining = (await listPinSagas()).filter(
                      (saga) => saga.state !== "applied" && saga.state !== "accepted",
                    );
                    if (
                      !remaining.length &&
                      !(await unresolvedSessionOrganizationGestures()).length
                    ) {
                      await hydrateSessionOrganization();
                      organizationUnresolved.current = false;
                      setOrganizationNotice("Confirmed pin changes kept. Review the folder state.");
                    }
                  })().catch((error: unknown) => setOrganizationNotice(String(error)));
                }}
              >
                {t("Keep confirmed changes")}
              </Button>
            ) : undefined
          }
          onDismiss={() => {
            if (!organizationUnresolved.current) setOrganizationNotice(null);
          }}
        >
          {partialPinSagas.flatMap((saga) =>
            saga.steps
              .filter((step) => !isProjectPasswordLocked(step.viewCwd))
              .map((step) => (
                <div key={`${saga.id}:${step.operationId}`}>
                  {step.viewSessionId}: {step.state} (
                  {step.desiredPinned ? t("Pinned") : t("Unpinned")})
                </div>
              )),
          )}
        </TransientNotice>
      ) : null}
      {filterMenu ? (
        <SessionFiltersMenu
          x={filterMenu.x}
          y={filterMenu.y}
          harnesses={sessionHarnesses}
          local={!remoteProject}
          settled={!remoteProject && !lastSessionsOpen}
          filters={lastSessionsOpen ? globalSessionFilters : sessionFilters}
          allowedTimeFilters={lastSessionsOpen ? GLOBAL_SESSION_TIME_FILTERS : undefined}
          defaultFilters={lastSessionsOpen ? GLOBAL_SESSION_FILTERS : undefined}
          onChange={lastSessionsOpen ? setGlobalSessionFilters : onSessionFiltersChange}
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
      {copyIdFailure ? (
        <Modal title={t("Session ID")} size="sm" onClose={() => setCopyIdFailure(null)}>
          <div className="flex flex-col gap-3">
            <Alert tone="danger">
              {t("Could not copy the session ID. Select it below to copy manually, or retry.")}{" "}
              {copyIdFailure.error}
            </Alert>
            <TextField
              label={t("Session ID")}
              aria-label={t("Session ID")}
              value={copyIdFailure.value}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              loading={copyIdRetrying}
              onClick={() => {
                if (copyIdRetrying) return;
                const value = copyIdFailure.value;
                setCopyIdRetrying(true);
                void copyText(value)
                  .then(
                    () => setCopyIdFailure(null),
                    (error) => setCopyIdFailure({ value, error: String(error) }),
                  )
                  .finally(() => setCopyIdRetrying(false));
              }}
            >
              {t("Retry")}
            </Button>
          </div>
        </Modal>
      ) : null}
      {/* useDragResize owns the drag (Escape cancels), keys and double-click reset through sashProps. */}
      <Sash
        {...resize.sashProps}
        label={t("Resize sidebar")}
        appearance="hidden"
        className="absolute inset-y-0 end-0"
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
          onOpenLastSessions={onOpenLastSessions}
          lastSessionsOpen={lastSessionsOpen}
          onPreviewSession={onPreviewSession}
          recoveryControl={recoveryControl}
          cwd={cwd}
          workingSessionsBadge={workingSessionsBadge}
          recents={visibleRecents}
          tabShown={open}
          inboxUnseen={inboxUnseen}
          onSelectProject={onSelectProject}
          onOpenProjectNavigation={
            onOpenProject ? (anchor) => setProjectNavigationAnchor(anchor) : undefined
          }
          projectNavigationOpen={Boolean(projectNavigationAnchor)}
          onOpenWorkspace={() => {
            if (!sidebarAvailable) onGoBack?.();
            if (!open) setDrawerOpen(!drawerVisible);
          }}
          onSearch={onSearch}
          searchActive={searchActive}
          onOpenInbox={onOpenInbox}
          inboxActive={inboxActive}
          onOpenNotificationSettings={onOpenNotificationSettings}
          onOpenNotes={notesEnabled ? onOpenNotes : undefined}
          onOpenServers={onOpenServers}
          serversActive={serversActive}
          notesActive={notesActive}
          onOpenAutomations={onOpenAutomations}
          onOpenTasks={onOpenTasks}
          automationsActive={automationsActive}
          tasksActive={tasksActive}
          socialActive={socialActive}
          assistantActive={assistantActive}
          onOpenSettings={onOpenSettings}
          onOpenAccountSettings={openAccountSettings}
          onOpenCrews={
            onSelectSettingsSection && onOpenSettings
              ? () => {
                  onOpenSettings();
                  onSelectSettingsSection("crews");
                }
              : undefined
          }
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
          onOpenLastSessions={onOpenLastSessions}
          lastSessionsOpen={lastSessionsOpen}
          onSelectListedSession={onSelectListedSession}
          onPreviewSession={onPreviewSession}
          onOpenCrewSession={onOpenCrewSession}
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
          onOpenServers={onOpenServers}
          serversActive={serversActive}
          notesActive={notesActive}
          onOpenAutomations={onOpenAutomations}
          onOpenTasks={onOpenTasks}
          automationsActive={automationsActive}
          tasksActive={tasksActive}
          socialActive={socialActive}
          assistantActive={assistantActive}
          onTogglePanel={onToggleProjectRail}
          onSelectProject={onSelectProject}
          onOpenProject={onOpenProject}
          onOpenSyncedProject={onOpenSyncedProject}
          onRemoveProject={onRemoveProject}
          settingsOpen={settingsOpen}
          settingsDialogOpen={settingsDialogOpen}
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
      {compactRailVisible && projectNavigationAnchor && onSelectProject && onOpenProject ? (
        <Popover
          anchor={projectNavigationAnchor}
          side="right"
          autoFocus
          align="start"
          width={320}
          maxHeight={760}
          onDismiss={() => setProjectNavigationAnchor(null)}
          role="dialog"
          aria-label={t("Projects and groups")}
          data-project-navigation-flyout
          // The popover bounds its own height to the room left in the window. The ledger is
          // the one scroll owner, so the nested rail has to be allowed to shrink to fit.
          className="flex min-h-0 flex-col [&>nav]:min-h-0 [&>nav]:w-full! [&>nav]:max-w-full [&>nav]:flex-1 [&>nav]:shrink"
        >
          <ProjectsFlyoutChrome
            onNewProject={() => {
              setProjectNavigationAnchor(null);
              void onOpenProject();
            }}
            onExpand={() => {
              setProjectNavigationAnchor(null);
              onToggleProjectRail?.();
            }}
          >
            {(projectFilter) => (
              <ProjectRail
                visible
                presentation="navigator"
                projectFilter={projectFilter}
                resizable={false}
                cwd={cwd}
                recents={recents}
                onSelectProject={(path) => {
                  setProjectNavigationAnchor(null);
                  onSelectProject(path);
                }}
                onOpenProject={() => {
                  setProjectNavigationAnchor(null);
                  onOpenProject();
                }}
                onOpenSyncedProject={onOpenSyncedProject}
                onRemoveProject={onRemoveProject}
                onRenameProjectFolder={onRenameProjectFolder}
                onOpenCrewSession={
                  onOpenCrewSession
                    ? (target) => {
                        setProjectNavigationAnchor(null);
                        return onOpenCrewSession(target);
                      }
                    : undefined
                }
                onPreviewSession={
                  onPreviewSession
                    ? (id, options) => {
                        setProjectNavigationAnchor(null);
                        onPreviewSession(id, options);
                      }
                    : undefined
                }
                onSelectAgent={
                  onSelectAgent
                    ? (id) => {
                        setProjectNavigationAnchor(null);
                        onSelectAgent(id);
                      }
                    : undefined
                }
                activeSessionId={activeSessionId}
                liveAgents={liveAgents}
                // The sidebar below the rail already shows the canonical live summary; the
                // popup only repeats it when no sidebar surface is on screen.
                showLiveAgents={!(sidebarVisible || drawerRendered)}
                recentSessions={recentSessions}
                busyPaths={busyProjectPaths}
                onTogglePanel={() => setProjectNavigationAnchor(null)}
                onOpenSettings={closeProjectNavigationThen(onOpenSettings)}
                onSelectSettingsSection={onSelectSettingsSection}
                onOpenNotificationSettings={onOpenNotificationSettings}
                notesEnabled={notesEnabled}
                onSearch={closeProjectNavigationThen(onSearch)}
                onOpenInbox={closeProjectNavigationThen(onOpenInbox)}
                onOpenNotes={closeProjectNavigationThen(onOpenNotes)}
                onOpenServers={closeProjectNavigationThen(onOpenServers)}
                onOpenAutomations={closeProjectNavigationThen(onOpenAutomations)}
                onOpenTasks={closeProjectNavigationThen(onOpenTasks)}
              />
            )}
          </ProjectsFlyoutChrome>
        </Popover>
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

/**
 * Header and project search for the compact Projects flyout. The canonical list below is the
 * only place a project is chosen; search narrows that list instead of opening a second picker.
 */
function ProjectsFlyoutChrome({
  onNewProject,
  onExpand,
  children,
}: {
  onNewProject: () => void;
  onExpand: () => void;
  children: (projectFilter: string) => ReactNode;
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  return (
    <>
      <div className="flex shrink-0 flex-col gap-1.5 px-2 pb-1.5 pt-2">
        <div className="flex items-center gap-1 ps-1">
          <span className="min-w-0 flex-1 truncate text-ui-body font-medium">
            {t("Projects and groups")}
          </span>
          <Button
            variant="ghost"
            motion="none"
            iconOnly
            label={t("New project")}
            onClick={onNewProject}
          >
            <Plus className="icon-md" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            motion="none"
            iconOnly
            label={t("Expand projects")}
            onClick={onExpand}
          >
            <PanelLeft className="icon-md" aria-hidden />
          </Button>
        </div>
        <SearchInputGroup appearance="field" className="min-w-0">
          <Search className="icon-xs shrink-0" />
          <SearchInput
            focusOwner="group"
            type="text"
            value={filter}
            placeholder={t("Search projects...")}
            aria-label={t("Search projects")}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => setFilter(event.target.value)}
            className="w-full min-w-0"
          />
        </SearchInputGroup>
      </div>
      {children(filter)}
    </>
  );
}

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
  onOpenServers,
  onOpenAutomations,
  onOpenTasks,
  searchActive = false,
  inboxActive = false,
  notesActive = false,
  serversActive = false,
  automationsActive = false,
  tasksActive = false,
  socialActive = false,
  assistantActive = false,
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
  onOpenServers?: () => void;
  onOpenAutomations?: () => void;
  onOpenTasks?: () => void;
  searchActive?: boolean;
  inboxActive?: boolean;
  notesActive?: boolean;
  serversActive?: boolean;
  automationsActive?: boolean;
  tasksActive?: boolean;
  socialActive?: boolean;
  assistantActive?: boolean;
  inboxUnseen?: boolean;
}) {
  const t = useT();
  const [inboxMenu, setInboxMenu] = useState<{ x: number; y: number } | null>(null);
  const inboxTrigger = useRef<HTMLElement | null>(null);
  const assistantLabel = useAssistantRoomLabel();
  return (
    <PaneHeader
      dragRegion
      className="@container/picker"
      actions={
        <>
          {onNew ? (
            <IconButton label={t("New tab")} command="Tab: New" onClick={onNew}>
              <Plus className="icon-sm" strokeWidth={1.75} />
            </IconButton>
          ) : null}
          {onSearch ? (
            <IconButton
              label={t("Search")}
              command="App: Search"
              active={searchActive}
              onClick={onSearch}
            >
              <Search className="icon-sm" strokeWidth={1.75} />
            </IconButton>
          ) : null}
          {onOpenInbox ? (
            <WorkspaceFeatureGate id="inbox" active={inboxActive}>
              <IconButton
                label={inboxUnseen ? t("Inbox, new items") : t("Inbox")}
                command="App: Open Inbox"
                active={inboxActive}
                onClick={onOpenInbox}
                onOpenContextMenu={(x, y) => {
                  inboxTrigger.current =
                    document.activeElement instanceof HTMLElement ? document.activeElement : null;
                  setInboxMenu({ x, y });
                }}
              >
                <span className="relative">
                  <Inbox className="icon-sm" strokeWidth={1.75} />
                  {inboxUnseen ? (
                    <StatusDot
                      label={t("Inbox, new items")}
                      aria-hidden
                      className="absolute -right-0.5 -top-0.5"
                    />
                  ) : null}
                </span>
              </IconButton>
            </WorkspaceFeatureGate>
          ) : null}
          {onOpenServers ? (
            <IconButton label={t("Servers")} active={serversActive} onClick={onOpenServers}>
              <Server className="icon-sm" strokeWidth={1.75} />
            </IconButton>
          ) : null}
          {onOpenNotes ? (
            <span className="contents @max-[230px]/picker:hidden">
              <IconButton
                label={t("Notes")}
                command="App: Open Notes"
                active={notesActive}
                onClick={onOpenNotes}
              >
                <StickyNote className="icon-sm" strokeWidth={1.75} />
              </IconButton>
            </span>
          ) : null}
          {onOpenAutomations ? (
            <span className="contents @max-[260px]/picker:hidden">
              <WorkspaceFeatureGate id="automations" active={automationsActive}>
                <IconButton
                  label={t("Automations")}
                  command="App: Open Automations"
                  active={automationsActive}
                  onClick={onOpenAutomations}
                >
                  <Zap className="icon-sm" strokeWidth={1.75} />
                </IconButton>
              </WorkspaceFeatureGate>
            </span>
          ) : null}
          <SocialShortcut active={socialActive} cwd={cwd} compact />
          {onOpenTasks ? (
            <span className="contents @max-[290px]/picker:hidden">
              <WorkspaceFeatureGate id="tasks" active={tasksActive}>
                <IconButton
                  label={t("Tasks")}
                  command="App: Open Tasks"
                  active={tasksActive}
                  onClick={onOpenTasks}
                >
                  <DashboardSquare className="icon-sm" strokeWidth={1.75} />
                </IconButton>
              </WorkspaceFeatureGate>
            </span>
          ) : null}
          <span className="contents @max-[320px]/picker:hidden">
            <IconButton
              label={assistantLabel}
              active={assistantActive}
              onClick={() => openAssistantRoom()}
            >
              <Sparkles className="icon-sm" strokeWidth={1.75} />
            </IconButton>
          </span>
        </>
      }
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
    </PaneHeader>
  );
}

function CompactProjectRail({
  onOpenLastSessions,
  lastSessionsOpen,
  recoveryControl,
  cwd,
  workingSessionsBadge,
  recents,
  tabShown,
  inboxUnseen,
  onOpenProjectNavigation,
  projectNavigationOpen,
  onOpenWorkspace,
  onSearch,
  searchActive,
  onOpenInbox,
  inboxActive,
  onOpenNotificationSettings,
  onOpenNotes,
  onOpenServers,
  notesActive,
  serversActive = false,
  onOpenAutomations,
  onOpenTasks,
  automationsActive,
  tasksActive,
  socialActive,
  assistantActive = false,
  onOpenSettings,
  onOpenAccountSettings,
  onOpenCrews,
  onTogglePanel,
  onLeaveActive,
  titleBarAbove,
}: {
  onOpenLastSessions?: () => void;
  lastSessionsOpen?: boolean;
  cwd: string;
  workingSessionsBadge?: ReactNode;
  recoveryControl?: ReactNode;
  recents: RecentProject[];
  tabShown: boolean;
  inboxUnseen: boolean;
  onSelectProject?: (path: string) => void;
  onOpenProjectNavigation?: (anchor: HTMLElement) => void;
  projectNavigationOpen?: boolean;
  onOpenWorkspace: () => void;
  onSearch?: () => void;
  searchActive: boolean;
  onOpenInbox?: () => void;
  inboxActive: boolean;
  onOpenNotificationSettings?: (projectPath?: string) => void;
  onOpenNotes?: () => void;
  onOpenServers?: () => void;
  notesActive: boolean;
  serversActive?: boolean;
  onOpenAutomations?: () => void;
  onOpenTasks?: () => void;
  automationsActive: boolean;
  tasksActive: boolean;
  socialActive: boolean;
  assistantActive?: boolean;
  onOpenSettings?: () => void;
  onOpenAccountSettings?: () => void;
  onOpenCrews?: () => void;
  onTogglePanel?: () => void;
  onLeaveActive?: () => void;
  titleBarAbove: boolean;
  recentSessions?: RecentSessionsSource;
  activeSessionId?: string;
  onSelectAgent?: (sessionId: string) => void;
  onPreviewSession?: (sessionId: string, options?: { keepOpen?: boolean }) => void;
}) {
  const t = useT();
  const toggleShortcut = useKeybindingShortcut("App: Toggle Sidebar");
  const [inboxMenu, setInboxMenu] = useState<{ x: number; y: number } | null>(null);
  const inboxTrigger = useRef<HTMLElement | null>(null);
  const action = (active: boolean, open?: () => void) =>
    active && onLeaveActive ? onLeaveActive : open;
  const workspaceActive =
    !searchActive &&
    !inboxActive &&
    !notesActive &&
    !serversActive &&
    !automationsActive &&
    !tasksActive &&
    !socialActive &&
    !assistantActive;
  const assistantLabel = useAssistantRoomLabel();

  return (
    <nav
      aria-label={t("Project shortcuts")}
      data-compact-project-rail
      className="sidebar-glass relative flex h-full w-14 shrink-0 flex-col items-center"
    >
      {titleBarAbove ? null : (
        // The row shares its height and rule with the workspace header beside it. It stays a
        // window drag region; the mark is the same product logo the full rail shows.
        <PaneHeader dragRegion className="w-full px-0! [&>div]:justify-center">
          <CompactRailLogo />
        </PaneHeader>
      )}
      <span
        aria-hidden
        data-compact-rail-divider
        className={`pointer-events-none absolute bottom-0 right-0 w-px bg-(--ui-pane-border) ${
          titleBarAbove ? "top-0" : "top-[calc(var(--ui-control-height-compact)+0.5rem)]"
        }`}
      />
      <div
        data-compact-rail-actions
        className="flex min-h-0 w-full flex-col items-center gap-1.5 overflow-y-auto px-1 py-1.5"
      >
        {titleBarAbove ? <CompactRailLogo /> : null}
        <Button
          variant="ghost"
          motion="none"
          iconOnly
          label={t("Expand projects")}
          shortcut={toggleShortcut || undefined}
          tooltipSide="right"
          onClick={onTogglePanel}
        >
          <PanelLeft className="icon-md" aria-hidden />
        </Button>
        <CompactRailAction
          label={t("Search")}
          command="App: Search"
          icon={Search}
          active={searchActive}
          onClick={action(searchActive, onSearch)}
        />
        <WorkspaceFeatureGate id="inbox" active={inboxActive}>
          <CompactRailAction
            label={inboxUnseen ? t("Inbox, new items") : t("Inbox")}
            caption={t("Inbox")}
            command="App: Open Inbox"
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
        <CompactRailTools
          active={
            notesActive ||
            serversActive ||
            automationsActive ||
            tasksActive ||
            socialActive ||
            assistantActive
          }
        >
          {onOpenCrews ? (
            <CompactRailAction label={t("Crews")} icon={Bot} onClick={onOpenCrews} />
          ) : null}
          {onOpenServers ? (
            <CompactRailAction
              label={t("Servers")}
              icon={Server}
              active={serversActive}
              onClick={action(serversActive, onOpenServers)}
            />
          ) : null}
          {onOpenNotes ? (
            <CompactRailAction
              label={t("Notes")}
              command="App: Open Notes"
              icon={StickyNote}
              active={notesActive}
              onClick={action(notesActive, onOpenNotes)}
            />
          ) : null}
          <WorkspaceFeatureGate id="automations" active={automationsActive}>
            <CompactRailAction
              label={t("Automations")}
              command="App: Open Automations"
              icon={Zap}
              active={automationsActive}
              onClick={action(automationsActive, onOpenAutomations)}
            />
          </WorkspaceFeatureGate>
          <SocialShortcut active={socialActive} cwd={cwd} responsiveRail />
          <WorkspaceFeatureGate id="tasks" active={tasksActive}>
            <CompactRailAction
              label={t("Tasks")}
              command="App: Open Tasks"
              icon={DashboardSquare}
              active={tasksActive}
              onClick={action(tasksActive, onOpenTasks)}
            />
          </WorkspaceFeatureGate>
          <CompactRailAction
            label={assistantLabel}
            icon={Sparkles}
            active={assistantActive}
            onClick={action(assistantActive, () => openAssistantRoom())}
          />
        </CompactRailTools>
        {/* Same order as the full sidebar: panel, search and tools first, then the
            work sections (recovered work, projects, last sessions, workspace). */}
        <Divider decorative className="my-0.5 w-6 shrink-0 self-center" />
        {recoveryControl}
        {onOpenProjectNavigation ? (
          <Button
            variant="ghost"
            motion="none"
            iconOnly
            label={t("Projects and groups")}
            tooltipSide="right"
            aria-haspopup="dialog"
            aria-expanded={projectNavigationOpen}
            selected={projectNavigationOpen}
            onClick={(event) => onOpenProjectNavigation(event.currentTarget)}
          >
            <FolderTree className="icon-md" aria-hidden />
          </Button>
        ) : null}
        {onOpenLastSessions ? (
          <CompactRailAction
            label={t("Last sessions")}
            caption={t("Recent")}
            icon={Clock}
            active={lastSessionsOpen}
            onClick={onOpenLastSessions}
          />
        ) : null}
        {!tabShown || !workspaceActive ? (
          <CompactRailAction
            label={t("Workspace")}
            icon={FolderTree}
            badge={workingSessionsBadge}
            onClick={onOpenWorkspace}
          />
        ) : null}
      </div>
      <div className="min-h-2 flex-1" />
      <SidebarAccountFooter
        compact
        onOpenSettings={onOpenSettings}
        onOpenAccountSettings={onOpenAccountSettings}
      />
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

const CompactRailLayout = createContext<"caption" | "row">("caption");

function CompactRailTools({ active, children }: { active: boolean; children: ReactNode }) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        motion="none"
        iconOnly
        label={t("Tools")}
        tooltipSide="right"
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        selected={Boolean(anchor) || active}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <DashboardSquare className="icon-md" aria-hidden />
      </Button>
      {anchor ? (
        <Popover
          anchor={anchor}
          side="right"
          align="start"
          width={240}
          autoFocus
          onDismiss={() => setAnchor(null)}
          role="dialog"
          aria-label={t("Tools")}
          data-compact-tools-flyout
        >
          <CompactRailLayout.Provider value="row">
            <div
              className="flex flex-col gap-1 p-1"
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button")) setAnchor(null);
              }}
            >
              {children}
            </div>
          </CompactRailLayout.Provider>
        </Popover>
      ) : null}
    </>
  );
}

function CompactRailAction({
  label,
  caption,
  command,
  icon: Icon,
  active = false,
  dot = false,
  badge,
  onClick,
  onOpenContextMenu,
  ref,
}: {
  label: string;
  caption?: string;
  command?: string;
  icon: typeof PanelLeft;
  active?: boolean;
  dot?: boolean;
  badge?: ReactNode;
  onClick?: () => void;
  onOpenContextMenu?: (x: number, y: number) => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  useLocale();
  const layout = useContext(CompactRailLayout);
  const shortcut = useKeybindingShortcut(command ?? "");
  const row = layout === "row";
  const sharedProps = {
    variant: "ghost" as const,
    motion: "none" as const,
    ref,
    type: "button" as const,
    "aria-label": label,
    "aria-pressed": active,
    disabled: !onClick,
    onClick,
    onContextMenu: onOpenContextMenu
      ? (event: ReactMouseEvent<HTMLButtonElement>) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus();
          onOpenContextMenu(event.clientX, event.clientY);
        }
      : undefined,
    onKeyDown: onOpenContextMenu
      ? (event: ReactKeyboardEvent<HTMLButtonElement>) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenContextMenu(rect.right, rect.top);
        }
      : undefined,
  };
  const marks = (
    <>
      {dot ? <StatusDot label={label} aria-hidden className="absolute right-1 top-1" /> : null}
      {badge ? (
        <span className="pointer-events-none absolute -right-1 -top-1 [&>span]:ml-0">{badge}</span>
      ) : null}
    </>
  );
  // The rail shows icons only: one square hit area and icon size for every action. The name
  // and shortcut live in the tooltip and the accessible name. Flyout rows keep their text.
  if (!row)
    return (
      <Button
        {...sharedProps}
        iconOnly
        label={label}
        shortcut={shortcut || undefined}
        tooltipSide="right"
        className="relative shrink-0"
      >
        <Icon
          className={`icon-md ${dot ? "compact-rail-icon-with-dot" : ""}`}
          strokeWidth={1.75}
          aria-hidden
        />
        {marks}
      </Button>
    );
  return (
    <Button
      {...sharedProps}
      variant="item"
      tooltip={label}
      tooltipWhen={caption && caption !== label ? "always" : "overflow"}
      shortcut={shortcut || undefined}
      fullWidth
      align="start"
      className="relative shrink-0"
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <Icon className={`icon-md ${dot ? "compact-rail-icon-with-dot" : ""}`} strokeWidth={1.75} />
        <span className="max-w-full truncate">{caption ?? label}</span>
      </span>
      {marks}
    </Button>
  );
}

/** The existing product mark at the start of the collapsed rail; not a control. */
function CompactRailLogo() {
  return (
    <span
      data-compact-rail-logo
      className="grid size-(--ui-control-height-sm) shrink-0 place-items-center"
    >
      <img
        src={PRODUCT_IDENTITY.smallLogoSrc}
        alt={PRODUCT_IDENTITY.displayName}
        draggable={false}
        className="size-6 select-none object-contain"
      />
    </span>
  );
}

/** The header's one remaining global action; the global Search is the top-left control. */
function WorkspaceTitleActions({ onNew }: { onNew?: () => void }) {
  const t = useT();
  if (!onNew) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-tauri-drag-region="false">
      {onNew ? (
        <span className="inline-flex" data-usage-guide="new-session">
          <IconButton label={t("New session")} command="Tab: New" onClick={onNew}>
            <Plus className="icon-sm" strokeWidth={1.75} />
          </IconButton>
        </span>
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
  const t = useT();
  return (
    <Button
      tone={danger ? "danger" : "neutral"}
      iconOnly
      label={t("{p0} selected", { p0: label })}
      variant="ghost"
      motion="none"
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="grid place-items-center disabled:pointer-events-none"
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
      aria-expanded={open}
      aria-haspopup={hasPopup ? "menu" : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className="relative grid place-items-center"
    >
      {children}
    </Button>
  );
}

type FolderEntry = Extract<SessionListEntry, { kind: "folder" }>;

/** Runs once in the commit that follows a session-list drop (see the layout effect in Sidebar). */
let afterSessionListCommit: (() => void) | null = null;

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

/**
 * Marks where a dragged folder would land with the shared indicator: a line before or after a
 * folder, a frame on the folder (or pinned) header it would nest into, and a refused frame on the
 * header it cannot go into. The top level has no row to mark, so only the badge says it.
 */
function markFolderMoveTarget(
  root: HTMLElement | null,
  target: FolderMoveTarget | null,
  allowed: boolean,
) {
  const folder =
    root && target && "id" in target
      ? ([...root.querySelectorAll<HTMLElement>("[data-session-folder]")].find(
          (el) => el.dataset.sessionFolder === target.id,
        ) ?? null)
      : null;
  const header = (scope: HTMLElement | null | undefined) =>
    scope?.querySelector<HTMLElement>("[data-folder-row]") ?? null;
  if (!root || !target) clearDropIndicator();
  else if (!allowed) setDropIndicator(header(folder), "blocked");
  else if (target.kind === "beside") setDropIndicator(folder, target.place);
  else if (target.kind === "into") setDropIndicator(header(folder), "inside");
  else if (target.kind === "pinned")
    setDropIndicator(header(root.querySelector<HTMLElement>("[data-pinned-sessions]")), "inside");
  else clearDropIndicator();
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

/** The hint on the dragged copy; a plain reorder has none because the open gap is the hint. */
function dropTargetLabel(target: SessionListDropTarget): string | undefined {
  switch (target.kind) {
    case "session":
      return t("Release to group");
    case "pinned":
      return t("Release to pin");
    case "folder":
      return t("Release to add to the folder");
    case "insert":
      return undefined;
  }
}

/**
 * Marks the one row a dragged session would land on, in the shared drop-indicator vocabulary: a
 * dashed frame once a card is ready to group, a frame on a folder or the pinned header. A plain
 * insert draws nothing here: the list opens a gap at that point instead of drawing a line.
 */
function markSessionListTarget(target: SessionListDropTarget | null) {
  if (!target || target.kind === "insert") {
    clearDropIndicator();
    return;
  }
  if (target.kind === "session") {
    const card = [...document.querySelectorAll<HTMLElement>("[data-session-card]")].find(
      (el) => el.dataset.sessionCard === target.id,
    );
    setDropIndicator(card ?? null, "group");
    return;
  }
  const scope =
    target.kind === "folder"
      ? [...document.querySelectorAll<HTMLElement>("[data-session-folder]")].find(
          (el) => el.dataset.sessionFolder === target.id,
        )
      : document.querySelector<HTMLElement>("[data-pinned-sessions]");
  setDropIndicator(scope?.querySelector<HTMLElement>("[data-folder-row]") ?? null, "inside");
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

const SESSION_PREFETCH_DELAY_MS = 120;
/** Hover waits this long before the detail card; keyboard focus shows it at once. */
const SESSION_DETAIL_DELAY_MS = 600;
/** Rows created this recently slide in; older ones are just being listed. */
/** The folder-less list search: the session filter owns the matches, rows only draw them. */
const NO_SEARCH_ITEMS: ExpandingSearchItem[] = [];

/** The inline filter text, so rows can highlight what matched without threading a prop through every group. */
const SessionSearchQueryContext = createContext("");

/** Every session inside a group (or a subgroup of one) whose name matches the filter. */
function sessionIdsInMatchingFolders(folders: SessionFolder[], query: string): Set<string> {
  const ids = new Set<string>();
  const prepared = prepareFuzzyQuery(query);
  const childrenOf = new Map<string, SessionFolder[]>();
  for (const folder of folders) {
    if (folder.parentId) {
      childrenOf.set(folder.parentId, [...(childrenOf.get(folder.parentId) ?? []), folder]);
    }
  }
  const addAll = (folder: SessionFolder, seen: Set<string>) => {
    if (seen.has(folder.id)) return;
    seen.add(folder.id);
    for (const id of folder.sessionIds) ids.add(id);
    for (const child of childrenOf.get(folder.id) ?? []) addAll(child, seen);
  };
  for (const folder of folders) {
    if (fuzzyMatch(prepared, folder.name)) addAll(folder, new Set());
  }
  return ids;
}

/** Plain text with the characters the inline session filter matched accented. */
function SessionSearchText({ text }: { text: string }) {
  const query = useContext(SessionSearchQueryContext);
  const hit = query.trim() ? fuzzyMatch(query, text) : null;
  return <MatchText text={text} positions={hit?.positions ?? []} active={hit !== null} />;
}

/** How long a still press takes to start selecting. */
const LONG_PRESS_MS = 450;

/** Hover actions overlay a compact row's time; the time keeps one 20px column per action. */
const YIELD_WIDTH = [
  "",
  "pointer-fine:w-5",
  "pointer-fine:w-10",
  "pointer-fine:w-15",
  "pointer-fine:w-20",
];

const SessionCard = memo(function SessionCard({
  showProjectAppearance = false,
  session,
  isActive,
  isSelected,
  selectionMode = false,
  busy,
  wait,
  opening = false,
  startedAt,
  done,
  linkedUpdate,
  needsApproval,
  inputKind,
  dropTarget,
  dropDwell = false,
  groupDelayMs,
  density,
  showModel,
  showBranch,
  inPinnedSection = false,
  onPin,
  onSelect,
  onLongPress,
  onOpenWorkItem,
  onPrefetch,
  onPlaceOnPane,
  onPopOut,
  onListDrop,
  onListDropTargetChange,
  onContextMenu,
  settleable = false,
  onArchive,
  onRename,
  onDelete,
  renameEditor,
  titleFeedback,
}: {
  showProjectAppearance?: boolean;
  session: SessionSummary;
  isActive: boolean;
  isSelected: boolean;
  selectionMode?: boolean;
  busy: boolean;
  /** Set when the agent yielded and background work or delegated children still run. */
  wait?: SessionWait | null;
  startedAt?: number;
  /** Clicked and still loading before it opens. */
  opening?: boolean;
  done: boolean;
  linkedUpdate: boolean;
  needsApproval: boolean;
  inputKind?: LiveAgent["inputKind"];
  /** Ready to group with the dragged session. */
  dropTarget?: boolean;
  /** The dragged session rests on this card, counting down to grouping. */
  dropDwell?: boolean;
  groupDelayMs: number;
  density: SessionListDensity;
  showModel: boolean;
  showBranch: boolean;
  /** Listed directly under the Pinned header, which already says it is pinned. */
  inPinnedSection?: boolean;
  onPin?: (sessionId: string, pinned: boolean) => void;
  onSelect: (
    sessionId: string,
    event: {
      shiftKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      detail?: number;
    },
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
  /** A session of this computer's Host: offers Settle / Un-settle. */
  settleable?: boolean;
  onArchive?: (sessionId: string, archived: boolean) => void;
  onRename?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  renameEditor?: ReactNode;
  titleFeedback?: ReactNode;
}) {
  "use memo";
  const t = useT();
  const project = useSessionProjectAppearance(session.cwd);
  const providerHistory = sessionProviderHistory(session);
  const skipClickUntil = useRef(0);
  const skipNextClick = useRef(false);
  const cancelSessionDrag = useRef<(() => void) | null>(null);
  const cancelLongPress = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      cancelSessionDrag.current?.();
      cancelLongPress.current?.();
      if (detailTimer.current != null) window.clearTimeout(detailTimer.current);
    },
    [],
  );
  const [pressing, setPressing] = useState(false);
  const prefetchTimer = useRef<number | null>(null);
  const orchestrationTooltipRootRef = useRef<HTMLDivElement>(null);
  const orchestrationTooltipId = useId();
  const detailRootRef = useRef<HTMLDivElement>(null);
  const detailTimer = useRef<number | null>(null);
  const detailId = useId();
  const [detailOpen, setDetailOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [orchestrationTooltipOpen, setOrchestrationTooltipOpen] = useState(false);
  const orchestration = session.orchestration;
  // A saved draft, or text typed into this session's composer and left unsent.
  // The session being typed in already shows its composer, so only other rows are marked.
  const unsentComposerDraft = useUnsentComposerDraft(session.id, !isActive);
  const draft = !!session.draft || unsentComposerDraft;
  const orchestrationExpanded = !!orchestration && (isActive || isSelected || busy);
  const orchestrationDone =
    orchestration?.tasks.filter((task) => task.status === "completed").length ?? 0;
  const title = sessionDisplayTitle(session.title, session.harness);
  const highlightQuery = useContext(SessionSearchQueryContext);
  const titleHit = highlightQuery.trim() ? fuzzyMatch(highlightQuery, title) : null;
  const gitLabel = session.worktreeRemoved
    ? NO_BRANCH_LABEL
    : formatGitLabel(session.repo, session.branch);
  const compact = density === "compact";
  const model = providerHistory.activeModel
    ? resolveModel(providerHistory.activeHarness, providerHistory.activeModel).name
    : providerHistory.activeHarness === session.harness
      ? resolveModel(session.harness, session.model).name
      : HARNESS_TITLE[providerHistory.activeHarness];
  const worktree = !!session.worktreeCwd && !session.worktreeRemoved;
  // Standard rows name the branch only; detailed rows add the repository only when it
  // differs from the project already named above the title (owner 2026-11-04: the
  // "bycoda/" prefix repeated the project). The detail card keeps the full label.
  const repoRepeatsProject =
    !!session.repo && session.repo.toLowerCase() === project.name.toLowerCase();
  const branchText =
    session.worktreeRemoved || (density === "detailed" && !repoRepeatsProject)
      ? gitLabel
      : session.branch || gitLabel;
  const statusKind = sessionRowStatusKind({
    issue: session.issue,
    interrupted: session.interrupted,
    needsApproval,
    busy,
    wait,
    opening,
    done,
    draft,
  });
  const working = statusKind === "working" || statusKind === "waiting";
  const idle = statusKind === "idle";
  const detailPath = session.worktreeCwd && worktree ? session.worktreeCwd : session.cwd;
  const status = (
    <SessionRowStatus
      kind={statusKind}
      startedAt={startedAt}
      wait={wait}
      needsInputLabel={
        orchestration
          ? t("Needs input")
          : t(inputKind === "question" ? "Question" : "Need approval")
      }
      time={<RelativeSessionTime at={session.lastActivityAt ?? session.updatedAt} />}
    />
  );

  const linkedWorkItem = session.linkedWorkItem;
  const linkedUpdateDot = linkedUpdate ? (
    <Tooltip
      label={t(
        linkedWorkItem?.kind === "pr"
          ? "Linked PR updated since this session"
          : "Linked issue updated since this session",
      )}
    >
      <StatusDot label={t("Linked work item updated")} />
    </Tooltip>
  ) : null;
  const workItemBadge = linkedWorkItem ? (
    <Button
      variant="ghost"
      motion="none"
      type="button"
      data-no-drag
      data-tauri-drag-region="false"
      tooltip={t(
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
        <GitPullRequest className="icon-xs" strokeWidth={1.75} />
      ) : (
        <CircleDot className="icon-xs" strokeWidth={1.75} />
      )}
      <span>#{linkedWorkItem.number}</span>
    </Button>
  ) : null;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Escape" && detailOpen) hideDetail();
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
    hideDetail();
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
    let overSelf = false;
    // Runs on time, not movement: a pointer held still sends no events.
    let dwell: { id: string; ready: boolean; timer: number } | null = null;
    // The lifted copy that follows the pointer, and the gap the list opens for it.
    let preview: ReturnType<typeof createDragPreview> | null = null;
    let gap: ReturnType<typeof createListGap> | null = null;
    let zones: ReturnType<typeof snapshotSessionList> | null = null;
    const scroller = handle.closest<HTMLElement>(".sidebar-session-scroll");
    const startScroll = scroller?.scrollTop ?? 0;
    const startRect = handle.getBoundingClientRect();
    handle.setPointerCapture(pointerId);
    const restoreSelection = suppressTextSelection();

    const setListTarget = (next: SessionListDropTarget | null) => {
      if (sameDropTarget(lastList, next)) return;
      lastList = next;
      markSessionListTarget(next);
      onListDropTargetChange?.(next);
      // Only a plain insert opens a gap; grouping, a folder or pinning closes it again.
      if (next?.kind === "insert") {
        const item = zones?.cardElement(next.id)?.closest("li");
        gap?.open(item ?? null, next.place);
      } else gap?.open(null);
    };
    const clearDwell = () => {
      if (dwell) window.clearTimeout(dwell.timer);
      dwell = null;
    };
    const listTargetAt = (x: number, y: number): SessionListDropTarget | null => {
      const hit = onListDrop ? (zones?.hit(x, y, session.id) ?? null) : null;
      overSelf = hit?.kind === "self";
      if (hit?.kind !== "card" || !hit.middle) clearDwell();
      if (!hit || hit.kind === "self") return null;
      if (hit.kind !== "card") return hit;
      if (!hit.middle) return { kind: "insert", id: hit.id, place: hit.place };
      if (dwell?.id !== hit.id) {
        clearDwell();
        const id = hit.id;
        const timer = window.setTimeout(() => {
          if (dwell?.id !== id) return;
          dwell.ready = true;
          setListTarget({ kind: "session", id });
          showFeedback();
        }, groupDelayMs);
        dwell = { id, ready: false, timer };
      }
      return dwell.ready
        ? { kind: "session", id: hit.id }
        : { kind: "insert", id: hit.id, place: hit.place, dwell: true };
    };

    const showFeedback = () => {
      if (!preview) return;
      const point = { clientX: lastX, clientY: lastY };
      const bounds = scroller?.getBoundingClientRect();
      if (onPopOut && isPointerOutsideWindow(lastX, lastY, window.innerWidth, window.innerHeight)) {
        preview.move(point, {
          action: "window",
          label: busy ? "Move after response finishes" : undefined,
        });
      } else if (lastList) {
        preview.move(point, { label: dropTargetLabel(lastList), bounds });
      } else if (overSelf) {
        preview.move(point, { bounds });
      } else if (!onPlaceOnPane) {
        preview.move(point, { action: "blocked", bounds });
      } else {
        const over = paneDropFromPoint(lastX, lastY);
        if (!over || over.id === session.id) preview.move(point, { action: "blocked", bounds });
        else preview.move(point, { label: `Place ${over.edge}` });
      }
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
        // Measure the list as it is, before the source collapses and the copy appears.
        zones = snapshotSessionList(scroller);
        preview = createDragPreview(handle, { clientX: startX, clientY: startY });
        const item = handle.closest("li");
        if (item) gap = createListGap(item);
        if (scroller) scroller.style.overflowAnchor = "none";
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
      showFeedback();
      if (
        onPopOut &&
        isPointerOutsideWindow(ev.clientX, ev.clientY, window.innerWidth, window.innerHeight)
      ) {
        setExternalPaneDrop(null);
        return;
      }
      if (lastList) {
        setExternalPaneDrop(null);
        return;
      }
      if (!onPlaceOnPane) return;
      const over = paneDropFromPoint(ev.clientX, ev.clientY);
      if (!over || over.id === session.id) {
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

    // Release everything the drag lent to the list, whatever way it ended.
    const releaseList = () => {
      gap?.release();
      gap = null;
      if (scroller) scroller.style.removeProperty("overflow-anchor");
    };
    const endPreview = () => {
      preview?.dispose();
      preview = null;
      releaseList();
    };

    function finish(commit: boolean) {
      const listOver = lastList;
      clearDwell();
      cancelSessionDrag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onCancel);
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
      const copy = preview;
      if (
        commit &&
        onPopOut &&
        isPointerOutsideWindow(lastX, lastY, window.innerWidth, window.innerHeight)
      ) {
        endPreview();
        onPopOut(session.id, {
          ...popOutPosition(screenX, screenY),
          clientX: lastX,
          clientY: lastY,
        });
        return;
      }
      if (commit && listOver && onListDrop) {
        // The copy lands on the card the reorder produces, found once the new order is committed.
        // If nothing is committed (a drop that changes nothing) it returns to where it started.
        let landed = false;
        const land = () => {
          if (landed) return;
          landed = true;
          if (afterSessionListCommit === land) afterSessionListCommit = null;
          window.clearTimeout(fallback);
          releaseList();
          const card = [...document.querySelectorAll<HTMLElement>("[data-session-card]")].find(
            (el) => el.dataset.sessionCard === session.id,
          );
          if (card) card.style.visibility = "hidden";
          preview = null;
          copy?.settleTo(card?.getBoundingClientRect() ?? null, () => {
            card?.style.removeProperty("visibility");
          });
        };
        const fallback = window.setTimeout(land, 160);
        afterSessionListCommit = land;
        onListDrop(session.id, listOver);
        return;
      }
      if (commit) {
        const over = paneDropFromPoint(lastX, lastY);
        if (over && over.id !== session.id) {
          endPreview();
          onPlaceOnPane?.(session.id, over.id, over.edge);
          return;
        }
      }
      // Cancelled or dropped nowhere: the copy returns to its slot and the gap closes.
      gap?.open(null);
      preview = null;
      const home = new DOMRect(
        startRect.left,
        startRect.top + startScroll - (scroller?.scrollTop ?? 0),
        startRect.width,
        startRect.height,
      );
      if (copy && handle.isConnected) copy.settleTo(home, releaseList);
      else {
        copy?.dispose();
        releaseList();
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    // Losing the window mid-drag ends it without a drop, like Escape.
    window.addEventListener("blur", onCancel);
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

  const scheduleDetail = () => {
    if (detailTimer.current != null || selectionMode || orchestration) return;
    detailTimer.current = window.setTimeout(() => {
      detailTimer.current = null;
      setDetailOpen(true);
    }, SESSION_DETAIL_DELAY_MS);
  };
  // Keyboard focus opened the detail; the anchored card follows its row while focus stays.
  const detailFromFocus = useRef(false);
  const hideDetail = useCallback(() => {
    if (detailTimer.current != null) {
      window.clearTimeout(detailTimer.current);
      detailTimer.current = null;
    }
    detailFromFocus.current = false;
    setDetailOpen(false);
  }, [setDetailOpen]);
  useEffect(() => {
    const root = detailRootRef.current;
    if (!root) return;
    const doc = root.ownerDocument;
    const view = doc.defaultView;
    if (!view) return;
    // Scrolling can move or clip a row without delivering pointerleave. Cancel
    // the pending open too, so a delayed card cannot appear after the row moved.
    // Focusing a partly hidden row scrolls it into view; that scroll must not close the
    // detail the focus just opened.
    const onScroll = (event: Event) => {
      if (detailFromFocus.current && root.contains(doc.activeElement)) return;
      const target = event.target;
      if (target === doc || (target instanceof Node && target.contains(root))) hideDetail();
    };
    doc.addEventListener("scroll", onScroll, true);
    view.addEventListener("resize", hideDetail);
    view.addEventListener("blur", hideDetail);
    return () => {
      doc.removeEventListener("scroll", onScroll, true);
      view.removeEventListener("resize", hideDetail);
      view.removeEventListener("blur", hideDetail);
    };
  }, [hideDetail]);
  const detailVisible = detailOpen && !dragging && !pressing && !selectionMode && !orchestration;

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
    <span data-session-row-model className="flex shrink-0 items-center gap-1.5" aria-label={model}>
      <span className="sr-only">
        <SessionSearchText text={model} />
      </span>
      {providerHistory.providers.map((harness) => (
        <span
          key={harness}
          data-session-provider={harness}
          data-provider-active={harness === providerHistory.activeHarness ? "true" : "false"}
          title={HARNESS_TITLE[harness]}
          className={
            harness === providerHistory.activeHarness
              ? "text-content"
              : "session-provider-inactive text-(--ui-text-muted)"
          }
        >
          <HarnessIcon
            harness={harness}
            className={`${compact ? "icon-xs" : "icon-md"} shrink-0`}
          />
        </span>
      ))}
    </span>
  ) : null;
  const BranchIcon = worktree ? FolderTree : GitBranch;
  const branchLabel =
    showBranch && !compact && branchText ? (
      <span
        data-session-row-branch
        className="session-row-branch flex min-w-0 items-center gap-1 text-ui-caption text-(--ui-text-secondary)"
      >
        <span className="sr-only">{t(worktree ? "Worktree" : "Branch")}</span>
        <span className="min-w-0 truncate">
          <SessionSearchText text={branchText} />
        </span>
      </span>
    ) : null;
  // The Pinned section names the state, so its cards keep their project mark at rest.
  const markPinned = session.pinned && !compact && !inPinnedSection;
  const pinAction = (className?: string) =>
    onPin ? (
      <InlineAction
        className={className}
        reveal={markPinned ? "always" : "interaction"}
        label={t(session.pinned ? "Unpin" : "Pin")}
        tooltip={t(session.pinned ? "Unpin" : "Pin")}
        aria-pressed={!!session.pinned}
        motion="none"
        data-no-drag
        data-tauri-drag-region="false"
        onClick={(event) => {
          event.stopPropagation();
          onPin(session.id, !session.pinned);
        }}
      >
        {compact && session.pinned ? (
          <PinOff className="icon-xs" strokeWidth={1.75} />
        ) : (
          <Pin className="icon-xs" strokeWidth={1.75} />
        )}
      </InlineAction>
    ) : null;
  // Compact idle rows let hover actions sit over the time instead of reserving a gutter.
  const compactActionCount = compact
    ? [onPin, settleable, onArchive, onDelete].filter(Boolean).length
    : 0;
  const timeYields =
    compactActionCount && idle && !linkedWorkItem && !session.automationId && !orchestration;
  const rowCommands = (
    <span
      data-session-row-actions
      data-action-slot="collapse"
      className={`relative flex shrink-0 items-center ${compact ? "" : "gap-px"}`}
    >
      {compact ? pinAction() : null}
      {settleable ? <SessionSettleAction session={session} title={title} /> : null}
      {onArchive ? (
        <InlineAction
          label={`${archiveLabel} ${title}`}
          tooltip={archiveLabel}
          tooltipDetails={[title]}
          motion="none"
          type="button"
          data-no-drag
          data-tauri-drag-region="false"
          aria-label={`${archiveLabel} ${title}`}
          onClick={() => {
            onArchive(session.id, !session.archived);
          }}
        >
          <Archive className="icon-xs shrink-0" strokeWidth={1.75} />
        </InlineAction>
      ) : null}
      {onDelete ? (
        <InlineAction
          label={`Delete ${title}`}
          tooltip={t("Delete")}
          tooltipDetails={[title]}
          tone="danger"
          motion="none"
          type="button"
          data-no-drag
          data-tauri-drag-region="false"
          aria-label={`Delete ${title}`}
          onClick={() => {
            onDelete(session.id);
          }}
        >
          <Trash2 className="icon-xs shrink-0" strokeWidth={1.75} />
        </InlineAction>
      ) : null}
    </span>
  );
  const actions = (
    <span className="relative flex shrink-0 items-center gap-px">
      {workItemBadge}
      {session.automationId ? (
        <Tooltip label={t("Started by an automation")}>
          <span
            data-automation-icon
            role="img"
            aria-label={t("Started by an automation")}
            className="grid size-5 -mr-1 shrink-0 place-items-center text-warning"
          >
            <Zap className="icon-xs" strokeWidth={1.75} />
          </span>
        </Tooltip>
      ) : null}
      {orchestration ? (
        <div
          ref={orchestrationTooltipRootRef}
          className="relative shrink-0"
          onMouseEnter={() => setOrchestrationTooltipOpen(true)}
          onMouseLeave={() => setOrchestrationTooltipOpen(false)}
        >
          <InlineAction
            reveal="always"
            label={t(
              orchestration.tasks.length === 1
                ? "Orchestrator, {p0} subagent, {p2} done"
                : "Orchestrator, {p0} subagents, {p2} done",
              { p0: orchestration.tasks.length, p2: orchestrationDone },
            )}
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
            onFocus={() => setOrchestrationTooltipOpen(true)}
            onBlur={() => setOrchestrationTooltipOpen(false)}
            onClick={(event) => {
              setOrchestrationTooltipOpen(false);
              onSelect(session.id, event);
            }}
          >
            <Share className="icon-xs" />
          </InlineAction>
        </div>
      ) : null}
    </span>
  );
  // Reserve space for actions, but let larger text/status content grow in flow.
  const metaLine = (children: ReactNode) => (
    <span className="relative flex min-h-5 min-w-0 items-center gap-1.5">{children}</span>
  );

  return (
    <div ref={detailRootRef} className="group relative">
      <ActionHost
        selected={isSelected || isActive}
        hoverReveal
        ground={showProjectAppearance ? project.backgroundColor : undefined}
        data-session-card={session.id}
        data-session-density={density}
        data-orchestration-card={orchestration ? "true" : undefined}
        data-session-selected={isSelected ? "true" : undefined}
        data-tauri-drag-region="false"
        onPointerDown={onPointerDown}
        onDragStart={(event) => event.preventDefault()}
        onPointerEnter={() => {
          schedulePrefetch();
          scheduleDetail();
        }}
        onPointerLeave={() => {
          cancelScheduledPrefetch();
          hideDetail();
        }}
        onClick={(event) => {
          if (renameEditor) return;
          if (skipNextClick.current) {
            skipNextClick.current = false;
            return;
          }
          if (performance.now() < skipClickUntil.current) return;
          onSelect(session.id, event);
        }}
        onContextMenu={onContextMenu ? (event) => onContextMenu(session.id, event) : undefined}
        className={`relative border flex w-full ${onPlaceOnPane || onListDrop || onPopOut ? "cursor-grab" : "cursor-default"} select-none touch-none flex-col items-stretch gap-0 rounded-md px-2.5 text-left ${cardPaddingY} ${
          dragging ? "opacity-0" : ""
        } border-transparent ${
          dropTarget
            ? "text-content"
            : isSelected
              ? "text-content"
              : pressing
                ? "bg-(--ui-surface-pressed) text-content transition-colors duration-500 ease-linear"
                : isActive
                  ? "text-content"
                  : "text-(--ui-text-secondary) hover:text-content"
        }`}
      >
        {/* The landing mark (line, group frame) is drawn on this card by setDropIndicator. */}
        {/* Actions sit beside the row's button, never inside it. */}
        {!compact ? (
          <span
            data-session-row-project
            className="relative flex min-h-5 min-w-0 items-center gap-1.5 text-ui-caption text-(--ui-text-secondary)"
          >
            <span
              data-session-project-slot
              data-pinned={markPinned ? "true" : undefined}
              className="session-project-slot relative grid size-5 shrink-0 place-items-center"
            >
              <span data-session-project-mark className="col-start-1 row-start-1">
                {project.icon}
              </span>
              {pinAction("col-start-1 row-start-1")}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <SessionSearchText text={project.name} />
            </span>
            {rowCommands}
            <span className="flex shrink-0 items-center gap-1.5">
              {linkedUpdateDot}
              {status}
            </span>
          </span>
        ) : null}
        <span className="relative flex min-h-5 min-w-0 items-center gap-1.5">
          {renameEditor ?? (
            <div
              role="button"
              tabIndex={0}
              aria-current={isActive ? "true" : undefined}
              aria-pressed={isSelected}
              aria-describedby={detailVisible ? detailId : undefined}
              data-session-select={session.id}
              onKeyDown={onKeyDown}
              // Only keyboard focus lands here (mouse presses blur it), so focus opens the details.
              onFocus={(event) => {
                if (event.target === event.currentTarget && !orchestration && !selectionMode) {
                  detailFromFocus.current = true;
                  setDetailOpen(true);
                }
              }}
              onBlur={hideDetail}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                // Shift-click can trigger :focus-visible. Mouse selection should
                // only highlight the card; Tab can still focus this button.
                event.preventDefault();
                // Clear prior focus too, so shortcuts cannot target another card.
                const focused = event.currentTarget.ownerDocument.activeElement;
                if (focused instanceof HTMLElement) focused.blur();
              }}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm focus-visible:ring-2 focus-visible:ring-(--ui-focus-ring-color)"
            >
              {selectionMode ? (
                <span
                  aria-hidden
                  data-session-checkbox={isSelected ? "checked" : "unchecked"}
                  className={`grid size-3.5 shrink-0 place-items-center rounded-sm border ${
                    isSelected
                      ? "border-active bg-active text-on-solid"
                      : "border-(--ui-text-muted)"
                  }`}
                >
                  {isSelected ? <Check className="icon-xs" strokeWidth={2} /> : null}
                </span>
              ) : null}
              {compact && session.pinned && !inPinnedSection ? (
                <Pin className="icon-xs shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
              ) : null}
              {titleHit ? (
                <span className="line-clamp-1 min-w-0 flex-1 text-ui-secondary font-medium leading-snug text-content">
                  <MatchText text={title} positions={titleHit.positions} active />
                </span>
              ) : (
                <ParticleText
                  text={title}
                  className="line-clamp-1 min-w-0 flex-1 text-ui-secondary font-medium leading-snug text-content"
                />
              )}
              <AssistantManagedBadge
                management={session.managedBy}
                compact
                local={!isRemoteProjectPath(session.cwd)}
              />
              {compact ? modelLabel : null}
              {!compact ? null : (
                <span className="flex shrink-0 items-center gap-1.5">
                  {linkedUpdateDot}
                  {timeYields ? (
                    <span
                      data-action-yield=""
                      className={`flex shrink-0 justify-end ${YIELD_WIDTH[compactActionCount]}`}
                    >
                      {status}
                    </span>
                  ) : (
                    status
                  )}
                </span>
              )}
            </div>
          )}
          {compact ? actions : null}
          {compact ? rowCommands : null}
        </span>
        {!compact
          ? metaLine(
              <>
                {branchLabel}
                <span className="min-w-0 flex-1" />
                {actions}
                {modelLabel}
              </>,
            )
          : null}
        {titleFeedback ? (
          <div data-no-drag className="min-w-0">
            {titleFeedback}
          </div>
        ) : null}
        {orchestrationExpanded ? (
          <OrchestrationSidebarAgents leadId={session.id} summary={orchestration!} />
        ) : null}
        {/* Last child: later DOM order paints over the row content without a z-index. */}
        {dropDwell || dropTarget ? (
          <span
            aria-hidden
            data-session-dwell={dropTarget ? "ready" : "waiting"}
            style={{ "--session-dwell-ms": `${groupDelayMs}ms` } as CSSProperties}
            // Progress only: the cursor badge owns the instruction ("Hold to group" then
            // "Release to group"), so the row never repeats it.
            className="pointer-events-none absolute right-1.5 top-1/2 grid -translate-y-1/2 place-items-center rounded-full bg-(--ui-surface-raised) p-0.5"
          >
            <svg viewBox="0 0 16 16" className="session-row-dwell-ring size-3.5 -rotate-90">
              <circle
                cx="8"
                cy="8"
                r="6"
                className="fill-none stroke-(--ui-surface-pressed)"
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
          </span>
        ) : null}
      </ActionHost>
      {detailVisible ? (
        <Popover
          anchor={detailRootRef}
          side="right"
          align="start"
          gap={6}
          width={264}
          maxHeight={280}
          role="tooltip"
          id={detailId}
          passive
          frosted
          restoreFocus={false}
          className="pointer-events-none overflow-hidden p-2.5"
        >
          <p className="line-clamp-2 break-words text-ui-secondary font-medium leading-snug text-content">
            {title}
          </p>
          {/* Every row shares one icon column, so labels line up like the list rows. */}
          <DescriptionList hideTerms size="sm" className="mt-2 items-center gap-y-1.5">
            <DescriptionItem
              term={t("Project")}
              icon={
                showProjectAppearance ? (
                  project.icon
                ) : (
                  <FolderTree className="icon-xs shrink-0" aria-hidden="true" />
                )
              }
            >
              <span className="min-w-0 truncate text-content">{project.name}</span>
              {/* The full location sits under the name; a long path keeps its last folder. */}
              <span
                className="col-start-2 -mt-1 min-w-0 overflow-hidden text-ui-micro text-(--ui-text-muted)"
                dir="auto"
              >
                <MiddleTruncate mode="path" title={false}>
                  {detailPath}
                </MiddleTruncate>
              </span>
            </DescriptionItem>
            {branchText ? (
              <DescriptionItem
                term={t(worktree ? "Worktree" : "Branch")}
                icon={<BranchIcon className="icon-xs shrink-0" strokeWidth={1.75} />}
              >
                <span className="min-w-0 truncate">{gitLabel}</span>
              </DescriptionItem>
            ) : null}
            <DescriptionItem
              term={t("Model")}
              icon={
                <HarnessIcon harness={providerHistory.activeHarness} className="icon-xs shrink-0" />
              }
            >
              <span className="min-w-0 truncate">{model}</span>
            </DescriptionItem>
            {providerHistory.handedOffFrom ? (
              <DescriptionItem term={t("Provider")} icon={<Share className="icon-xs shrink-0" />}>
                <span className="min-w-0 truncate">
                  {t("Handed off from {p0}", {
                    p0: HARNESS_TITLE[providerHistory.handedOffFrom],
                  })}
                </span>
              </DescriptionItem>
            ) : null}
          </DescriptionList>
          <SessionDetailTimes
            session={session}
            runningSince={statusKind === "working" ? startedAt : undefined}
          />
          <div className="mt-2.5 flex min-w-0 items-center gap-2 border-t border-(--ui-frosted-divider) pt-2 text-ui-caption text-(--ui-text-secondary)">
            <span className="sr-only">{t("Status")}</span>
            {idle ? (
              <span className="flex min-w-0 items-center gap-1.5 tabular-nums">
                <Clock className="icon-xs shrink-0" strokeWidth={1.75} />
                <RelativeSessionTime at={session.lastActivityAt ?? session.updatedAt} />
              </span>
            ) : (
              <>
                {status}
                {working ? null : (
                  <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums text-(--ui-text-muted)">
                    <Clock className="icon-xs shrink-0" strokeWidth={1.75} />
                    <RelativeSessionTime at={session.lastActivityAt ?? session.updatedAt} />
                  </span>
                )}
              </>
            )}
          </div>
        </Popover>
      ) : null}
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
            <span className="text-ui-caption font-medium text-content">{t("Subagents")}</span>
            <span className="shrink-0 text-ui-caption tabular-nums text-(--ui-text-secondary)">
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
                  <HarnessIcon harness={task.harness} className="icon-sm shrink-0 opacity-75" />
                  <span className="min-w-0 flex-1 truncate text-ui-caption text-(--ui-text-secondary)">
                    {task.title}
                  </span>
                  <span
                    className={`shrink-0 text-ui-caption ${
                      task.needsInput ||
                      task.status === "failed" ||
                      task.status === "blocked" ||
                      task.status === "interrupted"
                        ? "text-warning"
                        : label === "Working"
                          ? "text-accent"
                          : task.status === "completed"
                            ? "text-success"
                            : "text-(--ui-text-secondary)"
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
  onCommit,
  onCancel,
}: {
  session: SessionSummary;
  onCommit: (title: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(() => sessionDisplayTitle(session.title, session.harness));

  useEffect(() => {
    if (error && !saving) inputRef.current?.focus();
  }, [error, saving]);

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
      setError(null);
      const failed = (reason: unknown) => {
        finished.current = false;
        setSaving(false);
        setError(reason instanceof Error ? reason.message : String(reason));
        inputRef.current?.focus();
      };
      try {
        const result = onCommit(trimmed);
        if (result) {
          setSaving(true);
          void result.catch(failed);
        }
      } catch (reason) {
        failed(reason);
      }
      return;
    }
    finished.current = true;
    onCancel();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
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
      data-session-rename
      data-no-drag
      className="flex min-w-0 flex-1 flex-col"
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <TextField
        fieldClassName="min-w-0 flex-1"
        hideLabel
        fieldVariant="compact"
        label={t("Name")}
        ref={inputRef}
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={onKeyDown}
        className="w-full leading-snug"
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions <= 0 && deletions <= 0) return null;

  return (
    <span className="scrollbar-none flex h-full w-full min-w-0 items-center [justify-content:safe_center] overflow-x-auto overflow-y-hidden overscroll-contain">
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-sans text-ui-micro font-medium tabular-nums">
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
