import { useSidebarActions } from "./workspace/layout/useSidebarActions";
import { VoiceCompanionGate } from "../features/voice/ui/VoiceCompanionGate";
import { SOCIAL_PANEL_EVENT } from "../features/social/ui/SocialShortcut";
import { useAppUiControl } from "./workspace/control/useAppUiControl";
import {
  createConversationTerminalControl,
  type ConversationTerminalDeps,
} from "./workspace/control/conversationTerminalControl";
import { type ToolWindow } from "./model/toolWindows";
import { useWindowNavigation } from "./model/windowNavigation";
import { useTraySessions } from "./model/useTraySessions";
import { useInitializeSessions } from "./hooks/useInitializeSessions";
import { useNativeSkillWarmup } from "../features/sessions/ui/useNativeSkillWarmup";
import { useOwnedTimeout } from "../shared/hooks/useOwnedTimeout";
import { useLocale } from "../shared/i18n";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation";
import { useWorkspaceActions, type WorkspaceActions } from "./workspace/input/useWorkspaceActions";
import { useWorkspaceKeyboardShortcuts } from "./workspace/input/useWorkspaceKeyboardShortcuts";
import { useNativeMenuEvents } from "./workspace/input/useNativeMenuEvents";
import { useWindowChromeActions } from "./workspace/input/useWindowChromeActions";
import { useNativeFullscreen } from "./workspace/windows/useNativeFullscreen";
import { useMouseNavigation } from "./hooks/useMouseNavigation";
import { useTabNavigation } from "./workspace/navigation/useTabNavigation";
import { useRailNavigation } from "./workspace/navigation/useRailNavigation";
import { useListNavigation } from "./workspace/navigation/useListNavigation";
import {
  useWorkspaceUsage,
  useRunningTerminals,
  useUsageLimitResume,
} from "./workspace/derived/useWorkspaceUsage";
import { useProjectTerminalDockState } from "./workspace/terminal/useProjectTerminalDockState";
import { useProjectTerminalOpen } from "./workspace/terminal/useProjectTerminalOpen";
import { useProjectTerminalDockActions } from "./workspace/terminal/useProjectTerminalDockActions";
import { useGuideActions } from "./workspace/control/useGuideActions";
import { useDockGridSizing } from "./workspace/terminal/useDockGridSizing";
import {
  useBusySessionIds,
  useApprovalSessionIds,
  useUnseenFinishedIds,
  useLiveAgentStatus,
} from "./workspace/derived/useSessionStatusSets";
import { useWorkspaceNotifications } from "./workspace/derived/useWorkspaceNotifications";
import { useActiveWorkspaceContext } from "./workspace/derived/useActiveWorkspaceContext";
import { useHistoryLists } from "./workspace/derived/useHistoryLists";
import { useRailSessionLists } from "./workspace/derived/useRailSessionLists";
import { useTabActivation } from "./workspace/tabs/useTabActivation";
import { useNewSessionActions } from "./workspace/tabs/useNewSessionActions";
import { useTurnCardActions } from "./workspace/tabs/useTurnCardActions";
import { useMaximizedPane, useToggleMaximizePane } from "./workspace/tabs/useMaximizedPane";
import { usePaneLayoutActions } from "./workspace/tabs/usePaneLayoutActions";
import { usePaneFocusActions } from "./workspace/tabs/usePaneFocusActions";
import { usePaneMoveActions } from "./workspace/tabs/usePaneMoveActions";
import { usePaneDetachActions } from "./workspace/tabs/usePaneDetachActions";
import { useCloseTabActions } from "./workspace/tabs/useCloseTabActions";
import { useCloseAllTabs } from "./workspace/tabs/useCloseAllTabs";
import { useClosePaneActions } from "./workspace/tabs/useClosePaneActions";
import { useEditorFileClose } from "./workspace/files/useEditorFileClose";
import { useClearTabSession } from "./workspace/files/useClearTabSession";
import { useSourceControlSurfaces } from "./workspace/files/useSourceControlSurfaces";
import { useEditorFileEvents } from "./workspace/files/useEditorFileEvents";
import { useManagedWorkspaceBuffers } from "./workspace/files/useManagedWorkspaceBuffers";
import { useEditorFileOpen } from "./workspace/files/useEditorFileOpen";
import { useRepositoryReviewOpen } from "./workspace/files/useRepositoryReviewOpen";
import { useSessionLoading } from "./workspace/sessions/useSessionLoading";
import { useOpenSessionTargets } from "./workspace/sessions/useOpenSessionTargets";
import { useOpenSessionActions } from "./workspace/sessions/useOpenSessionActions";
import { useSessionPlacement } from "./workspace/sessions/useSessionPlacement";
import { useSessionReminderActions } from "./workspace/sessions/useSessionReminderActions";
import { useSessionRename } from "./workspace/sessions/useSessionRename";
import { useHistorySessionDelete } from "./workspace/sessions/useHistorySessionDelete";
import { useHistorySessionArchive } from "./workspace/sessions/useHistorySessionArchive";
import { useHistorySessionMeta } from "./workspace/sessions/useHistorySessionMeta";
import { useTitleTabActions } from "./workspace/sessions/useTitleTabActions";
import { useSessionModelActions } from "./workspace/sessions/useSessionModelActions";
import { useSessionDraftActions } from "./workspace/sessions/useSessionDraftActions";
import { useSessionShell } from "./workspace/sessions/useSessionShell";
import { useSubmitSession } from "./workspace/sessions/submit/useSubmitSession";
import { useQueuedMessageActions } from "./workspace/sessions/useQueuedMessageActions";
import { useSessionStop } from "./workspace/sessions/useSessionStop";
import { useApprovalActions } from "./workspace/sessions/useApprovalActions";
import { useSecondOpinion } from "./workspace/sessions/useSecondOpinion";
import { useBtwThreads } from "./workspace/sessions/useBtwThreads";
import { useBtwActions } from "./workspace/sessions/useBtwActions";
import { useHandoff } from "./workspace/sessions/useHandoff";
import { useAutoContinue } from "./workspace/sessions/useAutoContinue";
import { useCompactAndRewind } from "./workspace/sessions/useCompactAndRewind";
import { useOrchestrationState } from "./workspace/bridges/useOrchestrationState";
import { useOrchestratorBinding } from "./workspace/bridges/useOrchestratorBinding";
import { useOrchestrationWorkerPanes } from "./workspace/bridges/useOrchestrationWorkerPanes";
import { useOrchestrationActions } from "./workspace/bridges/useOrchestrationActions";
import { useWorktreeRemoval } from "./workspace/projects/useWorktreeRemoval";
import { useWorkspaceDirectoryActions } from "./workspace/projects/useWorkspaceDirectoryActions";
import { useWorktreeSelection } from "./workspace/projects/useWorktreeSelection";
import { useProjectOpen } from "./workspace/projects/useProjectOpen";
import { useProjectImport } from "./workspace/projects/useProjectImport";
import { useProjectRemoval } from "./workspace/projects/useProjectRemoval";
import {
  useProjectFolderRename,
  useProjectLocationChange,
  useProjectLocationSyncs,
} from "./workspace/projects/useProjectLocation";
import { useIdleSessionDetach } from "./hooks/useIdleSessionDetach";
import { useAppControlRequests } from "./workspace/control/useAppControlRequests";
import { orchestrator } from "../features/orchestration/model/orchestration";
import {
  OrchestrationActions,
  OrchestrationWorkers,
} from "../features/orchestration/ui/OrchestrationActions";
import { useDesktopLiveHandlers } from "./workspace/control/useDesktopLiveHandlers";
import { useWindowDragPreview } from "./model/useWindowDragPreview";
import { DetachedWorkingBar } from "./shell/DetachedWorkingBar";
import { WindowControlsVisible } from "./shell/WindowControls";
import {
  startTransition,
  Suspense,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
} from "react";
import { useWorktreeFocus } from "../features/source-control/model/worktreeFocus";
import { useStableCallback } from "../shared/hooks/useStableCallback";
import { useStableValue } from "../shared/hooks/useStableValue";
import { shallowArrayEqual } from "../features/sessions/model/stableBlocks";
import { useHeldValue } from "./workspace/helpers/stableProps";
import { useProjectBranches } from "../features/source-control/hooks/useProjectBranches";
import { useInboxActivity } from "../features/inbox/hooks/useInboxUnseen";
import { HAS_NATIVE_GLASS, IS_MAC } from "../platform/tauri/platform";
import { useLinkedWorkspaceGroups } from "../features/projects/hooks/useLinkedWorkspaceGroups";
import { additionalDirsForSession } from "../features/projects/model/additionalDirs";
import { setAdditionalDirsResolver } from "../integrations/harness/core/additionalDirs";
import { leafIds } from "../features/workspace/model/layout";
import { idleWorkspaceTabIds } from "../features/workspace/model/idleTabs";
import { useCloseForeignEmptyTabs } from "./workspace/tabs/useCloseForeignEmptyTabs";
import { composerDraftOf } from "../features/sessions/model/draftCache";
import { type WindowTransferPayload } from "./model/windowTransfer";
import { paneDropFromPoint } from "../features/workspace/model/paneDrop";
import {
  useMovingWindowsState,
  usePendingWindowMovesState,
} from "./workspace/windows/useWindowTransferState";
import { useWindowTransferListener } from "./workspace/windows/useWindowTransferListener";
import { useMoveTabsToNewWindow } from "./workspace/windows/useMoveTabsToNewWindow";
import {
  useLinkedCardActions,
  useContinuedSessionNotices,
} from "./workspace/actions/useLinkedCardActions";
import {
  useRemoteSessionDeleted,
  useTabSlotActions,
  usePaneFileOrder,
  useFileErrorCounts,
  useNotesPanelToggle,
  useResumeProviderSession,
  useMoveTabToNewWindow,
  useOpenArchivedSession,
  useManageWorktrees,
} from "./workspace/actions/useMiscWorkspaceActions";
import { useUsageLimitAccountActions } from "./workspace/actions/useAccountActions";
import { useSearchActions } from "./workspace/actions/useSearchActions";
import { useRepairChecks } from "./workspace/actions/useRepairChecks";
import { useWindowMoveActions } from "./workspace/windows/useWindowMoveActions";
import { useRemoteHostSync } from "./workspace/bridges/useRemoteHostSync";
import { useRunningOnHostLoader } from "./workspace/bridges/useRunningOnHostLoader";
import { useRemoteRailProjects } from "./workspace/bridges/useRemoteRailProjects";
import { useSessionRecoveryState } from "./workspace/sessions/useSessionRecoveryState";
import { useSessionRecoveryActions } from "./workspace/sessions/useSessionRecoveryActions";
import { useOpenRecoveredSessions } from "./workspace/sessions/useOpenRecoveredSessions";
import {
  useHarnessEventQueue,
  useHarnessBeforePaintFlush,
} from "./workspace/sessions/useHarnessEventQueue";
import {
  useSessionMoveGuards,
  useStopSessionForRemoval,
} from "./workspace/sessions/useSessionMoveGuards";
import {
  useSessionPersistenceRefs,
  useSessionPersistence,
} from "./workspace/sessions/useSessionPersistence";
import { useSessionPersistenceFlush } from "./workspace/sessions/useSessionPersistenceFlush";
import { registerBuiltinHarnesses } from "../integrations/harness";

import {
  loadRecents,
  isLocalProject,
  isRemoteProjectPath,
  sameProjectPath,
} from "../features/projects/model/recents";
import {
  useAddNoteToChatListener,
  useAddToChatListener,
  useWorktreeManagementListener,
} from "./workspace/control/useWorkspaceWindowEvents";
import { sessionWorkCwd } from "../features/sessions/model/session";

import { useQueuePersistence } from "../features/sessions/hooks/useQueuePersistence";
import { type SessionSummary } from "../features/sessions/data/sessionStore";
import { TranscriptPoolOutlet } from "../features/sessions/ui/TranscriptPool";
import { useDockBadge } from "../features/notifications/hooks/useDockBadge";
import { useKeepAwake } from "../features/settings/model/keepAwake";
import { useInputNotifications } from "../features/notifications/hooks/useInputNotifications";
import { useBackgroundNotifications } from "../features/notifications/hooks/useBackgroundNotifications";
import { useDailySummary } from "../features/notifications/hooks/useDailySummary";
import { useAttentionNotifications } from "../features/notifications/hooks/useAttentionNotifications";
import { useQuickComposerLaunches } from "../features/quick-composer/hooks/useQuickComposerLaunches";

import {
  OPEN_REMOTE_PROJECT_EVENT,
  REMOTE_HISTORY_UPDATED,
  REMOTE_TAB_BINDING_CHANGE,
  rememberRemotePendingWorktree,
  rememberRemoteSession,
  remoteSessionFor,
} from "../features/connections/model/connections";
import { useRemoteUnseenFinished } from "../features/connections/model/useRemoteUnseenFinished";
import {
  sessionsRef,
  setSessions,
  useShellSessions,
} from "../features/sessions/model/sessionsStore";
import { loadNotesEnabled } from "../features/settings/model/settings";

import type { InstalledUpdate } from "./model/updateNotice";
import { type ResumedWorkspace } from "./model/appLifecycle";
import type { Submit } from "./workspace/helpers/types";
import {
  useLinkedWorkItemPanelState,
  useOpenLinkedWorkItem,
  useRevealLinkedSessionUpdate,
} from "./workspace/bridges/useLinkedWorkItemPanels";
import {
  useInboxAskOpen,
  useInboxAskPortal,
  useInboxAskRestart,
  useOpenInboxSession,
} from "./workspace/bridges/useInboxAsk";
import { useWorkspaceAutomationActivity } from "./workspace/bridges/useWorkspaceAutomationActivity";
import { useInboxAutomationActivity } from "./workspace/bridges/useInboxAutomationActivity";
import { useAutomationLaunch } from "./workspace/bridges/useAutomationLaunch";
import { useAutomationRecovery } from "./workspace/bridges/useAutomationRecovery";
import { useQuickSessionLaunch } from "./workspace/bridges/useQuickSessionLaunch";
import { useAutomationSessionOpeners } from "./workspace/bridges/useAutomationSessionOpeners";
import { usePlanActions } from "./workspace/sessions/usePlanActions";
import {
  useSettingsSurfaceActions,
  useSettingsSurfaceState,
} from "./workspace/surfaces/useSettingsSurface";
import { useSurfaceOpeners } from "./workspace/surfaces/useSurfaceOpeners";
import { useProviderSignInPrompts } from "./workspace/surfaces/useProviderSignInPrompts";
import { useUpdateNotices } from "./workspace/surfaces/useUpdateNotices";
import { openSessionIds } from "./workspace/helpers/sessionHelpers";
import { filesInWorkspaceTabs } from "./workspace/helpers/tabHelpers";
import { useActiveTabContext } from "./workspace/layout/useActiveTabContext";
import { useSidebarTabSelection } from "./workspace/layout/useSidebarTabSelection";
import { useWorktreeDeckTabs } from "./workspace/layout/useWorktreeDeckTabs";
import { useInboxRepairLists } from "./workspace/layout/useInboxRepairLists";
import { useSessionPaneProps } from "./workspace/layout/useSessionPaneProps";
import { useWorkspaceChromeFlags } from "./workspace/layout/useWorkspaceChromeFlags";
import { useLayoutControl } from "./workspace/layout/useLayoutControl";
import { useWorkspaceTitleBar } from "./workspace/layout/useWorkspaceTitleBar";
import { useRecoveryControl } from "./workspace/layout/useRecoveryControl";
import { WorkspaceAuxSurfaces } from "./workspace/layout/WorkspaceAuxSurfaces";
import { WorkspaceMainArea } from "./workspace/layout/WorkspaceMainArea";
import {
  WorkspaceRecoveryDialogs,
  WorkspacePickerDialogs,
} from "./workspace/layout/WorkspaceDialogs";
import { WorkspaceNotices } from "./workspace/layout/WorkspaceNotices";
import { WorkspaceToolPanels } from "./workspace/layout/WorkspaceToolPanels";
import { WorkspaceSettingsSurface } from "./workspace/layout/WorkspaceSettingsSurface";
import { WorkspaceFooter } from "./workspace/layout/WorkspaceFooter";
import { WorkspaceSidebar } from "./workspace/layout/WorkspaceSidebar";
import { WorkspaceMenuBar } from "./workspace/layout/WorkspaceMenuBar";
import { WorkspaceFilePicker } from "./workspace/layout/WorkspaceFilePicker";
import {
  useBootWatchers,
  useNotificationPermissionProbe,
  useTrafficLightsVisible,
} from "./workspace/lifecycle/useBootWatchers";
import { useProjectLocationSeeding } from "./workspace/lifecycle/useProjectLocationSeeding";
import {
  useActiveHarnessCatalogRefresh,
  useHarnessLifecycle,
} from "./workspace/lifecycle/useHarnessLifecycle";
import { useWindowFocusLifecycle } from "./workspace/lifecycle/useWindowFocusLifecycle";
import { useProjectLockRedirect } from "./workspace/lifecycle/useProjectLockRedirect";
import { useOpenProjectChangesListener } from "./workspace/lifecycle/useProjectNavigationListeners";
import { useLiveAgentAnnouncements } from "./workspace/lifecycle/useLiveAgentAnnouncements";
import { useFocusResets } from "./workspace/lifecycle/useFocusResets";
import { useSessionHousekeeping } from "./workspace/sessions/useSessionHousekeeping";
import { useSessionBookkeepingRefs } from "./workspace/sessions/useSessionBookkeepingRefs";
import { useHistoryRefresh } from "./workspace/sessions/useHistoryRefresh";
import { useHistorySync } from "./workspace/sessions/useHistorySync";
import { useWorkspaceSnapshotSync } from "./workspace/sessions/useWorkspaceSnapshotSync";
import { useProjectState } from "./workspace/state/useProjectState";
import { useWorkspaceSeed, useTabState, useActiveTabSetter } from "./workspace/state/useTabState";
import { useComposerRailState, useWorkspaceUiState } from "./workspace/state/useWorkspaceUiState";
import { useHistoryState } from "./workspace/state/useHistoryState";
import { useSurfaceViewFlags, useSurfaceBoardFlags } from "./workspace/state/useSurfaceViewState";
import { useSettingsBackedFlags } from "./workspace/state/useSettingsBackedFlags";
import {
  useWorkspaceStateRefs,
  useSurfaceFlagRefs,
} from "./workspace/state/useWorkspaceRefMirrors";
import { useWorkspacePins } from "./workspace/state/useWorkspacePins";
import { useProjectReturnMemory } from "./workspace/state/useProjectReturnMemory";

// Register capabilities before composer hooks choose their discovery strategy.
registerBuiltinHarnesses();

type AppProps = {
  toolWindow?: ToolWindow | null;
  windowTransfer?: WindowTransferPayload | null;
  windowTransferPending?: boolean;
  resumed?: ResumedWorkspace | null;
  installedUpdate?: InstalledUpdate | null;
  history?: SessionSummary[];
  historyCwd?: string | null;
};

export default function App(props: AppProps) {
  useLocale();
  return (
    <Suspense fallback={null}>
      <Workspace {...props} />
    </Suspense>
  );
}

function Workspace({
  toolWindow = null,
  windowTransfer = null,
  windowTransferPending = false,
  resumed = null,
  installedUpdate = null,
  history: bootHistory = [],
  historyCwd: bootHistoryCwd = null,
}: AppProps) {
  useLocale();
  const windowTransferPendingRef = useRef(windowTransferPending);
  windowTransferPendingRef.current = windowTransferPending;
  const nativeFullscreenRef = useNativeFullscreen();
  const { projectCwd, setProjectCwd, recents, setRecents, lockSnapshot, visibleRecents } =
    useProjectState({ toolWindow, windowTransfer, resumed });
  useBootWatchers({ setRecents });
  const seed = useWorkspaceSeed({ toolWindow });
  // The sessions live in a store so a streamed token re-renders only the pane
  // showing it. `sessions` here lags behind by streamed text alone; code that
  // needs the live text reads `sessionsRef.current` at event time.
  const deferWorkspaceWork = useOwnedTimeout();
  useInitializeSessions(windowTransfer?.sessions ?? resumed?.sessions ?? [seed.session]);
  const sessions = useShellSessions();
  const {
    sessionRecovery,
    updateSessionRecovery,
    recoveryOpen,
    setRecoveryOpen,
    sessionDeleteDialog,
    setSessionDeleteDialog,
  } = useSessionRecoveryState({ windowTransfer, toolWindow });
  useKeepAwake(sessions);
  const switchingWorktrees = useRef(new Map<string, string>());
  const removingWorktreePaths = useRef(new Set<string>());
  const deleteConfirmationPending = useRef(false);
  const { tabs, setTabs, activeTabId, setActiveTabIdState } = useTabState({
    seed,
    windowTransfer,
    resumed,
  });
  const projectTerminalDock = useProjectTerminalDockState({
    initialProjectTerminals: () =>
      windowTransfer?.projectTerminals ?? resumed?.projectTerminals ?? [],
    initialLastDockSide: () => resumed?.lastDockSide ?? null,
    projectCwd,
  });
  const {
    projectTerminals,
    setProjectTerminals,
    lastDockSide,
    lastDockSideRef,
    projectTerminalFocused,
    setProjectTerminalFocused,
    projectTerminalsRef,
    projectTerminalFocusedRef,
    currentProjectDock,
    dockVisible,
  } = projectTerminalDock;
  // Maximized pane state and its repair effect; the toggle lives after isMovingPane.
  const { maximizedPane, setMaximizedPane } = useMaximizedPane({ tabs });
  const {
    composerFocused,
    setComposerFocused,
    composerFocusToken,
    setComposerFocusToken,
    tabProjectsRef,
    projectOfTab,
    projectRailOpen,
    setProjectRailOpen,
    sessionSidebarOpen,
    setSessionSidebarOpen,
  } = useComposerRailState({ windowTransfer, resumed });
  const tabCloseScope = "project" as const;
  const {
    filesSearchOpen,
    setFilesSearchOpen,
    searchFocusToken,
    setSearchFocusToken,
    searchViewOpen,
    setSearchViewOpen,
    searchViewFocusToken,
    setSearchViewFocusToken,
    inboxViewOpen,
    setInboxViewOpen,
    pullRequestsOnly,
    setPullRequestsOnly,
  } = useSurfaceViewFlags({ toolWindow });
  const {
    linkedWorkItemPanels,
    setLinkedWorkItemPanels,
    linkedWorkItemPanelRequest,
    closeLinkedWorkItemPanel,
  } = useLinkedWorkItemPanelState();
  const { inboxAskPortal, setInboxAskPortal, openingInboxSessions } = useInboxAskPortal();
  const {
    serversViewOpen,
    setServersViewOpen,
    notesViewOpen,
    setNotesViewOpen,
    automationsViewOpen,
    setAutomationsViewOpen,
    auxiliaryTool,
    setAuxiliaryTool,
    taskBoardShown,
    setTaskBoardShown,
    socialBoardShown,
    setSocialBoardShown,
    socialPanelCwd,
    setSocialPanelCwd,
  } = useSurfaceBoardFlags({ toolWindow });
  useEffect(() => {
    const open = async (event: Event) => {
      const detail = (event as CustomEvent<{ cwd: string; local?: boolean }>).detail;
      startTransition(() => {
        setFilePickerOpen(false);
        setSettingsOpen(false);
        setSearchViewOpen(false);
        setInboxViewOpen(false);
        setServersViewOpen(false);
        setNotesViewOpen(false);
        setSocialPanelCwd(detail.cwd);
        setSocialBoardShown(true);
        setTaskBoardShown(false);
        setAutomationsViewOpen(true);
      });
    };
    window.addEventListener(SOCIAL_PANEL_EVENT, open);
    return () => window.removeEventListener(SOCIAL_PANEL_EVENT, open);
  }, []);
  const {
    inspectedWorkerId,
    setInspectedWorkerId,
    workerDetailRequest,
    setWorkerDetailRequest,
    orchestrationRuns,
  } = useOrchestrationState();
  const { notesEnabled, liveAgentsEnabled, collapsedProjectRailMode, setCollapsedProjectRailMode } =
    useSettingsBackedFlags();
  const {
    settingsOpen,
    setSettingsOpen,
    settingsSection,
    setSettingsSection,
    settingsAnchor,
    setSettingsAnchor,
    settingsOpenRef,
  } = useSettingsSurfaceState();
  const {
    updateNotice,
    onDismissUpdate,
    whatsNewVersion,
    setWhatsNewVersion,
    whatsNewVersionRef,
    onOpenWhatsNew,
  } = useUpdateNotices({ installedUpdate });
  const {
    notificationProjectPath,
    setNotificationProjectPath,
    notificationSettingsRequest,
    setNotificationSettingsRequest,
    worktreeManagementRequest,
    setWorktreeManagementRequest,
    worktreeManagementRevision,
    setWorktreeManagementRevision,
    editorNavigation,
    setEditorNavigation,
    editorNavigationToken,
    filePickerOpen,
    setFilePickerOpen,
    filePickerInitialQuery,
    setFilePickerInitialQuery,
    filePickerResetToken,
    setFilePickerResetToken,
    dirtyFiles,
    setDirtyFiles,
    fileErrorCounts,
    setFileErrorCounts,
    history,
    setHistory,
  } = useWorkspaceUiState({ windowTransfer, bootHistory });
  useManagedWorkspaceBuffers(
    [...filesInWorkspaceTabs(tabs), ...projectTerminals.flatMap((dock) => dock.pane.files)],
    dirtyFiles,
  );
  const [, refreshRemoteTabTitles] = useState(0);
  useEffect(() => {
    const updated = () => refreshRemoteTabTitles((value) => value + 1);
    window.addEventListener(REMOTE_HISTORY_UPDATED, updated);
    return () => window.removeEventListener(REMOTE_HISTORY_UPDATED, updated);
  }, []);
  const {
    storedLinkedSessions,
    setStoredLinkedSessions,
    btwRequestsRef,
    loadedProjects,
    setLoadedProjects,
    loadedProjectsRef,
    historyErrorCwd,
    setHistoryErrorCwd,
  } = useHistoryState({ bootHistory, bootHistoryCwd });

  const {
    localHostReachable,
    loadRunningOnHostRef,
    onRefreshAdoptedSession,
    desktopLiveHandlers,
    linkedSessionUpdatesRef,
    onRemoteSnapshot,
  } = useRemoteHostSync();
  const linkedWorkItemActivityFetches = useRef(new Map<string, number>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  // Provider adapters ask this for a session's extra folders at launch.
  useEffect(() => {
    setAdditionalDirsResolver((sessionId) => {
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      return session && isLocalProject(session.cwd)
        ? additionalDirsForSession(sessionId, session.cwd)
        : [];
    });
    return () => setAdditionalDirsResolver(() => []);
  }, []);
  const { dirtyFilesRef, activeTabIdRef, projectCwdRef } = useWorkspaceStateRefs({
    dirtyFiles,
    activeTabId,
    projectCwd,
  });

  const projectWorktree = useWorktreeFocus(projectCwd);
  /** Tab or session id -> the workspace it was opened or moved in. A tab
   * belongs to the workspace it was opened in, whatever worktree it runs in:
   * opening a session, or moving one from its composer, never switches the
   * workspace. Unpinned tabs group by their own worktree. */
  // Saved tabs reopen on their project's default workspace, including one its
  // composer moved to a worktree. A tab handed over from another window keeps
  // grouping by its own worktree.
  const { workspacePins, tabWorkspace, tabWorktreeOf, keepWorkspaceTab } = useWorkspacePins({
    windowTransfer,
    tabs,
    sessions,
  });

  const workspaceNavigation = useWorkspaceNavigation({
    project: projectCwd,
    activeTabId,
    tabs,
    sessions,
    pins: workspacePins.current,
    tabWorkspace,
    moveSession: (id, tree, isCurrent) => onWorktreeChange(id, tree, false, isCurrent),
    activateTab: (id) => {
      if (tabsRef.current.some((tab) => tab.id === id)) {
        activateTab(id, undefined, "workspace");
      } else {
        // A newly created tab has not rendered into tabsRef yet.
        setActiveTabIdState(id);
        setComposerFocused(true);
      }
    },
    createTab: (project, focus) => createWorkspaceTab(project, focus),
  });
  // Every ordinary tab activation supersedes an unfinished workspace request,
  // including opening a session in the same tab or selecting a project.
  const setActiveTabId = useActiveTabSetter({
    cancel: workspaceNavigation.cancel,
    setActiveTabIdState,
    setProjectTerminalFocused,
    setComposerFocusToken,
  });
  const {
    searchViewOpenRef,
    inboxViewOpenRef,
    serversViewOpenRef,
    notesViewOpenRef,
    automationsViewOpenRef,
    filePickerOpenRef,
  } = useSurfaceFlagRefs({
    serversViewOpen,
    searchViewOpen,
    inboxViewOpen,
    notesViewOpen,
    automationsViewOpen,
    filePickerOpen,
  });
  const foregroundSurfaceRef = useRef<{
    workspaceVisible: boolean;
    inboxSessionId?: string;
  }>({ workspaceVisible: true });
  foregroundSurfaceRef.current = {
    workspaceVisible:
      !searchViewOpen &&
      !inboxViewOpen &&
      !notesViewOpen &&
      !serversViewOpen &&
      !automationsViewOpen &&
      !settingsOpen,
    inboxSessionId: inboxViewOpen ? inboxAskPortal?.sessionId : undefined,
  };
  const sessionNavigationIdsRef = useRef<readonly string[]>([]);
  useSessionHousekeeping({ sessions, btwRequestsRef, notesEnabled, setNotesViewOpen });

  const { projectReturnRef, readProjectReturnMemory } = useProjectReturnMemory({
    resumed,
    tabs,
    activeTabId,
    sessions,
    tabsRef,
    activeTabIdRef,
  });

  const persistenceRefs = useSessionPersistenceRefs();
  const {
    turnGen,
    retiringTurns,
    lastPersisted,
    lastBoundProvider,
    lastPersistedUserBlock,
    observedSessions,
    pendingPersist,
  } = persistenceRefs;
  const {
    editedResends,
    inFlightSyncKey,
    sawInFlight,
    workspaceSyncKey,
    removingSessionIds,
    loadedSessionCache,
    sessionLoads,
    sessionLoadEpochs,
    openingSessionIds,
    activeSessionPrefetch,
  } = useSessionBookkeepingRefs();
  const [remoteBindingRevision, setRemoteBindingRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRemoteBindingRevision((revision) => revision + 1);
    window.addEventListener(REMOTE_TAB_BINDING_CHANGE, changed);
    return () => window.removeEventListener(REMOTE_TAB_BINDING_CHANGE, changed);
  }, []);
  // Harness token queue and transcript pool (see useHarnessEventQueue).
  const { transcriptPool, harnessQueue, flushHarnessEvents, enqueueHarnessEvent } =
    useHarnessEventQueue({ tabsRef, activeTabIdRef, foregroundSurfaceRef });
  // Move guards for sessions and tabs in transit (see useSessionMoveGuards).
  const { skipForgetSessionIds, movingTabIds, movingSessionIds, isMovingPane } =
    useSessionMoveGuards({ windowTransferPendingRef, tabsRef });
  const onToggleMaximizePane = useToggleMaximizePane({
    tabsRef,
    activeTabIdRef,
    sessionsRef,
    windowTransferPendingRef,
    movingTabIds,
    setTabs,
    setProjectTerminalFocused,
    setComposerFocused,
    setMaximizedPane,
  });
  const openingFileWindowIds = useRef(new Set<string>());
  const importedSessionsApplied = useRef(false);
  const projectLocationSyncs = useProjectLocationSyncs();
  const submitAfterProjectSyncRef = useRef<Submit>(() => false);

  useProjectLocationSeeding({
    recents,
    windowTransfer,
    resumed,
    observedSessions,
    lastPersisted,
    lastPersistedUserBlock,
    lastBoundProvider,
    importedSessionsApplied,
  });

  const stopSessionForRemoval = useStopSessionForRemoval({ turnGen, flushHarnessEvents });

  useHarnessLifecycle({
    resumed,
    harnessQueue,
    tabsRef,
    activeTabIdRef,
    projectCwdRef,
    projectTerminalsRef,
    lastDockSideRef,
    keepWorkspaceTab,
    readProjectReturnMemory,
  });

  const {
    activeTab,
    active,
    sidebarCwd,
    sidebarCwdRef,
    historyFailed,
    historyPending,
    gitCwd,
    terminalCwd,
    filesCwd,
    gitCwdRef,
  } = useActiveWorkspaceContext({
    tabs,
    activeTabId,
    sessions,
    projectCwd,
    historyErrorCwd,
    loadedProjects,
  });
  const { conversationTools, activeLinkedWorkItemPanel } = useActiveTabContext({
    active,
    activeTab,
    projectCwd,
    linkedWorkItemPanels,
  });

  // Panels are tab-local UI. Keep mounted panels alive while their tab is in
  // the workspace so switching away preserves the fetched issue and its UI
  // state, then discard them when their session leaves every open tab.
  useEffect(() => {
    const openSessionIds = new Set(tabs.flatMap((tab) => leafIds(tab.layout)));
    setLinkedWorkItemPanels((current) => {
      if ([...current.keys()].every((id) => openSessionIds.has(id))) {
        return current;
      }
      return new Map([...current].filter(([id]) => openSessionIds.has(id)));
    });
  }, [tabs]);

  const sessionDefaults = active ?? sessions[0];

  useAddToChatListener({
    sessionDefaults,
    tabsRef,
    activeTabIdRef,
    projectCwdRef,
    setTabs,
    setActiveTabId,
    setProjectTerminalFocused,
    setComposerFocused,
  });

  useNativeSkillWarmup(active);

  const { sidebarTab, setSidebarTabSelection, setSidebarTab } = useSidebarTabSelection({
    sidebarCwd,
    sidebarCwdRef,
  });
  const gitCwdBranches = useProjectBranches(
    gitCwd,
    Boolean(gitCwd) && gitCwd !== "~" && !isRemoteProjectPath(sidebarCwd),
  );
  const explorerRootLabel =
    active?.worktreeCwd && sameProjectPath(gitCwd, sessionWorkCwd(active))
      ? active.branch || gitCwdBranches?.current || undefined
      : undefined;
  const projectBranches = useProjectBranches(sidebarCwd, Boolean(sidebarCwd) && sidebarCwd !== "~");

  const busySessionIds = useBusySessionIds(sessions);

  const activeHarness = active?.harness;
  useActiveHarnessCatalogRefresh(activeHarness);

  const { usageProviders, usageSession } = useWorkspaceUsage(active);
  const {
    providerAccountRecovery,
    setProviderAccountRecovery,
    providerSignInRequest,
    setProviderSignInRequest,
    promptProviderAccountSignIn,
  } = useProviderSignInPrompts({ active, sessions, sessionsRef });
  const { runningTerminals, runningTerminalOpen } = useRunningTerminals({
    projectCwd,
    projectTerminals,
    tabs,
    activeTab,
    currentProjectDock,
  });

  const approvalSessionIds = useApprovalSessionIds(sessions);

  const activeSessionId = inboxViewOpen ? inboxAskPortal?.sessionId : active?.id;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  useInputNotifications(sessions, activeSessionId);
  useAttentionNotifications(sessions, activeSessionId);
  useBackgroundNotifications(automationsViewOpen && taskBoardShown);
  useDailySummary();

  useNotificationPermissionProbe();
  const unseenFinishedIds = useUnseenFinishedIds(sessions, busySessionIds, activeSessionId);

  const { listedRemoteSessions, loadedRemoteHostIds, unopenedRemote, unopenedRemoteRef } =
    useRemoteRailProjects({ visibleRecents, sessionRecovery, lockSnapshot, sessions });
  // The unopened list already leaves out loaded sessions and the one a tab is
  // creating, so the user's own first turn never shows as finished elsewhere.
  const [remoteUnseenFinishedIds, dismissRemoteFinished] = useRemoteUnseenFinished(
    unopenedRemote,
    loadedRemoteHostIds,
    activeSessionId ? remoteSessionFor(activeSessionId) : undefined,
  );

  const { nextLiveAgents, liveAgents, ownedLiveSessionKeys } = useLiveAgentStatus({
    sessions,
    unseenFinishedIds,
    unopenedRemote,
    remoteUnseenFinishedIds,
    lockSnapshot,
    liveAgentsEnabled,
  });

  const { hiddenApprovalToasts, pendingNotifications } = useWorkspaceNotifications({
    sessions,
    activeTabId,
    tabs,
    composerFocused,
  });
  const [reminderNoticesHeight, setReminderNoticesHeight] = useState(0);
  const [harnessUpdateHeight, setHarnessUpdateHeight] = useState(0);

  useDockBadge();

  useWindowFocusLifecycle({
    serversViewOpenRef,
    flushHarnessEvents,
    projectTerminalFocusedRef,
    searchViewOpenRef,
    inboxViewOpenRef,
    notesViewOpenRef,
    automationsViewOpenRef,
    settingsOpenRef,
    setComposerFocused,
    setComposerFocusToken,
  });

  useHarnessBeforePaintFlush({
    flushHarnessEvents,
    activeTabId,
    inboxViewOpen,
    inboxAskSessionId: inboxAskPortal?.sessionId,
    searchViewOpen,
    notesViewOpen,
    automationsViewOpen,
    settingsOpen,
  });

  useSessionPersistenceFlush({
    tabsRef,
    activeTabIdRef,
    projectCwdRef,
    projectTerminalsRef,
    lastDockSideRef,
    readProjectReturnMemory,
    flushHarnessEvents,
    keepWorkspaceTab,
    windowTransfer,
    toolWindow,
  });

  const { refreshHistory } = useHistoryRefresh({
    sidebarCwd,
    sidebarCwdRef,
    loadedProjectsRef,
    setHistory,
    setLoadedProjects,
    setHistoryErrorCwd,
  });

  useHistorySync({ inboxViewOpen, gitCwd, setStoredLinkedSessions });

  const { persistSession } = useSessionPersistence({
    refs: persistenceRefs,
    sessions,
    tabsRef,
    sidebarCwdRef,
    removingSessionIds,
    switchingWorktrees,
    setHistory,
    localHostReachable,
  });

  useWorkspaceSnapshotSync({
    tabs,
    sessions,
    activeTabId,
    projectCwd,
    projectTerminals,
    lastDockSide,
    windowTransfer,
    toolWindow,
    keepWorkspaceTab,
    projectReturnRef,
    projectWorktreePath: projectWorktree?.path,
    workspaceNavigationRevision: workspaceNavigation.revision,
    remoteBindingRevision,
    inFlightSyncKey,
    sawInFlight,
    workspaceSyncKey,
    setProjectCwd,
    setRecents,
  });

  // Tabs are views. Hidden idle sessions drop their child. A visible session
  // keeps its child for a few minutes after a turn so follow-ups stay instant,
  // then parks it and resumes on the next prompt.
  useIdleSessionDetach({
    sessions,
    sessionsRef,
    tabs,
    tabsRef,
    orchestrationRuns,
    liveAgentsEnabled,
    unseenFinishedIds,
    openingSessionIds,
    loadedSessionCache,
    skipForgetSessionIds,
    persistSession,
    setSessions,
  });

  // Tab activation and insertion (followProject, activateTab, insertBeside*, appendTab).
  const { followProject, activateTab, insertBeside, insertBesideActive, appendTab } =
    useTabActivation({
      projectCwdRef,
      setProjectCwd,
      setRecents,
      tabsRef,
      sessionsRef,
      activeTabIdRef,
      setActiveTabIdState,
      setActiveTabId,
      setTabs,
      setComposerFocused,
      projectOfTab,
    });

  // New-session and card callbacks (createWorkspaceTab, onNew*, onStartInboxItem,
  // onAddNoteToChat). The ADD_NOTE_TO_CHAT listener effect stays below.
  const {
    createWorkspaceTab,
    onNewSession,
    onNew,
    onSelectRemoteSession,
    onStartInboxItem,
    onAddNoteToChat,
  } = useNewSessionActions({
    setServersViewOpen,
    setTabs,
    active,
    sessionDefaults,
    projectCwd,
    sidebarCwd,
    sessionsRef,
    tabsRef,
    setSessions,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setSidebarTab,
    setActiveTabId,
    setComposerFocused,
    workspaceNavigation,
    activateTab,
    appendTab,
    followProject,
  });

  useAddNoteToChatListener(onAddNoteToChat);

  const { onInboxCardDismiss, onNoteCardDismiss, onHandoffCardDismiss } = useTurnCardActions({
    setSessions,
  });

  const { setLinkedWorkItemUpdateCard, onLinkedWorkItemUpdateCardDismiss } = useLinkedCardActions({
    sessionsRef,
    setSessions,
  });

  const { onSplit, activeTabLayoutPreset, onArrangeActiveTab } = usePaneLayoutActions({
    activeTab,
    sidebarCwd,
    sessionDefaults,
    tabsRef,
    sessionsRef,
    windowTransferPendingRef,
    movingTabIds,
    setMaximizedPane,
    setSessions,
    setTabs,
    setComposerFocused,
  });
  const {
    focusProjectTerminal,
    openProjectTerminal,
    onOpenTerminal,
    onNewTerminal,
    onNewTerminalWithProfile,
    onSplitProjectTerminal,
    onShowProjectTerminal,
    onNewTerminalInSession,
    onRunSessionProjectAction,
  } = useProjectTerminalOpen({
    dock: projectTerminalDock,
    activeTab,
    appendTab,
    setActiveTabId,
    setComposerFocused,
    setSessions,
    setTabs,
    sessionsRef,
    lastPersisted,
    projectCwd,
    projectCwdRef,
    sidebarCwd,
    terminalCwd,
  });

  const {
    onToggleProjectTerminal,
    onHideProjectTerminal,
    onProjectTerminalSide,
    onProjectTerminalSize,
    onSelectProjectTerminal,
    onReorderProjectTerminals,
    onCloseProjectTerminal,
    onCloseOtherProjectTerminals,
    onTerminalMetaChange,
    onToggleRunningTerminal,
    onNewTerminalTab,
  } = useProjectTerminalDockActions({
    dock: projectTerminalDock,
    projectCwd,
    projectCwdRef,
    terminalCwd,
    focusProjectTerminal,
    openProjectTerminal,
    onOpenTerminal,
    activeTabIdRef,
    tabsRef,
    setActiveTabId,
    setComposerFocused,
    setTabs,
  });

  const { onCloseTab, onCloseTabs, onCloseOtherTabs } = useCloseTabActions({
    activateTab,
    persistSession,
    refreshHistory,
    sidebarCwd,
    tabCloseScope,
    tabWorktreeOf,
    tabsRef,
    sessionsRef,
    activeTabIdRef,
    movingTabIds,
    windowTransferPendingRef,
    dirtyFilesRef,
    setDirtyFiles,
    setTabs,
    rememberRemoteSession,
    rememberRemotePendingWorktree,
  });

  // Idle tabs close without prompts: the active, moving, dirty and terminal tabs stay.
  const idleTabIds = () =>
    idleWorkspaceTabIds({
      tabs,
      sessions,
      activeTabId: activeTabIdRef.current,
      busySessionIds,
      unseenFinishedIds,
      dirtyFileIds: dirtyFilesRef.current,
      movingTabIds: movingTabIds.current,
      hasComposerDraft: (sessionId) => {
        const draft = composerDraftOf(sessionId);
        return draft.text.trim().length > 0 || draft.attachments.length > 0;
      },
    });
  const idleTabCount = idleTabIds().length;
  const onCloseIdleTabs = () => {
    const ids = idleTabIds();
    if (ids.length > 0) onCloseTabs(ids, activeTabIdRef.current);
  };
  // Other projects' never-used new chats close on launch and on project switch.
  useCloseForeignEmptyTabs({
    projectCwd,
    tabs,
    sessions,
    activeTabId,
    busySessionIds,
    unseenFinishedIds,
    dirtyFileIds: dirtyFiles,
    movingTabIds: movingTabIds.current,
    restoredWorkspace: !windowTransfer,
    onCloseTabs: (ids, fallbackId, opts) => onCloseTabs(ids, fallbackId, opts),
  });

  const { onCloseFile, onCloseOtherFiles } = useEditorFileClose({
    activeTabId,
    projectCwd,
    tabCloseScope,
    tabWorktreeOf,
    tabsRef,
    sessionsRef,
    dirtyFilesRef,
    isMovingPane,
    onCloseTab,
    setDirtyFiles,
    setSessions,
    setTabs,
    setComposerFocused,
  });

  const { movingWindows, setMovingWindows } = useMovingWindowsState();
  useWindowDragPreview(
    () =>
      new Set(
        tabsRef.current.flatMap((tab) => [
          ...leafIds(tab.layout),
          ...filesInWorkspaceTabs([tab]).map((file) => file.id),
        ]),
      ),
    (x, y) => {
      const target = paneDropFromPoint(x, y);
      return (
        !target ||
        !tabsRef.current.some(
          (tab) => movingTabIds.current.has(tab.id) && leafIds(tab.layout).includes(target.id),
        )
      );
    },
  );
  const { pendingWindowMoves, setPendingWindowMoves } = usePendingWindowMovesState();

  useWindowTransferListener({
    activateTab,
    tabsRef,
    sessionsRef,
    projectTerminalsRef,
    activeTabIdRef,
    projectCwdRef,
    movingTabIds,
    movingSessionIds,
    skipForgetSessionIds,
    observedSessions,
    lastPersisted,
    lastBoundProvider,
    lastPersistedUserBlock,
    pendingPersist,
    setTabs,
    setSessions,
    setProjectTerminals,
    setProjectCwd,
    setMovingWindows,
  });

  const { onMoveTabsToNewWindow } = useMoveTabsToNewWindow({
    activateTab,
    tabsRef,
    sessionsRef,
    projectTerminalsRef,
    activeTabIdRef,
    projectCwdRef,
    dirtyFilesRef,
    movingTabIds,
    movingSessionIds,
    skipForgetSessionIds,
    setMovingWindows,
    setPendingWindowMoves,
    setProjectTerminals,
    setSessions,
    setTabs,
    setDirtyFiles,
  });

  const { onCancelMoveToNewWindow, onOpenFileInNewWindow } = useWindowMoveActions({
    pendingWindowMoves,
    tabs,
    sessions,
    setPendingWindowMoves,
    onMoveTabsToNewWindow,
    onCloseFile,
    isMovingPane,
    tabsRef,
    dirtyFilesRef,
    projectCwdRef,
    openingFileWindowIds,
    movingTabIds,
    movingSessionIds,
    setMovingWindows,
  });

  const { onClearTabSession } = useClearTabSession({
    tabs,
    tabWorkspace,
    windowTransferPendingRef,
    movingTabIds,
    sessionsRef,
    dirtyFilesRef,
    persistSession,
    rememberRemoteSession,
    rememberRemotePendingWorktree,
    refreshHistory,
    sidebarCwd,
    setSessions,
    setDirtyFiles,
    setTabs,
    setComposerFocused,
  });

  const { onRemoteSessionDeleted } = useRemoteSessionDeleted({
    tabsRef,
    sessionsRef,
    tabCloseScope,
    tabWorktreeOf,
    onClearTabSession,
    onCloseTab,
  });

  const { onCloseAllTabs } = useCloseAllTabs({
    onCloseTab,
    onCloseTabs,
    onClearTabSession,
    projectCwd,
    tabCloseScope,
    tabWorktreeOf,
    tabsRef,
    sessionsRef,
    activeTabIdRef,
    dirtyFilesRef,
    setDirtyFiles,
    setTabs,
    setSessions,
    setComposerFocused,
  });

  const { onClosePane, onCloseTitleTab } = useClosePaneActions({
    activeTab,
    onCloseFile,
    onCloseTab,
    onClearTabSession,
    persistSession,
    refreshHistory,
    sidebarCwd,
    tabCloseScope,
    tabWorktreeOf,
    tabsRef,
    sessionsRef,
    activeTabIdRef,
    movingTabIds,
    windowTransferPendingRef,
    setTabs,
    setComposerFocused,
  });

  const { worktreeTabStats, deckProjectTabs } = useWorktreeDeckTabs({
    tabs,
    sessions,
    sidebarCwd,
    projectCwd,
    activeTabId,
    projectWorktree,
    tabWorkspace,
    workspaceNavigation,
  });

  const { onNext, onPrev } = useTabNavigation({
    activateTab,
    activeTabId,
    deckProjectTabs,
  });

  const { onActivate } = useTabSlotActions({ activateTab, deckProjectTabs });

  const { onFocusPane } = usePaneFocusActions({
    activeTabId,
    activeTabIdRef,
    tabsRef,
    sessionsRef,
    inboxAskPortal,
    isMovingPane,
    workspaceNavigation,
    setMaximizedPane,
    setProjectTerminalFocused,
    setComposerFocused,
    setTabs,
  });

  const { onOpenDiff, onOpenWorkingTreeDiff, onOpenAllChanges, onOpenCommit, onToggleChanges } =
    useSourceControlSurfaces({
      activeTabId,
      gitCwdRef,
      sidebarCwdRef,
      sessionsRef,
      setTabs,
      setComposerFocused,
      setSidebarTab,
    });

  const { onReorderTabs, onMovePane, onMoveFileBetweenPanes } = usePaneMoveActions({
    tabsRef,
    sessionsRef,
    projectCwdRef,
    dirtyFilesRef,
    movingTabIds,
    isMovingPane,
    projectOfTab,
    setTabs,
    setSessions,
    setActiveTabId,
    setProjectTerminalFocused,
    setComposerFocused,
  });

  const { onReorderFiles } = usePaneFileOrder({ isMovingPane, setTabs });

  const { onDetachPane, onPopOutPane } = usePaneDetachActions({
    tabsRef,
    movingTabIds,
    dirtyFilesRef,
    isMovingPane,
    setTabs,
    setProjectTerminalFocused,
    activateTab,
    onMoveTabsToNewWindow,
  });

  const { focusOpenSession, replaceBlankPaneWithSession } = useOpenSessionTargets({
    tabsRef,
    sessionsRef,
    activeTabIdRef,
    lastPersisted,
    loadedSessionCache,
    setSessions,
    setTabs,
    setActiveTabId,
    setComposerFocused,
    followProject,
  });

  const {
    invalidateLoadedSession,
    loadStoredSession,
    ensureOpenSession,
    onPopOutSession,
    onPrefetchHistorySession,
  } = useSessionLoading({
    sessionsRef,
    setSessions,
    setTabs,
    tabsRef,
    onPopOutPane,
    lastPersisted,
    loadedSessionCache,
    sessionLoads,
    sessionLoadEpochs,
    openingSessionIds,
    removingSessionIds,
    activeSessionPrefetch,
    sidebarCwd,
    refreshHistory,
  });

  /** Loads sessions this machine's host runs for another computer, so the
   * Working card shows them without a tab; they unload once seen after done. */
  useRunningOnHostLoader({
    loadRunningOnHostRef,
    loadStoredSession,
    openingSessionIds,
    removingSessionIds,
    loadedSessionCache,
    lastPersisted,
  });

  const revealLinkedSessionUpdate = useRevealLinkedSessionUpdate({
    sessionsRef,
    linkedSessionUpdatesRef,
    linkedWorkItemActivityFetches,
    setLinkedWorkItemUpdateCard,
  });

  const onAskInboxItem = useInboxAskOpen({ openingInboxSessions, sessionsRef, sidebarCwd });

  const { onRestartInboxAsk } = useInboxAskRestart({
    onAskInboxItem,
    stopSessionForRemoval,
    removingSessionIds,
    sessionsRef,
    setInboxAskPortal,
    inboxAskPortal,
    inboxViewOpen,
    setComposerFocused,
  });

  const {
    onSelectHistorySession,
    onPreviewHistorySession,
    onKeepSession,
    onOpenSessionsSideBySide,
  } = useOpenSessionActions({
    sessions,
    tabsRef,
    setTabs,
    setActiveTabId,
    setProjectTerminalFocused,
    setComposerFocused,
    setInspectedWorkerId,
    followProject,
    appendTab,
    insertBesideActive,
    ensureOpenSession,
    focusOpenSession,
    replaceBlankPaneWithSession,
    linkedSessionUpdatesRef,
    revealLinkedSessionUpdate,
    orchestrator,
    workspaceNavigation,
  });

  const { sessionReminders } = useSessionReminderActions({
    setServersViewOpen,
    sessions,
    sessionsRef,
    ensureOpenSession,
    onSelectHistorySession,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setSettingsOpen,
    setFilePickerOpen,
    setSidebarTab,
    setProjectCwd,
    setRecents,
  });

  const { dismissNoticesForContinuedSession } = useContinuedSessionNotices({
    sessionsRef,
    sessionReminders,
    setLinkedWorkItemUpdateCard,
  });

  const { onPlaceSessionOnPane, onPlaceTabOnPane } = useSessionPlacement({
    isMovingPane,
    movingTabIds,
    tabsRef,
    sessionsRef,
    dirtyFilesRef,
    lastPersisted,
    projectCwdRef,
    setSessions,
    setTabs,
    setActiveTabId,
    setProjectTerminalFocused,
    setComposerFocused,
    ensureOpenSession,
    tabCloseScope,
    tabWorktreeOf,
    onMovePane,
  });

  const { onRenameHistorySession } = useSessionRename({
    sessionsRef,
    setSessions,
    loadedSessionCache,
    lastPersisted,
    invalidateLoadedSession,
    refreshHistory,
    sidebarCwd,
  });

  const { checkOpenWorktreeFiles, onCheckWorktreeRemoval, onRemoveWorktree } = useWorktreeRemoval({
    tabsRef,
    projectTerminalsRef,
    sessionsRef,
    projectCwdRef,
    removingSessionIds,
    removingWorktreePaths,
    switchingWorktrees,
    pendingPersist,
    lastPersisted,
    invalidateLoadedSession,
    stopSessionForRemoval,
    setSessions,
    setHistory,
    setStoredLinkedSessions,
    setProjectCwd,
    setRecents,
  });

  const {
    onRemoveHistorySession,
    onDeleteWorktreeSessions,
    onDeleteHistorySession,
    onDeleteHistorySessions,
    onDeleteHistorySessionNow,
  } = useHistorySessionDelete({
    sessions: {
      sessionsRef,
      setSessions,
      history,
      setHistory,
      setStoredLinkedSessions,
      loadedSessionCache,
      sessionLoads,
      lastPersisted,
      pendingPersist,
      invalidateLoadedSession,
      refreshHistory,
      sidebarCwd,
    },
    tabs: {
      tabsRef,
      activeTabIdRef,
      dirtyFilesRef,
      setTabs,
      setDirtyFiles,
      setComposerFocused,
      activateTab,
      tabWorkspace,
      tabWorktreeOf,
      tabCloseScope,
    },
    removal: {
      removingSessionIds,
      switchingWorktrees,
      deleteConfirmationPending,
      setSessionDeleteDialog,
      stopSessionForRemoval,
      onRemoveWorktree,
    },
  });

  const { onArchiveHistorySession, onArchiveFocusedSession, onArchiveHistorySessions } =
    useHistorySessionArchive({
      serversViewOpenRef,
      onRemoveHistorySession,
      removingSessionIds,
      setHistory,
      sessionsRef,
      activeTabIdRef,
      tabsRef,
      projectTerminalFocusedRef,
      searchViewOpenRef,
      inboxViewOpenRef,
      notesViewOpenRef,
      automationsViewOpenRef,
      settingsOpenRef,
      filePickerOpenRef,
      whatsNewVersionRef,
    });

  const { onToggleNotesPanel } = useNotesPanelToggle({
    serversViewOpenRef,
    activeTabIdRef,
    tabsRef,
    sessionsRef,
    projectTerminalFocusedRef,
    searchViewOpenRef,
    inboxViewOpenRef,
    notesViewOpenRef,
    automationsViewOpenRef,
    settingsOpenRef,
    filePickerOpenRef,
    whatsNewVersionRef,
  });

  const { onPinHistorySession, onPinHistorySessions, onSetHistorySessionLinkedWorkItem } =
    useHistorySessionMeta({
      sessionsRef,
      setSessions,
      history,
      setHistory,
      setStoredLinkedSessions,
      loadedSessionCache,
      invalidateLoadedSession,
      setLinkedWorkItemPanels,
      refreshHistory,
      sidebarCwd,
    });

  const { onArchiveTitleTab, onDeleteTitleTab } = useTitleTabActions({
    tabsRef,
    sessionsRef,
    onArchiveHistorySessions,
    onDeleteHistorySession,
    onDeleteHistorySessions,
  });

  const {
    onFocusDir,
    onRatio,
    onCwdChange,
    onBranchChange,
    onWorkspaceModeChange,
    onWorktreeBaseChange,
    onSelectWorkspace,
  } = useWorkspaceDirectoryActions({
    activeTab,
    onFocusPane,
    windowTransferPendingRef,
    movingTabIds,
    setTabs,
    sessionsRef,
    setProjectCwd,
    setRecents,
    setSessions,
    projectOfTab,
    appendTab,
    setActiveTabId,
    setComposerFocused,
    persistSession,
    sidebarCwdRef,
    workspaceNavigation,
  });

  const { onWorktreeChange, onComposerWorktreeChange } = useWorktreeSelection({
    sessionsRef,
    removingSessionIds,
    removingWorktreePaths,
    switchingWorktrees,
    pendingPersist,
    workspacePins,
    invalidateLoadedSession,
    refreshHistory,
    appendTab,
    setActiveTabId,
    setComposerFocused,
    setSessions,
  });

  /**
   * Open a run of folders from one snapshot, committed in a single transition.
   * Planning, selecting, and naming the opened projects live in useProjectOpen.
   */
  const {
    nameConflicts,
    setNameConflicts,
    promptAddedProjectNames,
    openProjects,
    onSelectProject,
    pickProject,
    openSyncedProject,
  } = useProjectOpen({
    setServersViewOpen,
    readProjectReturnMemory,
    tabsRef,
    sessionsRef,
    activeTabIdRef,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    onCwdChange,
    setSessions,
    setTabs,
    insertBeside,
    setProjectCwd,
    activateTab,
    setActiveTabId,
    setComposerFocused,
    setRecents,
    workspaceNavigation,
  });

  useProjectLockRedirect({
    lockSnapshot,
    sidebarCwd,
    visibleRecents,
    activeTabId,
    appendTab,
    openProjects,
    runtimeMode: sessionDefaults?.runtimeMode,
    setActiveTabId,
    setProjectCwd,
  });

  // Importing VS Code workspaces, Claude conversations, and session folders.
  const {
    resumePickerFor,
    setResumePickerFor,
    importClaudeConversation,
    onPlaceSessionInFolder,
    onSessionsImported,
  } = useProjectImport({
    openProjects,
    refreshHistory,
    sidebarCwdRef,
    setRecents,
    sessionsRef,
    turnGen,
    setSessions,
  });

  // Groups linked to a workspace file follow it; new folders land on the rail
  // without moving focus.
  useLinkedWorkspaceGroups(useCallback(() => setRecents(loadRecents()), []));

  useOpenProjectChangesListener({ onSelectProject, setSidebarTab });

  const { onResumeProviderSession } = useResumeProviderSession({
    sessionsRef,
    turnGen,
    setResumePickerFor,
  });

  // Removing a project from the rail (archive or purge) and restoring it.
  const { onRemoveProject, onRestoreProject } = useProjectRemoval({
    refs: {
      sessionsRef,
      tabsRef,
      activeTabIdRef,
      projectCwdRef,
      dirtyFilesRef,
      removingSessionIds,
      loadedSessionCache,
      sessionLoads,
      pendingPersist,
      lastPersisted,
      turnGen,
    },
    activeTabId,
    invalidateLoadedSession,
    persistSession,
    onSelectProject,
    setRecents,
    setSidebarTabSelection,
    setSessions,
    setTabs,
    setActiveTabId,
    setProjectCwd,
    setDirtyFiles,
    setProjectTerminals,
    setComposerFocused,
  });

  const { onFileMoved, onFileDeleted, onPinFile, onFileDirtyChange, onSelectFileSurface } =
    useEditorFileEvents({ tabsRef, setTabs, setDirtyFiles, setComposerFocused });

  const { applyProjectLocationChange } = useProjectLocationChange({
    onFileMoved,
    sessionsRef,
    loadedSessionCache,
    pendingPersist,
    setSessions,
    setHistory,
    setStoredLinkedSessions,
    setLoadedProjects,
    projectCwdRef,
    setProjectCwd,
    projectTerminalsRef,
    setProjectTerminals,
    setSidebarTabSelection,
    setRecents,
  });

  const { onOpenFile, onOpenPlan } = useEditorFileOpen({
    activeTabId,
    activateTab,
    insertBesideActive,
    gitCwdRef,
    sidebarCwdRef,
    activeTabIdRef,
    tabsRef,
    sessionsRef,
    setTabs,
    setActiveTabId,
    setProjectTerminalFocused,
    setComposerFocused,
    setEditorNavigation,
    editorNavigationToken,
  });

  const { onOpenRepository } = useRepositoryReviewOpen({
    sidebarCwdRef,
    lockSnapshot,
    onOpenFile,
    onOpenCommit,
    onOpenDiff,
    onOpenAllChanges,
  });

  const { onFileErrorCountChange } = useFileErrorCounts({ setFileErrorCounts });

  const { onModelChange, onModelSettingsChange, onRuntimeModeChange } = useSessionModelActions({
    isMovingPane,
    removingSessionIds,
    enqueueHarnessEvent,
    flushHarnessEvents,
    promptProviderAccountSignIn,
  });

  const { onSaveDraft, onRemoveDraft } = useSessionDraftActions({
    pendingPersist,
    lastPersisted,
    lastPersistedUserBlock,
    invalidateLoadedSession,
    setHistory,
    setStoredLinkedSessions,
  });

  const { runSessionShell } = useSessionShell({
    removingSessionIds,
    getSubmitSessionRef: () => submitSessionRef,
  });

  // The composer submit (submitSession / onSubmit) lives in ./workspace/sessions/submit.
  const { submitSession, onSubmit } = useSubmitSession({
    refs: {
      windowTransferPendingRef,
      movingSessionIds,
      editedResends,
      retiringTurns,
      turnGen,
      removingSessionIds,
      switchingWorktrees,
      removingWorktreePaths,
      workspacePins,
      projectLocationSyncs,
      submitAfterProjectSyncRef,
      activeSessionIdRef,
    },
    getSubmitSessionRef: () => submitSessionRef,
    workspaceNavigation,
    applyProjectLocationChange,
    dismissNoticesForContinuedSession,
    enqueueHarnessEvent,
    flushHarnessEvents,
    runSessionShell,
    setProviderAccountRecovery,
    deferWorkspaceWork,
  });
  submitAfterProjectSyncRef.current = submitSession;

  const onStopRef = useRef<(sessionId: string) => void>(() => undefined);
  const { launchAutomation } = useAutomationLaunch({
    setServersViewOpen,
    appendTab,
    focusOpenSession,
    submitSession,
    setActiveTabId,
    setComposerFocused,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setSidebarTab,
    onStopRef,
  });
  const { launchQuickSession } = useQuickSessionLaunch({
    setServersViewOpen,
    appendTab,
    submitSession,
    onSaveDraft,
    tabsRef,
    setTabs,
    setActiveTabId,
    setComposerFocused,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setSidebarTab,
    setProjectCwd,
    setRecents,
  });
  useQuickComposerLaunches(launchQuickSession);
  const launchQuickSessionRef = useRef(launchQuickSession);
  launchQuickSessionRef.current = launchQuickSession;
  const submitSessionRef = useRef(submitSession);
  submitSessionRef.current = submitSession;
  const saveDraftRef = useRef(onSaveDraft);
  saveDraftRef.current = onSaveDraft;
  const ensureOpenSessionRef = useRef(ensureOpenSession);
  ensureOpenSessionRef.current = ensureOpenSession;

  const { ensureAutomationRecovery } = useAutomationRecovery({ launchAutomation });

  useWorkspaceAutomationActivity({ ensureAutomationRecovery, launchAutomation });

  const onInboxActivity = useInboxAutomationActivity({
    ensureAutomationRecovery,
    launchAutomation,
  });

  const { onUpdatePlan, onBuildPlan } = usePlanActions({ onSubmit });

  const {
    onDeleteQueuedMessage,
    onQueuedMessageEditingChange,
    onReorderQueuedMessages,
    onEditQueuedMessage,
    onSteerQueuedMessage,
    onResumeQueue,
  } = useQueuedMessageActions({
    sessions,
    movingWindows,
    windowTransferPending,
    windowTransferPendingRef,
    movingSessionIds,
    retiringTurns,
    sessionsRef,
    setSessions,
    onSubmit: submitSession,
    enqueueHarnessEvent,
    flushHarnessEvents,
    onStopRef,
  });

  useQueuePersistence();

  const {
    onUsageLimitDismiss,
    onSwitchSessionAccount,
    onSelectProviderAccount,
    onUsageLimitResumeAtReset,
    onUsageLimitResume,
  } = useUsageLimitAccountActions({
    active,
    sessionsRef,
    removingSessionIds,
    setSessions,
    isMovingPane,
    enqueueHarnessEvent,
    flushHarnessEvents,
    promptProviderAccountSignIn,
    onSubmit,
  });

  useUsageLimitResume({
    sessions,
    sessionsRef,
    movingSessionIds,
    windowTransferPending,
    windowTransferPendingRef,
    movingWindows,
    onUsageLimitResume,
  });

  const { openSessionBeside, onSecondOpinion } = useSecondOpinion({
    sessionsRef,
    setSessions,
    tabsRef,
    setTabs,
    activeTabIdRef,
    setActiveTabId,
    setProjectTerminalFocused,
    setComposerFocused,
    appendTab,
    onSubmit,
  });
  const { updateBtwThread, removeBtwThread, runBtwRequest } = useBtwThreads({
    btwRequestsRef,
    sessionsRef,
    setSessions,
    persistSession,
  });

  const { onBtwSubmit, onBtwModelChange, onBtwDelete, onBtwStop, onBtwRetry } = useBtwActions({
    sessionsRef,
    btwRequestsRef,
    updateBtwThread,
    removeBtwThread,
    runBtwRequest,
  });
  const { onHandoff } = useHandoff({ sessionsRef, openSessionBeside });
  useAutoContinue({
    sessions,
    sessionsRef,
    windowTransferPending,
    windowTransferPendingRef,
    movingSessionIds,
    onSubmit,
  });
  const { onCompactContext, onRewindMessage } = useCompactAndRewind({
    sessionsRef,
    setSessions,
    turnGen,
    enqueueHarnessEvent,
    flushHarnessEvents,
    retiringTurns,
    editedResends,
    windowTransferPendingRef,
    movingSessionIds,
    orchestrator,
    lastBoundProvider,
    lastPersistedUserBlock,
    persistSession,
  });
  const { onStop } = useSessionStop({
    sessionsRef,
    setSessions,
    turnGen,
    flushHarnessEvents,
    deferWorkspaceWork,
    tabsRef,
    activeTabIdRef,
    projectTerminalFocusedRef,
    onStopRef,
  });
  const { onApproval, onQuestionReply, onQuestionInteraction, onOpenApprovalSession } =
    useApprovalActions({
      sessionsRef,
      setInspectedWorkerId,
      focusOpenSession,
      onSelectHistorySession,
    });

  useDesktopLiveHandlers({
    desktopLiveHandlers,
    onDeleteHistorySessionNow,
    onStop,
    onApproval,
    onQuestionReply,
  });

  useOrchestratorBinding({
    tabs,
    activeTabId,
    setTabs,
    setActiveTabId,
    orchestrationRuns,
    setHistory,
    setStoredLinkedSessions,
    checkOpenWorktreeFiles,
    submitSession,
    onStop,
    flushHarnessEvents,
  });

  useAppControlRequests({
    launchQuickSessionRef,
    submitSessionRef,
    ensureOpenSessionRef,
    saveDraftRef,
  });

  const { queueWorkerPanes, orchestrationWorkers } = useOrchestrationWorkerPanes({
    tabs,
    setTabs,
    setActiveTabId,
    setComposerFocused,
    projectCwdRef,
    focusOpenSession,
    onSelectHistorySession,
    ensureOpenSession,
    inspectedWorkerId,
    setInspectedWorkerId,
    workerDetailRequest,
    setWorkerDetailRequest,
  });
  const { orchestrationActions, onSelectLiveAgent } = useOrchestrationActions({
    setServersViewOpen,
    onOpenApprovalSession,
    queueWorkerPanes,
    onSubmit,
    liveAgents,
    unopenedRemoteRef,
    dismissRemoteFinished,
    onSelectRemoteSession,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
  });

  useLiveAgentAnnouncements({ onOpenApprovalSession, unopenedRemote });
  const { railLiveSessions, recentSessions, titleTabs } = useRailSessionLists({
    sessions,
    unseenFinishedIds,
    unopenedRemote,
    history,
    onPinHistorySession,
    deckProjectTabs,
    dirtyFiles,
    pendingWindowMoves,
    windowTransferPending,
    movingWindows,
    tabProjectsRef,
  });

  // `history` now spans every visited project; consumers that expect the
  // current project only get this slice.
  const { projectHistory, sidebarHistory, openProjectSessions, busyProjectPaths } = useHistoryLists(
    {
      history,
      sessions,
      sidebarCwd,
      projectBranches,
      orchestrationRuns,
      unopenedRemote,
    },
  );
  const {
    unseen: inboxUnseen,
    linkedSessionUpdateIds,
    linkedSessionUpdates,
  } = useInboxActivity(visibleRecents, sidebarCwd, sidebarHistory, {
    onActivity: onInboxActivity,
  });
  linkedSessionUpdatesRef.current = linkedSessionUpdates;
  const { inboxRelatedSessions, repairSessions } = useInboxRepairLists({
    storedLinkedSessions,
    history,
    sessions,
  });
  const { onRenameProjectFolder } = useProjectFolderRename({
    busyProjectPaths,
    applyProjectLocationChange,
  });

  const { onMoveTabToNewWindow } = useMoveTabToNewWindow({ onMoveTabsToNewWindow });
  const {
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onToggleSidebar,
    onToggleSessionSidebar,
    onToggleProjectRail,
    onGoToFile,
    onOpenCommandPalette,
    onReload,
    onFindInProject,
  } = useWindowChromeActions({
    setServersViewOpen,
    setProjectRailOpen,
    setSessionSidebarOpen,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setFilePickerOpen,
    setFilePickerInitialQuery,
    setFilePickerResetToken,
    setSidebarTab,
    setFilesSearchOpen,
    setSearchFocusToken,
    dirtyFilesRef,
  });
  const {
    onCloseCurrentTab,
    onOpenSearch,
    onSearchConversations,
    searchRequest,
    onLeaveSearch,
    searchDialogOpen,
    onExpandSearch,
  } = useSearchActions({
    activeTabId,
    onCloseTab,
    setFilePickerOpen,
    setSettingsOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setSearchViewOpen,
    setSearchViewFocusToken,
  });

  const {
    onOpenInbox,
    onLeaveInbox,
    onOpenServers,
    onLeaveServers,
    onOpenNotes,
    onLeaveNotes,
    onOpenAutomations,
    onOpenTasks,
    onLeaveAutomations,
  } = useSurfaceOpeners({
    setServersViewOpen,
    projectCwd,
    setFilePickerOpen,
    setSettingsOpen,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setTaskBoardShown,
    setSocialBoardShown,
    setPullRequestsOnly,
  });
  const {
    openSettings,
    onOpenSettings,
    onOpenNotificationSettings,
    onOpenInboxIntegrations,
    onCloseSettings,
    onSelectSettingsSection,
  } = useSettingsSurfaceActions({
    setServersViewOpen,
    serversViewOpenRef,
    setSettingsOpen,
    setSettingsSection,
    setSettingsAnchor,
    setNotificationProjectPath,
    setNotificationSettingsRequest,
    setFilePickerOpen,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    settingsOpenRef,
    searchViewOpenRef,
    inboxViewOpenRef,
    notesViewOpenRef,
    automationsViewOpenRef,
  });

  const onOpenLinkedWorkItem = useOpenLinkedWorkItem({
    setServersViewOpen,
    linkedWorkItemPanelRequest,
    setFilePickerOpen,
    setSettingsOpen,
    setSearchViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setInboxViewOpen,
    setLinkedWorkItemPanels,
    sessionsRef,
    history,
    sidebarCwd,
    onSelectHistorySession,
  });

  const onOpenInboxSession = useOpenInboxSession({
    sessionsRef,
    history,
    toolWindow,
    setInboxViewOpen,
    setSidebarTab,
    onSelectHistorySession,
  });

  const { onRepairChecks } = useRepairChecks({
    setServersViewOpen,
    ensureOpenSession,
    onSubmit,
    onSelectHistorySession,
    sessionDefaults,
    sessionsRef,
    setSessions,
    setInboxViewOpen,
    setNotesViewOpen,
    setSearchViewOpen,
    setSidebarTab,
  });

  const { onOpenAutomationSession, onOpenBackgroundSession } = useAutomationSessionOpeners({
    setServersViewOpen,
    toolWindow,
    ensureOpenSession,
    onSelectHistorySession,
    onSelectRemoteSession,
    invalidateLoadedSession,
    onRefreshAdoptedSession,
    promptAddedProjectNames,
    lastPersisted,
    setAutomationsViewOpen,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setSettingsOpen,
    setFilePickerOpen,
    setSidebarTab,
    setProjectCwd,
    setRecents,
  });

  const announcedSessionIds = useMemo(
    () =>
      [...openSessionIds(tabs)].flatMap((id) => [
        id,
        ...(remoteSessionFor(id) ? [remoteSessionFor(id)!] : []),
      ]),
    [tabs, sessions],
  );
  useWindowNavigation(
    {
      tools: !!toolWindow,
      grouped: toolWindow?.grouped ?? false,
      activeTool: serversViewOpen
        ? "servers"
        : automationsViewOpen && auxiliaryTool
          ? auxiliaryTool
          : inboxViewOpen
            ? "inbox"
            : notesViewOpen
              ? "notes"
              : automationsViewOpen
                ? socialBoardShown
                  ? "social"
                  : taskBoardShown
                    ? "tasks"
                    : "automations"
                : null,
      cwd: socialBoardShown && socialPanelCwd ? socialPanelCwd : projectCwd,
      sessionIds: announcedSessionIds,
    },
    async (target) => {
      if (target.kind === "session") {
        if (target.background) await onOpenBackgroundSession(target.background, true);
        else {
          const localId =
            sessionsRef.current.find(
              (session) =>
                session.id === target.sessionId ||
                remoteSessionFor(session.id) === target.sessionId,
            )?.id ?? target.sessionId;
          await onOpenAutomationSession(localId, true);
        }
        return;
      }
      if (target.tool === "notes" && !loadNotesEnabled())
        throw new Error("Notes is disabled; enable it in settings first.");
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(target.tool === "inbox");
      setPullRequestsOnly(false);
      setServersViewOpen(target.tool === "servers");
      setNotesViewOpen(target.tool === "notes");
      setAutomationsViewOpen(
        ["tasks", "automations", "social", "terminal", "conversation-tools"].includes(target.tool),
      );
      setAuxiliaryTool(
        target.tool === "terminal" || target.tool === "conversation-tools" ? target.tool : null,
      );
      setTaskBoardShown(target.tool === "tasks");
      setSocialBoardShown(target.tool === "social");
    },
  );

  useWorktreeManagementListener({ setWorktreeManagementRequest, setWorktreeManagementRevision });
  const [remoteProjectDialogOpen, setRemoteProjectDialogOpen] = useState(false);
  useEffect(() => {
    const open = () => setRemoteProjectDialogOpen(true);
    window.addEventListener(OPEN_REMOTE_PROJECT_EVENT, open);
    return () => window.removeEventListener(OPEN_REMOTE_PROJECT_EVENT, open);
  }, []);

  const { onOpenArchivedSession } = useOpenArchivedSession({
    setSettingsOpen,
    onSelectHistorySession,
  });

  const conversationTerminalDeps = useRef<ConversationTerminalDeps | null>(null);
  conversationTerminalDeps.current = {
    docks: projectTerminalsRef,
    setDocks: setProjectTerminals,
    open: openProjectTerminal,
    stillActive: (context) =>
      projectCwdRef.current === context.cwd &&
      tabsRef.current.some(
        (tab) =>
          tab.id === activeTabIdRef.current &&
          tab.kind === "session" &&
          tab.focusedId === context.sessionId,
      ),
  };
  const conversationTerminalControl = useRef<ReturnType<
    typeof createConversationTerminalControl
  > | null>(null);
  if (!conversationTerminalControl.current)
    conversationTerminalControl.current = createConversationTerminalControl(
      () => conversationTerminalDeps.current!,
    );

  useAppUiControl({
    terminalControl: conversationTerminalControl.current,
    surface: {
      settingsOpen,
      searchViewOpen,
      inboxViewOpen,
      notesViewOpen,
      serversViewOpen,
      automationsViewOpen,
      socialBoardShown,
      taskBoardShown,
      settingsSection,
      projectCwd,
      activeTab,
      sessionSidebarOpen,
      sidebarTab,
      dockVisible,
    },
    actions: {
      setServersViewOpen,
      setSettingsOpen,
      setSearchViewOpen,
      setInboxViewOpen,
      setNotesViewOpen,
      setAutomationsViewOpen,
      setSessionSidebarOpen,
      setSidebarTab,
      onShowProjectTerminal,
      onHideProjectTerminal,
      onOpenNotes,
      onOpenInbox,
      onOpenAutomations,
      onOpenTasks,
      onOpenServers,
      onOpenSearch,
      openSettings,
    },
    focusOpenSession,
    isDetachedSessionWindow: () => detachedSessionWindow,
  });

  const {
    navigation: tabVisitNav,
    surfaceForward,
    onRailBack,
    onRailForward,
  } = useRailNavigation({
    auxiliaryTool,
    setAuxiliaryTool,
    toolWindow: !!toolWindow,
    openTabIds: new Set(tabs.map((tab) => tab.id)),
    activateTab,
    setProjectCwd,
    socialPanelCwd,
    setSocialPanelCwd,
    socialBoardShown,
    taskBoardShown,
    setSocialBoardShown,
    setTaskBoardShown,
    serversViewOpen,
    setServersViewOpen,
    activeTabId,
    projectCwd,
    settingsOpen,
    searchViewOpen,
    inboxViewOpen,
    notesViewOpen,
    automationsViewOpen,
    setSettingsOpen,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
  });

  useMouseNavigation(onRailBack, onRailForward);

  useFocusResets({ sidebarTab, setSidebarTab, dockVisible, setProjectTerminalFocused });

  const { openFilePaths, onSessionNavigationOrder, onNavigateSessionList, onNavigateProjectList } =
    useListNavigation({
      tabs,
      tabsRef,
      activeTabIdRef,
      sessionsRef,
      sessionNavigationIdsRef,
      projectCwdRef,
      linkedSessionUpdatesRef,
      setComposerFocused,
      setTabs,
      ensureOpenSession,
      onPrefetchHistorySession,
      onSelectHistorySession,
      onSelectRemoteSession,
      revealLinkedSessionUpdate,
      onSelectProject,
    });

  useTrafficLightsVisible();

  const workspaceActions: WorkspaceActions = {
    onArrangeActiveTab,
    onNew,
    onArchiveFocusedSession,
    onToggleNotesPanel,
    onCloseOtherTabs,
    onCloseAllTabs,
    onClosePane,
    onNext,
    onPrev,
    onVisitBack: onRailBack,
    onVisitForward: onRailForward,
    onActivate,
    onSplit,
    onFocusDir,
    onToggleSidebar,
    onToggleSessionSidebar,
    onGoToFile,
    onOpenCommandPalette,
    onReload,
    onFindInProject,
    onOpenSearch,
    onOpenInbox,
    onOpenNotes,
    pickProject,
    onNewTerminal,
    onNewTerminalTab,
    onToggleProjectTerminal,
    onNavigateSessionList,
    onNavigateProjectList,
    openSettings,
    onOpenApprovalSession,
    onOpenTasks,
    onOpenAutomations,
  };
  const { actions, run } = useWorkspaceActions(workspaceActions);
  useGuideActions({
    actions,
    projectCwd,
    closeSurfaces: () => {
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setServersViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
    },
    setSidebarTab,
    setSessionSidebarOpen,
    onShowProjectTerminal,
  });

  useWorkspaceKeyboardShortcuts({
    serversViewOpenRef,
    actions,
    run,
    nativeFullscreenRef,
    searchViewOpenRef,
    settingsOpenRef,
    inboxViewOpenRef,
    notesViewOpenRef,
    automationsViewOpenRef,
    filePickerOpenRef,
    whatsNewVersionRef,
    onToggleMaximizePane,
  });

  useNativeMenuEvents({ actions, run });

  const { dockGridRef, paintDockSize, commitDockSize } = useDockGridSizing({
    dock: projectTerminalDock,
    projectCwdRef,
    onProjectTerminalSize,
  });

  const { onManageWorktrees } = useManageWorktrees({ openSettings });

  const { sessionPaneProps } = useSessionPaneProps({
    onKeepSession,
    tabs,
    movingWindows,
    windowTransferPending,
    workspaceNavigation,
    active,
    visibleRecents,
    onFocusPane,
    onClosePane,
    onCwdChange,
    onBranchChange,
    onComposerWorktreeChange,
    onRemoteSnapshot,
    onRefreshAdoptedSession,
    onWorkspaceModeChange,
    onWorktreeBaseChange,
    onManageWorktrees,
    onModelChange,
    onModelSettingsChange,
    onRuntimeModeChange,
    onSaveDraft,
    onRemoveDraft,
    onSubmit,
    onStop,
    onRewindMessage,
    onCompactContext,
    onNewSession,
    onPlaceSessionInFolder,
    onResumeProviderSession,
    onDeleteQueuedMessage,
    onEditQueuedMessage,
    onQueuedMessageEditingChange,
    onReorderQueuedMessages,
    onSteerQueuedMessage,
    onResumeQueue,
    onUsageLimitResume,
    onUsageLimitResumeAtReset,
    onUsageLimitDismiss,
    onSwitchSessionAccount,
    onInboxCardDismiss,
    onLinkedWorkItemUpdateCardDismiss,
    onNoteCardDismiss,
    onHandoffCardDismiss,
    onOpenLinkedWorkItem,
    onArchiveHistorySession,
    onDeleteHistorySession,
    onApproval,
    onQuestionReply,
    onQuestionInteraction,
    onOpenFile,
    onOpenDiff,
    onOpenPlan,
    onBuildPlan,
    onSecondOpinion,
    onHandoff,
    onBtwSubmit,
    onBtwRetry,
    onBtwDelete,
    onBtwStop,
    onBtwModelChange,
    onNewTerminalInSession,
    onRunSessionProjectAction,
  });

  const {
    chromeSurfaceOpen,
    compactProjectRail,
    detachedSessionWindow,
    compactRailActive,
    trayProjectKeys,
  } = useWorkspaceChromeFlags({
    serversViewOpen,
    toolWindow,
    windowTransfer,
    searchViewOpen,
    settingsOpen,
    inboxViewOpen,
    notesViewOpen,
    automationsViewOpen,
    collapsedProjectRailMode,
    projectRailOpen,
    visibleRecents,
  });
  useTraySessions({
    history,
    live: railLiveSessions,
    agents: nextLiveAgents,
    projectKeys: trayProjectKeys,
    ownedKeys: ownedLiveSessionKeys,
    onSettings: () => openSettings("notifications"),
    onOpen: (sessionId) => {
      setSettingsOpen(false);
      onSelectLiveAgent(sessionId);
    },
  });

  const compactTitleBar = IS_MAC && compactRailActive && !chromeSurfaceOpen;
  const layoutControl = useLayoutControl({
    activeTab,
    activeTabId,
    activeTabLayoutPreset,
    onArrangeActiveTab,
    onSplit,
    maximizedPane,
    onToggleMaximizePane,
  });
  // The layout children below are memoized; these keep their inputs from being
  // rebuilt by the many workspace renders a session status change causes.
  const railBack = useStableCallback(onRailBack);
  const railForward = useStableCallback(onRailForward);
  const toolNavigation = useMemo(
    () => ({
      canBack: tabVisitNav.canBack,
      canForward: tabVisitNav.canForward,
      onBack: railBack,
      onForward: railForward,
    }),
    [tabVisitNav.canBack, tabVisitNav.canForward, railBack, railForward],
  );
  const inboxAskSessions = useStableValue(
    useMemo(() => sessions.filter((session) => session.inboxAsk), [sessions]),
    shallowArrayEqual,
  );
  // Closed surfaces keep the lists they last showed; they catch up when opened.
  const searchHistory = useHeldValue(projectHistory, searchViewOpen || searchDialogOpen);
  const settingsSurfaceOpen = settingsOpen || !!worktreeManagementRequest;
  const settingsSessions = useHeldValue(sessions, settingsSurfaceOpen);
  const settingsHistory = useHeldValue(sidebarHistory, settingsSurfaceOpen);

  const workspaceTitleBar = useWorkspaceTitleBar({
    onKeepSession,
    windowTransfer,
    detachedSessionWindow,
    onMoveTabsToNewWindow,
    tabsRef,
    titleTabs,
    activeTabId,
    sidebarCwd,
    projectRailOpen,
    sessionSidebarOpen,
    compactTitleBar,
    tabVisitNav,
    surfaceForward,
    onRailBack,
    onRailForward,
    onToggleSidebar,
    onToggleSessionSidebar,
    activateTab,
    onNew,
    onNewTerminal,
    onOpenSettings,
    onOpenInbox,
    notesEnabled,
    onOpenNotes,
    onCloseTitleTab,
    onCloseTabs,
    onCloseIdleTabs,
    idleTabCount,
    onArchiveTitleTab,
    onDeleteTitleTab,
    onReorderTabs,
    onPlaceTabOnPane,
    layoutControl,
    onMoveTabToNewWindow,
    onCancelMoveToNewWindow,
    onGoToFile,
    onPinFile,
    visibleRecents,
    onSelectProject,
  });

  const { closeRecovery, removeRecoveredSessions, recoveryCount, clearRecoveredSessions } =
    useSessionRecoveryActions({
      sessionRecovery,
      updateSessionRecovery,
      setRecoveryOpen,
      projectCwd,
      projectReturnRef,
      projectTerminals,
      lastDockSide,
      keepWorkspaceTab,
      lockSnapshot,
      tabsRef,
      activeTabIdRef,
    });
  const { openRecoveredSessions } = useOpenRecoveredSessions({
    sessionRecovery,
    lockSnapshot,
    removingSessionIds,
    movingSessionIds,
    switchingWorktrees,
    workspaceNavigation,
    ensureOpenSession,
    tabsRef,
    setTabs,
    activeTabIdRef,
    setActiveTabId,
    followProject,
    removeRecoveredSessions,
  });
  const recoveryControl = useRecoveryControl({
    toolWindow,
    windowTransfer,
    recoveryCount,
    setRecoveryOpen,
    clearRecoveredSessions,
  });

  const sidebarActions = useSidebarActions({
    onSelectWorkspace: onSelectWorkspace,
    onTabChange: setSidebarTab,
    onFilesSearchOpenChange: setFilesSearchOpen,
    onOpenFilesSearch: onFindInProject,
    onSelectSession: onPreviewHistorySession,
    onSelectRemoteSession: onSelectRemoteSession,
    onRemoteSessionDeleted: onRemoteSessionDeleted,
    onPrefetchSession: onPrefetchHistorySession,
    onSessionNavigationOrder: onSessionNavigationOrder,
    onPlaceSessionOnPane: onPlaceSessionOnPane,
    onPopOutSession: onPopOutSession,
    onOpenSessionsSideBySide: onOpenSessionsSideBySide,
    onRenameSession: onRenameHistorySession,
    onArchiveSession: onArchiveHistorySession,
    onArchiveSessions: onArchiveHistorySessions,
    onPinSession: onPinHistorySession,
    onPinSessions: onPinHistorySessions,
    onSetSessionLinkedWorkItem: onSetHistorySessionLinkedWorkItem,
    onDeleteSession: onDeleteHistorySession,
    onDeleteSessions: onDeleteHistorySessions,
    onDeleteSessionNow: onDeleteHistorySessionNow,
    onOpenFile: onOpenFile,
    onOpenTerminal: onOpenTerminal,
    onFileMoved: onFileMoved,
    onFileDeleted: onFileDeleted,
    onGoBack: onRailBack,
    onGoForward: onRailForward,
    onOpenDiff: onOpenWorkingTreeDiff,
    onOpenAllChanges: onOpenAllChanges,
    onOpenCommit: onOpenCommit,
    onOpenRepository: onOpenRepository,
    onSelectAgent: onSelectLiveAgent,
    onPreviewSession: (sessionId: string, options?: { keepOpen?: boolean }) => {
      if (liveAgents.some((agent) => agent.id === sessionId && agent.ownerWindowLabel)) {
        onSelectLiveAgent(sessionId);
        return;
      }
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setServersViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      const remote = unopenedRemoteRef.current.find(({ session }) => session.id === sessionId);
      if (remote) onSelectRemoteSession(remote.project, sessionId, { preview: !options?.keepOpen });
      else void onPreviewHistorySession(sessionId, options);
    },
    onSelectProject: onSelectProject,
    onOpenProject: pickProject,
    onOpenSyncedProject: openSyncedProject,
    onRemoveProject: onRemoveProject,
    onRenameProjectFolder: onRenameProjectFolder,
    onNew: onNew,
    onNewTerminal: onNewTerminal,
    onSearch: onOpenSearch,
    onOpenInbox: onOpenInbox,
    onOpenInboxItem: onOpenLinkedWorkItem,
    onOpenNotes: onOpenNotes,
    onOpenAutomations: onOpenAutomations,
    onOpenTasks: onOpenTasks,
    onGoToFile: onGoToFile,
    onToggleProjectRail: onToggleProjectRail,
    onOpenSettings: onOpenSettings,
    onOpenNotificationSettings: onOpenNotificationSettings,
    onSelectSettingsSection: onSelectSettingsSection,
    onCloseSettings: onCloseSettings,
    onOpenWhatsNew: onOpenWhatsNew,
    onDismissUpdate: onDismissUpdate,
  });
  const onboardingProjects = recents.length;
  const onboardingSessions = bootHistory.length;
  const onboardingRestored = !!resumed;
  const onboardingTransferred = !!windowTransfer || !!toolWindow;
  const onboardingContext = useMemo(
    () => ({
      projects: onboardingProjects,
      sessions: onboardingSessions,
      restored: onboardingRestored,
      transferred: onboardingTransferred,
    }),
    [onboardingProjects, onboardingSessions, onboardingRestored, onboardingTransferred],
  );
  return (
    <OrchestrationActions.Provider value={orchestrationActions}>
      <OrchestrationWorkers.Provider value={orchestrationWorkers}>
        <div
          className={`flex h-full flex-col text-content ${
            HAS_NATIVE_GLASS ? "bg-background-base/40" : "bg-background-base"
          }`}
        >
          {compactTitleBar ? workspaceTitleBar : null}
          <VoiceCompanionGate
            activeId={activeSessionId}
            sessions={sessions}
            onSubmit={submitSession}
            onStop={onStop}
          />
          {detachedSessionWindow && (!IS_MAC || liveAgents.length > 0) ? (
            <DetachedWorkingBar agents={liveAgents} onSelectAgent={onSelectLiveAgent} />
          ) : null}
          <WindowControlsVisible.Provider value={!detachedSessionWindow}>
            <div className="flex min-h-0 min-w-0 flex-1">
              {!detachedSessionWindow ? (
                <WorkspaceSidebar
                  recoveryControl={recoveryControl}
                  cwd={sidebarCwd}
                  gitCwd={gitCwd}
                  worktreeTabStats={worktreeTabStats}
                  onSelectWorkspace={sidebarActions.onSelectWorkspace}
                  workspaceNavigation={workspaceNavigation}
                  explorerRootLabel={explorerRootLabel}
                  open={sessionSidebarOpen}
                  tab={sidebarTab}
                  onTabChange={sidebarActions.onTabChange}
                  filesSearchOpen={filesSearchOpen}
                  onFilesSearchOpenChange={sidebarActions.onFilesSearchOpenChange}
                  onOpenFilesSearch={sidebarActions.onOpenFilesSearch}
                  searchFocusToken={searchFocusToken}
                  sessions={sidebarHistory}
                  busySessionIds={busySessionIds}
                  approvalSessionIds={approvalSessionIds}
                  activeSessionId={active?.id}
                  historyFailed={historyFailed}
                  pending={historyPending}
                  onSelectSession={sidebarActions.onSelectSession}
                  onSelectRemoteSession={sidebarActions.onSelectRemoteSession}
                  onRemoteSessionDeleted={sidebarActions.onRemoteSessionDeleted}
                  onPrefetchSession={sidebarActions.onPrefetchSession}
                  onSessionNavigationOrder={sidebarActions.onSessionNavigationOrder}
                  onPlaceSessionOnPane={sidebarActions.onPlaceSessionOnPane}
                  onPopOutSession={sidebarActions.onPopOutSession}
                  onOpenSessionsSideBySide={sidebarActions.onOpenSessionsSideBySide}
                  onRenameSession={sidebarActions.onRenameSession}
                  onArchiveSession={sidebarActions.onArchiveSession}
                  onArchiveSessions={sidebarActions.onArchiveSessions}
                  onPinSession={sidebarActions.onPinSession}
                  onPinSessions={sidebarActions.onPinSessions}
                  onSetSessionLinkedWorkItem={sidebarActions.onSetSessionLinkedWorkItem}
                  reminders={sessionReminders.reminders}
                  onSetReminders={sessionReminders.schedule}
                  onCancelReminders={sessionReminders.cancel}
                  onDeleteSession={sidebarActions.onDeleteSession}
                  onDeleteSessions={sidebarActions.onDeleteSessions}
                  onDeleteSessionNow={sidebarActions.onDeleteSessionNow}
                  onOpenFile={sidebarActions.onOpenFile}
                  onOpenTerminal={sidebarActions.onOpenTerminal}
                  onFileMoved={sidebarActions.onFileMoved}
                  onFileDeleted={sidebarActions.onFileDeleted}
                  tabVisitNav={tabVisitNav}
                  searchViewOpen={searchViewOpen}
                  inboxViewOpen={inboxViewOpen}
                  notesViewOpen={notesViewOpen}
                  serversViewOpen={serversViewOpen}
                  automationsViewOpen={automationsViewOpen}
                  surfaceForward={surfaceForward}
                  onGoBack={sidebarActions.onGoBack}
                  onGoForward={sidebarActions.onGoForward}
                  onOpenDiff={sidebarActions.onOpenDiff}
                  onOpenAllChanges={sidebarActions.onOpenAllChanges}
                  onOpenCommit={sidebarActions.onOpenCommit}
                  onOpenRepository={sidebarActions.onOpenRepository}
                  activeTab={activeTab}
                  activeHarness={active?.harness}
                  recents={recents}
                  busyProjectPaths={busyProjectPaths}
                  liveAgents={liveAgents}
                  onSelectAgent={sidebarActions.onSelectAgent}
                  onPreviewSession={sidebarActions.onPreviewSession}
                  onOpenCrewSession={onOpenBackgroundSession}
                  recentSessions={recentSessions}
                  onSelectProject={sidebarActions.onSelectProject}
                  onOpenProject={sidebarActions.onOpenProject}
                  onOpenSyncedProject={sidebarActions.onOpenSyncedProject}
                  onRemoveProject={sidebarActions.onRemoveProject}
                  onRenameProjectFolder={sidebarActions.onRenameProjectFolder}
                  onNew={sidebarActions.onNew}
                  openSessions={openProjectSessions}
                  onNewTerminal={sidebarActions.onNewTerminal}
                  onSearch={sidebarActions.onSearch}
                  onSearchConversations={onSearchConversations}
                  onOpenInbox={sidebarActions.onOpenInbox}
                  onOpenInboxItem={sidebarActions.onOpenInboxItem}
                  onOpenServers={onOpenServers}
                  serversActive={serversViewOpen}
                  onOpenNotes={sidebarActions.onOpenNotes}
                  onOpenAutomations={sidebarActions.onOpenAutomations}
                  onOpenTasks={sidebarActions.onOpenTasks}
                  onGoToFile={sidebarActions.onGoToFile}
                  searchActive={searchViewOpen}
                  inboxActive={inboxViewOpen}
                  notesActive={notesViewOpen}
                  taskBoardShown={taskBoardShown}
                  socialBoardShown={socialBoardShown}
                  notesEnabled={notesEnabled}
                  projectRailOpen={projectRailOpen}
                  compactProjectRail={compactProjectRail}
                  titleBarAbove={compactTitleBar}
                  onToggleProjectRail={sidebarActions.onToggleProjectRail}
                  unseenFinishedIds={unseenFinishedIds}
                  inboxUnseen={inboxUnseen}
                  linkedSessionUpdateIds={linkedSessionUpdateIds}
                  settingsOpen={settingsOpen}
                  settingsSection={settingsSection}
                  onOpenSettings={sidebarActions.onOpenSettings}
                  onOpenNotificationSettings={sidebarActions.onOpenNotificationSettings}
                  onSelectSettingsSection={sidebarActions.onSelectSettingsSection}
                  onCloseSettings={sidebarActions.onCloseSettings}
                  updateNotice={updateNotice}
                  onOpenWhatsNew={sidebarActions.onOpenWhatsNew}
                  onDismissUpdate={sidebarActions.onDismissUpdate}
                />
              ) : null}

              <div className="body-glass flex min-h-0 min-w-0 flex-1 flex-col">
                <div
                  data-workspace-chrome
                  className={
                    searchViewOpen ||
                    settingsOpen ||
                    inboxViewOpen ||
                    notesViewOpen ||
                    serversViewOpen ||
                    automationsViewOpen
                      ? "hidden"
                      : "flex min-h-0 min-w-0 flex-1 flex-col"
                  }
                  aria-hidden={
                    searchViewOpen ||
                    settingsOpen ||
                    inboxViewOpen ||
                    notesViewOpen ||
                    serversViewOpen ||
                    automationsViewOpen
                  }
                  inert={
                    searchViewOpen ||
                    settingsOpen ||
                    inboxViewOpen ||
                    notesViewOpen ||
                    serversViewOpen ||
                    automationsViewOpen ||
                    undefined
                  }
                >
                  {!IS_MAC ? (
                    <WorkspaceMenuBar
                      activeTabId={activeTabId}
                      onNew={onNew}
                      onNewTerminal={onNewTerminal}
                      onToggleTerminal={onToggleProjectTerminal}
                      onGoToFile={onGoToFile}
                      onToggleSidebar={onToggleSidebar}
                      onToggleSessionSidebar={onToggleSessionSidebar}
                      onShowSourceControl={onToggleChanges}
                      onCloseCurrentTab={onCloseCurrentTab}
                      onCloseOtherTabs={onCloseOtherTabs}
                      onCloseIdleTabs={onCloseIdleTabs}
                      idleTabCount={idleTabCount}
                      onCloseAllTabs={onCloseAllTabs}
                      onPickProject={pickProject}
                      onFindInProject={onFindInProject}
                      onSearch={onOpenSearch}
                      onOpenInbox={onOpenInbox}
                      onOpenNotes={notesEnabled ? onOpenNotes : undefined}
                      onZoomIn={onZoomIn}
                      onZoomOut={onZoomOut}
                      onZoomReset={onZoomReset}
                      layout={layoutControl}
                    />
                  ) : null}
                  {compactTitleBar ? null : workspaceTitleBar}

                  <WorkspaceMainArea
                    dockGridRef={dockGridRef}
                    projectCwd={projectCwd}
                    projectTerminals={projectTerminals}
                    projectTerminalFocused={projectTerminalFocused}
                    focusProjectTerminal={focusProjectTerminal}
                    onHideProjectTerminal={onHideProjectTerminal}
                    onProjectTerminalSide={onProjectTerminalSide}
                    paintDockSize={paintDockSize}
                    commitDockSize={commitDockSize}
                    onNewTerminal={onNewTerminal}
                    onNewTerminalWithProfile={onNewTerminalWithProfile}
                    onSplitProjectTerminal={onSplitProjectTerminal}
                    openSettings={openSettings}
                    onSelectProjectTerminal={onSelectProjectTerminal}
                    onCloseProjectTerminal={onCloseProjectTerminal}
                    onCloseOtherProjectTerminals={onCloseOtherProjectTerminals}
                    onReorderProjectTerminals={onReorderProjectTerminals}
                    onTerminalMetaChange={onTerminalMetaChange}
                    tabs={tabs}
                    activeTabId={activeTabId}
                    windowTransferPending={windowTransferPending}
                    movingWindows={movingWindows}
                    busySessionIds={busySessionIds}
                    unseenFinishedIds={unseenFinishedIds}
                    inboxViewOpen={inboxViewOpen}
                    dirtyFiles={dirtyFiles}
                    fileErrorCounts={fileErrorCounts}
                    activeSessionId={active?.id}
                    composerFocused={composerFocused}
                    composerFocusToken={composerFocusToken}
                    onSelectFileSurface={onSelectFileSurface}
                    onCloseFile={onCloseFile}
                    onCloseOtherFiles={onCloseOtherFiles}
                    onOpenFileInNewWindow={onOpenFileInNewWindow}
                    onPinFile={onPinFile}
                    onReorderFiles={onReorderFiles}
                    onFileDirtyChange={onFileDirtyChange}
                    onFileErrorCountChange={onFileErrorCountChange}
                    transcriptPool={transcriptPool}
                    onRatio={onRatio}
                    editorNavigation={editorNavigation}
                    onUpdatePlan={onUpdatePlan}
                    onMovePane={onMovePane}
                    onMoveFileBetweenPanes={onMoveFileBetweenPanes}
                    onDetachPane={onDetachPane}
                    onPopOutPane={onPopOutPane}
                    maximizedPane={maximizedPane}
                    onToggleMaximizePane={onToggleMaximizePane}
                    sessionPaneProps={sessionPaneProps}
                    linkedWorkItemPanels={linkedWorkItemPanels}
                    repairSessions={repairSessions}
                    onRepairChecks={onRepairChecks}
                    closeLinkedWorkItemPanel={closeLinkedWorkItemPanel}
                    onOpenInboxSession={onOpenInboxSession}
                    visibleRecents={visibleRecents}
                    searchViewOpen={searchViewOpen}
                    settingsOpen={settingsOpen}
                    notesViewOpen={notesViewOpen}
                    serversViewOpen={serversViewOpen}
                    automationsViewOpen={automationsViewOpen}
                    activeLinkedWorkItemPanel={activeLinkedWorkItemPanel}
                  />
                </div>
                <WorkspaceAuxSurfaces
                  searchViewOpen={searchViewOpen}
                  searchDialogOpen={searchDialogOpen}
                  searchRequest={searchRequest}
                  onExpandSearch={onExpandSearch}
                  onCompactSearch={onOpenSearch}
                  gitCwd={gitCwd}
                  visibleRecents={visibleRecents}
                  projectHistory={searchHistory}
                  lockSnapshot={lockSnapshot}
                  searchViewFocusToken={searchViewFocusToken}
                  projectRailOpen={projectRailOpen}
                  compactProjectRail={compactProjectRail}
                  compactRailActive={compactRailActive}
                  onLeaveSearch={onLeaveSearch}
                  onToggleSidebar={onToggleSidebar}
                  onOpenFile={onOpenFile}
                  onSelectHistorySession={onSelectHistorySession}
                  onSelectProject={onSelectProject}
                  sessions={inboxAskSessions}
                  inboxViewOpen={inboxViewOpen}
                  inboxAskPortal={inboxAskPortal}
                  composerFocused={composerFocused}
                  composerFocusToken={composerFocusToken}
                  sessionPaneProps={sessionPaneProps}
                />
                <WorkspaceToolPanels
                  auxiliaryTool={auxiliaryTool}
                  setAuxiliaryTool={setAuxiliaryTool}
                  conversationTools={conversationTools}
                  navigation={toolNavigation}
                  onLeaveServers={onLeaveServers}
                  setServersViewOpen={setServersViewOpen}
                  onLaunchAutomationAssistant={launchQuickSession}
                  inboxViewOpen={inboxViewOpen}
                  notesViewOpen={notesViewOpen}
                  serversViewOpen={serversViewOpen}
                  automationsViewOpen={automationsViewOpen}
                  socialBoardShown={socialBoardShown}
                  taskBoardShown={taskBoardShown}
                  pullRequestsOnly={pullRequestsOnly}
                  setFilePickerOpen={setFilePickerOpen}
                  setSettingsOpen={setSettingsOpen}
                  setSearchViewOpen={setSearchViewOpen}
                  setInboxViewOpen={setInboxViewOpen}
                  setPullRequestsOnly={setPullRequestsOnly}
                  setNotesViewOpen={setNotesViewOpen}
                  setAutomationsViewOpen={setAutomationsViewOpen}
                  setSocialBoardShown={setSocialBoardShown}
                  setTaskBoardShown={setTaskBoardShown}
                  projectCwd={projectCwd}
                  socialPanelCwd={socialPanelCwd}
                  sidebarCwd={sidebarCwd}
                  visibleRecents={visibleRecents}
                  notesEnabled={notesEnabled}
                  toolWindow={toolWindow}
                  detachedSessionWindow={detachedSessionWindow}
                  projectRailOpen={projectRailOpen}
                  compactProjectRail={compactProjectRail}
                  compactRailActive={compactRailActive}
                  onToggleSidebar={onToggleSidebar}
                  pickProject={pickProject}
                  onLeaveInbox={onLeaveInbox}
                  onStartInboxItem={onStartInboxItem}
                  onAskInboxItem={onAskInboxItem}
                  onRestartInboxAsk={onRestartInboxAsk}
                  setInboxAskPortal={setInboxAskPortal}
                  inboxRelatedSessions={inboxRelatedSessions}
                  repairSessions={repairSessions}
                  onRepairChecks={onRepairChecks}
                  onOpenInboxSession={onOpenInboxSession}
                  onOpenInboxIntegrations={onOpenInboxIntegrations}
                  onLeaveNotes={onLeaveNotes}
                  onLeaveAutomations={onLeaveAutomations}
                  onOpenBackgroundSession={onOpenBackgroundSession}
                  onOpenAutomationSession={onOpenAutomationSession}
                  launchAutomation={launchAutomation}
                />
                <WorkspaceSettingsSurface
                  worktreeManagementRequest={worktreeManagementRequest}
                  worktreeManagementRevision={worktreeManagementRevision}
                  setWorktreeManagementRequest={setWorktreeManagementRequest}
                  onRemoveWorktree={onRemoveWorktree}
                  settingsOpen={settingsOpen}
                  settingsSection={settingsSection}
                  settingsAnchor={settingsAnchor}
                  notificationProjectPath={notificationProjectPath}
                  notificationSettingsRequest={notificationSettingsRequest}
                  visibleRecents={visibleRecents}
                  sidebarCwd={sidebarCwd}
                  sidebarHistory={settingsHistory}
                  sessions={settingsSessions}
                  onCheckWorktreeRemoval={onCheckWorktreeRemoval}
                  onDeleteWorktreeSessions={onDeleteWorktreeSessions}
                  onCloseSettings={onCloseSettings}
                  onSelectSettingsSection={onSelectSettingsSection}
                  onOpenArchivedSession={onOpenArchivedSession}
                  onOpenBackgroundSession={onOpenBackgroundSession}
                  onArchiveHistorySession={onArchiveHistorySession}
                  onDeleteHistorySession={onDeleteHistorySession}
                  onRestoreProject={onRestoreProject}
                  onRemoveProject={onRemoveProject}
                  onOpenWhatsNew={onOpenWhatsNew}
                  collapsedProjectRailMode={collapsedProjectRailMode}
                  setCollapsedProjectRailMode={setCollapsedProjectRailMode}
                />
                <WorkspaceFooter
                  searchViewOpen={searchViewOpen}
                  inboxViewOpen={inboxViewOpen}
                  notesViewOpen={notesViewOpen}
                  serversViewOpen={serversViewOpen}
                  automationsViewOpen={automationsViewOpen}
                  settingsOpen={settingsOpen}
                  settingsSection={settingsSection}
                  pullRequestsOnly={pullRequestsOnly}
                  setPullRequestsOnly={setPullRequestsOnly}
                  onOpenInbox={onOpenInbox}
                  openSettings={openSettings}
                  active={active}
                  projectCwd={projectCwd}
                  usageProviders={usageProviders}
                  usageSession={usageSession}
                  onSelectProviderAccount={onSelectProviderAccount}
                  runningTerminals={runningTerminals}
                  runningTerminalOpen={runningTerminalOpen}
                  onToggleRunningTerminal={onToggleRunningTerminal}
                  onNewTerminal={onNewTerminal}
                  onShowProjectTerminal={onShowProjectTerminal}
                  currentProjectDock={currentProjectDock}
                  dockVisible={dockVisible}
                  conversationTools={conversationTools}
                  onOpenFile={onOpenFile}
                  pendingNotifications={pendingNotifications}
                  hiddenApprovalToasts={hiddenApprovalToasts}
                  reminderNoticesHeight={reminderNoticesHeight}
                  harnessUpdateHeight={harnessUpdateHeight}
                  onOpenApprovalSession={onOpenApprovalSession}
                  onApproval={onApproval}
                />
              </div>
            </div>

            <WorkspaceFilePicker
              filePickerOpen={filePickerOpen}
              filePickerResetToken={filePickerResetToken}
              filePickerInitialQuery={filePickerInitialQuery}
              setFilePickerOpen={setFilePickerOpen}
              filesCwd={filesCwd}
              openFilePaths={openFilePaths}
              active={active}
              activeTab={activeTab}
              onOpenFile={onOpenFile}
              onArrangeActiveTab={onArrangeActiveTab}
              actions={actions}
            />

            <WorkspaceRecoveryDialogs
              recoveryOpen={recoveryOpen}
              sessionRecovery={sessionRecovery}
              sessions={sessions}
              remoteSessions={listedRemoteSessions}
              closeRecovery={closeRecovery}
              openRecoveredSessions={openRecoveredSessions}
              removeRecoveredSessions={removeRecoveredSessions}
              sessionDeleteDialog={sessionDeleteDialog}
              setSessionDeleteDialog={setSessionDeleteDialog}
            />
            <WorkspaceNotices
              setHarnessUpdateHeight={setHarnessUpdateHeight}
              reminderNoticesHeight={reminderNoticesHeight}
              setReminderNoticesHeight={setReminderNoticesHeight}
              sessionReminders={sessionReminders}
              openSettings={openSettings}
            />
            <WorkspacePickerDialogs
              resumePickerFor={resumePickerFor}
              setResumePickerFor={setResumePickerFor}
              importClaudeConversation={importClaudeConversation}
              whatsNewVersion={whatsNewVersion}
              setWhatsNewVersion={setWhatsNewVersion}
              onOpenCommit={onOpenCommit}
              onSessionsImported={onSessionsImported}
              onboardingContext={onboardingContext}
              onSelectProject={onSelectProject}
              projectCwd={projectCwd}
              remoteProjectDialogOpen={remoteProjectDialogOpen}
              setRemoteProjectDialogOpen={setRemoteProjectDialogOpen}
              nameConflicts={nameConflicts}
              setNameConflicts={setNameConflicts}
              providerAccountRecovery={providerAccountRecovery}
              setProviderAccountRecovery={setProviderAccountRecovery}
              onSwitchSessionAccount={onSwitchSessionAccount}
              openSettings={openSettings}
              providerSignInRequest={providerSignInRequest}
              setProviderSignInRequest={setProviderSignInRequest}
            />
          </WindowControlsVisible.Provider>
        </div>
        <TranscriptPoolOutlet pool={transcriptPool} />
      </OrchestrationWorkers.Provider>
    </OrchestrationActions.Provider>
  );
}
