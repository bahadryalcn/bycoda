import { SOCIAL_PANEL_EVENT } from "../features/social/ui/SocialShortcut";
import { newWorkspaceSession } from "./model/newWorkspaceSession";
import { APP_UI_VIEWS, APP_UI_SETTINGS, registerAppUiControl, type AppUiContext, type AppUiAction, type AppUiInput } from "./model/appUiControl";
import { confirmWorkspaceClose } from "./model/closeConfirmation";
import { ToolNavigationContext, ToolPanel } from "./shell/ToolNavigation";
import { type ToolId, type ToolWindow } from "./model/toolWindows";
import { restoreWindowFocus } from "./model/windowFocus";
import { useTraySessions } from "./model/useTraySessions";
import { useInitializeSessions } from "./hooks/useInitializeSessions";
import { useNativeSkillWarmup } from "../features/sessions/ui/useNativeSkillWarmup";
import { useOwnedTimeout } from "../shared/hooks/useOwnedTimeout";
import { retainAsyncSubscription } from "../shared/lib/asyncSubscription";
import { t, useLocale } from "../shared/i18n";
import {
  openSyncedProjectRemotely,
  subscribeSyncedProjectsAdded,
} from "../features/sync/model/syncRemoteProjects";
import { acceptQuickLaunch } from "./model/quickLaunchSession";
import { queueTerminalCommand } from "../features/terminal/model/terminalLaunchCommand";
import {
  liveAgentsEqual,
  sessionSummariesEqual,
  stringArraysEqual,
  worktreeTabStatsEqual,
} from "./model/sidebarEquality";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation";
import { useMouseNavigation } from "./hooks/useMouseNavigation";
import { useSurfaceForwardHistory } from "./hooks/useSurfaceForwardHistory";
import { useIdleSessionDetach } from "./hooks/useIdleSessionDetach";
import { HarnessEventQueue } from "./model/harnessFlush";
import {
  handleAgentApp,
  type AppSessionListing,
  type AppSessionPlacement,
} from "../features/agent-app/model/agentApp";
import { submitWithSettlement } from "./model/managedSubmission";
import { submitAfterProjectSync, type SubmissionAcceptance } from "./model/submissionAcceptance";
import { finalizeLocalTurn } from "./model/localTurnFinalization";
import type { CiRepairRequest } from "../features/inbox/model/ciRepair";
import { ciRepairSessions } from "../features/inbox/model/ciRepairSessions";
import { rebaseCiRepairs, trackCiRepair } from "../features/inbox/model/ciRepairTracking";
import { invoke } from "@tauri-apps/api/core";
import {
  orchestrationCheckoutCwd,
  orchestrationProjectCwd,
  orchestrator,
  shellPath,
  workspaceIdentity,
  type ControlOutcome,
} from "../features/orchestration/model/orchestration";
import { modelsFor } from "../features/sessions/model/models";
import { isHarnessAvailable } from "../integrations/harness/core/availability";
import {
  completeOrchestrationProposal,
  completeOrRepairOrchestrationProposal,
  orchestrationPlanningPrompt,
  orchestrationRepairPrompt,
  proposalBlock,
  validateOrchestrationSettings,
  withOrchestrationProposal,
  type OrchestrationProposal,
} from "../features/orchestration/model/orchestrationPlan";
import { discoverOrchestrationSettings } from "../features/orchestration/model/orchestrationCatalog";
import {
  attachOrchestrationWorkers,
  consolidateOrchestrationTabs,
  prepareOrchestrationWorkerDetails,
  releaseOrchestrationWorker,
} from "../features/orchestration/model/orchestrationWorkspace";
import {
  OrchestrationActions,
  OrchestrationWorkers,
  type OrchestrationWorkerDetail,
} from "../features/orchestration/ui/OrchestrationActions";
import { flushSync } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useWindowLiveAgents,
  focusWindowLiveAgent,
  listenForWindowLiveAgent,
} from "./model/useWindowLiveAgents";
import { useWindowDragPreview } from "./model/useWindowDragPreview";
import { DetachedWorkingBar } from "./shell/DetachedWorkingBar";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { appName } from "../shared/lib/appName";
import {
  type ComponentProps,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Sidebar } from "./shell/Sidebar";
import { ApprovalToasts } from "../features/sessions/ui/ApprovalToasts";
import { HarnessUpdateNotice } from "../features/providers/ui/HarnessUpdateNotice";
import { WhatsNewDialog } from "./shell/WhatsNewDialog";
import { ClaudeSessionPicker } from "../features/sessions/ui/ClaudeSessionPicker";
import {
  buildImportedSession,
  claudeImportTarget,
  type ClaudeImportTarget,
} from "../features/sessions/model/claudeSessionImport";
import { type ClaudeSessionSummary } from "../platform/tauri/fs";
import { ProviderSignInDialog } from "../features/sessions/ui/ProviderSignInDialog";
import { ProviderAccountRecoveryDialog } from "../features/sessions/ui/ProviderAccountRecoveryDialog";
import { TitleBar, type Tab as TitleTab } from "./shell/TitleBar";
import { NavigationBoundary } from "./shell/NavigationBoundary";
import { MenuBar } from "./shell/MenuBar";
import { FilePicker, LAYOUT_ACTION_PREFIX } from "../features/files/ui/FilePicker";
import { useLockSnapshot } from "../features/group-lock/hooks/useGroupLock";
import {
  getGroupLockView,
  isProjectPasswordLocked,
  startGroupLockWatcher,
} from "../features/group-lock/model/groupLock";
import { isProjectLockedIn, visibleProjects } from "../features/group-lock/model/lockState";
import {
  DeleteSessionDialog,
  type SessionDeleteChoice,
} from "../features/sessions/ui/DeleteSessionDialog";
import {
  assertWorktreeFilesClosed,
  createOrchestrationWorktree,
  createWorktree,
  detachSessionWorktree,
  checkWorktreeRemoval,
  listWorktrees,
  namedWorktreeBranch,
  orchestrationWorktreeBranchName,
  removeOrchestrationBranch,
  removeOrchestrationWorktree,
  removeWorktree,
  renameWorktreeBranch,
  sessionInWorktree,
  temporaryWorktreeBranchName,
  worktreeSessionIds,
  type Worktree,
} from "../features/source-control/model/worktrees";
import {
  type WorktreeFocus,
  useWorktreeFocus,
  worktreeFocus,
} from "../features/source-control/model/worktreeFocus";
import { composerDraftOf } from "../features/sessions/model/draftCache";
import { UsageFooter } from "./shell/UsageFooter";
import { WorkspaceControls } from "./shell/WorkspaceControls";
import { useProjectBranches } from "../features/source-control/hooks/useProjectBranches";
import { useInboxActivity } from "../features/inbox/hooks/useInboxUnseen";
import {
  loadProjectRailOpen,
  loadSessionSidebarOpen,
  saveProjectRailOpen,
  saveSessionSidebarOpen,
  type SidebarTabId,
} from "../features/settings/model/appearance";
import {
  loadProjectSidebarTab,
  saveProjectSidebarTab,
} from "../features/settings/model/projectSidebarTab";
import { HAS_NATIVE_GLASS, IS_MAC, isFullscreenShortcut } from "../platform/tauri/platform";
import {
  applyUiScale,
  loadUiScale,
  saveUiScale,
  UI_SCALE_DEFAULT,
  zoomInUiScale,
  zoomOutUiScale,
} from "../features/settings/model/uiScale";
import { resolveZoomKeybinding } from "../features/settings/model/zoomKeybinding";
import { resolveAppShortcut } from "../features/settings/model/appShortcuts";
import { runUpdateFlow } from "./model/updater";
import { displayAttachments, prepareAttachments } from "../features/sessions/model/attachments";
import {
  basename,
  isLocalDirectory,
  listDir,
  notifyGitChanged,
  openPathWithDefaultApp,
  pickCodeWorkspaceFile,
  runShellCommand,
  pickFolders,
  readTextFile,
  type GitFileDiffKind,
  type GitHistoryCommit,
} from "../platform/tauri/fs";
import {
  OPEN_CODE_WORKSPACE_EVENT,
  parseCodeWorkspace,
} from "../features/projects/model/codeWorkspace";
import {
  assignProjectsToNamedGroup,
  linkProjectGroup,
} from "../features/projects/model/projectGroups";
import { useLinkedWorkspaceGroups } from "../features/projects/hooks/useLinkedWorkspaceGroups";
import { OPEN_PROJECT_CHANGES_EVENT } from "../features/projects/model/groupGit";
import { GitFileInspector } from "../features/source-control/ui/GitFileInspector";
import type { RepositoryReviewRequest } from "../features/source-control/model/workspaceRepositories";
import { additionalDirsForSession } from "../features/projects/model/additionalDirs";
import { setAdditionalDirsResolver } from "../integrations/harness/core/additionalDirs";
import {
  invalidateProjectFiles,
  prefetchProjectFiles,
  rememberOpenedFile,
  resolveFileOpenRequest,
  resolveOpenablePath,
} from "../features/files/model/fileIndex";
import {
  closeLeaf,
  closeSurfacePanes,
  findSurfacePane,
  firstLeafId,
  focusedFileTab,
  isolateTerminalPanes,
  isFilesystemTab,
  isCommitTab,
  isTerminalTab,
  leaf,
  leafIds,
  neighborLeafId,
  newEditorWorkspaceTab,
  newFileTab,
  newPlanTab,
  newTab,
  newTerminalFile,
  newTerminalWorkspaceTab,
  nextTerminalTitle,
  openChangesTab,
  openCommitTab,
  newAgentTab,
  openEditorTab,
  openSessionChangesTab,
  pinEditorFile,
  openWorkspaceFile,
  previewWorkspaceFile,
  openTerminalTab,
  removePane,
  resetTabToSession,
  replaceLeafId,
  setSplitRatio,
  selectPaneTab,
  layoutLeaves,
  siblingLeafId,
  splitPane,
  splitPaneAtSelfEdge,
  surfacePanes,
  updateTerminalTab,
  withSurfacePanes,
  type EditorPane,
  type FilePaneTab,
  type FocusDir,
  type PaneEdge,
  type PaneTabDropPosition,
  type SplitDir,
  type WorkspaceTab,
} from "../features/workspace/model/layout";
import { releaseNotesTitle } from "./model/releaseNotes";
import { mergeOrderedSubset, orderByIds } from "../shared/lib/reorder";
import {
  addTerminalToDock,
  applyDockGridStyle,
  closeTerminalInDock,
  createProjectTerminal,
  findProjectTerminal,
  mapProjectTerminal,
  nextDockTerminalTitle,
  patchProjectTerminals,
  reorderDockTerminals,
  selectDockTerminal,
  splitTerminalInDock,
  splitProjectTerminalsForMove,
  withDockOpen,
  withDockSide,
  withDockSize,
  type DockSide,
  type ProjectTerminalDock as ProjectTerminal,
} from "../features/projects/model/projectTerminal";
import {
  applyGroupedReorder,
  insertTabBesideActive,
  removeTabFromGroup,
  saveTabGroupLabel,
  saveWorkspaceProjectNames,
  tabGroupProject,
} from "../features/workspace/model/tabGroups";
import {
  collectWindowTransfer,
  mergeWindowTransfer,
  parseWindowTransfer,
  removeWindowTransfer,
  restoreTransferredDrafts,
  type WindowTransferPayload,
} from "./model/windowTransfer";
import {
  paneDropFromPoint,
  titleTabDropFromPoint,
  clearWindowDragPreview,
} from "../features/workspace/model/paneDrop";
import {
  busySessionsInTabs,
  dropWindowMoves,
  planTabMoveRemainder,
  windowDropPointToClient,
  queueWindowMoves,
  settlePendingWindowMoves,
  type PendingWindowMoves,
  type WindowMovePosition,
} from "./model/windowTransferPopout";
import {
  confirmCloseTerminal,
  confirmCloseTerminals,
} from "../features/terminal/model/terminalClose";
import {
  listRunningTerminals,
  terminalTabLabel,
  newTerminalCwd,
  type TerminalMetaPatch,
} from "../features/terminal/model/terminalTab";
import {
  applyHarnessEvent,
  applyHarnessEvents,
  appendUser,
  appendSteerUser,
  bindHarnessSession,
  cancelHarnessTurn,
  canStopHarnessBackgroundWork,
  stopHarnessBackgroundWork,
  canCompactHarnessContext,
  canRewindHarnessLastTurn,
  canSteerHarness,
  compactHarnessContext,
  rewindHarnessLastTurn,
  forgetHarnessSession,
  generateHarnessTitle,
  generateHarnessBranchName,
  isLiveHarness,
  latestTurnNeedsHarnessLogin,
  probeHarnessAvailability,
  refreshHarnessCatalogs,
  registerBuiltinHarnesses,
  promoteLastAssistantToPlan,
  respondHarnessApproval,
  respondHarnessQuestion,
  keepHarnessQuestionOpen,
  runHarnessTextPrompt,
  sendHarnessTurn,
  steerHarnessTurn,
  startHarnessBridge,
  stopHarnessSession,
  stopHarnessTextPrompts,
  stopStreaming,
  pickTextHarness,
  type ApprovalDecision,
  type HarnessEvent,
  type UserQuestionReply,
} from "../integrations/harness";
import { supportsHarnessLogin } from "../integrations/harness/core/authSupport";
import {
  appendPreparingHandoff,
  buildDeterministicHandoff,
  buildHandoffComposerCard,
  chooseHandoffBrief,
  completeHandoff,
  consumeHandoff,
  HANDOFF_TITLE,
  handoffTurnCard,
  isPreparingHandoff,
  pendingHandoff,
  withHarnessChoice,
  withAccountHandoff,
  planComposerSwitch,
  sessionChildHarnesses,
  sessionThroughTurn,
  shouldAskOutgoingAgent,
  type HandoffComposerCard,
  userMessagesAfterHandoff,
  wrapHandoffPrompt,
} from "../features/sessions/model/handoff";
import { requestOutgoingHandoff } from "../features/sessions/model/handoffTurn";
import { prepareBudgetedHandoff } from "./model/prepareHandoff";
import {
  applyBtwHarnessEvent,
  btwTurnHarness,
  buildBtwPrompt,
  replaceBtwThread,
  sealBtwResponseBlocks,
  supportsBtwHarness,
} from "../features/sessions/model/btw";

import { isEditTool } from "../integrations/harness/core/preview";
import {
  createEditedResendAttempt,
  createEditedResendCoordinator,
} from "../features/sessions/model/editLastTurn";
import {
  beginSessionTurn,
  applySessionCheckpoint,
  captureSessionCheckpoint,
  forgetSessionCheckpoint,
  flushSessionCheckpoint,
  finishSessionTurn,
  keepSessionChanges,
  notifyReviewChanged,
  prepareSessionCheckpoint,
  sessionCheckpointCleanupSafe,
} from "../features/sessions/model/checkpoint";
import { notifyDirsChanged } from "../features/files/model/fileTree";
import { invalidateWatchedFiles, nudgeWatchedFiles } from "../features/files/model/fileWatch";
import { type EditorNavigationTarget, type OpenFileFn } from "../features/search/model/search";
import {
  mergeModelSettings,
  nativeModelId,
  preferredModelSettings,
  resolveModel,
  saveLastModelSettings,
  saveRecentModelChoice,
} from "../features/sessions/model/models";

import {
  buildPlanPrompt,
  isProviderFailureText,
  planTitle,
  planTurnKey,
  planTurnPrompt,
} from "../features/sessions/model/plan";
import {
  displayPath,
  isEqualOrInside,
  pathKey,
  projectKey,
  projectName,
  rebasePath,
  resolveWorkspacePath,
} from "../shared/lib/paths";
import { rebaseProjectData, removeProjectData } from "../features/projects/model/projectData";
import { renamePath } from "../platform/tauri/fs";
import { folderRenameError } from "../features/projects/model/projectFolderRename";
import {
  forgetProjectLocation,
  rememberProjectLocation,
  synchronizeProjectLocation,
  invalidateProjectLocation,
} from "../features/projects/model/projectLocation";
import {
  archiveProject,
  forgetProject,
  lastProjectPath,
  loadRecents,
  isLocalProject,
  isRemoteProjectPath,
  looksLikeProject,
  newProjectPaths,
  normalizeProjectPath,
  projectRailItems,
  rememberProject,
  replaceProjectPath,
  sameProjectPath,
} from "../features/projects/model/recents";
import {
  applyDetachPaneToTab,
  applyMovePaneBetweenTabs,
  applyMoveFileBetweenPanes,
  applyPlaceTabOnPane,
  applyPlaceSessionOnPane,
  planOpenSessionsSideBySide,
  SIDE_BY_SIDE_LIMIT,
  filterTabsForProject,
  findOpenSessionTab,
  keepsWorkspaceTab,
  planWorkspaceTabClose,
  switchSessionInTab,
  workspaceTabCwd,
  workspaceTabWorktree,
  focusedWorkspaceTabCwd,
} from "../features/workspace/model/workspaceTabGroups";
import {
  arrangeSuggestedLayout,
  suggestedPaneCount,
  detectLayoutPreset,
  type LayoutPreset,
} from "../features/workspace/model/layoutPresets";
import { applyAddToChatRequest } from "../features/sessions/model/addChatToWorkspace";
import { ADD_TO_CHAT_EVENT, type AddToChatRequest } from "../features/sessions/model/quoteDraft";
import { createSessionRemover } from "../features/sessions/model/sessionRemoval";
import { confirmSessionDelete } from "../features/sessions/model/confirmSessionDelete";
import { shouldGenerateSessionTitle } from "../features/sessions/model/sessionTitle";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  providerAccountExists,
  providerAccountLabel,
  sessionProviderAccountId,
  supportsProviderAccounts,
  type ProviderAccountProvider,
} from "../features/providers/model/providerAccounts";
import { switchSessionAccount } from "../features/sessions/model/accountSwitch";
import { transferProviderSession } from "../platform/tauri/providerSessionTransfer";
import {
  HARNESSES,
  HARNESS_LABEL,
  HARNESS_TITLE,
  canReplaceSessionTitle,
  formatSessionTitle,
  sessionNeedsInput,
  newDefaultSession,
  newSession,
  retargetSessionToProject,
  removeSessionDraft,
  sessionDisplayTitle,
  sessionDraftBlock,
  sessionWorkCwd,
  titleFromPrompt,
  type Attachment,
  type Block,
  type BtwThread,
  type ComposerTurnOptions,
  type HarnessId,
  type LinkedWorkItem,
  type ModelTarget,
  type PlanBuildTarget,
  type RuntimeMode,
  type PlanStatus,
  type SecondOpinionMeta,
  type QueuedMessage,
  type Session,
  type UsageLimit,
  type WorkspaceMode,
} from "../features/sessions/model/session";

import {
  appendQueuedMessage,
  canDispatchQueuedHead,
  dequeueQueuedMessage,
  queuedMessageForSubmit,
  queuedModelTarget,
  reorderSessionQueue,
  resolveFollowUpRoute,
  holdUndeliveredFollowUp,
  sentQueuedMessage,
} from "../features/sessions/model/messageQueue";
import { claimAutoContinue, isAutoContinueDue } from "../features/sessions/model/autoContinue";
import { applyQueuedEdit } from "../features/sessions/model/queuedMessageEdit";
import { useQueuePersistence } from "../features/sessions/hooks/useQueuePersistence";
import { isBackgroundOnly } from "../features/sessions/model/activityDock";
import {
  USAGE_LIMIT_RESUME_GRACE_MS,
  usageLimitResumeDue,
} from "../features/sessions/model/usageLimit";
import {
  clearCachedRateLimits,
  loadFreshRateLimits,
  loadRateLimits,
} from "../features/providers/model/rateLimitsCache";
import { providerAccountSignedOut } from "../features/providers/model/accountUsage";
import { loadTerminalProfile } from "../features/terminal/model/terminalProfiles";
import {
  finishShellBlock,
  parseShellCommand,
  pendingShellRuns,
  SHELL_FOLLOW_UP_PROMPT,
  shellBlock,
  withShellContext,
  type ShellResult,
} from "../features/sessions/model/shellRun";
import {
  exhaustedWindowResetAt,
  type RateLimitProvider,
} from "../features/providers/model/rateLimits";
import {
  discardDraftSessionRecord,
  deleteSession,
  getSession,
  listLinkedSessions,
  listSessionsByProject,
  persistFingerprint,
  rebaseProjectSessions,
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
  setSessionArchived,
  setSessionLinkedWorkItem,
  setSessionPinned,
  shouldPersistSession,
  upsertSession,
  upsertSessionIfUnchanged,
  upsertSessionLive,
  flushSessionWrites,
  type SessionSummary,
} from "../features/sessions/data/sessionStore";
import { rememberLoadedSession } from "../features/sessions/data/sessionCache";
import { TranscriptPool, TranscriptPoolOutlet } from "../features/sessions/ui/TranscriptPool";
import { syncDockBadge } from "../features/notifications/model/dockBadge";
import { liveAgentsFromSessions, workingProjectPaths } from "../features/sessions/model/liveAgents";
import { liveSessionInfos, sameLiveSessionInfos } from "../features/sessions/model/recentSessions";
import { useKeepAwake } from "../features/settings/model/keepAwake";
import {
  hiddenApprovalNotices,
  pendingApprovalNotices,
} from "../features/notifications/model/approvalToast";
import { useSessionReminders } from "../features/notifications/hooks/useSessionReminders";
import { ReminderNotices } from "../features/sessions/ui/ReminderNotices";
import { useUnseenFinishedSessions } from "../features/sessions/hooks/useUnseenFinishedSessions";
import {
  loadNotificationsEnabled,
  NOTIFICATION_CLICK_EVENT,
  BACKGROUND_NOTIFICATION_TARGETS,
  announceSessionFinished,
  announceSessionIssue,
  probeNotificationPermission,
  setWindowFocused,
} from "../features/notifications/model/notifications";
import { useInputNotifications } from "../features/notifications/hooks/useInputNotifications";
import {
  isLeadWindow,
  useBackgroundNotifications,
} from "../features/notifications/hooks/useBackgroundNotifications";
import { useDailySummary } from "../features/notifications/hooks/useDailySummary";
import { requestSummaryPanel } from "../features/tasks/model/dailySummaryClient";
import { useAttentionNotifications } from "../features/notifications/hooks/useAttentionNotifications";
import { archiveFocusedSession } from "../features/sessions/model/archiveShortcut";
import { shouldToggleNotesPanel, toggleNotesPanel } from "../features/notes/notesPanel";
import {
  adjacentItemId,
  deferUnhandledEscape,
  focusedBusyAgentSessionId,
  shouldHandleListNavigation,
  shouldStopFocusedTurnOnEscape,
  tabCommand,
  tabCommandForKeybinding,
  tabCommandKeybinding,
} from "../features/workspace/model/tabKeys";
import {
  canTabVisitBack,
  canTabVisitForward,
  emptyTabVisitHistory,
  pruneTabVisitHistory,
  recordTabVisit,
  tabVisitBack,
  tabVisitForward,
  type TabVisitHistory,
} from "../features/workspace/model/tabVisitHistory";
import { prepareLocalTurn } from "./model/localTurnPreparation";
import {
  startPerformanceSpan,
  recordPerformanceEvent,
  beginSessionPerformanceTrace,
} from "../shared/lib/performanceTrace";
import { preparePrompt } from "../features/sessions/model/promptPreparation";
import {
  consumeOperatorCommand,
  operatorEnabledInThread,
} from "../features/sessions/model/operatorCommand";
import { isNativeCommandPrompt } from "../features/skills/model/skills";
import {
  loadSessionFolders,
  placeSessionInFolder,
  saveSessionFolders,
  type SessionFolderTarget,
} from "../features/sessions/model/sessionFolders";
import {
  ADD_NOTE_TO_CHAT_EVENT,
  NOTES_CHANGED_EVENT,
  composeNoteMessage,
  loadNoteSummaries,
  noteCardMeta,
  upsertNote,
  type NoteComposerCard,
} from "../features/notes";
import {
  claimDueAutomations,
  listAutomationRuns,
  listAutomations,
  recoverAutomationRuns,
  updateAutomationRun,
  type Automation,
  type AutomationRun,
} from "../features/automations/model/automations";
import { useQuickComposerLaunches } from "../features/quick-composer/hooks/useQuickComposerLaunches";
import type { QuickLaunch } from "../features/quick-composer/model/quickComposer";
import { claimInboxAutomationRuns } from "../features/automations/model/automationEvents";
import {
  LOCKED_PROJECT_SKIP,
  automationLimits,
  dailyRunLimitSkip,
  runLimitBreach,
} from "../features/automations/model/automationLimits";
import {
  SECOND_OPINION_TITLE,
  buildSecondOpinionRequest,
  harnessForTurn,
  turnEditedFiles,
  turnUserRequest,
} from "../features/sessions/model/secondOpinion";

import { PaneTree } from "../features/workspace/ui/PaneTree";
import { SessionPane } from "../features/sessions/ui/SessionPane";
import type { ProjectAction } from "../features/projects/model/projectActions";
import { SessionSurface } from "../features/sessions/ui/SessionSurface";
import { ProjectTerminalDock } from "../features/terminal/ui/ProjectTerminalDock";
import { ToolsWorkspace } from "../features/host-tools/ToolsWorkspace";
import { lazySurface } from "../shared/ui/lazySurface";
import { preloadNavigationWhenIdle } from "./model/preloadNavigation";
import { requestTranscriptJump } from "../features/sessions/model/transcriptJump";
import type { SettingsAnchor } from "../features/settings/ui/SettingsView";
import {
  OPEN_CONNECTIONS_EVENT,
  OPEN_REMOTE_PROJECT_EVENT,
  REMOTE_HISTORY_UPDATED,
  REMOTE_TAB_BINDING_CHANGE,
  cachedRemoteSessionSummary,
  loadRemoteSession,
  knownRemoteMachine,
  rememberRemotePendingWorktree,
  rememberRemoteSession,
  remotePendingWorktree,
  remoteTabCwd,
  remoteRequest,
  remoteSessionFor,
  useRemoteRailSessions,
} from "../features/connections/model/connections";
import {
  remoteLiveAgents,
  remoteLiveSessionInfos,
  unopenedRemoteSessions,
} from "../features/connections/model/remoteRailSessions";
import { useRemoteUnseenFinished } from "../features/connections/model/useRemoteUnseenFinished";
import {
  buildRemotePlan,
  remoteSessionActions,
} from "../features/connections/model/remoteSessionActions";
import { remoteSessionState } from "../features/connections/model/remoteSessionState";
import { findRemoteSessionTab } from "../features/connections/model/remoteSessionNavigation";
import { takePendingSessionWrites } from "./model/pendingSessionWrites";
import {
  parseRemotePath,
  rememberRemoteProject,
  remotePath,
  remoteProjectFor,
  remoteProjectsOn,
} from "../features/connections/model/remoteProjects";
import type { BackgroundSessionTarget } from "../features/tasks/model/backgroundSession";
import { openLocalHostSession } from "../features/connections/model/openLocalHostSession";
import { sessionHasBackgroundWork } from "../features/sessions/model/backgroundStop";
import { reconnectRemoteMachine } from "../features/connections/model/remoteReconnect";
import { startAppSync } from "../features/sync/model/useSync";
import {
  useAdoptedSessions,
  type RefreshAdoptedSession,
} from "../features/connections/model/useAdoptedSessions";
import {
  isTextOnlyChange,
  sessionsRef,
  setSessions,
  useLiveSessions,
  useShellSessions,
} from "../features/sessions/model/sessionsStore";
import { ADOPTED_SESSION_ADDED } from "../features/connections/model/adoptedSessions";
import { useDesktopLive } from "../features/connections/model/useDesktopLive";
import {
  sharedLocalQueueClaiming,
  sharedLocalQueueReady,
  submitSharedLocalQueue,
  useSharedLocalQueues,
} from "../features/connections/model/useSharedLocalQueues";
import type { DesktopLiveHandlers } from "../features/connections/model/desktopLive";
import { SyncMergedNotice } from "../features/sync/ui/SyncMergedNotice";
import type { HostProject, HostSession } from "../features/connections/model/protocol";
import { AddRemoteProjectDialog } from "../features/connections/ui/AddRemoteProjectDialog";
import {
  autoNameOnConflict,
  projectNameError,
  type AutoNamedProject,
} from "../features/projects/model/projectNames";
import { ProjectNameConflictDialog } from "../features/projects/ui/ProjectNameConflictDialog";
import { SessionImportHost } from "../features/sessions/ui/SessionImportHost";
import { OnboardingHost } from "../features/onboarding/ui/OnboardingHost";
import { OPEN_USAGE_GUIDE_EVENT, openUsageGuide } from "../features/onboarding/model/usageGuide";
import { requestSessionImport } from "../features/sessions/import/importModel";
import type { ConnectableInboxSource } from "../features/inbox/model/inboxFilters";
import type { InboxSessionPortal } from "../features/inbox/ui/InboxDiscussionPanel";
import { inboxAskKey, inboxAskPrompt } from "../features/inbox/model/inboxAsk";
import {
  githubWorkItemThread,
  inboxComposerCard,
  type InboxItem,
} from "../features/inbox/model/githubTasks";
import {
  linkedWorkItemFromAutomationEvent,
  linkedWorkItemFromInboxItem,
  resolveLinkedWorkItem,
} from "../features/sessions/model/sessionWorkItem";
import {
  completeLinkedWorkItemUpdateCard,
  failLinkedWorkItemUpdateCard,
  pendingLinkedWorkItemUpdateCard,
  type LinkedWorkItemUpdateCard,
} from "../features/inbox/model/linkedWorkItemActivity";
import type { LinkedSessionUpdate } from "../features/inbox/model/linkedSessionUpdates";
import { markLinkedSessionUpdateSeen } from "../features/inbox/model/linkedSessionSeen";
import { inboxTrackerDescription } from "../features/inbox/model/inboxContext";
import { gitlabWorkItemDetails, peekGitlabWorkItemDetails } from "../features/inbox/model/gitlab";
import {
  azureDevOpsWorkItemDetails,
  peekAzureDevOpsWorkItemDetails,
} from "../features/inbox/model/azureDevOps";
import {
  loadCloseToTray,
  loadAutosave,
  loadCollapsedProjectRailMode,
  loadFileTabMode,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  loadDiffViewer,
  loadFollowUpBehavior,
  loadKeybindingOverrides,
  loadSettingsSection,
  keybindingPressed,
  matchCustomKeybinding,
  saveSettingsSection,
  saveAutosave,
  subscribeLiveAgentsEnabled,
  subscribeNotesEnabled,
  type CollapsedProjectRailMode,
  type SettingsSectionId,
  type FollowUpBehavior,
} from "../features/settings/model/settings";
import {
  handleEditorFindKey,
  openFindInActiveEditor,
  preloadEditorFind,
} from "../features/files/editor/editorFindBridge";

import {
  mergeHistorySummary,
  mergeProjectHistorySummary,
  replaceProjectHistory,
  historyWithLiveSessions,
  summaryFromSession,
} from "../features/sessions/data/sessionHistory";
import {
  CONTINUE_PROMPT,
  canAutoContinue,
  inFlightRefs,
  inFlightSnapshotKey,
  shouldWriteInFlightSnapshot,
} from "../features/sessions/model/inFlight";
import {
  isBlankSession,
  reconcileProjectReturn,
  type ProjectReturnMemory,
} from "../features/projects/model/projectReturn";
import {
  planProjectOpenRun,
  type ProjectOpenStep,
} from "../features/projects/model/projectOpenRun";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
  workspaceSnapshotKey,
} from "../features/workspace/model/workspaceSnapshot";
import {
  getSessionRecovery,
  setSessionRecovery,
  isRecoverySessionHeld,
  sessionRecoveryTabs,
  mergeRecoveryTabs,
  removeRecoverySessions,
} from "../features/workspace/model/sessionRecovery";
import { SessionRecoveryPanel } from "./shell/SessionRecoveryPanel";
import { SessionRecoveryControl } from "./shell/SessionRecoveryControl";
import type { InstalledUpdate } from "./model/updateNotice";
import {
  bindResumedSessions,
  closeBusyWindow,
  closeCurrentWindow,
  confirmReload,
  hasInFlightSessions,
  hideCurrentWindow,
  isAppQuitting,
  abortQuit,
  relinquishTransferredWindow,
  persistLiveTranscripts,
  persistQuitState,
  reapUnloadRuntime,
  setQuitWorkspace,
  type ResumedWorkspace,
} from "./model/appLifecycle";

const SearchView = lazySurface(
  async () => {
    const module = await import("../features/search/ui/SearchView");
    return { default: module.SearchView };
  },
  { suspense: false },
);
const SettingsView = lazySurface(
  async () => {
    const module = await import("../features/settings/ui/SettingsView");
    return { default: module.SettingsView };
  },
  { suspense: false },
);
const InboxView = lazySurface(
  async () => {
    const module = await import("../features/inbox/ui/InboxView");
    return { default: module.InboxView };
  },
  { suspense: false },
);
const LinkedWorkItemPanel = lazySurface(async () => {
  const module = await import("../features/inbox/ui/InboxView");
  return { default: module.LinkedWorkItemPanel };
});
const NotesView = lazySurface(
  async () => {
    const module = await import("../features/notes/ui/NotesView");
    return { default: module.NotesView };
  },
  { suspense: false },
);
const AutomationsView = lazySurface(
  async () => {
    const module = await import("../features/automations/ui/AutomationsView");
    return { default: module.AutomationsView };
  },
  { suspense: false },
);
const SocialView = lazySurface(async () => {
  const module = await import("../features/social/ui/SocialView");
  return { default: module.SocialView };
});
const TasksView = lazySurface(
  async () => {
    const module = await import("../features/tasks/ui/TasksView");
    return { default: module.TasksView };
  },
  { suspense: false },
);

type LinkedWorkItemPanelState = {
  item: LinkedWorkItem;
  sessionId: string;
  cwd: string;
};

type SubmitOptions = ComposerTurnOptions & {
  sharedQueueClaimed?: boolean;
  ciRepair?: CiRepairRequest;
  /** Saved alongside the user turn; does not replace the submitted prompt. */
  ciContext?: string;
  secondOpinion?: SecondOpinionMeta;
  followUpBehavior?: FollowUpBehavior;
  noteCard?: NoteComposerCard;
  handoffCard?: HandoffComposerCard;
  queuedMessageId?: string;
  planBlockId?: string;
  buildTarget?: PlanBuildTarget;
  managed?: boolean;
  orchestrationRetry?: OrchestrationProposal;
  appRequestId?: string;
  onSettled?: (outcome: ControlOutcome) => void;
  /** Generate a fresh title even when this is not the session's first turn. */
  refreshTitle?: boolean;
  /** Internal guard for the retry after resolving a renamed project. */
  projectLocationReady?: boolean;
};

type Submit = (
  sessionId: string,
  text: string,
  attachments?: Attachment[],
  options?: SubmitOptions,
) => SubmissionAcceptance;

function withPlanStatus(session: Session, blockId: string, status: PlanStatus): Session {
  return {
    ...session,
    blocks: session.blocks.map((block) =>
      block.id === blockId && block.role === "plan"
        ? {
            ...block,
            plan: { ...(block.plan ?? { status: "ready" }), status },
          }
        : block,
    ),
  };
}

function lastAssistantTextInTurn(session: Session): string {
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    const block = session.blocks[index];
    if (block.role === "user") return "";
    if (block.role === "assistant" && block.text.trim()) return block.text;
  }
  return "";
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function userTurnCards(noteCard: NoteComposerCard | undefined, secondOpinion?: SecondOpinionMeta) {
  if (!noteCard && !secondOpinion) return undefined;
  return {
    ...(secondOpinion ? { secondOpinion } : {}),
    ...(noteCard ? { noteCard: noteCardMeta(noteCard) } : {}),
  };
}

function withPlanBuildTarget(session: Session, target: PlanBuildTarget): Session {
  const resolved = resolveModel(target.harness, target.model);
  const modelSettings = mergeModelSettings(resolved, target.modelSettings);
  const plan = planComposerSwitch(session, target.harness);
  const next = withHarnessChoice(session, target.harness, resolved.id, modelSettings);

  if (plan.kind === "arm") {
    return { ...next, pendingSwitch: plan.pending };
  }
  if (plan.kind === "revert") {
    return {
      ...next,
      pendingSwitch: undefined,
      ...(plan.restoreProviderSessionId
        ? { providerSessionId: plan.restoreProviderSessionId }
        : { providerSessionId: undefined }),
      ...(plan.restoreProviderAccountId
        ? { providerAccountId: plan.restoreProviderAccountId }
        : { providerAccountId: undefined }),
    };
  }
  if (plan.kind === "empty") {
    return { ...next, pendingSwitch: undefined };
  }
  return next;
}

function openSessionIds(tabs: WorkspaceTab[]): Set<string> {
  const ids = new Set<string>();
  for (const tab of tabs) {
    for (const id of leafIds(tab.layout)) ids.add(id);
  }
  return ids;
}

function filesInWorkspaceTabs(tabs: readonly WorkspaceTab[]): FilePaneTab[] {
  return tabs.flatMap((tab) => [
    ...tab.editorPanes.flatMap((pane) => pane.files),
    ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
  ]);
}

/** Native sheet. `window.confirm` is swallowed when a macOS menu accelerator fires. */
function confirmDiscardUnsaved(message: string): Promise<boolean> {
  return ask(message, { title: appName(), kind: "warning" });
}

/** The worktree a project's workspace currently shows. */
function currentWorkspace(project: string): string {
  return worktreeFocus(project)?.path ?? project;
}

function titleTabsEqual(a: TitleTab[], b: TitleTab[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tab, index) => {
    const other = b[index];
    return (
      other != null &&
      tab.id === other.id &&
      tab.project === other.project &&
      tab.title === other.title &&
      tab.sessionCount === other.sessionCount &&
      tab.dirty === other.dirty &&
      tab.more.join("\u0000") === other.more.join("\u0000") &&
      tab.harnesses.join("\u0000") === other.harnesses.join("\u0000") &&
      tab.busyHarnesses.join("\u0000") === other.busyHarnesses.join("\u0000") &&
      (tab.doneHarnesses ?? []).join("\u0000") === (other.doneHarnesses ?? []).join("\u0000") &&
      tab.files.join("\u0000") === other.files.join("\u0000") &&
      tab.multiPane === other.multiPane &&
      tab.fileFocused === other.fileFocused &&
      tab.blank === other.blank &&
      tab.terminal === other.terminal &&
      tab.hasTerminal === other.hasTerminal &&
      tab.pendingWindowMove === other.pendingWindowMove &&
      tab.movingWindow === other.movingWindow &&
      tab.previewFileId === other.previewFileId &&
      tab.groupId === other.groupId
    );
  });
}

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

/** How often a running session's stored copy follows it, for a local host. */
const LIVE_PERSIST_MS = 1_500;
const USAGE_PROVIDERS: RateLimitProvider[] = ["claude", "codex", "opencode"];

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
  const nativeFullscreenRef = useRef(false);
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const window = getCurrentWindow();
    const refresh = async () => {
      const current = ++revision;
      try {
        const full = await window.isFullscreen();
        if (!disposed && current === revision) nativeFullscreenRef.current = full;
      } catch {}
    };
    void refresh();
    const resized = window.onResized(() => void refresh());
    return () => {
      disposed = true;
      void resized.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
  const [projectCwd, setProjectCwd] = useState(
    () =>
      toolWindow?.cwd ??
      windowTransfer?.projectCwd ??
      resumed?.projectCwd ??
      lastProjectPath() ??
      "~",
  );
  const [recents, setRecents] = useState(() =>
    resumed?.projectCwd && looksLikeProject(resumed.projectCwd)
      ? rememberProject(resumed.projectCwd)
      : loadRecents(),
  );
  // What is not behind a locked group. The rail itself gets the full list, so
  // it can keep the saved order and pins of projects that are hidden.
  const lockSnapshot = useLockSnapshot();
  const visibleRecents = useMemo(
    () => visibleProjects(lockSnapshot, recents, (project) => project.path),
    [lockSnapshot, recents],
  );
  useEffect(() => startGroupLockWatcher(), []);
  useEffect(() => startAppSync(), []);
  // The editor is kept out of the boot chunk; fetch it once the app is up so
  // find-in-file works before the first file is opened.
  useEffect(() => {
    const timer = window.setTimeout(() => void preloadEditorFind(), 1_500);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => subscribeSyncedProjectsAdded(() => setRecents(loadRecents())), []);
  const [seed] = useState(() => {
    const cwd = toolWindow?.cwd ?? lastProjectPath() ?? "~";
    const session = newDefaultSession(cwd);
    const tab = newTab(session.id);
    return { session, tab };
  });
  // The sessions live in a store so a streamed token re-renders only the pane
  // showing it. `sessions` here lags behind by streamed text alone; code that
  // needs the live text reads `sessionsRef.current` at event time.
  const deferWorkspaceWork = useOwnedTimeout();
  useInitializeSessions(windowTransfer?.sessions ?? resumed?.sessions ?? [seed.session]);
  const sessions = useShellSessions();
  const [sessionRecovery, updateSessionRecovery] = useState(getSessionRecovery);
  const [recoveryOpen, setRecoveryOpen] = useState(
    () =>
      !windowTransfer && !toolWindow && !!getSessionRecovery() && !getSessionRecovery()?.dismissed,
  );
  useKeepAwake(sessions);
  const [sessionDeleteDialog, setSessionDeleteDialog] = useState<{
    title: string;
    unusedWorktree: string;
    resolve: (choice: SessionDeleteChoice) => void;
  }>();
  const switchingWorktrees = useRef(new Map<string, string>());
  const removingWorktreePaths = useRef(new Set<string>());
  const deleteConfirmationPending = useRef(false);
  const [tabs, setTabsState] = useState<WorkspaceTab[]>(() =>
    (windowTransfer?.tabs ?? resumed?.tabs ?? [seed.tab]).map(isolateTerminalPanes),
  );
  const setTabs = useCallback(
    (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => {
      setTabsState((previous) => {
        const next = typeof update === "function" ? update(previous) : update;
        if (next === previous) return previous;
        return next.map(isolateTerminalPanes);
      });
    },
    [],
  );
  const [projectTerminals, setProjectTerminals] = useState<ProjectTerminal[]>(
    () => windowTransfer?.projectTerminals ?? resumed?.projectTerminals ?? [],
  );
  /** Dock side a brand-new project's terminal starts with, persisted in the workspace snapshot. */
  const [lastDockSide, setLastDockSide] = useState<DockSide | null>(
    () => resumed?.lastDockSide ?? null,
  );
  const lastDockSideRef = useRef(lastDockSide);
  lastDockSideRef.current = lastDockSide;
  const [projectTerminalFocused, setProjectTerminalFocused] = useState(false);
  const [activeTabId, setActiveTabIdState] = useState(
    () => windowTransfer?.activeTabId ?? resumed?.activeTabId ?? seed.tab.id,
  );
  const [maximizedPane, setMaximizedPane] = useState<{ tabId: string; paneId: string } | null>(
    null,
  );
  const onToggleMaximizePane = useCallback((paneId?: string) => {
    const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current);
    const id = paneId ?? tab?.focusedId;
    if (!tab || !id || !leafIds(tab.layout).includes(id)) return;
    if (windowTransferPendingRef.current || movingTabIds.current.has(tab.id)) return;
    if (tab.focusedId !== id) {
      const next = tabsRef.current.map((entry) =>
        entry.id === tab.id
          ? { ...entry, layout: selectPaneTab(entry.layout, id), focusedId: id, diffFocused: false }
          : entry,
      );
      tabsRef.current = next;
      setTabs(next);
      setProjectTerminalFocused(false);
      setComposerFocused(sessionsRef.current.some((session) => session.id === id));
    }
    setMaximizedPane((current) =>
      current?.tabId === tab.id && current.paneId === id ? null : { tabId: tab.id, paneId: id },
    );
  }, []);
  useEffect(() => {
    if (
      maximizedPane &&
      !tabs.some(
        (tab) =>
          tab.id === maximizedPane.tabId && leafIds(tab.layout).includes(maximizedPane.paneId),
      )
    )
      setMaximizedPane(null);
    else if (maximizedPane) {
      const tab = tabs.find((entry) => entry.id === maximizedPane.tabId);
      if (
        tab &&
        tab.focusedId !== maximizedPane.paneId &&
        leafIds(tab.layout).includes(tab.focusedId)
      )
        setMaximizedPane({ tabId: tab.id, paneId: tab.focusedId });
    }
  }, [tabs, maximizedPane]);
  const [composerFocused, setComposerFocused] = useState(() => {
    if (windowTransfer) return true;
    if (!resumed) return false;
    const tab = resumed.tabs.find((entry) => entry.id === resumed.activeTabId) ?? resumed.tabs[0];
    return !!tab && resumed.sessions.some((session) => session.id === tab.focusedId);
  });
  const [composerFocusToken, setComposerFocusToken] = useState(0);
  /** Tab id -> project name, kept in sync with the rendered title tabs. */
  const tabProjectsRef = useRef(new Map<string, string>());
  const projectOfTab = useCallback((id: string) => tabProjectsRef.current.get(id), []);
  const [projectRailOpen, setProjectRailOpen] = useState(loadProjectRailOpen);
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(loadSessionSidebarOpen);
  const tabCloseScope = "project" as const;
  const currentProjectDock = findProjectTerminal(projectTerminals, projectCwd);
  const dockVisible = !!currentProjectDock?.open;
  const [filesSearchOpen, setFilesSearchOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [searchViewOpen, setSearchViewOpen] = useState(false);
  const [searchViewFocusToken, setSearchViewFocusToken] = useState(0);
  const [inboxViewOpen, setInboxViewOpen] = useState(toolWindow?.active === "inbox");
  const [pullRequestsOnly, setPullRequestsOnly] = useState(false);
  const [linkedWorkItemPanels, setLinkedWorkItemPanels] = useState<
    ReadonlyMap<string, LinkedWorkItemPanelState>
  >(() => new Map());
  const linkedWorkItemPanelRequest = useRef(0);
  const closeLinkedWorkItemPanel = useCallback((sessionId: string) => {
    linkedWorkItemPanelRequest.current += 1;
    setLinkedWorkItemPanels((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Map(current);
      next.delete(sessionId);
      return next;
    });
  }, []);
  const [inboxAskPortal, setInboxAskPortal] = useState<InboxSessionPortal | null>(null);
  const openingInboxSessions = useRef(new Map<string, Promise<string>>());
  const [notesViewOpen, setNotesViewOpen] = useState(
    toolWindow?.active === "notes" && loadNotesEnabled(),
  );
  const [automationsViewOpen, setAutomationsViewOpen] = useState(
    toolWindow?.active === "automations" ||
      toolWindow?.active === "tasks" ||
      toolWindow?.active === "social",
  );
  // Tasks and Social Media share the workspace navigation lifecycle with
  // Automations; closing or restoring it also handles the selected panel.
  const [taskBoardShown, setTaskBoardShown] = useState(toolWindow?.active === "tasks");
  const [socialBoardShown, setSocialBoardShown] = useState(toolWindow?.active === "social");
  const [socialPanelCwd, setSocialPanelCwd] = useState("");
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ cwd: string }>).detail;
      startTransition(() => {
        setFilePickerOpen(false);
        setSettingsOpen(false);
        setSearchViewOpen(false);
        setInboxViewOpen(false);
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
  const [inspectedWorkerId, setInspectedWorkerId] = useState<string | null>(null);
  // Set while the lead's tab is still opening; the agent tab lands on the
  // commit that brings it in.
  const [workerDetailRequest, setWorkerDetailRequest] = useState<{
    leadId: string;
    workers: OrchestrationWorkerDetail[];
  } | null>(null);
  const orchestrationRuns = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  const liveAgentsEnabled = useSyncExternalStore(
    subscribeLiveAgentsEnabled,
    loadLiveAgentsEnabled,
    () => true,
  );
  const [collapsedProjectRailMode, setCollapsedProjectRailMode] =
    useState<CollapsedProjectRailMode>(loadCollapsedProjectRailMode);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsReturnViewRef = useRef({
    search: false,
    inbox: false,
    notes: false,
    automations: false,
  });
  const [updateNotice, setUpdateNotice] = useState(installedUpdate);
  const [whatsNewVersion, setWhatsNewVersion] = useState<string | null>(null);
  const [providerAccountRecovery, setProviderAccountRecovery] = useState<{
    sessionId: string;
    provider: ProviderAccountProvider;
  } | null>(null);
  const [providerSignInRequest, setProviderSignInRequest] = useState<{
    key: string;
    sessionId: string;
    harness: HarnessId;
    accountId?: string;
  } | null>(null);
  const seenProviderSignInRequestsRef = useRef<Set<string> | null>(null);
  const seenProviderSignInRequests =
    seenProviderSignInRequestsRef.current ??
    (seenProviderSignInRequestsRef.current = new Set(
      sessions.flatMap((session) => {
        if (
          !supportsHarnessLogin(session.harness) ||
          !latestTurnNeedsHarnessLogin(session.blocks)
        ) {
          return [];
        }
        return [providerSignInRequestKey(session)];
      }),
    ));
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>(loadSettingsSection);
  const [settingsAnchor, setSettingsAnchor] = useState<SettingsAnchor | null>(null);
  const [notificationProjectPath, setNotificationProjectPath] = useState<string | null>(null);
  const [notificationSettingsRequest, setNotificationSettingsRequest] = useState(0);
  const [editorNavigation, setEditorNavigation] = useState<EditorNavigationTarget | null>(null);
  const editorNavigationToken = useRef(0);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [filePickerInitialQuery, setFilePickerInitialQuery] = useState("");
  const [filePickerResetToken, setFilePickerResetToken] = useState(0);
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(
    () => new Set(windowTransfer?.dirtyFileIds ?? []),
  );
  // Not carried across a window transfer the way dirty state is: the editor
  // re-lints whatever it mounts, so the counts rebuild themselves.
  const [fileErrorCounts, setFileErrorCounts] = useState<Map<string, number>>(() => new Map());
  const [history, setHistory] = useState<SessionSummary[]>(() => bootHistory);
  const [, refreshRemoteTabTitles] = useState(0);
  useEffect(() => {
    const updated = () => refreshRemoteTabTitles((value) => value + 1);
    window.addEventListener(REMOTE_HISTORY_UPDATED, updated);
    return () => window.removeEventListener(REMOTE_HISTORY_UPDATED, updated);
  }, []);
  const [storedLinkedSessions, setStoredLinkedSessions] = useState<SessionSummary[]>(() =>
    bootHistory.filter((session) => session.linkedWorkItem),
  );
  /**
   * Projects whose rows are already in `history`. This has to be state, not a
   * ref: `sidebarCwd` is derived during render, so the frame that first shows
   * a new project must already know the listing has not arrived yet.
   */
  const btwRequestsRef = useRef(
    new Map<string, { sessionId: string; controller: AbortController }>(),
  );
  const [loadedProjects, setLoadedProjects] = useState<ReadonlySet<string>>(() =>
    bootHistoryCwd ? new Set([normalizeProjectPath(bootHistoryCwd)]) : new Set(),
  );
  const loadedProjectsRef = useRef(loadedProjects);
  loadedProjectsRef.current = loadedProjects;
  /** Project whose listing failed, so the error cannot leak to another one. */
  const [historyErrorCwd, setHistoryErrorCwd] = useState<string | null>(null);

  const loadRunningOnHostRef = useRef<(ids: string[]) => void>(undefined);
  const refreshAdoptedSessionRef = useRef<RefreshAdoptedSession>(undefined);
  const localHostReachable = useAdoptedSessions(
    sessionsRef,
    setSessions,
    loadRunningOnHostRef,
    refreshAdoptedSessionRef,
  );
  const onRefreshAdoptedSession = useCallback<RefreshAdoptedSession>((sessionId, target) => {
    const refresh = refreshAdoptedSessionRef.current;
    if (!refresh) return Promise.reject(new Error("Host unavailable. Try again."));
    return refresh(sessionId, target);
  }, []);
  const desktopLiveHandlers = useRef<DesktopLiveHandlers>({
    stop: () => undefined,
    approve: () => undefined,
    answer: () => undefined,
  });
  useDesktopLive(sessionsRef, desktopLiveHandlers, localHostReachable);
  useSharedLocalQueues(sessionsRef, setSessions, localHostReachable);
  const linkedSessionUpdatesRef = useRef<ReadonlyMap<string, LinkedSessionUpdate>>(new Map());
  const linkedWorkItemActivityFetches = useRef(new Map<string, number>());
  const queueDispatchingRef = useRef(new Set<string>());
  const usageResumingRef = useRef(new Set<string>());
  const usageResetLookups = useRef(new WeakSet<UsageLimit>());
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
  const dirtyFilesRef = useRef(dirtyFiles);
  dirtyFilesRef.current = dirtyFiles;
  const projectTerminalsRef = useRef(projectTerminals);
  projectTerminalsRef.current = projectTerminals;
  const projectTerminalFocusedRef = useRef(projectTerminalFocused);
  projectTerminalFocusedRef.current = projectTerminalFocused;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const projectCwdRef = useRef(projectCwd);
  projectCwdRef.current = projectCwd;

  const projectWorktree = useWorktreeFocus(projectCwd);
  /** Tab or session id -> the workspace it was opened or moved in. A tab
   * belongs to the workspace it was opened in, whatever worktree it runs in:
   * opening a session, or moving one from its composer, never switches the
   * workspace. Unpinned tabs group by their own worktree. */
  // Saved tabs reopen on their project's default workspace, including one its
  // composer moved to a worktree. A tab handed over from another window keeps
  // grouping by its own worktree.
  const [restoredPins] = useState(
    () =>
      new Map(
        windowTransfer
          ? []
          : tabs.flatMap((tab) => {
              const project = workspaceTabCwd(tab, sessions);
              return project && !isRemoteProjectPath(project) ? [[tab.id, project] as const] : [];
            }),
      ),
  );
  const workspacePins = useRef(restoredPins);
  const tabWorkspace = useCallback((tab: WorkspaceTab, list: readonly Session[]) => {
    const pinnedTab = workspacePins.current.get(tab.id);
    if (pinnedTab) return pinnedTab;
    for (const id of leafIds(tab.layout)) {
      const pinned = workspacePins.current.get(id);
      if (pinned) return pinned;
    }
    return workspaceTabWorktree(tab, list);
  }, []);
  const tabWorktreeOf = useCallback(
    (tab: WorkspaceTab) => tabWorkspace(tab, sessionsRef.current),
    [tabWorkspace],
  );
  const keepWorkspaceTab = useCallback(
    (tab: WorkspaceTab) =>
      keepsWorkspaceTab(
        tab,
        sessionsRef.current,
        tabWorkspace(tab, sessionsRef.current),
        (sessionId) => {
          const draft = composerDraftOf(sessionId);
          return (
            !!draft.text.trim() ||
            draft.attachments.length > 0 ||
            !!sessionsRef.current.find((entry) => entry.id === sessionId)?.queuedMessages?.length
          );
        },
      ),
    [tabWorkspace],
  );

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
  const setActiveTabId = useCallback(
    (id: string) => {
      workspaceNavigation.cancel();
      setActiveTabIdState(id);
    },
    [workspaceNavigation.cancel],
  );
  const searchViewOpenRef = useRef(searchViewOpen);
  searchViewOpenRef.current = searchViewOpen;
  const inboxViewOpenRef = useRef(inboxViewOpen);
  inboxViewOpenRef.current = inboxViewOpen;
  const foregroundSurfaceRef = useRef<{
    workspaceVisible: boolean;
    inboxSessionId?: string;
  }>({ workspaceVisible: true });
  foregroundSurfaceRef.current = {
    workspaceVisible:
      !searchViewOpen && !inboxViewOpen && !notesViewOpen && !automationsViewOpen && !settingsOpen,
    inboxSessionId: inboxViewOpen ? inboxAskPortal?.sessionId : undefined,
  };
  const notesViewOpenRef = useRef(notesViewOpen);
  notesViewOpenRef.current = notesViewOpen;
  const automationsViewOpenRef = useRef(automationsViewOpen);
  automationsViewOpenRef.current = automationsViewOpen;
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  const sessionNavigationIdsRef = useRef<readonly string[]>([]);
  const filePickerOpenRef = useRef(filePickerOpen);
  filePickerOpenRef.current = filePickerOpen;
  const whatsNewVersionRef = useRef(whatsNewVersion);
  whatsNewVersionRef.current = whatsNewVersion;
  useEffect(() => {
    const liveSessionIds = new Set(sessions.map((session) => session.id));
    for (const [key, request] of btwRequestsRef.current) {
      if (liveSessionIds.has(request.sessionId)) continue;
      request.controller.abort();
      btwRequestsRef.current.delete(key);
    }
  }, [sessions]);

  useEffect(
    () => () => {
      for (const request of btwRequestsRef.current.values()) {
        request.controller.abort();
      }
      btwRequestsRef.current.clear();
      void stopHarnessTextPrompts().catch((error) =>
        console.warn("Stopping text prompts failed", error),
      );
    },
    [],
  );

  useEffect(() => {
    if (!notesEnabled) setNotesViewOpen(false);
  }, [notesEnabled]);

  useEffect(
    () =>
      preloadNavigationWhenIdle([
        InboxView.preload,
        LinkedWorkItemPanel.preload,
        AutomationsView.preload,
        TasksView.preload,
        listAutomations,
        ...(notesEnabled ? [NotesView.preload, loadNoteSummaries] : []),
      ]),
    [notesEnabled],
  );

  const projectReturnRef = useRef<ProjectReturnMemory>(resumed?.projectReturnMemory ?? new Map());
  const readProjectReturnMemory = useCallback(() => {
    projectReturnRef.current = reconcileProjectReturn({
      memory: projectReturnRef.current,
      tabs: tabsRef.current,
      sessions: sessionsRef.current,
      activeTabId: activeTabIdRef.current,
    });
    return projectReturnRef.current;
  }, []);
  useEffect(() => {
    readProjectReturnMemory();
  }, [activeTabId, tabs, sessions, readProjectReturnMemory]);

  const tabVisitRef = useRef(emptyTabVisitHistory(activeTabId));
  const tabVisitFromHistoryRef = useRef(false);
  const [tabVisitNav, setTabVisitNav] = useState({
    canBack: false,
    canForward: false,
  });
  const turnGen = useRef(new Map<string, number>());
  const retiringTurns = useRef(new Map<string, number>());
  const editedResends = useRef(createEditedResendCoordinator()).current;
  const lastPersisted = useRef(new Map<string, string>());
  const lastBoundProvider = useRef(new Map<string, string>());
  const lastPersistedUserBlock = useRef(new Map<string, string>());
  const inFlightSyncKey = useRef<string | null>(null);
  const sawInFlight = useRef(false);
  const workspaceSyncKey = useRef<string | null>(null);
  const [remoteBindingRevision, setRemoteBindingRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRemoteBindingRevision((revision) => revision + 1);
    window.addEventListener(REMOTE_TAB_BINDING_CHANGE, changed);
    return () => window.removeEventListener(REMOTE_TAB_BINDING_CHANGE, changed);
  }, []);
  const observedSessions = useRef(new Map<string, Session>());
  const pendingPersist = useRef(new Map<string, Session>());
  const removingSessionIds = useRef(new Set<string>());
  const loadedSessionCache = useRef(new Map<string, Session>());
  const sessionLoads = useRef(new Map<string, Promise<Session | null>>());
  const sessionLoadEpochs = useRef(new Map<string, number>());
  const openingSessionIds = useRef(new Set<string>());
  const activeSessionPrefetch = useRef<Promise<Session | null> | null>(null);
  const [transcriptPool] = useState(() => new TranscriptPool());
  // Tokens arrive many times per frame; apply them once so React/markdown aren't
  // recomputed for every delta.
  const [harnessQueue] = useState(
    () =>
      new HarnessEventQueue(
        (sessionId) => {
          const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current);
          return (
            foregroundSurfaceRef.current.inboxSessionId === sessionId ||
            (foregroundSurfaceRef.current.workspaceVisible &&
              !!tab &&
              (leafIds(tab.layout).includes(sessionId) ||
                tab.editorPanes.some((pane) =>
                  pane.files.some(
                    (file) => file.id === pane.activeFileId && file.agent?.sessionId === sessionId,
                  ),
                )))
          );
        },
        (batches) => {
          const prev = sessionsRef.current;
          const next = prev.map((session) => {
            const events = batches.get(session.id);
            return events ? applyHarnessEvents(session, events) : session;
          });
          if (!next.some((session, index) => session !== prev[index])) return;
          sessionsRef.current = next;
          if (!isTextOnlyChange(prev, next)) syncDockBadge(next);
          setSessions(next);
        },
      ),
  );
  const skipForgetSessionIds = useRef(new Set<string>());
  const movingTabIds = useRef(new Set<string>());
  const movingSessionIds = useRef(new Set<string>());
  const isMovingPane = useCallback(
    (paneId: string) =>
      windowTransferPendingRef.current ||
      tabsRef.current.some(
        (tab) => movingTabIds.current.has(tab.id) && leafIds(tab.layout).includes(paneId),
      ),
    [],
  );
  const openingFileWindowIds = useRef(new Set<string>());
  const importedSessionsApplied = useRef(false);
  const projectLocationSyncs = useRef(
    new Map<string, ReturnType<typeof synchronizeProjectLocation>>(),
  );
  const submitAfterProjectSyncRef = useRef<Submit>(() => false);

  useEffect(() => {
    for (const project of recents) {
      void rememberProjectLocation(project.path).catch((error) => {
        console.warn("App operation failed", error);
      });
    }
  }, [recents]);

  useEffect(() => {
    if (importedSessionsApplied.current) return;
    const imported = windowTransfer?.sessions ?? resumed?.sessions;
    if (!imported?.length) return;
    importedSessionsApplied.current = true;
    for (const session of imported) {
      observedSessions.current.set(session.id, session);
      lastPersisted.current.set(session.id, persistFingerprint(session));
      const userId = lastUserBlockId(session);
      if (userId) lastPersistedUserBlock.current.set(session.id, userId);
      if (session.providerSessionId) {
        lastBoundProvider.current.set(session.id, session.providerSessionId);
      }
    }
  }, [windowTransfer, resumed]);

  const flushHarnessEvents = harnessQueue.flush;

  const stopSessionForRemoval = useCallback(
    async (sessionId: string): Promise<Session | undefined> => {
      await orchestrator.stopForSession(sessionId);
      const open = sessionsRef.current.find((session) => session.id === sessionId);
      if (!open?.busy) return open;

      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      flushHarnessEvents();
      await Promise.all(
        sessionChildHarnesses(open).map((harness) =>
          cancelHarnessTurn(harness, sessionId).catch((error) => {
            console.warn("App operation failed", error);
          }),
        ),
      );
      flushHarnessEvents();
      return sessionsRef.current.find((session) => session.id === sessionId);
    },
    [flushHarnessEvents],
  );

  const enqueueHarnessEvent = harnessQueue.enqueue;

  useEffect(() => {
    if (resumed?.sessions.length) bindResumedSessions(resumed.sessions);
    const stopBridge = startHarnessBridge();
    const reap = () => {
      if (isAppQuitting()) return;
      void persistQuitState(
        sessionsRef.current,
        tabsRef.current,
        activeTabIdRef.current,
        projectCwdRef.current,
        readProjectReturnMemory(),
        "unload",
        projectTerminalsRef.current,
        lastDockSideRef.current ?? undefined,
        keepWorkspaceTab,
      )
        .finally(() => {
          void reapUnloadRuntime(sessionsRef.current).catch((error) =>
            console.warn("Unloading runtime failed", error),
          );
        })
        .catch((error) => console.warn("Persisting unload state failed", error));
    };
    window.addEventListener("pagehide", reap);
    window.addEventListener("beforeunload", reap);
    return () => {
      window.removeEventListener("pagehide", reap);
      window.removeEventListener("beforeunload", reap);
      stopBridge();
      harnessQueue.cancelScheduled();
    };
  }, [resumed, readProjectReturnMemory]);

  useEffect(() => {
    void probeHarnessAvailability();
    // Only the harnesses already in this window. Probing every installed CLI
    // at boot left unused agents (especially Pi) running in the background.
    const harnesses = [...new Set(sessionsRef.current.map((session) => session.harness))];
    void refreshHarnessCatalogs(harnesses).then(() => {
      setSessions((prev) =>
        prev.map((session) => {
          if (!isLiveHarness(session.harness)) return session;
          const resolved = resolveModel(session.harness, session.model);
          const modelSettings = mergeModelSettings(resolved, session.modelSettings);
          if (resolved.id === session.model && sameSettings(modelSettings, session.modelSettings)) {
            return session;
          }
          return { ...session, model: resolved.id, modelSettings };
        }),
      );
    });
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const active =
    sessions.find((session) => session.id === activeTab?.focusedId) ??
    sessions.find((session) => activeTab && leafIds(activeTab.layout).includes(session.id));
  const toolSessionId =
    active && (active.cwd.startsWith("remote://") ? remoteSessionFor(active.id) : active.id);
  const conversationTools =
    active && toolSessionId && sameProjectPath(active.cwd, projectCwd)
      ? {
          cwd: active.cwd,
          sessionId: toolSessionId,
          composerSessionId: active.id,
          title: sessionDisplayTitle(active.title, active.harness),
        }
      : undefined;
  const activeTabSessionIds = activeTab ? leafIds(activeTab.layout) : [];
  const activeLinkedWorkItemPanel = activeTab
    ? (linkedWorkItemPanels.get(activeTab.focusedId) ??
      [...linkedWorkItemPanels.values()]
        .reverse()
        .find((panel) => activeTabSessionIds.includes(panel.sessionId)) ??
      null)
    : null;

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

  useEffect(() => {
    const openSessionForAddToChat = (event: Event) => {
      const detail = (event as CustomEvent<AddToChatRequest>).detail;
      if (!detail?.text) return;

      const result = applyAddToChatRequest({
        sessions: sessionsRef.current,
        tabs: tabsRef.current,
        activeTabId: activeTabIdRef.current,
        projectCwd: projectCwdRef.current,
        fallbackCwd: sessionDefaults?.cwd,
        defaultRuntimeMode: sessionDefaults?.runtimeMode,
        text: detail.text,
        mode: detail.mode,
      });
      if (!result) return;

      sessionsRef.current = result.sessions;
      tabsRef.current = result.tabs;
      setSessions(result.sessions);
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(true);
    };

    window.addEventListener(ADD_TO_CHAT_EVENT, openSessionForAddToChat);
    return () => window.removeEventListener(ADD_TO_CHAT_EVENT, openSessionForAddToChat);
  }, [sessionDefaults?.cwd, sessionDefaults?.runtimeMode]);

  useNativeSkillWarmup(active);

  const activeFile = activeTab ? focusedFileTab(activeTab) : undefined;
  const sidebarCwd = activeFile?.projectCwd ?? activeFile?.cwd ?? active?.cwd ?? projectCwd;
  const sidebarCwdRef = useRef(sidebarCwd);
  sidebarCwdRef.current = sidebarCwd;
  const [sidebarTabSelection, setSidebarTabSelection] = useState<{
    project: string;
    tab: SidebarTabId;
  }>(() => ({
    project: pathKey(sidebarCwd),
    tab: loadProjectSidebarTab(sidebarCwd),
  }));
  const sidebarTab =
    sidebarTabSelection.project === pathKey(sidebarCwd)
      ? sidebarTabSelection.tab
      : loadProjectSidebarTab(sidebarCwd);
  const setSidebarTab = useCallback((tab: SidebarTabId, project?: string) => {
    const cwd = project ?? sidebarCwdRef.current;
    saveProjectSidebarTab(cwd, tab);
    setSidebarTabSelection({
      project: pathKey(cwd),
      tab: tab === "inbox" ? "sessions" : tab,
    });
  }, []);
  const sidebarCwdKey = sidebarCwd && sidebarCwd !== "~" ? normalizeProjectPath(sidebarCwd) : null;
  const historyFailed = sidebarCwdKey != null && historyErrorCwd === sidebarCwdKey;
  // True from the very first frame that shows a project we have never listed,
  // so the sidebar can stay blank instead of flashing "No sessions yet".
  const historyPending =
    sidebarCwdKey != null && !loadedProjects.has(sidebarCwdKey) && !historyFailed;
  const gitCwd = activeFile?.cwd ?? (active ? sessionWorkCwd(active) : sidebarCwd);
  const terminalCwd = newTerminalCwd({ activeFile, session: active, fallback: sidebarCwd });
  const gitCwdBranches = useProjectBranches(
    gitCwd,
    Boolean(gitCwd) && gitCwd !== "~" && !isRemoteProjectPath(sidebarCwd),
  );
  const explorerRootLabel =
    active?.worktreeCwd && sameProjectPath(gitCwd, sessionWorkCwd(active))
      ? active.branch || gitCwdBranches?.current || undefined
      : undefined;
  const remoteFilesProject = remoteProjectFor(sidebarCwd);
  const filesCwd = remoteFilesProject
    ? isRemoteProjectPath(gitCwd)
      ? gitCwd
      : remotePath(
          remoteFilesProject.environmentId,
          remoteTabCwd(sidebarCwd, active?.id) ??
            (gitCwd && gitCwd !== sidebarCwd ? gitCwd : remoteFilesProject.cwd),
        )
    : gitCwd;
  const gitCwdRef = useRef(filesCwd);
  gitCwdRef.current = filesCwd;
  const projectBranches = useProjectBranches(sidebarCwd, Boolean(sidebarCwd) && sidebarCwd !== "~");

  const nextBusySessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (session.busy || session.continuingElsewhere) {
        ids.add(session.id);
        if (session.orchestrationLeadId) ids.add(session.orchestrationLeadId);
      }
    }
    return ids;
  }, [sessions]);
  const busySessionIdsRef = useRef(nextBusySessionIds);
  if (!setsEqual(busySessionIdsRef.current, nextBusySessionIds)) {
    busySessionIdsRef.current = nextBusySessionIds;
  }
  const busySessionIds = busySessionIdsRef.current;

  /** Probe the active session's harness for its live model catalog whenever
   * the active harness changes. Catalogs load lazily (probing spawns a CLI
   * process) and the boot refresh runs before restored sessions land, so a
   * fresh session would otherwise show only the built-in fallback model
   * until the picker happened to be opened. Idempotent: refreshHarnessCatalogs
   * dedupes via hasLiveCatalog and its inflight map. */
  const activeHarness = active?.harness;
  useEffect(() => {
    if (!activeHarness || !isLiveHarness(activeHarness)) return;
    void refreshHarnessCatalogs([activeHarness]);
  }, [activeHarness]);

  const usageProviders = USAGE_PROVIDERS;
  const usageSession = useMemo(() => {
    if (!active) return undefined;
    return {
      id: active.id,
      harness: active.harness,
      model: active.model,
      authRequired: latestTurnNeedsHarnessLogin(active.blocks),
      providerAccountId:
        active.providerAccountId ??
        (active.blocks.some((block) => block.role === "user")
          ? DEFAULT_PROVIDER_ACCOUNT_ID
          : undefined),
    };
  }, [active?.id, active?.harness, active?.model, active?.blocks, active?.providerAccountId]);
  const activeProviderSignInRequest = useMemo(() => {
    if (
      !active ||
      !supportsHarnessLogin(active.harness) ||
      !latestTurnNeedsHarnessLogin(active.blocks)
    ) {
      return null;
    }
    if (
      supportsProviderAccounts(active.harness) &&
      !providerAccountExists(active.harness, sessionProviderAccountId(active.harness, active))
    ) {
      return null;
    }
    return {
      key: providerSignInRequestKey(active),
      sessionId: active.id,
      harness: active.harness,
      accountId: supportsProviderAccounts(active.harness)
        ? sessionProviderAccountId(active.harness, active)
        : undefined,
    };
  }, [active]);
  useEffect(() => {
    if (!activeProviderSignInRequest) return;
    if (seenProviderSignInRequests.has(activeProviderSignInRequest.key)) {
      return;
    }
    seenProviderSignInRequests.add(activeProviderSignInRequest.key);
    setProviderSignInRequest(activeProviderSignInRequest);
  }, [activeProviderSignInRequest, seenProviderSignInRequests]);
  useEffect(() => {
    if (providerSignInRequest && active?.id !== providerSignInRequest.sessionId) {
      setProviderSignInRequest(null);
    }
  }, [active?.id, providerSignInRequest]);
  const runningTerminals = useMemo(() => {
    const files: FilePaneTab[] = [];
    const dock = findProjectTerminal(projectTerminals, projectCwd);
    if (dock) files.push(...dock.pane.files);
    for (const tab of tabs) {
      for (const pane of tab.terminalPanes ?? []) {
        files.push(...pane.files);
      }
    }
    return listRunningTerminals(files);
  }, [projectCwd, projectTerminals, tabs]);
  const runningTerminalOpen = useMemo(() => {
    const ids = new Set(runningTerminals.map((terminal) => terminal.id));
    if (
      currentProjectDock?.open &&
      currentProjectDock.pane.files.some((file) => ids.has(file.id))
    ) {
      return true;
    }
    const focused = activeTab ? focusedFileTab(activeTab) : undefined;
    return !!focused && ids.has(focused.id);
  }, [activeTab, currentProjectDock, runningTerminals]);

  const nextApprovalSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (sessionNeedsInput(session)) {
        ids.add(session.id);
        if (session.orchestrationLeadId) ids.add(session.orchestrationLeadId);
      }
    }
    return ids;
  }, [sessions]);
  const approvalSessionIdsRef = useRef(nextApprovalSessionIds);
  if (!setsEqual(approvalSessionIdsRef.current, nextApprovalSessionIds)) {
    approvalSessionIdsRef.current = nextApprovalSessionIds;
  }
  const approvalSessionIds = approvalSessionIdsRef.current;

  const activeSessionId = inboxViewOpen ? inboxAskPortal?.sessionId : active?.id;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  useInputNotifications(sessions, activeSessionId);
  useAttentionNotifications(sessions, activeSessionId);
  useBackgroundNotifications(automationsViewOpen && taskBoardShown);
  useDailySummary();

  // Cache the OS decision so a turn ending later can skip a denied banner.
  useEffect(() => {
    if (loadNotificationsEnabled()) void probeNotificationPermission();
  }, []);
  const unseenFinishedIds = useUnseenFinishedSessions(sessions, busySessionIds, activeSessionId);

  // Host sessions of the rail's remote projects that no tab here has loaded:
  // they run on their machine whether or not this app looks at them.
  const remoteRailProjects = useMemo(
    () => [
      ...new Set(
        [
          ...visibleRecents.map((project) => project.path),
          ...(sessionRecovery?.workspace.sessions
            .filter((stub) => !isProjectLockedIn(lockSnapshot, stub.cwd))
            .map((stub) => stub.cwd) ?? []),
        ].filter(isRemoteProjectPath),
      ),
    ],
    [visibleRecents, sessionRecovery, lockSnapshot],
  );
  const listedRemoteSessions = useRemoteRailSessions(remoteRailProjects);
  const loadedRemoteShellIds = useMemo(
    () =>
      sessions
        .filter((session) => isRemoteProjectPath(session.cwd) && session.blocks.length > 0)
        .map((session) => session.id)
        .join("\n"),
    [sessions],
  );
  const loadedRemoteHostIds = useMemo(() => {
    const loadedHostIds = new Set<string>();
    for (const shellId of loadedRemoteShellIds.split("\n")) {
      const hostId = shellId && remoteSessionFor(shellId);
      if (hostId) loadedHostIds.add(hostId);
    }
    return loadedHostIds;
  }, [loadedRemoteShellIds]);
  const unopenedRemote = useMemo(
    () => unopenedRemoteSessions(listedRemoteSessions, loadedRemoteHostIds),
    [listedRemoteSessions, loadedRemoteHostIds],
  );
  const unopenedRemoteRef = useRef(unopenedRemote);
  unopenedRemoteRef.current = unopenedRemote;
  const [remoteUnseenFinishedIds, dismissRemoteFinished] = useRemoteUnseenFinished(
    listedRemoteSessions,
    loadedRemoteHostIds,
    activeSessionId ? remoteSessionFor(activeSessionId) : undefined,
  );

  const nextLiveAgents = useMemo(
    () => [
      ...liveAgentsFromSessions(sessions, unseenFinishedIds),
      ...remoteLiveAgents(unopenedRemote, remoteUnseenFinishedIds),
    ],
    [sessions, unseenFinishedIds, unopenedRemote, remoteUnseenFinishedIds],
  );
  const liveAgentsRef = useRef(nextLiveAgents);
  if (!liveAgentsEqual(liveAgentsRef.current, nextLiveAgents)) {
    liveAgentsRef.current = nextLiveAgents;
  }
  const ownedLiveSessionKeys = useMemo(
    () =>
      Object.fromEntries(
        sessions.map((session) => [session.id, remoteSessionFor(session.id) ?? session.id]),
      ),
    [sessions],
  );
  const windowLiveAgents = useWindowLiveAgents(liveAgentsRef.current, ownedLiveSessionKeys);
  const liveAgents = useMemo(
    () =>
      liveAgentsEnabled
        ? windowLiveAgents.filter((agent) => !isProjectLockedIn(lockSnapshot, agent.cwd))
        : [],
    [windowLiveAgents, lockSnapshot, liveAgentsEnabled],
  );

  const hiddenApprovalToasts = useMemo(
    () => hiddenApprovalNotices(sessions, activeTabId, tabs, composerFocused),
    [sessions, activeTabId, tabs, composerFocused],
  );
  const pendingNotifications = useMemo(() => pendingApprovalNotices(sessions), [sessions]);
  const [reminderNoticesHeight, setReminderNoticesHeight] = useState(0);
  const [harnessUpdateHeight, setHarnessUpdateHeight] = useState(0);

  useEffect(() => {
    syncDockBadge(sessions);
  }, [sessions]);

  useEffect(() => {
    return retainAsyncSubscription(
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        setWindowFocused(focused);
        if (focused) {
          flushHarnessEvents();
          syncDockBadge(sessionsRef.current);
          if (
            document.activeElement === document.body &&
            !projectTerminalFocusedRef.current &&
            !searchViewOpenRef.current &&
            !inboxViewOpenRef.current &&
            !notesViewOpenRef.current &&
            !automationsViewOpenRef.current &&
            !settingsOpenRef.current
          ) {
            setComposerFocused(true);
            setComposerFocusToken((token) => token + 1);
          }
        }
      }),
      (error) => console.warn("Window focus subscription failed", error),
    );
  }, [flushHarnessEvents]);

  useEffect(() => {
    const onVisible = () => {
      // Flush on hiding too: WebKit can suspend a pending animation frame,
      // leaving the last output stranded until another event or activation.
      flushHarnessEvents();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [flushHarnessEvents]);

  useLayoutEffect(() => {
    // A newly selected chat catches up before paint, even if its output was
    // waiting on the background cadence. Draft/composer input stays immediate.
    flushHarnessEvents();
  }, [
    activeTabId,
    inboxViewOpen,
    inboxAskPortal?.sessionId,
    searchViewOpen,
    notesViewOpen,
    automationsViewOpen,
    settingsOpen,
    flushHarnessEvents,
  ]);

  useEffect(() => {
    let releaseClose: (() => void) | undefined;
    const releaseQuit = setQuitWorkspace(
      () => sessionsRef.current,
      () => tabsRef.current,
      () => activeTabIdRef.current,
      () => projectCwdRef.current,
      () => projectTerminalsRef.current,
      readProjectReturnMemory,
      flushHarnessEvents,
      () => lastDockSideRef.current,
      keepWorkspaceTab,
    );
    releaseClose = retainAsyncSubscription(
      getCurrentWindow().onCloseRequested((event) => {
        // Listening here makes close our job. Letting the default path run
        // calls JS `window.destroy`, which Tauri denies without a permission.
        event.preventDefault();
        const toTray = loadCloseToTray();
        if (hasInFlightSessions(sessionsRef.current)) {
          flushHarnessEvents();
          if (!windowTransfer && !toolWindow && !toTray && !IS_MAC) {
            void closeBusyWindow().catch((error) =>
              console.warn("Closing busy window failed", error),
            );
            return;
          }
          // Not `persistQuitState`: that marks the live turns interrupted.
          void persistLiveTranscripts(sessionsRef.current).catch((error) =>
            console.warn("Persisting live transcripts failed", error),
          );
          void hideCurrentWindow().catch((error) => console.warn("Hiding window failed", error));
          return;
        }
        void persistQuitState(
          sessionsRef.current,
          tabsRef.current,
          activeTabIdRef.current,
          projectCwdRef.current,
          readProjectReturnMemory(),
          "unload",
          projectTerminalsRef.current,
          lastDockSideRef.current ?? undefined,
          keepWorkspaceTab,
        )
          .finally(() => {
            void (toTray ? hideCurrentWindow() : closeCurrentWindow()).catch((error) =>
              console.warn("Closing window failed", error),
            );
          })
          .catch((error) => console.warn("Persisting close state failed", error));
      }),
      (error) => console.warn("Window close subscription failed", error),
    );
    return () => {
      releaseQuit();
      releaseClose?.();
    };
  }, [flushHarnessEvents, readProjectReturnMemory, windowTransfer, toolWindow]);

  const refreshHistory = useCallback(async (cwd: string) => {
    if (!cwd || cwd === "~") return;
    // `history` holds every visited project's rows and the sidebar filters it
    // by cwd, so a project loaded once paints from cache on the way back and
    // revalidates quietly underneath the cards already on screen. Whether the
    // first load is still pending is derived from `loadedProjects`, not
    // tracked here — a status set from this effect lands a render too late to
    // suppress the empty state.
    const key = normalizeProjectPath(cwd);
    setHistoryErrorCwd((prev) => (prev === key ? null : prev));
    try {
      const rows = await listSessionsByProject(cwd);
      if (cwd !== sidebarCwdRef.current) return;
      setHistory((current) => replaceProjectHistory(current, cwd, rows));
      setLoadedProjects((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    } catch {
      if (cwd !== sidebarCwdRef.current) return;
      // A failed revalidate keeps the cached cards rather than replacing a
      // good list with an error.
      if (!loadedProjectsRef.current.has(key)) setHistoryErrorCwd(key);
    }
  }, []);

  useEffect(() => {
    void refreshHistory(sidebarCwd);
  }, [sidebarCwd, refreshHistory]);

  // A session another computer started in this machine's project, through
  // this machine's host, joins the list as soon as its copy is saved here.
  useEffect(() => {
    const onAdded = (event: Event) => {
      const cwd = (event as CustomEvent<string>).detail;
      if (cwd && sameProjectPath(cwd, sidebarCwdRef.current))
        void refreshHistory(sidebarCwdRef.current);
    };
    window.addEventListener(ADOPTED_SESSION_ADDED, onAdded);
    return () => window.removeEventListener(ADOPTED_SESSION_ADDED, onAdded);
  }, [refreshHistory]);

  useEffect(() => {
    if (!inboxViewOpen) return;
    let cancelled = false;
    void listLinkedSessions()
      .then((rows) => {
        if (!cancelled) setStoredLinkedSessions(rows);
      })
      .catch(() => {
        // Already-loaded and live sessions still provide a useful fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [inboxViewOpen]);

  useEffect(() => {
    prefetchProjectFiles(gitCwd);
  }, [gitCwd]);

  const persistSession = useCallback((session: Session | undefined) => {
    if (
      !session ||
      !shouldPersistSession(session) ||
      removingSessionIds.current.has(session.id) ||
      switchingWorktrees.current.has(session.id)
    )
      return;
    const fingerprint = persistFingerprint(session);
    // Leaving a session flushes it. An unchanged one would still rewrite and
    // re-diff its whole transcript under the store lock, stalling the next load.
    if (lastPersisted.current.get(session.id) === fingerprint) return;
    void upsertSession(session)
      .then((summary) => {
        if (!summary) return;
        lastPersisted.current.set(session.id, fingerprint);
        if (summary.cwd === sidebarCwdRef.current) {
          setHistory((current) => mergeProjectHistorySummary(current, summary));
        }
      })
      .catch((error) => {
        console.warn("App operation failed", error);
      });
  }, []);

  useEffect(() => {
    const liveIds = new Set(sessions.map((session) => session.id));
    const visibleIds = openSessionIds(tabsRef.current);
    for (const session of sessions) {
      if (removingSessionIds.current.has(session.id) || switchingWorktrees.current.has(session.id))
        continue;
      if (observedSessions.current.get(session.id) === session) continue;
      observedSessions.current.set(session.id, session);
      const parked = !visibleIds.has(session.id);
      const newlyBound =
        !!session.providerSessionId &&
        lastBoundProvider.current.get(session.id) !== session.providerSessionId;
      const lastUserId = lastUserBlockId(session);
      const newUserTurn =
        !!lastUserId && lastPersistedUserBlock.current.get(session.id) !== lastUserId;
      if (newlyBound && session.providerSessionId) {
        lastBoundProvider.current.set(session.id, session.providerSessionId);
      }
      if (newUserTurn && lastUserId) {
        lastPersistedUserBlock.current.set(session.id, lastUserId);
      }
      if ((!session.busy || newlyBound || newUserTurn) && shouldPersistSession(session)) {
        persistSession(session);
      }
      if (
        shouldPersistSession(session) &&
        (!session.busy ||
          parked ||
          newlyBound ||
          newUserTurn ||
          !lastPersisted.current.has(session.id))
      ) {
        pendingPersist.current.set(session.id, session);
      }
    }
    for (const sessionId of observedSessions.current.keys()) {
      if (liveIds.has(sessionId)) continue;
      observedSessions.current.delete(sessionId);
      pendingPersist.current.delete(sessionId);
    }
    if (pendingPersist.current.size === 0) return;

    const timer = window.setTimeout(() => {
      const dirty = takePendingSessionWrites(pendingPersist.current, sessionsRef.current);
      void Promise.all(
        dirty.map(async (session) => {
          if (
            removingSessionIds.current.has(session.id) ||
            switchingWorktrees.current.has(session.id)
          )
            return;
          const fingerprint = persistFingerprint(session);
          if (lastPersisted.current.get(session.id) === fingerprint) return;
          const summary = await upsertSession(session).catch(() => null);
          if (!summary) return;
          lastPersisted.current.set(session.id, fingerprint);
          if (summary.cwd === sidebarCwdRef.current) {
            setHistory((current) => mergeProjectHistorySummary(current, summary));
          }
        }),
      );
    }, 650);
    return () => window.clearTimeout(timer);
  }, [persistSession, sessions]);

  // Keep running transcripts durable even without a host. The shell skips
  // text-only frames, so its delayed snapshots cannot protect live replies.
  useEffect(() => {
    const timer = window.setInterval(() => {
      for (const session of sessionsRef.current) {
        if (
          !session.busy ||
          !shouldPersistSession(session) ||
          removingSessionIds.current.has(session.id) ||
          switchingWorktrees.current.has(session.id)
        )
          continue;
        const fingerprint = persistFingerprint(session);
        if (lastPersisted.current.get(session.id) === fingerprint) continue;
        // The fingerprint is recorded when the write starts: a snapshot that
        // is replaced while queued behind a slow write never claims to be saved.
        void upsertSessionLive(session, {
          shouldWrite: () =>
            !removingSessionIds.current.has(session.id) &&
            !switchingWorktrees.current.has(session.id),
          onStart: () => lastPersisted.current.set(session.id, fingerprint),
          onFailed: () => {
            if (lastPersisted.current.get(session.id) === fingerprint) {
              lastPersisted.current.delete(session.id);
            }
          },
        });
      }
    }, LIVE_PERSIST_MS);
    return () => window.clearInterval(timer);
  }, [localHostReachable]);

  useEffect(() => {
    const refs = inFlightRefs(sessions, tabs);
    if (refs.length > 0) sawInFlight.current = true;
    const key = inFlightSnapshotKey(refs);
    if (!shouldWriteInFlightSnapshot(key, refs, inFlightSyncKey.current, sawInFlight.current)) {
      return;
    }
    inFlightSyncKey.current = key;
    void replaceInFlightSessions(refs).catch((error) => {
      console.warn("App operation failed", error);
    });
  }, [sessions, tabs]);

  useEffect(() => {
    if (windowTransfer || toolWindow) return;
    const snapshot = collectWorkspaceSnapshot(
      tabs,
      sessions,
      activeTabId,
      projectCwd,
      reconcileProjectReturn({
        memory: projectReturnRef.current,
        tabs,
        sessions,
        activeTabId,
      }),
      projectTerminals,
      lastDockSide ?? undefined,
      keepWorkspaceTab,
    );
    const key = workspaceSnapshotKey(snapshot);
    if (workspaceSyncKey.current === key) return;
    const timer = window.setTimeout(() => {
      workspaceSyncKey.current = key;
      void saveWorkspaceSnapshot(snapshot).catch(() => {
        if (workspaceSyncKey.current === key) workspaceSyncKey.current = null;
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    tabs,
    sessions,
    activeTabId,
    projectCwd,
    projectTerminals,
    lastDockSide,
    windowTransfer,
    toolWindow,
    keepWorkspaceTab,
    projectWorktree?.path,
    workspaceNavigation.revision,
    remoteBindingRevision,
  ]);

  useEffect(() => {
    if (lastProjectPath()) return;
    void invoke<string>("default_cwd")
      .then((cwd) => {
        if (!looksLikeProject(cwd)) return;
        setProjectCwd(cwd);
        setRecents((prev) => (prev.length > 0 ? prev : rememberProject(cwd)));
        setSessions((prev) => prev.map((s) => (s.cwd === "~" ? { ...s, cwd } : s)));
      })
      .catch((error) => {
        console.warn("App operation failed", error);
      });
  }, []);

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

  // The title tabs, explorer, changes and session list all follow
  // `projectCwd`, so anything that reveals a tab from another project has to
  // move it along with the active tab.
  const followProject = useCallback((cwd: string | null | undefined) => {
    if (!cwd || !looksLikeProject(cwd)) return;
    const normalized = normalizeProjectPath(cwd);
    if (sameProjectPath(normalized, projectCwdRef.current)) return;
    setProjectCwd(normalized);
    setRecents(rememberProject(normalized));
  }, []);

  const activateTab = useCallback(
    (id: string, paneId?: string, reason: "session" | "workspace" = "session") => {
      const tab = tabsRef.current.find((entry) => entry.id === id);
      const nextFocusedId =
        tab &&
        paneId &&
        (leafIds(tab.layout).includes(paneId) ||
          tab.editorPanes.some((entry) => entry.id === paneId) ||
          (tab.terminalPanes ?? []).some((entry) => entry.id === paneId))
          ? paneId
          : tab?.focusedId;

      if (reason === "workspace") setActiveTabIdState(id);
      else setActiveTabId(id);
      if (tab && nextFocusedId) {
        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  layout: selectPaneTab(entry.layout, nextFocusedId),
                  focusedId: nextFocusedId,
                  diffFocused: false,
                }
              : entry,
          ),
        );
      }

      if (tab) {
        const focusedTab = nextFocusedId
          ? { ...tab, layout: selectPaneTab(tab.layout, nextFocusedId), focusedId: nextFocusedId }
          : tab;
        followProject(focusedWorkspaceTabCwd(focusedTab, sessionsRef.current));
      }
      setComposerFocused(
        !!nextFocusedId && sessionsRef.current.some((session) => session.id === nextFocusedId),
      );
    },
    [followProject, setActiveTabId],
  );

  const commitTabVisit = useCallback((history: TabVisitHistory) => {
    tabVisitRef.current = history;
    const canBack = canTabVisitBack(history);
    const canForward = canTabVisitForward(history);
    setTabVisitNav((prev) =>
      prev.canBack === canBack && prev.canForward === canForward ? prev : { canBack, canForward },
    );
  }, []);

  useEffect(() => {
    const openIds = new Set(tabs.map((tab) => tab.id));
    let next = pruneTabVisitHistory(tabVisitRef.current, openIds, activeTabId);
    if (tabVisitFromHistoryRef.current) {
      tabVisitFromHistoryRef.current = false;
    } else if (next.current !== activeTabId) {
      next = recordTabVisit(next, activeTabId);
    }
    commitTabVisit(pruneTabVisitHistory(next, openIds, activeTabId));
  }, [activeTabId, commitTabVisit, tabs]);

  /** `cwd` scopes group inheritance: a tab from another project starts alone. */
  const insertBeside = useCallback(
    (prev: WorkspaceTab[], tab: WorkspaceTab, anchorId: string | undefined, cwd?: string) =>
      insertTabBesideActive(prev, tab, anchorId, (id) =>
        id === tab.id ? (cwd ? projectName(cwd) : undefined) : projectOfTab(id),
      ),
    [projectOfTab],
  );

  const insertBesideActive = useCallback(
    (prev: WorkspaceTab[], tab: WorkspaceTab, cwd?: string) =>
      insertBeside(prev, tab, activeTabIdRef.current, cwd),
    [insertBeside],
  );

  const appendTab = useCallback(
    (tab: WorkspaceTab, cwd?: string) => {
      setTabs((prev) => insertBesideActive(prev, tab, cwd));
    },
    [insertBesideActive],
  );

  const onOpenWhatsNew = useCallback((version: string) => {
    setWhatsNewVersion(version.trim());
  }, []);

  const createWorkspaceTab = useCallback(
    (cwd: string, focus?: WorktreeFocus) => {
      const session = newWorkspaceSession(cwd, sessionDefaults?.runtimeMode, focus);
      const tab = newTab(session.id);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, cwd);
      return tab.id;
    },
    [appendTab, sessionDefaults?.runtimeMode],
  );

  const onNewSession = useCallback(
    (sourceSessionId?: string) => {
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      const source = sourceSessionId
        ? sessionsRef.current.find((session) => session.id === sourceSessionId)
        : undefined;
      const cwd = source?.cwd ?? sidebarCwd;
      const focus = worktreeFocus(cwd);
      const session = newWorkspaceSession(cwd, sessionDefaults?.runtimeMode, focus);
      const tab = newTab(session.id);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, cwd);
      setActiveTabId(tab.id);
      setComposerFocused(true);
      return session.id;
    },
    [appendTab, sessionDefaults?.runtimeMode, sidebarCwd],
  );

  const onNew = useCallback(() => onNewSession(), [onNewSession]);

  const onSelectRemoteSession = useCallback(
    (project: string, remoteSessionId: string) => {
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      workspaceNavigation.cancel();
      const existing = findRemoteSessionTab(
        tabsRef.current,
        sessionsRef.current,
        project,
        remoteSessionId,
        remoteSessionFor,
      );
      if (existing) {
        activateTab(existing.tab.id, existing.shellId);
        return;
      }
      // Reserve a dedicated tab immediately. An apparently blank remote tab
      // may hold composer text or a create/upload that the host has not accepted.
      const session = newDefaultSession(project, sessionDefaults?.runtimeMode);
      const tab = newTab(session.id);
      rememberRemoteSession(session.id, remoteSessionId);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, project);
      setActiveTabId(tab.id);
      followProject(project);
    },
    [
      activateTab,
      appendTab,
      followProject,
      sessionDefaults?.runtimeMode,
      setActiveTabId,
      workspaceNavigation.cancel,
    ],
  );

  const onStartInboxItem = useCallback(
    async (item: InboxItem, body?: string) => {
      const start = (description?: string) => {
        setInboxViewOpen(false);
        setNotesViewOpen(false);
        setAutomationsViewOpen(false);
        const cwd = item.projectPath || active?.cwd || sessionDefaults?.cwd || projectCwd;
        setSidebarTab("sessions", cwd);
        const ref =
          item.provider === "linear" || item.provider === "jira"
            ? item.identifier?.trim() || `#${item.number}`
            : `#${item.number}`;
        const linkedWorkItem = linkedWorkItemFromInboxItem(item);
        const session = {
          ...newDefaultSession(cwd, sessionDefaults?.runtimeMode),
          title: `${ref} ${item.title}`,
          inboxCard: inboxComposerCard(item, description),
          ...(linkedWorkItem ? { linkedWorkItem } : {}),
        };
        const tab = newTab(session.id);
        setSessions((prev) => [...prev, session]);
        appendTab(tab, cwd);
        setActiveTabId(tab.id);
        setComposerFocused(true);
      };

      start(await inboxTrackerDescription(item, body));
    },
    [active?.cwd, appendTab, sessionDefaults?.cwd, sessionDefaults?.runtimeMode, projectCwd],
  );

  const onAddNoteToChat = useCallback(
    (card: NoteComposerCard) => {
      if (!card.id) return;
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      const cwd =
        (card.sourceCwd && looksLikeProject(card.sourceCwd) ? card.sourceCwd : undefined) ||
        active?.cwd ||
        sessionDefaults?.cwd ||
        projectCwd;
      setSidebarTab("sessions", cwd);
      const title = card.title.trim();
      const session = {
        ...newDefaultSession(cwd, sessionDefaults?.runtimeMode),
        ...(title ? { title } : {}),
        noteCard: card,
      };
      const tab = newTab(session.id);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, cwd);
      setActiveTabId(tab.id);
      setComposerFocused(true);
    },
    [active?.cwd, appendTab, sessionDefaults?.cwd, sessionDefaults?.runtimeMode, projectCwd],
  );

  useEffect(() => {
    const onAdd = (event: Event) => {
      const card = (event as CustomEvent<NoteComposerCard>).detail;
      if (!card?.id) return;
      onAddNoteToChat(card);
    };
    window.addEventListener(ADD_NOTE_TO_CHAT_EVENT, onAdd);
    return () => window.removeEventListener(ADD_NOTE_TO_CHAT_EVENT, onAdd);
  }, [onAddNoteToChat]);

  const onInboxCardDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.inboxCard
          ? { ...session, inboxCard: undefined }
          : session,
      ),
    );
  }, []);

  const setLinkedWorkItemUpdateCard = useCallback(
    (
      sessionId: string,
      update: (card: LinkedWorkItemUpdateCard | undefined) => LinkedWorkItemUpdateCard | undefined,
    ) => {
      const previous = sessionsRef.current;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        const card = update(session.linkedWorkItemUpdateCard);
        return card === session.linkedWorkItemUpdateCard
          ? session
          : { ...session, linkedWorkItemUpdateCard: card };
      });
      if (!next.some((session, index) => session !== previous[index])) return;
      sessionsRef.current = next;
      setSessions(next);
    },
    [],
  );

  const onLinkedWorkItemUpdateCardDismiss = useCallback(
    (sessionId: string) => {
      setLinkedWorkItemUpdateCard(sessionId, () => undefined);
    },
    [setLinkedWorkItemUpdateCard],
  );

  const onNoteCardDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.noteCard
          ? { ...session, noteCard: undefined }
          : session,
      ),
    );
  }, []);

  const onHandoffCardDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.handoffCard
          ? { ...session, handoffCard: undefined }
          : session,
      ),
    );
  }, []);

  const onSplit = useCallback(
    (dir: SplitDir) => {
      if (!activeTab) return;
      if (windowTransferPendingRef.current || movingTabIds.current.has(activeTab.id)) return;
      setMaximizedPane(null);
      const focus = worktreeFocus(sidebarCwd);
      const session = newWorkspaceSession(sidebarCwd, sessionDefaults?.runtimeMode, focus);
      setSessions((prev) => [...prev, session]);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTab.id) return t;
          return {
            ...t,
            layout: splitPane(t.layout, t.focusedId, dir, session.id),
            focusedId: session.id,
          };
        }),
      );
      setComposerFocused(true);
    },
    [activeTab, sidebarCwd, sessionDefaults?.runtimeMode],
  );

  const activeTabLayoutPreset = useMemo(
    () => (activeTab ? detectLayoutPreset(activeTab.layout) : null),
    [activeTab],
  );
  const canArrangeActiveTab = activeTab ? layoutLeaves(activeTab.layout).length >= 2 : false;

  /** Rearranges every pane of the active tab (chats, files, terminals alike). */
  const onArrangeActiveTab = useCallback(
    (preset: LayoutPreset) => {
      if (!activeTab) return;
      if (windowTransferPendingRef.current || movingTabIds.current.has(activeTab.id)) return;
      setMaximizedPane(null);
      const current = tabsRef.current.find((tab) => tab.id === activeTab.id);
      if (!current) return;
      const emptySessions =
        layoutLeaves(current.layout).length === 1
          ? Array.from({ length: suggestedPaneCount(preset) - 1 }, () =>
              newWorkspaceSession(sidebarCwd, sessionDefaults?.runtimeMode, worktreeFocus(sidebarCwd)),
            )
          : [];
      const next = tabsRef.current.map((tab) =>
        tab.id === current.id
          ? {
              ...tab,
              layout: arrangeSuggestedLayout(
                tab.layout,
                preset,
                emptySessions.map((session) => session.id),
                tab.focusedId,
              ),
            }
          : tab,
      );
      if (emptySessions.length) {
        sessionsRef.current = [...sessionsRef.current, ...emptySessions];
        setSessions(sessionsRef.current);
      }
      tabsRef.current = next;
      setTabs(next);
    },
    [activeTab, sidebarCwd, sessionDefaults?.runtimeMode],
  );

  const focusProjectTerminal = useCallback(() => {
    setProjectTerminalFocused(true);
    setComposerFocused(false);
  }, []);

  const openProjectTerminal = useCallback(
    (cwd: string, profile?: string) => {
      const workdir = cwd || projectCwdRef.current;
      const projectPath = projectCwdRef.current;
      if (!isLocalProject(projectPath)) return false;
      // Chosen once, so the terminal keeps its shell when the default changes.
      const shellProfile = profile ?? loadTerminalProfile();
      setProjectTerminals((prev) => {
        const existing = findProjectTerminal(prev, projectPath);
        const file = newTerminalFile(
          workdir,
          existing ? nextDockTerminalTitle(existing, workdir) : undefined,
          projectPath,
          shellProfile,
        );
        if (!existing) {
          return [
            ...prev,
            createProjectTerminal(projectPath, file, lastDockSideRef.current ?? "bottom"),
          ];
        }
        return mapProjectTerminal(prev, projectPath, (dock) => addTerminalToDock(dock, file));
      });
      focusProjectTerminal();
      return true;
    },
    [focusProjectTerminal],
  );

  const onOpenTerminal = useCallback(
    (cwd: string, asWorkspaceTab = false, occupySessionId?: string, profile?: string) => {
      const workdir = cwd || terminalCwd;
      if (!isLocalProject(projectCwdRef.current) || !isLocalProject(workdir)) return;
      if (openProjectTerminal(workdir, profile)) return;
      const shellProfile = profile ?? loadTerminalProfile();

      if (asWorkspaceTab || !activeTab) {
        const file = newTerminalFile(workdir, undefined, sidebarCwd, shellProfile);
        const tab = newTerminalWorkspaceTab(file);
        appendTab(tab, sidebarCwd);
        setActiveTabId(tab.id);
        setComposerFocused(false);
        return;
      }

      const occupying = sessionsRef.current.find(
        (session) => session.id === (occupySessionId ?? activeTab.focusedId),
      );
      const occupyPaneId = occupying && isBlankSession(occupying) ? occupying.id : undefined;
      if (occupyPaneId && occupying) {
        lastPersisted.current.delete(occupyPaneId);
        void forgetHarnessSession(occupying.harness, occupyPaneId);
        setSessions((prev) => prev.filter((session) => session.id !== occupyPaneId));
      }

      const file = newTerminalFile(
        workdir,
        nextTerminalTitle(activeTab, workdir),
        sidebarCwd,
        shellProfile,
      );
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab.id ? openTerminalTab(tab, file, occupyPaneId) : tab,
        ),
      );
      setComposerFocused(false);
    },
    [terminalCwd, activeTab, appendTab, openProjectTerminal, sidebarCwd],
  );

  const onNewTerminal = useCallback(() => {
    onOpenTerminal(terminalCwd);
  }, [terminalCwd, onOpenTerminal]);

  /** A terminal in a shell other than the default, picked from the profile menu. */
  const onNewTerminalWithProfile = useCallback(
    (profile: string) => {
      onOpenTerminal(terminalCwd, false, undefined, profile);
    },
    [terminalCwd, onOpenTerminal],
  );

  const onSplitProjectTerminal = useCallback(
    (fileId: string) => {
      const projectPath = projectCwdRef.current;
      if (!isLocalProject(projectPath)) return;
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectPath, (dock) => {
          const source = dock.pane.files.find((file) => file.id === fileId);
          if (!source) return dock;
          const file = newTerminalFile(
            source.cwd,
            nextDockTerminalTitle(dock, source.cwd),
            projectPath,
            source.shellProfile,
          );
          return splitTerminalInDock(dock, fileId, file);
        }),
      );
      focusProjectTerminal();
    },
    [focusProjectTerminal],
  );

  const onShowProjectTerminal = useCallback(() => {
    const dock = findProjectTerminal(projectTerminalsRef.current, projectCwd);
    if (dock && dock.pane.files.length > 0) {
      if (!dock.open) {
        setProjectTerminals((prev) =>
          mapProjectTerminal(prev, projectCwd, (entry) => withDockOpen(entry, true)),
        );
      }
      focusProjectTerminal();
      return;
    }
    onOpenTerminal(terminalCwd);
  }, [terminalCwd, focusProjectTerminal, onOpenTerminal, projectCwd]);

  const onNewTerminalInSession = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (session?.worktreeRemoved) return;
      onOpenTerminal(session ? sessionWorkCwd(session) : projectCwd, false, sessionId);
    },
    [onOpenTerminal, projectCwd],
  );

  const onRunSessionProjectAction = useCallback(
    (sessionId: string, action: ProjectAction) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (!session || session.worktreeRemoved) return;
      const cwd = sessionWorkCwd(session);
      if (!isLocalProject(cwd)) return;
      const file = newTerminalFile(cwd, action.name, session.cwd, loadTerminalProfile());
      queueTerminalCommand(file.id, action.command);
      const tab = newTerminalWorkspaceTab(file);
      appendTab(tab, session.cwd);
      setActiveTabId(tab.id);
      setComposerFocused(false);
    },
    [appendTab],
  );

  const onToggleProjectTerminal = useCallback(() => {
    if (!isLocalProject(projectCwd)) return;
    const dock = findProjectTerminal(projectTerminalsRef.current, projectCwd);
    if (!dock) {
      openProjectTerminal(terminalCwd);
      return;
    }
    const nextOpen = !dock.open;
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwd, (entry) => withDockOpen(entry, nextOpen)),
    );
    if (nextOpen) focusProjectTerminal();
    else setProjectTerminalFocused(false);
  }, [terminalCwd, focusProjectTerminal, openProjectTerminal, projectCwd]);

  const onHideProjectTerminal = useCallback(() => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) => withDockOpen(dock, false)),
    );
    setProjectTerminalFocused(false);
  }, []);

  const onProjectTerminalSide = useCallback((side: DockSide) => {
    setLastDockSide(side);
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        withDockSide(dock, side, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      ),
    );
  }, []);

  const onProjectTerminalSize = useCallback((size: number) => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        withDockSize(dock, size, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      ),
    );
  }, []);

  const onSelectProjectTerminal = useCallback(
    (fileId: string) => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectCwdRef.current, (dock) => selectDockTerminal(dock, fileId)),
      );
      focusProjectTerminal();
    },
    [focusProjectTerminal],
  );

  const onReorderProjectTerminals = useCallback((ids: string[]) => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        reorderDockTerminals(dock, orderByIds(dock.pane.files, ids)),
      ),
    );
  }, []);

  const onCloseProjectTerminal = useCallback((fileId: string) => {
    const dock = findProjectTerminal(projectTerminalsRef.current, projectCwdRef.current);
    const file = dock?.pane.files.find((entry) => entry.id === fileId);
    if (!file) return;
    const finishClose = () => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectCwdRef.current, (entry) =>
          closeTerminalInDock(entry, fileId),
        ),
      );
    };
    void confirmCloseTerminal(file).then((ok) => ok && finishClose());
  }, []);

  const onCloseOtherProjectTerminals = useCallback((fileId: string) => {
    const projectPath = projectCwdRef.current;
    const dock = findProjectTerminal(projectTerminalsRef.current, projectPath);
    if (!dock?.pane.files.some((file) => file.id === fileId)) return;
    const closingFiles = dock.pane.files.filter((file) => file.id !== fileId);
    if (closingFiles.length === 0) return;
    const closingIds = new Set(closingFiles.map((file) => file.id));

    const finishClose = () => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectPath, (entry) => {
          if (!entry.pane.files.some((file) => file.id === fileId)) {
            return entry;
          }
          const files = entry.pane.files.filter((file) => !closingIds.has(file.id));
          return {
            ...entry,
            pane: { ...entry.pane, files, activeFileId: fileId },
          };
        }),
      );
    };

    void confirmCloseTerminals(closingFiles).then((ok) => ok && finishClose());
  }, []);

  const onTerminalMetaChange = useCallback((fileId: string, patch: TerminalMetaPatch) => {
    setProjectTerminals((prev) => patchProjectTerminals(prev, fileId, patch));
    setTabs((prev) => prev.map((tab) => updateTerminalTab(tab, fileId, patch)));
  }, []);

  const onToggleRunningTerminal = useCallback(
    (fileId: string) => {
      const dock = projectTerminalsRef.current.find((entry) =>
        entry.pane.files.some((file) => file.id === fileId),
      );
      if (dock) {
        if (dock.open) {
          setProjectTerminals((prev) =>
            mapProjectTerminal(prev, dock.projectPath, (entry) => withDockOpen(entry, false)),
          );
          setProjectTerminalFocused(false);
          return;
        }
        setProjectTerminals((prev) =>
          mapProjectTerminal(prev, dock.projectPath, (entry) =>
            withDockOpen(selectDockTerminal(entry, fileId), true),
          ),
        );
        focusProjectTerminal();
        return;
      }
      for (const tab of tabsRef.current) {
        for (const pane of tab.terminalPanes ?? []) {
          if (!pane.files.some((file) => file.id === fileId)) continue;
          const showing =
            activeTabIdRef.current === tab.id &&
            tab.focusedId === pane.id &&
            pane.activeFileId === fileId;
          if (showing) {
            setComposerFocused(true);
            setProjectTerminalFocused(false);
            return;
          }
          setActiveTabId(tab.id);
          setTabs((prev) =>
            prev.map((entry) => {
              if (entry.id !== tab.id) return entry;
              return withSurfacePanes(
                { ...entry, focusedId: pane.id },
                "terminal",
                (entry.terminalPanes ?? []).map((item) =>
                  item.id === pane.id ? { ...item, activeFileId: fileId } : item,
                ),
              );
            }),
          );
          setProjectTerminalFocused(false);
          setComposerFocused(false);
          return;
        }
      }
    },
    [focusProjectTerminal],
  );

  const onNewTerminalTab = useCallback(() => {
    onOpenTerminal(terminalCwd, true);
  }, [terminalCwd, onOpenTerminal]);

  const onCloseTab = useCallback(
    (id: string, opts?: { confirmedTerminalIds?: string[] }) => {
      if (windowTransferPendingRef.current || movingTabIds.current.has(id)) return;
      const current = tabsRef.current;
      const index = current.findIndex((t) => t.id === id);
      if (index < 0) return;
      const closePlan = planWorkspaceTabClose({
        tabs: current,
        sessions: sessionsRef.current,
        closingTabId: id,
        scope: tabCloseScope,
        worktreeOf: tabWorktreeOf,
      });
      if (closePlan.action === "keep") return;
      const closing = current[index];
      const closingFiles = [
        ...closing.editorPanes.flatMap((pane) => pane.files),
        ...(closing.terminalPanes ?? []).flatMap((pane) => pane.files),
      ];
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );
      const confirmed = new Set(opts?.confirmedTerminalIds ?? []);
      const terminals = closingFiles.filter((file) => file.terminal && !confirmed.has(file.id));

      const finishClose = () => {
        if (windowTransferPendingRef.current || movingTabIds.current.has(id)) return;
        const nextActiveTabId = closePlan.nextActiveTabId;
        const next = current.filter((t) => t.id !== id);
        const gone = new Set(
          leafIds(closing.layout).filter((paneId) =>
            sessionsRef.current.some((session) => session.id === paneId),
          ),
        );
        for (const sessionId of gone) {
          persistSession(sessionsRef.current.find((s) => s.id === sessionId));
          rememberRemoteSession(sessionId);
          rememberRemotePendingWorktree(sessionId);
        }
        setDirtyFiles((prev) => {
          const updated = new Set(prev);
          for (const file of closingFiles) updated.delete(file.id);
          return updated;
        });
        setTabs(next);
        if (id === activeTabIdRef.current && nextActiveTabId) {
          activateTab(nextActiveTabId);
        }
        void refreshHistory(sidebarCwd);
      };

      void (async () => {
        if (
          !(await confirmWorkspaceClose(
            unsaved.length > 0
              ? () => confirmDiscardUnsaved("Close this tab with unsaved files?")
              : undefined,
            terminals.length > 0 ? () => confirmCloseTerminals(terminals) : undefined,
          ))
        )
          return;
        finishClose();
      })();
    },
    [activateTab, persistSession, refreshHistory, sidebarCwd, tabCloseScope],
  );

  const onCloseTabs = useCallback(
    (ids: string[], fallbackId: string, opts?: { confirmed?: boolean }) => {
      if (windowTransferPendingRef.current || ids.some((id) => movingTabIds.current.has(id)))
        return;
      const current = tabsRef.current;
      const closingIds = new Set(ids);
      const closing = current.filter((tab) => closingIds.has(tab.id));
      const fallback = current.find((tab) => tab.id === fallbackId && !closingIds.has(tab.id));
      if (!fallback || closing.length === 0) return;

      const closingFiles = closing.flatMap((tab) => [
        ...tab.editorPanes.flatMap((pane) => pane.files),
        ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
      ]);
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );
      const terminals = closingFiles.filter((file) => file.terminal);

      const finishClose = () => {
        if (
          windowTransferPendingRef.current ||
          closing.some((tab) => movingTabIds.current.has(tab.id))
        )
          return;
        const sessionIds = new Set(
          closing.flatMap((tab) =>
            leafIds(tab.layout).filter((paneId) =>
              sessionsRef.current.some((session) => session.id === paneId),
            ),
          ),
        );
        for (const sessionId of sessionIds) {
          persistSession(sessionsRef.current.find((session) => session.id === sessionId));
          rememberRemoteSession(sessionId);
          rememberRemotePendingWorktree(sessionId);
        }
        setDirtyFiles((prev) => {
          const next = new Set(prev);
          for (const file of closingFiles) next.delete(file.id);
          return next;
        });
        setTabs((prev) => prev.filter((tab) => !closingIds.has(tab.id)));
        if (closingIds.has(activeTabIdRef.current)) activateTab(fallback.id);
        void refreshHistory(sidebarCwd);
      };

      // The caller already confirmed unsaved files and terminals.
      if (opts?.confirmed) {
        finishClose();
        return;
      }

      void (async () => {
        if (
          !(await confirmWorkspaceClose(
            unsaved.length > 0
              ? () => confirmDiscardUnsaved("Close these tabs with unsaved files?")
              : undefined,
            terminals.length > 0 ? () => confirmCloseTerminals(terminals) : undefined,
          ))
        )
          return;
        finishClose();
      })();
    },
    [activateTab, persistSession, refreshHistory, sidebarCwd],
  );

  const onCloseOtherTabs = useCallback(() => {
    const current = tabsRef.current;
    const activeId = activeTabIdRef.current;
    if (!current.some((tab) => tab.id === activeId)) return;
    onCloseTabs(
      current.filter((tab) => tab.id !== activeId).map((tab) => tab.id),
      activeId,
    );
  }, [onCloseTabs]);

  const onCloseFile = useCallback(
    (paneId: string, fileId: string, opts?: { skipConfirm?: boolean }) => {
      if (isMovingPane(paneId)) return;
      const tab = tabsRef.current.find((entry) => findSurfacePane(entry, paneId));
      if (!tab) return;
      const found = findSurfacePane(tab, paneId);
      if (!found) return;
      const { kind, pane } = found;
      const index = pane.files.findIndex((file) => file.id === fileId);
      if (index < 0) return;
      const file = pane.files[index];
      const needsUnsavedConfirm =
        !opts?.skipConfirm && isFilesystemTab(file) && dirtyFilesRef.current.has(fileId);

      const finishClose = () => {
        const files = pane.files.filter((entry) => entry.id !== fileId);
        let nextFocus = tab.focusedId;
        let nextLayout = tab.layout;
        let nextPanes = surfacePanes(tab, kind);
        if (files.length > 0) {
          nextFocus = paneId;
          const activeFileId =
            pane.activeFileId === fileId
              ? files[Math.min(index, files.length - 1)].id
              : pane.activeFileId;
          nextPanes = nextPanes.map((entry) =>
            entry.id === paneId ? { ...entry, files, activeFileId } : entry,
          );
        } else {
          const sibling = siblingLeafId(tab.layout, paneId);
          const withoutPane = removePane(tab.layout, paneId);
          if (!withoutPane) {
            setDirtyFiles((prev) => {
              const next = new Set(prev);
              next.delete(fileId);
              return next;
            });
            const closePlan = planWorkspaceTabClose({
              tabs: tabsRef.current,
              sessions: sessionsRef.current,
              closingTabId: tab.id,
              scope: tabCloseScope,
              worktreeOf: tabWorktreeOf,
            });
            if (closePlan.action === "close") {
              onCloseTab(tab.id, file.terminal ? { confirmedTerminalIds: [fileId] } : undefined);
              return;
            }
            const seed = sessionsRef.current[0];
            const session = newSession(
              seed?.harness ?? "claude",
              file.cwd || projectCwd,
              seed?.model,
              seed?.runtimeMode,
              seed?.modelSettings,
            );
            setSessions((prev) => [...prev, session]);
            setTabs((prev) =>
              prev.map((entry) =>
                entry.id === tab.id
                  ? {
                      ...entry,
                      layout: leaf(session.id),
                      focusedId: session.id,
                      editorPanes: [],
                      terminalPanes: [],
                      diffOpen: false,
                      diffFocused: false,
                    }
                  : entry,
              ),
            );
            setComposerFocused(true);
            return;
          }
          nextLayout = withoutPane;
          nextFocus =
            tab.focusedId === paneId ? (sibling ?? firstLeafId(withoutPane)) : tab.focusedId;
          nextPanes = nextPanes.filter((entry) => entry.id !== paneId);
        }

        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === tab.id
              ? withSurfacePanes(
                  {
                    ...entry,
                    layout: nextLayout,
                    focusedId: nextFocus,
                  },
                  kind,
                  nextPanes,
                )
              : entry,
          ),
        );
        setDirtyFiles((prev) => {
          const next = new Set(prev);
          next.delete(fileId);
          return next;
        });
        if (tab.id === activeTabId && files.length === 0) {
          setComposerFocused(sessionsRef.current.some((session) => session.id === nextFocus));
        }
      };

      void (async () => {
        if (
          !(await confirmWorkspaceClose(
            needsUnsavedConfirm
              ? () => confirmDiscardUnsaved(`Close ${basename(file.path)} without saving?`)
              : undefined,
            file.terminal && !opts?.skipConfirm ? () => confirmCloseTerminal(file) : undefined,
          ))
        )
          return;
        finishClose();
      })();
    },
    [activeTabId, onCloseTab, projectCwd, tabCloseScope],
  );

  const [movingWindows, setMovingWindows] = useState<Set<string>>(new Set());
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
  const [pendingWindowMoves, setPendingWindowMoves] = useState<PendingWindowMoves>({});

  useEffect(() => {
    // Scope this listener to the receiving webview; a global listener would
    // let every open window consume the same move notification.
    let disposed = false;
    const receiving = new Set<string>();
    const listening = getCurrentWebviewWindow().listen<string>(
      "window_transfer_available",
      async ({ payload: transferId }) => {
        if (disposed || receiving.has(transferId)) return;
        receiving.add(transferId);
        let rollback: (() => void) | undefined;
        let incomingTabIds: string[] = [];
        let incomingSessionIds = new Set<string>();
        try {
          const raw = await invoke<string | null>("take_window_transfer", {
            transferId,
          });
          if (!raw) return;
          if (disposed) throw new Error("The destination window is no longer ready.");
          const incoming = parseWindowTransfer(raw);
          const dropPoint = incoming.dropPoint ? windowDropPointToClient(incoming.dropPoint) : null;
          const paneTarget = dropPoint ? paneDropFromPoint(dropPoint.x, dropPoint.y) : null;
          const titleTarget = dropPoint ? titleTabDropFromPoint(dropPoint.x, dropPoint.y) : null;
          if (paneTarget?.invalid && !titleTarget)
            throw new Error("This panel is not ready to receive a transfer.");
          if (incoming.dropPoint && !paneTarget && !titleTarget)
            throw new Error("Drop the tab on a tab group or a panel to place it in this window.");
          if (
            paneTarget &&
            !titleTarget &&
            tabsRef.current.some(
              (tab) =>
                movingTabIds.current.has(tab.id) && leafIds(tab.layout).includes(paneTarget.id),
            )
          )
            throw new Error(
              "This panel is moving to another window. Wait for that move to finish.",
            );
          const beforeTabs = tabsRef.current;
          const merged = mergeWindowTransfer(
            beforeTabs,
            sessionsRef.current,
            projectTerminalsRef.current,
            incoming,
            paneTarget,
            titleTarget,
          );
          clearWindowDragPreview();
          const priorActive = activeTabIdRef.current;
          const priorCwd = projectCwdRef.current;
          incomingSessionIds = new Set(incoming.sessions.map((session) => session.id));
          const incomingPaneIds = new Set(incoming.tabs.flatMap((tab) => leafIds(tab.layout)));
          const incomingFileIds = new Set(
            filesInWorkspaceTabs(incoming.tabs).map((file) => file.id),
          );
          incomingTabIds = merged.tabs
            .filter(
              (tab) =>
                leafIds(tab.layout).some((id) => incomingPaneIds.has(id)) ||
                filesInWorkspaceTabs([tab]).some((file) => incomingFileIds.has(file.id)),
            )
            .map((tab) => tab.id);
          const priorObserved = new Map(
            incoming.sessions.map((session) => [
              session.id,
              observedSessions.current.get(session.id),
            ]),
          );
          const priorPersisted = new Map(
            incoming.sessions.map((session) => [session.id, lastPersisted.current.get(session.id)]),
          );
          const priorBound = new Map(
            incoming.sessions.map((session) => [
              session.id,
              lastBoundProvider.current.get(session.id),
            ]),
          );
          const priorUserBlock = new Map(
            incoming.sessions.map((session) => [
              session.id,
              lastPersistedUserBlock.current.get(session.id),
            ]),
          );
          const addedDockIds = new Set(
            merged.projectTerminals
              .filter((dock) => !projectTerminalsRef.current.includes(dock))
              .map((dock) => dock.pane.id),
          );
          rollback = () => {
            for (const id of incomingSessionIds) skipForgetSessionIds.current.add(id);
            flushSync(() => {
              setTabs((prev) =>
                removeWindowTransfer(prev, incoming, { before: beforeTabs, accepted: merged.tabs }),
              );
              setSessions((prev) => prev.filter((session) => !incomingSessionIds.has(session.id)));
              setProjectTerminals((prev) => prev.filter((dock) => !addedDockIds.has(dock.pane.id)));
              if (activeTabIdRef.current === merged.activeTabId) {
                setProjectCwd(priorCwd);
                activateTab(priorActive);
              }
            });
            // The imported draft is also the source's latest draft. Keep that
            // cache copy: restoring an older receiver copy would overwrite the
            // shared persisted draft while the source is still holding it.
            for (const id of incomingSessionIds) {
              const observed = priorObserved.get(id);
              if (observed) observedSessions.current.set(id, observed);
              else observedSessions.current.delete(id);
              const persisted = priorPersisted.get(id);
              if (persisted !== undefined) lastPersisted.current.set(id, persisted);
              else lastPersisted.current.delete(id);
              const bound = priorBound.get(id);
              if (bound !== undefined) lastBoundProvider.current.set(id, bound);
              else lastBoundProvider.current.delete(id);
              const userBlock = priorUserBlock.get(id);
              if (userBlock !== undefined) lastPersistedUserBlock.current.set(id, userBlock);
              else lastPersistedUserBlock.current.delete(id);
              pendingPersist.current.delete(id);
              skipForgetSessionIds.current.delete(id);
            }
          };
          restoreTransferredDrafts(incoming);
          for (const session of incoming.sessions) {
            observedSessions.current.set(session.id, session);
            lastPersisted.current.set(session.id, persistFingerprint(session));
            const userId = lastUserBlockId(session);
            if (userId) lastPersistedUserBlock.current.set(session.id, userId);
            if (session.providerSessionId)
              lastBoundProvider.current.set(session.id, session.providerSessionId);
          }
          flushSync(() => {
            for (const id of incomingTabIds) movingTabIds.current.add(id);
            for (const id of incomingSessionIds) movingSessionIds.current.add(id);
            setMovingWindows(new Set(movingTabIds.current));
            tabsRef.current = merged.tabs;
            projectTerminalsRef.current = merged.projectTerminals;
            setSessions(merged.sessions);
            setTabs(merged.tabs);
            setProjectTerminals(merged.projectTerminals);
            setProjectCwd(incoming.projectCwd);
            activateTab(merged.activeTabId);
          });
          await invoke("window_transfer_ready", { transferId });
        } catch (error) {
          rollback?.();
          await invoke("reject_window_transfer", {
            transferId,
            reason: String(error),
          }).catch(console.error);
          clearWindowDragPreview();
        } finally {
          receiving.delete(transferId);
          for (const id of incomingTabIds) movingTabIds.current.delete(id);
          for (const id of incomingSessionIds) movingSessionIds.current.delete(id);
          if (!disposed) setMovingWindows(new Set(movingTabIds.current));
        }
      },
    );
    return () => {
      disposed = true;
      clearWindowDragPreview();
      void listening.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [activateTab]);

  /** Pops tabs out into a new window. Tabs, their sessions and project
   * terminal docks are handed to the new window's boot, then removed here.
   * Tabs with a turn in flight are queued: their stream is parsed by this
   * window's harness listeners, which a new window cannot take over. */
  const onMoveTabsToNewWindow = useCallback(
    async (
      tabIds: string[],
      opts?: {
        position?: WindowMovePosition;
        targetWindowLabel?: string;
      },
    ) => {
      const movingTabs = tabsRef.current.filter((tab) => tabIds.includes(tab.id));
      if (movingTabs.length === 0) return;
      const movingIds = movingTabs.map((tab) => tab.id);
      if (movingIds.some((id) => movingTabIds.current.has(id))) return;
      const sessionIdsInMove = new Set(movingTabs.flatMap((tab) => leafIds(tab.layout)));
      if ([...sessionIdsInMove].some((id) => movingSessionIds.current.has(id))) return;
      if (
        tabsRef.current.some(
          (tab) =>
            !movingIds.includes(tab.id) &&
            leafIds(tab.layout).some((id) => sessionIdsInMove.has(id)),
        )
      ) {
        void message(
          "This conversation is also open in another tab. Close the duplicate tab before moving it to a new window.",
          {
            get title() {
              return t("Move to new window");
            },
          },
        );
        return "failed" as const;
      }
      // A shell cannot change windows: the source would kill the pty its
      // twin in the new window just respawned under the same id.
      if (filesInWorkspaceTabs(movingTabs).some((file) => file.terminal)) {
        void message("Close terminal tabs before moving this workspace to another window.", {
          get title() {
            return t("Move tab");
          },
        });
        return "failed" as const;
      }
      // A running turn lives in this window's harness listeners, so the
      // move waits until it finishes rather than dropping the stream.
      if (busySessionsInTabs(tabsRef.current, sessionsRef.current, movingIds).length > 0) {
        setPendingWindowMoves((prev) =>
          queueWindowMoves(prev, movingIds, {
            ...opts?.position,
            targetWindowLabel: opts?.targetWindowLabel,
          }),
        );
        return "queued" as const;
      }
      for (const id of movingIds) movingTabIds.current.add(id);
      // Freeze composer input before collecting its draft, attachments and model.
      flushSync(() => setMovingWindows(new Set(movingTabIds.current)));
      const lockedSessionIds = [] as string[];
      for (const tab of movingTabs) {
        for (const id of leafIds(tab.layout)) lockedSessionIds.push(id);
      }
      for (const id of lockedSessionIds) movingSessionIds.current.add(id);
      try {
        const dirtyIds = new Set(
          filesInWorkspaceTabs(movingTabs)
            .filter((file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id))
            .map((file) => file.id),
        );
        if (dirtyIds.size > 0) {
          void message("Save the unsaved files before moving this tab to another window.", {
            get title() {
              return t("Move tab");
            },
          });
          return "failed" as const;
        }

        const plan = planTabMoveRemainder(
          tabsRef.current,
          sessionsRef.current,
          movingIds,
          activeTabIdRef.current,
          projectCwdRef.current,
          getCurrentWindow().label !== "main",
        );
        const splitDocks = splitProjectTerminalsForMove(
          projectTerminalsRef.current,
          movingTabs,
          plan.remaining,
          sessionsRef.current,
        );
        if (splitDocks.moving.some((dock) => dock.pane.files.some((file) => file.terminal))) {
          void message(
            "Close project terminal tabs before moving this workspace to another window.",
            {
              get title() {
                return t("Move tab");
              },
            },
          );
          return "failed" as const;
        }
        const payload = collectWindowTransfer(
          tabsRef.current,
          sessionsRef.current,
          movingIds,
          activeTabIdRef.current,
          new Set(),
          projectCwdRef.current,
          splitDocks.moving,
        );
        if (!payload) return;

        const sessionIds = new Set(payload.sessions.map((session) => session.id));
        for (const id of sessionIds) skipForgetSessionIds.current.add(id);
        try {
          const outcome = await invoke<string>("move_window_tabs", {
            transfer: JSON.stringify(payload),
            targetWindowLabel: opts?.targetWindowLabel ?? null,
            x: opts?.position?.x ?? null,
            y: opts?.position?.y ?? null,
            clientX: opts?.position?.clientX ?? null,
            clientY: opts?.position?.clientY ?? null,
            pixelRatio: opts?.position?.pixelRatio ?? null,
            relocate: getCurrentWindow().label !== "main" && plan.remaining.length === 0,
          });
          if (outcome === "relocated") {
            for (const id of sessionIds) skipForgetSessionIds.current.delete(id);
            return "relocated" as const;
          }
        } catch (error) {
          for (const id of sessionIds) skipForgetSessionIds.current.delete(id);
          void message(
            `Could not move the conversation to a new window. Your tab is still here.\n\n${error instanceof Error ? error.message : String(error)}`,
            {
              get title() {
                return t("Move to new window");
              },
            },
          );
          return "failed" as const;
        }

        let closeDrainedWindow = false;
        flushSync(() => {
          const currentPlan = planTabMoveRemainder(
            tabsRef.current,
            sessionsRef.current,
            movingIds,
            activeTabIdRef.current,
            projectCwdRef.current,
            getCurrentWindow().label !== "main",
          );
          setProjectTerminals(
            (prev) =>
              splitProjectTerminalsForMove(
                prev,
                movingTabs,
                currentPlan.remaining,
                sessionsRef.current,
              ).remaining,
          );
          let remainingTabs = currentPlan.remaining;
          let nextActive = currentPlan.nextActiveTabId;
          closeDrainedWindow = currentPlan.closeWindow;
          if (currentPlan.needsSeed && !closeDrainedWindow) {
            const seedSession = sessionsRef.current.find((session) => sessionIds.has(session.id));
            const session = newSession(
              seedSession?.harness ?? "claude",
              seedSession?.cwd ?? projectCwdRef.current,
              seedSession?.model,
              seedSession?.runtimeMode,
              seedSession?.modelSettings,
            );
            const tab = newTab(session.id);
            setSessions((prev) => [...prev.filter((entry) => !sessionIds.has(entry.id)), session]);
            remainingTabs = [...remainingTabs, tab];
            nextActive = tab.id;
          } else {
            setSessions((prev) => prev.filter((session) => !sessionIds.has(session.id)));
          }
          setTabs(remainingTabs);
          if (nextActive) activateTab(nextActive);
          setDirtyFiles((prev) => {
            const next = new Set(prev);
            for (const id of dirtyIds) next.delete(id);
            return next;
          });
        });
        if (closeDrainedWindow) {
          relinquishTransferredWindow();
          try {
            await getCurrentWindow().destroy();
          } catch (error) {
            abortQuit();
            void message(
              `The tab was moved, but its empty window could not close.\n\n${String(error)}`,
              {
                get title() {
                  return t("Move tab");
                },
              },
            );
          }
        }
        for (const id of sessionIds) skipForgetSessionIds.current.delete(id);
        return "transferred" as const;
      } finally {
        for (const id of movingIds) movingTabIds.current.delete(id);
        setMovingWindows(new Set(movingTabIds.current));
        for (const id of lockedSessionIds) movingSessionIds.current.delete(id);
      }
    },
    [activateTab],
  );

  useEffect(() => {
    const { ready, gone } = settlePendingWindowMoves(pendingWindowMoves, tabs, sessions);
    if (ready.length === 0 && gone.length === 0) return;
    setPendingWindowMoves((prev) => dropWindowMoves(prev, [...ready, ...gone]));
    for (const id of ready) {
      void onMoveTabsToNewWindow([id], {
        position:
          pendingWindowMoves[id]?.x !== undefined && pendingWindowMoves[id]?.y !== undefined
            ? (pendingWindowMoves[id] as {
                x: number;
                y: number;
                clientX?: number;
                clientY?: number;
              })
            : undefined,
        targetWindowLabel: pendingWindowMoves[id]?.targetWindowLabel,
      });
    }
  }, [pendingWindowMoves, tabs, sessions, onMoveTabsToNewWindow]);

  const onCancelMoveToNewWindow = useCallback((tabId: string) => {
    setPendingWindowMoves((prev) => dropWindowMoves(prev, [tabId]));
  }, []);

  /** Moves one file tab into a new window as its own editor tab. */
  const onOpenFileInNewWindow = useCallback(
    async (paneId: string, fileId: string, position?: WindowMovePosition) => {
      if (openingFileWindowIds.current.has(fileId) || isMovingPane(paneId)) return;
      const sourceTab = tabsRef.current.find((entry) => findSurfacePane(entry, paneId));
      if (!sourceTab) return;
      const found = tabsRef.current
        .map((tab) => findSurfacePane(tab, paneId))
        .find((entry) => entry?.kind === "editor");
      const file = found?.pane.files.find((entry) => entry.id === fileId);
      if (!file || !isFilesystemTab(file) || dirtyFilesRef.current.has(fileId)) {
        return;
      }
      if (leafIds(sourceTab.layout).length === 1 && found!.pane.files.length === 1) {
        await onMoveTabsToNewWindow([sourceTab.id], { position });
        return;
      }
      const tab = newEditorWorkspaceTab({ ...file, preview: false });
      openingFileWindowIds.current.add(fileId);
      movingTabIds.current.add(sourceTab.id);
      flushSync(() => setMovingWindows(new Set(movingTabIds.current)));
      const lockedIds = leafIds(sourceTab.layout);
      for (const id of lockedIds) movingSessionIds.current.add(id);
      try {
        await invoke("move_window_tabs", {
          transfer: JSON.stringify({
            tabs: [tab],
            sessions: [],
            activeTabId: tab.id,
            projectCwd: file.cwd || projectCwdRef.current,
            dirtyFileIds: [],
          } satisfies WindowTransferPayload),
          targetWindowLabel: position?.targetWindowLabel ?? null,
          x: position?.x ?? null,
          y: position?.y ?? null,
          clientX: position?.clientX ?? null,
          clientY: position?.clientY ?? null,
          pixelRatio: position?.pixelRatio ?? null,
          relocate: false,
        });
        movingTabIds.current.delete(sourceTab.id);
        for (const id of lockedIds) movingSessionIds.current.delete(id);
        // An edit made while the destination boots must stay in this editor.
        if (!dirtyFilesRef.current.has(fileId)) {
          onCloseFile(paneId, fileId, { skipConfirm: true });
        }
      } catch (error) {
        void message(
          `Could not open the file in a new window. The original editor is still here.\n\n${error instanceof Error ? error.message : String(error)}`,
          {
            get title() {
              return t("Open in new window");
            },
          },
        );
      } finally {
        openingFileWindowIds.current.delete(fileId);
        movingTabIds.current.delete(sourceTab.id);
        for (const id of lockedIds) movingSessionIds.current.delete(id);
        setMovingWindows(new Set(movingTabIds.current));
      }
    },
    [onCloseFile, onMoveTabsToNewWindow],
  );

  const onCloseOtherFiles = useCallback((paneId: string, fileId: string) => {
    if (isMovingPane(paneId)) return;
    const tab = tabsRef.current.find((entry) => findSurfacePane(entry, paneId));
    if (!tab) return;
    const found = findSurfacePane(tab, paneId);
    if (!found?.pane.files.some((file) => file.id === fileId)) return;
    const closingFiles = found.pane.files.filter((file) => file.id !== fileId);
    if (closingFiles.length === 0) return;
    const closingIds = new Set(closingFiles.map((file) => file.id));
    const unsaved = closingFiles.filter(
      (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
    );
    const terminals = closingFiles.filter((file) => file.terminal);

    const finishClose = () => {
      setTabs((prev) =>
        prev.map((entry) => {
          if (entry.id !== tab.id) return entry;
          const current = findSurfacePane(entry, paneId);
          if (!current?.pane.files.some((file) => file.id === fileId)) {
            return entry;
          }
          return withSurfacePanes(
            { ...entry, focusedId: paneId },
            current.kind,
            surfacePanes(entry, current.kind).map((pane) =>
              pane.id === paneId
                ? {
                    ...pane,
                    files: pane.files.filter((file) => !closingIds.has(file.id)),
                    activeFileId: fileId,
                  }
                : pane,
            ),
          );
        }),
      );
      setDirtyFiles((prev) => {
        const next = new Set(prev);
        for (const id of closingIds) next.delete(id);
        return next;
      });
    };

    void (async () => {
      if (
        !(await confirmWorkspaceClose(
          unsaved.length > 0
            ? () => confirmDiscardUnsaved("Close other tabs with unsaved files?")
            : undefined,
          terminals.length > 0 ? () => confirmCloseTerminals(terminals) : undefined,
        ))
      )
        return;
      finishClose();
    })();
  }, []);

  const onClearTabSession = useCallback(
    (id: string) => {
      if (windowTransferPendingRef.current || movingTabIds.current.has(id)) return;
      const tab = tabs.find((entry) => entry.id === id);
      if (!tab || isBlankWorkspaceTab(tab, sessionsRef.current)) return;

      const closingFiles = [
        ...tab.editorPanes.flatMap((pane) => pane.files),
        ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
      ];
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );

      const oldSessionId = leafIds(tab.layout).find((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      const oldSession = sessionsRef.current.find((session) => session.id === oldSessionId);
      if (!oldSession) return;

      const finishClear = () => {
        persistSession(oldSession);
        for (const shellId of leafIds(tab.layout)) {
          rememberRemoteSession(shellId);
          rememberRemotePendingWorktree(shellId);
        }

        // The blank replacement stays in the tab's worktree, so clearing the
        // last tab there does not switch the workspace back to the project.
        const workspace = tabWorkspace(tab, sessionsRef.current);
        const focus = worktreeFocus(oldSession.cwd);
        const session = {
          ...newSession(
            oldSession.harness,
            oldSession.cwd,
            oldSession.model,
            oldSession.runtimeMode,
            oldSession.modelSettings,
          ),
          ...(workspace &&
          !isRemoteProjectPath(oldSession.cwd) &&
          !sameProjectPath(workspace, oldSession.cwd)
            ? {
                worktreeCwd: workspace,
                branch:
                  (focus && sameProjectPath(focus.path, workspace) ? focus.branch : undefined) ??
                  (oldSession.worktreeCwd && sameProjectPath(oldSession.worktreeCwd, workspace)
                    ? oldSession.branch
                    : undefined) ??
                  undefined,
              }
            : {}),
        };

        setSessions((prev) => [...prev, session]);
        setDirtyFiles((prev) => {
          const updated = new Set(prev);
          for (const file of closingFiles) updated.delete(file.id);
          return updated;
        });
        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  layout: leaf(session.id),
                  focusedId: session.id,
                  editorPanes: [],
                  terminalPanes: [],
                  diffOpen: false,
                  diffFocused: false,
                }
              : entry,
          ),
        );
        setComposerFocused(true);
        void refreshHistory(sidebarCwd);
      };

      if (unsaved.length === 0) {
        finishClear();
        return;
      }
      void confirmDiscardUnsaved("Close this conversation with unsaved files?").then(
        (ok) => ok && finishClear(),
      );
    },
    [tabs, persistSession, refreshHistory, sidebarCwd],
  );

  const onRemoteSessionDeleted = useCallback(
    (remoteSessionId: string) => {
      const tab = tabsRef.current.find((entry) =>
        leafIds(entry.layout).some((shellId) => remoteSessionFor(shellId) === remoteSessionId),
      );
      if (!tab) return;
      const closePlan = planWorkspaceTabClose({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        closingTabId: tab.id,
        scope: tabCloseScope,
        worktreeOf: tabWorktreeOf,
      });
      if (closePlan.action === "keep") onClearTabSession(tab.id);
      else onCloseTab(tab.id);
    },
    [onClearTabSession, onCloseTab, tabCloseScope],
  );

  const onCloseAllTabs = useCallback(() => {
    const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current);
    if (!tab) return;

    const seedSession = (cwd: string) => {
      const seed = sessionsRef.current[0];
      return newSession(
        seed?.harness ?? "claude",
        cwd,
        seed?.model,
        seed?.runtimeMode,
        seed?.modelSettings,
      );
    };

    // Stage one: files open in the active tab's editor panes close first.
    // Only when none are open does the command close every workspace tab.
    const editorFiles = tab.editorPanes.flatMap((pane) => pane.files);
    if (editorFiles.length > 0) {
      const remaining = closeSurfacePanes(tab, "editor");
      if (!remaining) {
        const closePlan = planWorkspaceTabClose({
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          closingTabId: tab.id,
          scope: tabCloseScope,
          worktreeOf: tabWorktreeOf,
        });
        if (closePlan.action === "close") {
          onCloseTab(tab.id);
          return;
        }
      }
      const unsaved = editorFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );

      const finishClose = () => {
        let nextTab: WorkspaceTab;
        let focusesSession: boolean;
        if (remaining) {
          nextTab = remaining;
          focusesSession = sessionsRef.current.some(
            (session) => session.id === remaining.focusedId,
          );
        } else {
          // The tab held only editor panes and must stay: seed a session.
          const session = seedSession(editorFiles[0].cwd || projectCwd);
          setSessions((prev) => [...prev, session]);
          nextTab = resetTabToSession(tab, session.id);
          focusesSession = true;
        }
        setTabs((prev) => prev.map((entry) => (entry.id === tab.id ? nextTab : entry)));
        setDirtyFiles((prev) => {
          const updated = new Set(prev);
          for (const file of editorFiles) updated.delete(file.id);
          return updated;
        });
        setComposerFocused(focusesSession);
      };

      void (async () => {
        if (unsaved.length > 0) {
          const ok = await confirmDiscardUnsaved("Close all open files with unsaved changes?");
          if (!ok) return;
        }
        finishClose();
      })();
      return;
    }

    // Stage two: the workspace always keeps one tab, so close every other
    // tab and reset the active one to a blank session. Every confirmation
    // runs before any tab changes, so a cancelled prompt leaves all tabs.
    const otherIds = tabsRef.current
      .filter((entry) => entry.id !== tab.id)
      .map((entry) => entry.id);
    const terminalFiles = (tab.terminalPanes ?? []).flatMap((pane) => pane.files);
    const closingFiles = [
      ...tabsRef.current
        .filter((entry) => otherIds.includes(entry.id))
        .flatMap((entry) => [
          ...entry.editorPanes.flatMap((pane) => pane.files),
          ...(entry.terminalPanes ?? []).flatMap((pane) => pane.files),
        ]),
      ...terminalFiles,
    ];
    const unsaved = closingFiles.filter(
      (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
    );
    const terminals = closingFiles.filter((file) => file.terminal);

    void (async () => {
      if (
        !(await confirmWorkspaceClose(
          unsaved.length > 0
            ? () => confirmDiscardUnsaved("Close all tabs with unsaved files?")
            : undefined,
          terminals.length > 0 ? () => confirmCloseTerminals(terminals) : undefined,
        ))
      )
        return;
      if (otherIds.length > 0) {
        onCloseTabs(otherIds, tab.id, { confirmed: true });
      }
      const hasSession = leafIds(tab.layout).some((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      if (hasSession) {
        // No editor files remain, so this commits without a prompt.
        onClearTabSession(tab.id);
        return;
      }
      // The tab held no session: seed one so the workspace stays usable.
      const session = seedSession(terminalFiles[0]?.cwd || projectCwd);
      setSessions((prev) => [...prev, session]);
      setTabs((prev) =>
        prev.map((entry) => (entry.id === tab.id ? resetTabToSession(entry, session.id) : entry)),
      );
      setComposerFocused(true);
    })();
  }, [onCloseTab, onCloseTabs, onClearTabSession, projectCwd, tabCloseScope]);

  const onClosePane = useCallback(
    (sessionId?: string) => {
      // The project terminal is shared by every workspace tab in the project.
      // Keep the global close command scoped to workspace tabs and panes even
      // while the dock has focus; terminal tabs have their own close buttons.
      if (!activeTab) return;
      const focusedSurface = findSurfacePane(activeTab, activeTab.focusedId);
      if (windowTransferPendingRef.current || movingTabIds.current.has(activeTab.id)) return;
      if (sessionId === undefined && focusedSurface) {
        onCloseFile(focusedSurface.pane.id, focusedSurface.pane.activeFileId);
        return;
      }
      const closingId = sessionId ?? activeTab.focusedId;
      const ids = leafIds(activeTab.layout);
      const sessionIds = ids.filter((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      if (!sessionIds.includes(closingId)) return;
      const nextTab = closeLeaf(activeTab, closingId);
      if (!nextTab) {
        const closePlan = planWorkspaceTabClose({
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          closingTabId: activeTab.id,
          scope: tabCloseScope,
          worktreeOf: tabWorktreeOf,
        });
        if (closePlan.action === "keep") onClearTabSession(activeTab.id);
        else onCloseTab(activeTab.id);
        return;
      }
      persistSession(sessionsRef.current.find((s) => s.id === closingId));
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? { ...t, layout: nextTab.layout, focusedId: nextTab.focusedId }
            : t,
        ),
      );
      if (closingId === activeTab.focusedId) {
        setComposerFocused(
          nextTab && sessionsRef.current.some((session) => session.id === nextTab.focusedId),
        );
      }
      void refreshHistory(sidebarCwd);
    },
    [
      activeTab,
      onCloseFile,
      onCloseTab,
      onClearTabSession,
      persistSession,
      refreshHistory,
      sidebarCwd,
      tabCloseScope,
    ],
  );

  const onCloseTitleTab = useCallback(
    (id: string) => {
      if (windowTransferPendingRef.current || movingTabIds.current.has(id)) return;
      const closePlan = planWorkspaceTabClose({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        closingTabId: id,
        scope: tabCloseScope,
        worktreeOf: tabWorktreeOf,
      });
      if (closePlan.action === "keep" && id === activeTabIdRef.current) {
        onClosePane();
        return;
      }
      onCloseTab(id);
    },
    [onClosePane, onCloseTab, tabCloseScope],
  );

  /** Open tabs per workspace in the sidebar's project, keyed by worktree
   * path, so the switcher can show what each worktree still has open. */
  const nextWorktreeTabStats = useMemo(() => {
    const stats = new Map<string, { tabs: number; busy: boolean }>();
    if (!sidebarCwd || sidebarCwd === "~" || isRemoteProjectPath(sidebarCwd)) return stats;
    for (const tab of filterTabsForProject(tabs, sessions, sidebarCwd)) {
      const workspace = tabWorkspace(tab, sessions) ?? sidebarCwd;
      const key = pathKey(workspace);
      const entry = stats.get(key) ?? { tabs: 0, busy: false };
      entry.tabs += 1;
      entry.busy ||= leafIds(tab.layout).some(
        (id) => sessions.find((session) => session.id === id)?.busy,
      );
      stats.set(key, entry);
    }
    return stats;
  }, [tabs, sessions, sidebarCwd, tabWorkspace, workspaceNavigation.revision]);
  const worktreeTabStatsRef = useRef(nextWorktreeTabStats);
  if (!worktreeTabStatsEqual(worktreeTabStatsRef.current, nextWorktreeTabStats)) {
    worktreeTabStatsRef.current = nextWorktreeTabStats;
  }
  const worktreeTabStats = worktreeTabStatsRef.current;

  const deckProjectTabs = useMemo(() => {
    // A projectless session belongs to no project, so it stands on its own
    // rather than trailing the last project's tabs.
    const active = tabs.find((tab) => tab.id === activeTabId);
    if (active && !workspaceTabCwd(active, sessions)) return [active];
    // Each worktree keeps its own tabs; the others stay open, just hidden.
    const worktree = projectWorktree?.path ?? projectCwd;
    return filterTabsForProject(tabs, sessions, projectCwd).filter((tab) => {
      if (tab.id === activeTabId) return true;
      const workspace = tabWorkspace(tab, sessions);
      return !workspace || sameProjectPath(workspace, worktree);
    });
  }, [
    activeTabId,
    tabs,
    sessions,
    projectCwd,
    projectWorktree?.path,
    tabWorkspace,
    workspaceNavigation.revision,
  ]);

  const onNext = useCallback(() => {
    const index = deckProjectTabs.findIndex((t) => t.id === activeTabId);
    if (index >= 0) activateTab(deckProjectTabs[(index + 1) % deckProjectTabs.length].id);
  }, [activateTab, activeTabId, deckProjectTabs]);

  const onPrev = useCallback(() => {
    const index = deckProjectTabs.findIndex((t) => t.id === activeTabId);
    if (index >= 0) {
      activateTab(
        deckProjectTabs[(index - 1 + deckProjectTabs.length) % deckProjectTabs.length].id,
      );
    }
  }, [activateTab, activeTabId, deckProjectTabs]);

  const onVisitBack = useCallback(() => {
    const openIds = new Set(tabsRef.current.map((tab) => tab.id));
    const pruned = pruneTabVisitHistory(tabVisitRef.current, openIds, activeTabIdRef.current);
    const next = tabVisitBack(pruned);
    if (!next || !openIds.has(next.current)) return;
    tabVisitFromHistoryRef.current = true;
    commitTabVisit(next);
    activateTab(next.current);
  }, [activateTab, commitTabVisit]);

  const onVisitForward = useCallback(() => {
    const openIds = new Set(tabsRef.current.map((tab) => tab.id));
    const pruned = pruneTabVisitHistory(tabVisitRef.current, openIds, activeTabIdRef.current);
    const next = tabVisitForward(pruned);
    if (!next || !openIds.has(next.current)) return;
    tabVisitFromHistoryRef.current = true;
    commitTabVisit(next);
    activateTab(next.current);
  }, [activateTab, commitTabVisit]);

  const onActivate = useCallback(
    (slot: number) => {
      const tab = slot < 0 ? deckProjectTabs[deckProjectTabs.length - 1] : deckProjectTabs[slot];
      if (tab) activateTab(tab.id);
    },
    [activateTab, deckProjectTabs],
  );

  const onFocusPane = useCallback(
    (paneId: string) => {
      if (isMovingPane(paneId)) return;
      setMaximizedPane((current) =>
        current?.tabId === activeTabId ? { ...current, paneId } : current,
      );
      if (tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)?.focusedId !== paneId)
        workspaceNavigation.cancel();
      setProjectTerminalFocused(false);
      if (inboxAskPortal?.sessionId === paneId) {
        setComposerFocused(true);
        return;
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                layout: selectPaneTab(t.layout, paneId),
                focusedId: paneId,
                diffFocused: false,
              }
            : t,
        ),
      );
      setComposerFocused(sessionsRef.current.some((session) => session.id === paneId));
    },
    [activeTabId, inboxAskPortal],
  );

  const onOpenDiff = useCallback(
    (
      path?: string,
      session?: { sessionId: string; cwd: string },
      changeKind?: GitFileDiffKind,
      pin = false,
      exact = false,
      checkout?: { cwd: string; projectCwd: string },
    ) => {
      const diffCwd = checkout?.cwd ?? session?.cwd ?? gitCwdRef.current;
      const diffProjectCwd = session
        ? sessionsRef.current.find((entry) => entry.id === session.sessionId)?.cwd
        : (checkout?.projectCwd ?? sidebarCwdRef.current);
      const open = (resolved: string | undefined) => {
        if (resolved) rememberOpenedFile(diffCwd, resolved);
        setTabs((prev) =>
          prev.map((tab) => {
            if (tab.id !== activeTabId) return tab;
            if (session) {
              return openSessionChangesTab(
                tab,
                session.cwd,
                session.sessionId,
                resolved,
                diffProjectCwd,
                pin,
              );
            }
            if (loadDiffViewer() === "unified") {
              return openChangesTab(tab, diffCwd, resolved, changeKind, diffProjectCwd);
            }
            if (!resolved) return tab;
            return openEditorTab(
              tab,
              newFileTab(resolved, diffCwd, true, changeKind, diffProjectCwd),
              { pin },
            );
          }),
        );
        setSidebarTab("changes", diffProjectCwd);
        setComposerFocused(false);
      };
      // Source control hands over exact paths from git. Only shortened paths
      // (a transcript link, a session file) need the project file index, and
      // waiting on it here held the click until the whole project was listed.
      if (!path || exact) {
        open(path);
        return;
      }
      void resolveOpenablePath(diffCwd, path).then((resolved) => open(resolved ?? path));
    },
    [activeTabId],
  );

  const onOpenWorkingTreeDiff = useCallback(
    (path: string, kind?: GitFileDiffKind, pin?: boolean) =>
      onOpenDiff(path, undefined, kind, pin, true),
    [onOpenDiff],
  );

  /** Stack one section's working-tree changes in one review, whatever the diff-view setting. */
  const onOpenAllChanges = useCallback(
    (kind: GitFileDiffKind, repositoryCwd?: string) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? openChangesTab(
                tab,
                repositoryCwd ?? gitCwdRef.current,
                undefined,
                kind,
                sidebarCwdRef.current,
              )
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [activeTabId],
  );

  const onOpenCommit = useCallback(
    (commit: GitHistoryCommit, pin?: boolean, repositoryCwd?: string) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? openCommitTab(
                tab,
                repositoryCwd ?? gitCwdRef.current,
                {
                  sha: commit.sha,
                  shortSha: commit.shortSha,
                  subject: commit.subject,
                },
                sidebarCwdRef.current,
                pin,
              )
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [activeTabId],
  );

  const onShowSourceControl = useCallback(() => {
    setSidebarTab("changes");
  }, []);

  const onToggleChanges = useCallback(() => {
    onShowSourceControl();
  }, [onShowSourceControl]);

  const onReorderTabs = useCallback(
    (ids: string[], movedId?: string) => {
      setTabs((prev) => {
        const visibleIds = new Set(ids);
        const visibleTabs = prev.filter((tab) => visibleIds.has(tab.id));
        if (movedId) {
          const reordered = applyGroupedReorder(visibleTabs, ids, movedId, projectOfTab);
          return reordered ? mergeOrderedSubset(prev, reordered) : prev;
        }
        return mergeOrderedSubset(prev, orderByIds(visibleTabs, ids));
      });
    },
    [projectOfTab],
  );

  const onReorderFiles = useCallback((paneId: string, ids: string[]) => {
    if (isMovingPane(paneId)) return;
    setTabs((prev) =>
      prev.map((tab) => {
        const found = findSurfacePane(tab, paneId);
        if (!found) return tab;
        return withSurfacePanes(
          tab,
          found.kind,
          surfacePanes(tab, found.kind).map((pane) =>
            pane.id === paneId ? { ...pane, files: orderByIds(pane.files, ids) } : pane,
          ),
        );
      }),
    );
  }, []);

  const onMovePane = useCallback(
    (fromId: string, toId: string, edge: PaneEdge, tabPosition?: PaneTabDropPosition) => {
      if (isMovingPane(fromId) || isMovingPane(toId)) return;
      if (fromId === toId) {
        if (edge === "center") return;
        const source = tabsRef.current.find((tab) => leafIds(tab.layout).includes(fromId));
        if (!source) return;
        const currentSession = sessionsRef.current.find((session) => session.id === fromId);
        const empty = newDefaultSession(
          currentSession?.cwd ?? projectCwdRef.current,
          currentSession?.runtimeMode,
        );
        const next = tabsRef.current.map((tab) =>
          tab.id === source.id
            ? {
                ...tab,
                layout: splitPaneAtSelfEdge(tab.layout, fromId, edge, empty.id),
                focusedId: fromId,
              }
            : tab,
        );
        sessionsRef.current = [...sessionsRef.current, empty];
        tabsRef.current = next;
        setSessions(sessionsRef.current);
        setTabs(next);
        return;
      }
      const result = applyMovePaneBetweenTabs({
        tabs: tabsRef.current,
        fromId,
        toId,
        edge,
        tabPosition,
      });
      if (!result) return;
      tabsRef.current = result.tabs;
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(sessionsRef.current.some((session) => session.id === result.focusedId));
    },
    [],
  );

  const onMoveFileBetweenPanes = useCallback(
    (
      fileId: string,
      targetPaneId: string,
      edge: PaneEdge,
      targetFileId?: string,
      position?: PaneTabDropPosition,
    ) => {
      const source = tabsRef.current.find((tab) =>
        filesInWorkspaceTabs([tab]).some((file) => file.id === fileId),
      );
      if (
        !source ||
        movingTabIds.current.has(source.id) ||
        isMovingPane(targetPaneId) ||
        dirtyFilesRef.current.has(fileId)
      )
        return;
      const result = applyMoveFileBetweenPanes({
        tabs: tabsRef.current,
        fileId,
        targetPaneId,
        edge,
        targetFileId,
        position,
      });
      if (!result) return;
      tabsRef.current = result.tabs;
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(false);
    },
    [],
  );

  const onDetachPane = useCallback(
    (paneId: string, targetTabId: string, position: "before" | "after") => {
      if (isMovingPane(paneId) || movingTabIds.current.has(targetTabId)) return;
      const result = applyDetachPaneToTab({
        tabs: tabsRef.current,
        paneId,
        targetTabId,
        position,
      });
      if (!result) return;

      tabsRef.current = result.tabs;
      setTabs(result.tabs);
      setProjectTerminalFocused(false);
      activateTab(result.activeTabId, result.focusedId);
    },
    [activateTab],
  );

  const onPopOutPane = useCallback(
    (paneId: string, position: WindowMovePosition) => {
      const source = tabsRef.current.find((tab) => leafIds(tab.layout).includes(paneId));
      if (!source || movingTabIds.current.has(source.id)) return;
      const surface = findSurfacePane(source, paneId);
      if (
        surface &&
        surfacePanes(source, surface.kind)
          .find((pane) => pane.id === paneId)
          ?.files.some((file) => dirtyFilesRef.current.has(file.id))
      ) {
        void message("Save the unsaved files before moving this pane to another window.", {
          get title() {
            return t("Move pane");
          },
        });
        return;
      }
      if (
        surface &&
        surfacePanes(source, surface.kind)
          .find((pane) => pane.id === paneId)
          ?.files.some((file) => file.terminal)
      )
        return;
      let tabId = source.id;
      let detachedState: ReturnType<typeof applyDetachPaneToTab> = null;
      if (leafIds(source.layout).length > 1) {
        const detached = applyDetachPaneToTab({
          tabs: tabsRef.current,
          paneId,
          targetTabId: source.id,
          position: "after",
        });
        if (!detached) return;
        detachedState = detached;
        // Keep ownership in this window until the receiver acknowledges it.
        // Busy sessions use the existing cancellable tab-transfer queue.
        tabId = detached.activeTabId;
        flushSync(() => {
          tabsRef.current = detached.tabs;
          setTabs(detached.tabs);
          activateTab(tabId, paneId);
        });
      }
      void onMoveTabsToNewWindow([tabId], { position }).then((outcome) => {
        if (outcome !== "failed" || !detachedState) return;
        const currentSource = tabsRef.current.find((tab) => tab.id === source.id);
        const currentDetached = tabsRef.current.find((tab) => tab.id === tabId);
        const originalRemainder = detachedState.tabs.find((tab) => tab.id === source.id);
        const originalDetached = detachedState.tabs.find((tab) => tab.id === tabId);
        // Restore the original split only if the user has not rearranged it while queued.
        if (
          !currentSource ||
          !currentDetached ||
          currentSource.layout !== originalRemainder?.layout ||
          currentDetached.layout !== originalDetached?.layout
        )
          return;
        const restored = {
          ...currentSource,
          layout: source.layout,
          focusedId: paneId,
          editorPanes: [...currentSource.editorPanes, ...currentDetached.editorPanes],
          terminalPanes: [
            ...(currentSource.terminalPanes ?? []),
            ...(currentDetached.terminalPanes ?? []),
          ],
        };
        const next = tabsRef.current
          .filter((tab) => tab.id !== tabId)
          .map((tab) => (tab.id === source.id ? restored : tab));
        tabsRef.current = next;
        setTabs(next);
        activateTab(source.id, paneId);
      });
    },
    [activateTab, onMoveTabsToNewWindow],
  );

  const focusOpenSession = useCallback(
    (sessionId: string) => {
      const tab = findOpenSessionTab(tabsRef.current, sessionsRef.current, sessionId);
      if (!tab) return false;
      loadedSessionCache.current.delete(sessionId);
      setActiveTabId(tab.id);
      setTabs((prev) =>
        prev.map((entry) =>
          entry.id === tab.id
            ? { ...entry, layout: selectPaneTab(entry.layout, sessionId), focusedId: sessionId }
            : entry,
        ),
      );
      followProject(
        focusedWorkspaceTabCwd(
          { ...tab, layout: selectPaneTab(tab.layout, sessionId), focusedId: sessionId },
          sessionsRef.current,
        ),
      );
      setComposerFocused(true);
      return true;
    },
    [followProject],
  );

  const replaceBlankPaneWithSession = useCallback((session: Session) => {
    const tab =
      tabsRef.current.find((entry) => entry.id === activeTabIdRef.current) ?? tabsRef.current[0];
    if (!tab) return false;

    const paneId = isBlankSession(sessionsRef.current.find((entry) => entry.id === tab.focusedId))
      ? tab.focusedId
      : leafIds(tab.layout).find((id) =>
          isBlankSession(sessionsRef.current.find((entry) => entry.id === id)),
        );
    if (!paneId || paneId === session.id) return false;
    // A blank pane belongs to its own project; a session from another one
    // gets its own tab in that project instead.
    const blankCwd = sessionsRef.current.find((entry) => entry.id === paneId)?.cwd;
    if (blankCwd && looksLikeProject(blankCwd) && !sameProjectPath(blankCwd, session.cwd))
      return false;

    lastPersisted.current.delete(paneId);
    {
      const blank = sessionsRef.current.find((entry) => entry.id === paneId);
      if (blank) void forgetHarnessSession(blank.harness, paneId);
    }
    setSessions((prev) => {
      const next = prev.filter((entry) => entry.id !== paneId);
      return next.some((entry) => entry.id === session.id) ? next : [...next, session];
    });
    setTabs((prev) =>
      prev.map((entry) =>
        entry.id === tab.id
          ? {
              ...entry,
              layout: replaceLeafId(entry.layout, paneId, session.id),
              focusedId: session.id,
            }
          : entry,
      ),
    );
    setActiveTabId(tab.id);
    setComposerFocused(true);
    return true;
  }, []);

  const invalidateLoadedSession = useCallback((sessionId: string) => {
    openingSessionIds.current.delete(sessionId);
    loadedSessionCache.current.delete(sessionId);
    sessionLoads.current.delete(sessionId);
    sessionLoadEpochs.current.set(sessionId, (sessionLoadEpochs.current.get(sessionId) ?? 0) + 1);
  }, []);

  const loadStoredSession = useCallback((sessionId: string): Promise<Session | null> => {
    const cached = loadedSessionCache.current.get(sessionId);
    if (cached && !cached.historyLoading) {
      // The cache owns closed sessions only. Transfer this reference into
      // live state instead of retaining a stale duplicate while it changes.
      loadedSessionCache.current.delete(sessionId);
      return Promise.resolve(cached);
    }

    if (cached?.historyLoading) loadedSessionCache.current.delete(sessionId);
    const pending = sessionLoads.current.get(sessionId);
    if (pending) return pending;

    const epoch = sessionLoadEpochs.current.get(sessionId) ?? 0;
    const loading = getSession(sessionId, {
      onHydrated: (original, hydrated) => {
        if (
          removingSessionIds.current.has(sessionId) ||
          (sessionLoadEpochs.current.get(sessionId) ?? 0) !== epoch
        )
          return;
        // Repairs may finish after a new turn, edit, queue operation or tab
        // reload. Never overwrite that state with the older loaded snapshot.
        const owns = (value: Session) =>
          value.id === sessionId &&
          !value.busy &&
          value.blocks === original.blocks &&
          value.queuedMessages === original.queuedMessages;
        if (
          original.historyLoading &&
          !hydrated.historyLoading &&
          hydrated.providerSessionId &&
          !hydrated.worktreeRemoved &&
          isLiveHarness(hydrated.harness) &&
          sessionsRef.current.some(owns)
        ) {
          bindHarnessSession(
            hydrated.harness,
            hydrated.id,
            hydrated.providerSessionId,
            sessionWorkCwd(hydrated),
            hydrated.providerAccountId,
            hydrated.blocks,
          );
        }
        const cached = loadedSessionCache.current.get(sessionId);
        if (cached && owns(cached)) loadedSessionCache.current.set(sessionId, hydrated);
        setSessions((previous) =>
          previous.map((value) =>
            owns(value)
              ? {
                  ...value,
                  blocks: hydrated.blocks,
                  queuedMessages: hydrated.queuedMessages,
                  queueStatus: hydrated.queueStatus,
                  historyLoading: hydrated.historyLoading,
                  historyLoadError: undefined,
                }
              : value,
          ),
        );
      },
      onHydrationFailed: (original) => {
        if ((sessionLoadEpochs.current.get(sessionId) ?? 0) !== epoch) return;
        setSessions((previous) =>
          previous.map((value) =>
            value.id === sessionId && value.blocks === original.blocks && value.historyLoading
              ? {
                  ...value,
                  historyLoadError:
                    "Earlier messages could not be loaded. Reopen this chat to retry.",
                }
              : value,
          ),
        );
      },
    })
      .then((loaded) => {
        if (
          !loaded ||
          removingSessionIds.current.has(sessionId) ||
          (sessionLoadEpochs.current.get(sessionId) ?? 0) !== epoch
        ) {
          return null;
        }
        return loaded;
      })
      .catch(() => null);
    sessionLoads.current.set(sessionId, loading);
    void loading.then(() => {
      if (sessionLoads.current.get(sessionId) === loading) {
        sessionLoads.current.delete(sessionId);
      }
    });
    return loading;
  }, []);

  const ensureOpenSession = useCallback(
    async (sessionId: string): Promise<Session | null> => {
      const open = sessionsRef.current.find((session) => session.id === sessionId);
      if (open) return open;

      openingSessionIds.current.add(sessionId);
      const restored = await loadStoredSession(sessionId);
      if (!restored || removingSessionIds.current.has(sessionId)) {
        openingSessionIds.current.delete(sessionId);
        void refreshHistory(sidebarCwd);
        return null;
      }
      loadedSessionCache.current.delete(sessionId);
      const appeared = sessionsRef.current.find((session) => session.id === sessionId);
      if (appeared) return appeared;
      if (
        !restored.historyLoading &&
        !restored.worktreeRemoved &&
        restored.providerSessionId &&
        isLiveHarness(restored.harness)
      ) {
        bindHarnessSession(
          restored.harness,
          restored.id,
          restored.providerSessionId,
          sessionWorkCwd(restored),
          restored.providerAccountId,
          restored.blocks,
        );
      }
      lastPersisted.current.set(restored.id, persistFingerprint(restored));
      if (!sessionsRef.current.some((session) => session.id === restored.id)) {
        const next = [...sessionsRef.current, restored];
        sessionsRef.current = next;
        setSessions(next);
      }
      return restored;
    },
    [loadStoredSession, refreshHistory, sidebarCwd],
  );

  /** Loads sessions this machine's host runs for another computer, so the
   * Working card shows them without a tab; they unload once seen after done. */
  const loadRunningOnHost = useCallback(
    (sessionIds: string[]) => {
      for (const sessionId of sessionIds) {
        if (openingSessionIds.current.has(sessionId) || removingSessionIds.current.has(sessionId))
          continue;
        void loadStoredSession(sessionId).then((restored) => {
          if (
            !restored ||
            restored.inboxAsk ||
            removingSessionIds.current.has(sessionId) ||
            sessionsRef.current.some((session) => session.id === sessionId)
          )
            return;
          loadedSessionCache.current.delete(sessionId);
          if (
            !restored.worktreeRemoved &&
            restored.providerSessionId &&
            isLiveHarness(restored.harness)
          ) {
            bindHarnessSession(
              restored.harness,
              restored.id,
              restored.providerSessionId,
              sessionWorkCwd(restored),
              restored.providerAccountId,
              restored.blocks,
            );
          }
          lastPersisted.current.set(restored.id, persistFingerprint(restored));
          const next = [
            ...sessionsRef.current,
            { ...restored, busy: false, continuingElsewhere: true },
          ];
          sessionsRef.current = next;
          setSessions(next);
        });
      }
    },
    [loadStoredSession],
  );
  loadRunningOnHostRef.current = loadRunningOnHost;

  const onPopOutSession = useCallback(
    async (
      sessionId: string,
      position: { x: number; y: number; clientX?: number; clientY?: number },
    ) => {
      const session = await ensureOpenSession(sessionId);
      if (!session) return;
      if (!tabsRef.current.some((tab) => leafIds(tab.layout).includes(sessionId))) {
        flushSync(() => {
          const next = [...tabsRef.current, newTab(sessionId)];
          tabsRef.current = next;
          setTabs(next);
        });
      }
      onPopOutPane(sessionId, position);
    },
    [ensureOpenSession, onPopOutPane],
  );

  const onPrefetchHistorySession = useCallback(
    (sessionId: string) => {
      if (
        removingSessionIds.current.has(sessionId) ||
        sessionsRef.current.some((session) => session.id === sessionId) ||
        loadedSessionCache.current.has(sessionId) ||
        sessionLoads.current.has(sessionId) ||
        activeSessionPrefetch.current
      ) {
        return;
      }
      const loading = loadStoredSession(sessionId);
      activeSessionPrefetch.current = loading;
      void loading.then((loaded) => {
        if (
          loaded &&
          !removingSessionIds.current.has(sessionId) &&
          !sessionsRef.current.some((session) => session.id === sessionId)
        ) {
          rememberLoadedSession(loadedSessionCache.current, loaded);
        }
        if (activeSessionPrefetch.current === loading) {
          activeSessionPrefetch.current = null;
        }
      });
    },
    [loadStoredSession],
  );

  const revealLinkedSessionUpdate = useCallback(
    (sessionId: string, update: LinkedSessionUpdate) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (!session?.linkedWorkItem) return;
      if (
        session.linkedWorkItemUpdateCard?.updatedAt === update.updatedAt &&
        session.linkedWorkItemUpdateCard.status !== "error"
      ) {
        return;
      }
      if (linkedWorkItemActivityFetches.current.get(sessionId) === update.updatedAt) {
        return;
      }
      const pending = pendingLinkedWorkItemUpdateCard(update);
      linkedWorkItemActivityFetches.current.set(sessionId, update.updatedAt);
      // A stale/error card should not remain visible while fresh details load.
      // The session itself is already open; this request stays fully detached
      // from the navigation path.
      setLinkedWorkItemUpdateCard(sessionId, (current) =>
        current?.updatedAt === update.updatedAt && current.status === "ready" ? current : undefined,
      );

      void githubWorkItemThread(
        session.cwd,
        session.linkedWorkItem.repo,
        session.linkedWorkItem.kind,
        session.linkedWorkItem.number,
        { force: true },
      ).then(
        (thread) => {
          if (linkedWorkItemActivityFetches.current.get(sessionId) !== pending.updatedAt) {
            return;
          }
          linkedWorkItemActivityFetches.current.delete(sessionId);
          if (linkedSessionUpdatesRef.current.get(sessionId)?.updatedAt !== pending.updatedAt) {
            return;
          }
          setLinkedWorkItemUpdateCard(sessionId, () =>
            completeLinkedWorkItemUpdateCard(pending, thread),
          );
        },
        () => {
          if (linkedWorkItemActivityFetches.current.get(sessionId) !== pending.updatedAt) {
            return;
          }
          linkedWorkItemActivityFetches.current.delete(sessionId);
          if (linkedSessionUpdatesRef.current.get(sessionId)?.updatedAt !== pending.updatedAt) {
            return;
          }
          setLinkedWorkItemUpdateCard(sessionId, () => failLinkedWorkItemUpdateCard(pending));
        },
      );
    },
    [setLinkedWorkItemUpdateCard],
  );

  const onAskInboxItem = useCallback(
    (item: InboxItem): Promise<string> => {
      const key = inboxAskKey(item);
      const pending = openingInboxSessions.current.get(key);
      if (pending) return pending;
      const opening = (async () => {
        let session = sessionsRef.current.find((entry) => entry.inboxAsk?.key === key);
        if (!session) {
          const candidate = item.projectPath || sidebarCwd;
          const cwd =
            candidate && candidate !== "~" ? candidate : await invoke<string>("default_cwd");
          const description =
            item.provider === "linear" || item.provider === "jira"
              ? await inboxTrackerDescription(item)
              : item.provider === "gitlab" && (item.kind === "issue" || item.kind === "pr")
                ? (
                    peekGitlabWorkItemDetails(item.repo, item.kind, item.number) ??
                    (await gitlabWorkItemDetails(item.repo, item.kind, item.number))
                  ).body
                : item.provider === "azuredevops" && (item.kind === "issue" || item.kind === "pr")
                  ? (
                      peekAzureDevOpsWorkItemDetails(item.repo, item.kind, item.number) ??
                      (await azureDevOpsWorkItemDetails(item.repo, item.kind, item.number))
                    ).body
                  : undefined;
          session = {
            ...newDefaultSession(cwd),
            get title() {
              return t("Ask · {p0}", { p0: item.title });
            },
            inboxAsk: {
              key,
              title: item.title,
              url: item.url,
              provider: item.provider,
              description,
            },
          };
          sessionsRef.current = [...sessionsRef.current, session];
          setSessions(sessionsRef.current);
        }
        return session.id;
      })();
      openingInboxSessions.current.set(key, opening);
      void opening.then(
        () => openingInboxSessions.current.delete(key),
        () => openingInboxSessions.current.delete(key),
      );
      return opening;
    },
    [sidebarCwd],
  );

  const onRestartInboxAsk = useCallback(
    async (item: InboxItem): Promise<string> => {
      const id = await onAskInboxItem(item);
      const current = sessionsRef.current.find((session) => session.id === id)!;
      removingSessionIds.current.add(id);
      try {
        await stopSessionForRemoval(id);
        const stopped = sessionsRef.current.find((session) => session.id === id) ?? current;
        await Promise.all(
          sessionChildHarnesses(stopped).map((harness) => forgetHarnessSession(harness, id)),
        );
        const imagePaths = stopped.blocks.flatMap((block) =>
          block.role === "image" && block.image ? [block.image.path] : [],
        );
        await deleteSession(id, imagePaths);
        const fresh = {
          ...newSession(
            stopped.harness,
            stopped.cwd,
            stopped.model,
            stopped.runtimeMode,
            stopped.modelSettings,
          ),
          title: stopped.title,
          inboxAsk: stopped.inboxAsk,
        };
        const next = sessionsRef.current.map((session) => (session.id === id ? fresh : session));
        sessionsRef.current = next;
        setSessions(next);
        setInboxAskPortal((portal) =>
          portal?.sessionId === id ? { ...portal, sessionId: fresh.id } : portal,
        );
        return fresh.id;
      } finally {
        removingSessionIds.current.delete(id);
      }
    },
    [onAskInboxItem, stopSessionForRemoval],
  );

  useEffect(() => {
    if (!inboxAskPortal || !inboxViewOpen) return;
    setComposerFocused(true);
  }, [inboxAskPortal, inboxViewOpen]);

  const onSelectHistorySession = useCallback(
    async (sessionId: string) => {
      workspaceNavigation.cancel();
      let session = await ensureOpenSession(sessionId);
      if (!session || session.inboxAsk) return;
      const parentId = session.orchestrationLeadId ?? orchestrator.forSession(sessionId)?.leadId;
      if (parentId && parentId !== sessionId) {
        setInspectedWorkerId(sessionId);
        session = await ensureOpenSession(parentId);
        if (!session) return;
      }
      const linkedUpdate = linkedSessionUpdatesRef.current.get(session.id);
      if (focusOpenSession(session.id)) {
        if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
        return;
      }
      if (replaceBlankPaneWithSession(session)) {
        followProject(session.cwd);
        if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
        return;
      }
      const tab = newTab(session.id);
      appendTab(tab, session.cwd);
      setActiveTabId(tab.id);
      followProject(session.cwd);
      setComposerFocused(true);
      if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
    },
    [
      appendTab,
      ensureOpenSession,
      focusOpenSession,
      followProject,
      replaceBlankPaneWithSession,
      revealLinkedSessionUpdate,
    ],
  );

  /** Open several history sessions together as a grid in one new tab. */
  const onOpenSessionsSideBySide = useCallback(
    async (sessionIds: string[]) => {
      const wanted = [...new Set(sessionIds)].slice(0, SIDE_BY_SIDE_LIMIT);
      if (wanted.length === 0) return;
      workspaceNavigation.cancel();
      const loaded = await Promise.all(wanted.map((id) => ensureOpenSession(id)));
      const opened = loaded.filter((session): session is Session => !!session && !session.inboxAsk);
      if (opened.length === 0) return;
      if (opened.length === 1) {
        await onSelectHistorySession(opened[0].id);
        return;
      }
      const plan = planOpenSessionsSideBySide({
        tabs: tabsRef.current,
        sessionIds: opened.map((session) => session.id),
      });
      if (!plan) return;
      const cwd = opened[0].cwd;
      const next = insertBesideActive(plan.tabs, plan.tab, cwd);
      tabsRef.current = next;
      setTabs(next);
      setActiveTabId(plan.tab.id);
      setProjectTerminalFocused(false);
      followProject(cwd);
      setComposerFocused(true);
    },
    [ensureOpenSession, followProject, insertBesideActive, onSelectHistorySession],
  );

  const openReminderSession = useCallback(
    async (sessionId: string) => {
      const session = await ensureOpenSession(sessionId);
      if (!session) throw new Error("This conversation is no longer available.");
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setSettingsOpen(false);
      setFilePickerOpen(false);
      setSidebarTab("sessions", session.cwd);
      setProjectCwd(session.cwd);
      setRecents(rememberProject(session.cwd));
      await onSelectHistorySession(sessionId);
    },
    [ensureOpenSession, onSelectHistorySession],
  );

  const ensureReminderSessionsSaved = useCallback(async (ids: readonly string[]) => {
    for (const id of ids) {
      const session = sessionsRef.current.find((session) => session.id === id);
      if (session && !(await upsertSession(session))) {
        throw new Error("Send a message in this conversation before setting a reminder.");
      }
    }
  }, []);

  const sessionReminders = useSessionReminders(
    openReminderSession,
    ensureReminderSessionsSaved,
    sessions.filter((session) => !session.inboxAsk).map((session) => session.id),
  );

  const dismissNoticesForContinuedSession = useCallback(
    (sessionId: string) => {
      void sessionReminders.dismissDue(sessionId);
      const updatedAt = sessionsRef.current.find((session) => session.id === sessionId)
        ?.linkedWorkItemUpdateCard?.updatedAt;
      if (updatedAt == null) return;
      markLinkedSessionUpdateSeen(sessionId, updatedAt);
      setLinkedWorkItemUpdateCard(sessionId, (card) =>
        card?.updatedAt === updatedAt ? undefined : card,
      );
    },
    [sessionReminders.dismissDue, setLinkedWorkItemUpdateCard],
  );

  const onPlaceSessionOnPane = useCallback(
    async (sessionId: string, targetId: string, edge: PaneEdge) => {
      if (isMovingPane(sessionId) || isMovingPane(targetId)) return;
      if (sessionId === targetId) return;
      const targetTab = tabsRef.current.find((tab) => leafIds(tab.layout).includes(targetId));
      if (!targetTab) return;

      const alreadyHere = leafIds(targetTab.layout).includes(sessionId);
      if (!alreadyHere) {
        const session = await ensureOpenSession(sessionId);
        if (!session) return;
      }

      const tab = tabsRef.current.find((entry) => entry.id === targetTab.id);
      if (!tab || !leafIds(tab.layout).includes(targetId)) return;

      const replaceTarget =
        !leafIds(tab.layout).includes(sessionId) &&
        isBlankSession(sessionsRef.current.find((entry) => entry.id === targetId));

      if (replaceTarget) {
        lastPersisted.current.delete(targetId);
        const blank = sessionsRef.current.find((entry) => entry.id === targetId);
        if (blank) void forgetHarnessSession(blank.harness, targetId);
      }

      const result = applyPlaceSessionOnPane({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        sessionId,
        targetId,
        edge,
        replaceTarget,
        scope: tabCloseScope,
        worktreeOf: tabWorktreeOf,
        createReplacement: (seed) =>
          newDefaultSession(seed?.cwd ?? projectCwdRef.current, seed?.runtimeMode),
      });
      if (!result) return;

      sessionsRef.current = result.sessions;
      tabsRef.current = result.tabs;
      setSessions(result.sessions);
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(true);
    },
    [ensureOpenSession, tabCloseScope],
  );

  const onPlaceTabOnPane = useCallback(
    (sourceTabId: string, targetId: string, edge: PaneEdge, tabPosition?: PaneTabDropPosition) => {
      if (movingTabIds.current.has(sourceTabId) || isMovingPane(targetId)) return;
      const sourceTab = tabsRef.current.find((tab) => tab.id === sourceTabId);
      const targetTab = tabsRef.current.find((tab) => leafIds(tab.layout).includes(targetId));
      if (!targetTab) return;
      if (targetTab.id === sourceTabId) {
        if (targetTab.focusedId !== targetId || edge !== "center") {
          onMovePane(targetTab.focusedId, targetId, edge, tabPosition);
        }
        return;
      }

      if (
        sourceTab &&
        filesInWorkspaceTabs([sourceTab]).some((file) => dirtyFilesRef.current.has(file.id))
      ) {
        void message("Save the unsaved files before moving this tab to another workspace tab.", {
          get title() {
            return t("Arrange workspace");
          },
        });
        return;
      }
      const blankTarget = sessionsRef.current.find(
        (session) => session.id === targetId && isBlankSession(session),
      );
      const result = applyPlaceTabOnPane({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        sourceTabId,
        targetId,
        edge,
        tabPosition,
        replaceTarget: blankTarget != null,
      });
      if (!result) return;

      if (blankTarget) {
        lastPersisted.current.delete(blankTarget.id);
        void forgetHarnessSession(blankTarget.harness, blankTarget.id);
      }
      sessionsRef.current = result.sessions;
      tabsRef.current = result.tabs;
      setSessions(result.sessions);
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(result.sessions.some((session) => session.id === result.focusedId));
    },
    [onMovePane],
  );

  const onRenameHistorySession = useCallback(
    async (sessionId: string, displayTitle: string) => {
      const trimmed = displayTitle.trim();
      if (!trimmed) return;
      invalidateLoadedSession(sessionId);

      const open = sessionsRef.current.find((session) => session.id === sessionId);
      if (open) {
        const title = formatSessionTitle(open.harness, trimmed);
        const updated = { ...open, title };
        setSessions((prev) =>
          prev.map((session) => (session.id === sessionId ? updated : session)),
        );
        loadedSessionCache.current.delete(sessionId);
        persistSession(updated);
      } else {
        const restored = await getSession(sessionId).catch(() => null);
        if (!restored) {
          void refreshHistory(sidebarCwd);
          return;
        }
        const updated = {
          ...restored,
          title: formatSessionTitle(restored.harness, trimmed),
        };
        const saved = await upsertSession(updated).catch(() => null);
        if (saved) {
          rememberLoadedSession(loadedSessionCache.current, updated);
          lastPersisted.current.set(sessionId, persistFingerprint(updated));
        }
      }
      void refreshHistory(sidebarCwd);
    },
    [invalidateLoadedSession, persistSession, refreshHistory, sidebarCwd],
  );

  const checkOpenWorktreeFiles = useCallback((path: string) => {
    assertWorktreeFilesClosed(path, [
      ...filesInWorkspaceTabs(tabsRef.current),
      ...projectTerminalsRef.current.flatMap((dock) => dock.pane.files),
    ]);
  }, []);

  const onCheckWorktreeRemoval = useCallback(
    async (cwd: string, path: string, force: boolean) => {
      checkOpenWorktreeFiles(path);
      await checkWorktreeRemoval(cwd, path, force);
      // Re-read UI state after the native check, before deleting sessions.
      checkOpenWorktreeFiles(path);
    },
    [checkOpenWorktreeFiles],
  );

  const onRemoveWorktree = useCallback(
    async (cwd: string, path: string, force: boolean, keepSessions = false) => {
      if (removingWorktreePaths.current.has(path)) {
        throw new Error("This worktree is already being deleted.");
      }
      removingWorktreePaths.current.add(path);
      const lockedIds = new Set<string>();
      const forgottenIds = new Set<string>();
      try {
        if (
          [...switchingWorktrees.current.values()].some((target) => isEqualOrInside(target, path))
        ) {
          throw new Error(
            "A session is selecting this worktree. Try deleting it again once selection finishes.",
          );
        }
        await onCheckWorktreeRemoval(cwd, path, force);
        const listed = await listWorktrees(cwd);
        const tree = listed.worktrees.find((entry) => pathKey(entry.path) === pathKey(path));
        if (!tree) throw new Error("This worktree is no longer available.");
        const ids = worktreeSessionIds(tree, sessionsRef.current);
        if (!keepSessions && ids.length) {
          throw new Error("Move or delete the sessions using this worktree first.");
        }
        if (
          ids.some((id) => removingSessionIds.current.has(id) || switchingWorktrees.current.has(id))
        ) {
          throw new Error(
            "Wait for these sessions to finish changing before deleting the worktree.",
          );
        }
        for (const id of ids) {
          removingSessionIds.current.add(id);
          lockedIds.add(id);
          pendingPersist.current.delete(id);
          invalidateLoadedSession(id);
        }
        for (const id of ids) {
          await stopSessionForRemoval(id);
          const session = sessionsRef.current.find((entry) => entry.id === id);
          if (!session) continue;
          await flushSessionCheckpoint(id);
          forgottenIds.add(id);
          for (const harness of sessionChildHarnesses(session)) {
            await forgetHarnessSession(harness, id);
          }
          const latest = sessionsRef.current.find((entry) => entry.id === id);
          if (!latest) continue;
          const stopped = {
            ...stopStreaming(latest),
            busy: false,
            queueStatus: "paused" as const,
            pendingQuestion: undefined,
          };
          sessionsRef.current = sessionsRef.current.map((entry) =>
            entry.id === id ? stopped : entry,
          );
          setSessions(sessionsRef.current);
          if (shouldPersistSession(stopped)) await upsertSession(stopped);
        }
        await flushSessionWrites();
        checkOpenWorktreeFiles(path);
        const removed = await removeWorktree(cwd, path, force, keepSessions);
        const affected = new Set([...ids, ...removed.sessionIds]);
        if (isEqualOrInside(projectCwdRef.current, path)) {
          setProjectCwd(removed.projectCwd);
          setRecents(rememberProject(removed.projectCwd));
        }
        for (const id of affected) {
          invalidateLoadedSession(id);
          pendingPersist.current.delete(id);
          lastPersisted.current.delete(id);
        }
        sessionsRef.current = sessionsRef.current.map((session) =>
          affected.has(session.id)
            ? detachSessionWorktree(session, removed.projectCwd, path)
            : session,
        );
        setSessions(sessionsRef.current);
        const patchSummary = (entry: SessionSummary) =>
          affected.has(entry.id) ? detachSessionWorktree(entry, removed.projectCwd, path) : entry;
        setHistory((current) => current.map(patchSummary));
        setStoredLinkedSessions((current) => current.map(patchSummary));
        for (const id of affected) notifyReviewChanged(id);
      } catch (error) {
        // Removal may fail after idle agent processes were stopped. Rebind
        // their saved threads so the unchanged working copy can still resume.
        const kept = sessionsRef.current.filter(
          (session) => forgottenIds.has(session.id) && !session.worktreeRemoved,
        );
        bindResumedSessions(kept);
        for (const session of kept) {
          const pending = session.pendingSwitch;
          if (pending?.fromProviderSessionId) {
            bindHarnessSession(
              pending.from,
              session.id,
              pending.fromProviderSessionId,
              sessionWorkCwd(session),
              pending.fromProviderAccountId,
              session.blocks,
            );
          }
        }
        throw error;
      } finally {
        removingWorktreePaths.current.delete(path);
        for (const id of lockedIds) removingSessionIds.current.delete(id);
      }
    },
    [
      checkOpenWorktreeFiles,
      invalidateLoadedSession,
      onCheckWorktreeRemoval,
      stopSessionForRemoval,
    ],
  );

  const onRemoveHistorySession = useCallback(
    async (
      sessionId: string,
      mode: "archive" | "delete",
      skipDeleteConfirm = false,
      // A bulk caller collects errors itself instead of one dialog each.
      onError?: (detail: string) => void,
    ): Promise<boolean> => {
      if (
        removingSessionIds.current.has(sessionId) ||
        switchingWorktrees.current.has(sessionId) ||
        deleteConfirmationPending.current
      )
        return false;
      const open = sessionsRef.current.find((session) => session.id === sessionId);
      const summary = history.find((entry) => entry.id === sessionId);
      const seed = open ?? summary;
      const label = seed ? sessionDisplayTitle(seed.title, seed.harness) : "this session";
      removingSessionIds.current.add(sessionId);
      let deleteWorktreePath: string | undefined;
      if (mode === "delete" && !skipDeleteConfirm) {
        deleteConfirmationPending.current = true;
        let unusedWorktree: string | undefined;
        if (seed?.worktreeCwd) {
          try {
            const { worktrees } = await listWorktrees(seed.cwd);
            const tree = worktrees.find(
              (entry) => pathKey(entry.path) === pathKey(seed.worktreeCwd!),
            );
            if (
              tree &&
              !tree.isMain &&
              !tree.locked &&
              tree.branch &&
              worktreeSessionIds(tree, sessionsRef.current).every((id) => id === sessionId)
            )
              unusedWorktree = tree.path;
          } catch {
            // A failed lookup must never offer filesystem cleanup.
          }
        }
        if (!unusedWorktree) {
          deleteConfirmationPending.current = false;
        } else {
          const choice = await new Promise<SessionDeleteChoice>((resolve) => {
            setSessionDeleteDialog({ title: label, unusedWorktree, resolve });
          });
          deleteConfirmationPending.current = false;
          if (!choice.confirmed) {
            removingSessionIds.current.delete(sessionId);
            return false;
          }
          if (choice.deleteWorktree) deleteWorktreePath = unusedWorktree;
        }
      }
      invalidateLoadedSession(sessionId);
      pendingPersist.current.delete(sessionId);
      try {
        const remover = createSessionRemover({
          mode,
          scope: tabCloseScope,
          worktreeOf: tabWorktreeOf,
          // The blank replacement stays in the tab's worktree, unless that
          // worktree is being deleted along with the session.
          worktreeFor: (removed) => {
            const tab = tabsRef.current.find((entry) => leafIds(entry.layout).includes(removed.id));
            const workspace = tab && tabWorkspace(tab, sessionsRef.current);
            if (
              !workspace ||
              isRemoteProjectPath(removed.cwd) ||
              sameProjectPath(workspace, removed.cwd) ||
              (deleteWorktreePath && sameProjectPath(workspace, deleteWorktreePath))
            )
              return undefined;
            const focus = worktreeFocus(removed.cwd);
            return {
              worktreeCwd: workspace,
              branch:
                (focus && sameProjectPath(focus.path, workspace) ? focus.branch : undefined) ??
                (removed.worktreeCwd && sameProjectPath(removed.worktreeCwd, workspace)
                  ? removed.branch
                  : undefined) ??
                undefined,
            };
          },
          replacement: {
            harness: seed?.harness ?? "cursor",
            cwd: seed?.cwd ?? sidebarCwd,
            model: seed?.model,
            runtimeMode: seed?.runtimeMode,
            modelSettings: open?.modelSettings,
          },
          workspace: {
            snapshot: () => ({
              tabs: tabsRef.current,
              sessions: sessionsRef.current,
              activeTabId: activeTabIdRef.current,
              dirtyFiles: dirtyFilesRef.current,
            }),
            apply: (change) => {
              if (change.type === "stopped") {
                const next = sessionsRef.current.map((session) =>
                  session.id === sessionId ? change.session : session,
                );
                sessionsRef.current = next;
                setSessions(next);
                return;
              }

              if (change.type === "orchestrationReleased") {
                const released = sessionsRef.current.map((session) =>
                  releaseOrchestrationWorker(session, change.leadId),
                );
                sessionsRef.current = released;
                setSessions(released);
                for (const [id, cached] of loadedSessionCache.current) {
                  if (releaseOrchestrationWorker(cached, change.leadId) !== cached)
                    invalidateLoadedSession(id);
                }
                // Pending reads may still carry the deleted lead's ownership.
                for (const id of sessionLoads.current.keys()) {
                  invalidateLoadedSession(id);
                }
                for (const [id, pending] of pendingPersist.current) {
                  pendingPersist.current.set(
                    id,
                    releaseOrchestrationWorker(pending, change.leadId),
                  );
                }
                const releaseSummary = (entry: SessionSummary) =>
                  entry.orchestrationLeadId === change.leadId
                    ? { ...entry, orchestrationLeadId: undefined }
                    : entry;
                setHistory((current) => current.map(releaseSummary));
                setStoredLinkedSessions((current) => current.map(releaseSummary));
                return;
              }

              const { removal } = change;
              lastPersisted.current.delete(sessionId);
              pendingPersist.current.delete(sessionId);
              const closingFiles = filesInWorkspaceTabs(removal.closedTabs);
              setDirtyFiles((current) => {
                const next = new Set(current);
                for (const file of closingFiles) next.delete(file.id);
                return next;
              });
              sessionsRef.current = removal.sessions;
              tabsRef.current = removal.tabs;
              setSessions(removal.sessions);
              setTabs(removal.tabs);
              if (removal.activeTabId !== activeTabIdRef.current) {
                activateTab(removal.activeTabId);
              }
              const activeTab = removal.tabs.find((tab) => tab.id === removal.activeTabId);
              setComposerFocused(
                removal.sessions.some((session) => session.id === activeTab?.focusedId),
              );
              if (change.mode === "archive") {
                if (change.session && shouldPersistSession(change.session)) {
                  rememberLoadedSession(loadedSessionCache.current, change.session);
                }
                const archived =
                  change.savedSummary ??
                  summary ??
                  (change.session && summaryFromSession(change.session));
                if (archived) {
                  setHistory((current) =>
                    mergeHistorySummary(current, {
                      ...archived,
                      archived: true,
                    }),
                  );
                }
              } else {
                setHistory((current) => current.filter((entry) => entry.id !== sessionId));
                void refreshHistory(sidebarCwd);
              }
            },
          },
          confirm: async (closedTabs, removalMode) => {
            const files = filesInWorkspaceTabs(closedTabs);
            const unsaved = files.some(
              (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
            );
            if (
              unsaved &&
              !(await confirmDiscardUnsaved(
                `${removalMode === "archive" ? "Archive" : "Delete"} this conversation with unsaved files?`,
              ))
            )
              return false;
            const terminals = files.filter((file) => file.terminal);
            return terminals.length === 0 || (await confirmCloseTerminals(terminals));
          },
          stop: stopSessionForRemoval,
        });
        const removed = await remover.remove(sessionId);
        if (removed && deleteWorktreePath && seed) {
          try {
            await onRemoveWorktree(seed.cwd, deleteWorktreePath, false);
          } catch (error) {
            void message(
              `The session was deleted. Its worktree was kept.\n\n${String(error)}\n\nYou can manage it in Settings → Worktrees.`,
              { title: appName(), kind: "warning" },
            );
          }
        }
        return removed;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (onError) {
          onError(detail);
          return false;
        }
        void message(`Could not ${mode} this conversation.\n\n${detail}`, {
          title: appName(),
          kind: "error",
        });
        return false;
      } finally {
        removingSessionIds.current.delete(sessionId);
      }
    },
    [
      activateTab,
      history,
      invalidateLoadedSession,
      refreshHistory,
      sidebarCwd,
      stopSessionForRemoval,
      tabCloseScope,
      onRemoveWorktree,
    ],
  );

  const onArchiveHistorySession = useCallback(
    async (sessionId: string, archived: boolean) => {
      if (archived) return onRemoveHistorySession(sessionId, "archive");
      if (removingSessionIds.current.has(sessionId)) return false;
      try {
        await setSessionArchived(sessionId, false);
        setHistory((current) =>
          current.map((entry) => (entry.id === sessionId ? { ...entry, archived: false } : entry)),
        );
        return true;
      } catch (error) {
        void message(`Could not unarchive this conversation.\n\n${String(error)}`, {
          title: appName(),
          kind: "error",
        });
        return false;
      }
    },
    [onRemoveHistorySession],
  );

  const onArchiveFocusedSession = useCallback(
    (event: KeyboardEvent) => {
      archiveFocusedSession(
        event,
        {
          activeTabId: activeTabIdRef.current,
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          projectTerminalFocused: projectTerminalFocusedRef.current,
          surfaceOpen: Boolean(
            searchViewOpenRef.current ||
            inboxViewOpenRef.current ||
            notesViewOpenRef.current ||
            automationsViewOpenRef.current ||
            settingsOpenRef.current ||
            filePickerOpenRef.current ||
            whatsNewVersionRef.current,
          ),
        },
        (sessionId) => {
          void onArchiveHistorySession(sessionId, true);
        },
      );
    },
    [onArchiveHistorySession],
  );

  const onToggleNotesPanel = useCallback((event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      !shouldToggleNotesPanel({
        enabled: loadNotesEnabled(),
        activeTabId: activeTabIdRef.current,
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        projectTerminalFocused: projectTerminalFocusedRef.current,
        surfaceOpen: Boolean(
          searchViewOpenRef.current ||
          inboxViewOpenRef.current ||
          notesViewOpenRef.current ||
          automationsViewOpenRef.current ||
          settingsOpenRef.current ||
          filePickerOpenRef.current ||
          whatsNewVersionRef.current,
        ),
        inSessionArea:
          !target ||
          target === document.body ||
          (!target.closest(".cm-editor, .bycoda-terminal") &&
            Boolean(target.closest("[data-session-drop], [data-notes-panel]"))),
      })
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    toggleNotesPanel();
  }, []);

  const onPinHistorySession = useCallback(async (sessionId: string, pinned: boolean) => {
    const open = sessionsRef.current.find((session) => session.id === sessionId);
    if (open && shouldPersistSession(open)) {
      await upsertSession(open).catch((error) => {
        console.warn("App operation failed", error);
      });
    }
    await setSessionPinned(sessionId, pinned).catch((error) => {
      console.warn("App operation failed", error);
    });
    setHistory((current) => {
      const existing = current.find((entry) => entry.id === sessionId);
      if (existing) {
        return mergeProjectHistorySummary(current, { ...existing, pinned });
      }
      if (!open) return current;
      return mergeProjectHistorySummary(current, {
        ...summaryFromSession(open),
        pinned,
      });
    });
  }, []);

  const onSetHistorySessionLinkedWorkItem = useCallback(
    (sessionId: string, linkedWorkItem: LinkedWorkItem | undefined) => {
      const previousLinkedWorkItem =
        sessionsRef.current.find((session) => session.id === sessionId)?.linkedWorkItem ??
        history.find((session) => session.id === sessionId)?.linkedWorkItem;
      invalidateLoadedSession(sessionId);
      loadedSessionCache.current.delete(sessionId);

      const nextSessions = sessionsRef.current.map((session) =>
        session.id === sessionId ? { ...session, linkedWorkItem } : session,
      );
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      setHistory((current) =>
        current.map((session) =>
          session.id === sessionId ? { ...session, linkedWorkItem } : session,
        ),
      );
      setStoredLinkedSessions((current) =>
        linkedWorkItem
          ? current.map((session) =>
              session.id === sessionId ? { ...session, linkedWorkItem } : session,
            )
          : current.filter((session) => session.id !== sessionId),
      );
      setLinkedWorkItemPanels((current) => {
        if (!current.has(sessionId)) return current;
        const next = new Map(current);
        next.delete(sessionId);
        return next;
      });

      void setSessionLinkedWorkItem(sessionId, linkedWorkItem).catch((error) => {
        const rolledBackSessions = sessionsRef.current.map((session) =>
          session.id === sessionId && session.linkedWorkItem === linkedWorkItem
            ? { ...session, linkedWorkItem: previousLinkedWorkItem }
            : session,
        );
        sessionsRef.current = rolledBackSessions;
        setSessions(rolledBackSessions);
        setHistory((current) =>
          current.map((session) =>
            session.id === sessionId && session.linkedWorkItem === linkedWorkItem
              ? { ...session, linkedWorkItem: previousLinkedWorkItem }
              : session,
          ),
        );
        setStoredLinkedSessions((current) =>
          previousLinkedWorkItem
            ? current.map((session) =>
                session.id === sessionId
                  ? {
                      ...session,
                      linkedWorkItem: previousLinkedWorkItem,
                    }
                  : session,
              )
            : current.filter((session) => session.id !== sessionId),
        );
        void refreshHistory(sidebarCwd);
        void message(`Could not update this conversation's GitHub link.\n\n${String(error)}`, {
          title: appName(),
          kind: "error",
        });
      });
    },
    [history, invalidateLoadedSession, refreshHistory, sidebarCwd],
  );

  const onArchiveHistorySessions = useCallback(
    async (sessionIds: readonly string[], archived: boolean) => {
      for (const sessionId of sessionIds) {
        if (!(await onArchiveHistorySession(sessionId, archived))) break;
      }
    },
    [onArchiveHistorySession],
  );

  const onPinHistorySessions = useCallback(
    async (sessionIds: readonly string[], pinned: boolean) => {
      await Promise.all(sessionIds.map((sessionId) => onPinHistorySession(sessionId, pinned)));
    },
    [onPinHistorySession],
  );

  const onDeleteWorktreeSessions = useCallback(
    async (sessionIds: readonly string[]): Promise<boolean> => {
      for (const sessionId of sessionIds) {
        if (!(await onRemoveHistorySession(sessionId, "delete", true))) {
          return false;
        }
      }
      return true;
    },
    [onRemoveHistorySession],
  );

  const onDeleteHistorySession = useCallback(
    (sessionId: string) => onRemoveHistorySession(sessionId, "delete"),
    [onRemoveHistorySession],
  );

  const onDeleteHistorySessions = useCallback(
    async (sessionIds: readonly string[]) => {
      if (sessionIds.length === 0) return;
      if (
        !(await confirmSessionDelete(
          `Delete ${sessionIds.length} selected conversations? This can’t be undone.`,
        ))
      )
        return;
      for (const sessionId of sessionIds) {
        if (!(await onRemoveHistorySession(sessionId, "delete", true))) break;
      }
    },
    [onRemoveHistorySession],
  );

  const onDeleteHistorySessionNow = useCallback(
    async (sessionId: string, skipWorktreeConfirm = true): Promise<boolean> => {
      const failures: string[] = [];
      const removed = await onRemoveHistorySession(
        sessionId,
        "delete",
        skipWorktreeConfirm,
        (detail) => failures.push(detail),
      );
      if (failures.length > 0) throw new Error(failures[0]);
      return removed;
    },
    [onRemoveHistorySession],
  );

  const sessionIdsInTitleTab = useCallback((tabId: string): string[] => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId);
    if (!tab) return [];
    const openSessionIds = new Set(sessionsRef.current.map((session) => session.id));
    return leafIds(tab.layout).filter((id) => openSessionIds.has(id));
  }, []);

  const onArchiveTitleTab = useCallback(
    (tabId: string) => {
      const sessionIds = sessionIdsInTitleTab(tabId);
      void onArchiveHistorySessions(sessionIds, true);
    },
    [onArchiveHistorySessions, sessionIdsInTitleTab],
  );

  const onDeleteTitleTab = useCallback(
    (tabId: string) => {
      const sessionIds = sessionIdsInTitleTab(tabId);
      if (sessionIds.length === 1) {
        void onDeleteHistorySession(sessionIds[0]);
      } else if (sessionIds.length > 1) {
        void onDeleteHistorySessions(sessionIds);
      }
    },
    [onDeleteHistorySession, onDeleteHistorySessions, sessionIdsInTitleTab],
  );

  const onFocusDir = useCallback(
    (dir: FocusDir) => {
      if (!activeTab) return;
      const next = neighborLeafId(activeTab.layout, activeTab.focusedId, dir);
      if (next) onFocusPane(next);
    },
    [activeTab, onFocusPane],
  );

  const onRatio = useCallback((tabId: string, splitId: string, index: number, ratio: number) => {
    if (windowTransferPendingRef.current || movingTabIds.current.has(tabId)) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, layout: setSplitRatio(t.layout, splitId, index, ratio) } : t,
      ),
    );
  }, []);

  const onCwdChange = useCallback(
    (sessionId: string, cwd: string) => {
      const normalized = normalizeProjectPath(cwd);
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      const previous = current?.cwd;
      // Threads stay bound to their project. Switching from the composer opens a
      // new tab instead of retargeting the conversation.
      if (
        current &&
        previous &&
        looksLikeProject(previous) &&
        !sameProjectPath(previous, normalized) &&
        !isBlankSession(current)
      ) {
        setProjectCwd(normalized);
        setRecents(rememberProject(normalized));
        const session = newSession(
          current.harness,
          normalized,
          current.model,
          current.runtimeMode,
          current.modelSettings,
        );
        const tab = newTab(session.id);
        setSessions((prev) => [...prev, session]);
        appendTab(tab, normalized);
        setActiveTabId(tab.id);
        setComposerFocused(true);
        return;
      }
      if (previous && !sameProjectPath(previous, normalized) && previous !== "~") {
        void keepSessionChanges(sessionId, previous).catch((error) => {
          console.warn("App operation failed", error);
        });
      }
      setProjectCwd(normalized);
      setRecents(rememberProject(normalized));
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          // A blank session moving into a project adopts its provider defaults;
          // a conversation keeps its own provider.
          const base = isBlankSession(s) ? retargetSessionToProject(s, normalized) : s;
          return {
            ...base,
            cwd: normalized,
            branch: undefined,
            worktreeCwd: undefined,
            worktreeRemoved: undefined,
            workspaceMode: undefined,
            worktreeBase: undefined,
          };
        }),
      );
      // The session's project just moved in place; a group only holds tabs that
      // share one project, so drop this tab out if it no longer matches.
      setTabs((prev) => {
        const tab = prev.find((t) => leafIds(t.layout).includes(sessionId));
        // The tab's visible project follows its focused pane; a background
        // pane changing project doesn't change what the group check should see.
        if (!tab?.groupId || tab.focusedId !== sessionId) return prev;
        const newProject = projectName(normalized);
        const othersProject = tabGroupProject(
          prev.filter((t) => t.id !== tab.id),
          tab.groupId,
          projectOfTab,
        );
        if (othersProject && newProject && othersProject !== newProject) {
          return removeTabFromGroup(prev, tab.id);
        }
        return prev;
      });
      notifyReviewChanged(sessionId);
    },
    [appendTab, projectOfTab],
  );

  const onBranchChange = useCallback(
    (sessionId: string) => {
      notifyGitChanged();
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current) return;
      void forgetHarnessSession(current.harness, sessionId);
      const next = {
        ...current,
        branch: undefined,
        providerSessionId: undefined,
        context: undefined,
      };
      sessionsRef.current = sessionsRef.current.map((s) => (s.id === sessionId ? next : s));
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? next : s)));
      persistSession(next);
      notifyReviewChanged(sessionId);
    },
    [persistSession],
  );

  const onWorkspaceModeChange = useCallback(
    (sessionId: string, mode: WorkspaceMode, base?: string) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (
            session.id !== sessionId ||
            (!isBlankSession(session) &&
              !(session.workspaceMode && !session.worktreeCwd && !session.busy))
          ) {
            return session;
          }
          return mode === "worktree"
            ? base || session.worktreeBase
              ? {
                  ...session,
                  workspaceMode: "worktree",
                  worktreeBase: base || session.worktreeBase,
                }
              : session
            : {
                ...session,
                workspaceMode: undefined,
                worktreeBase: undefined,
              };
        }),
      );
    },
    [],
  );

  const onWorktreeBaseChange = useCallback((sessionId: string, base: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId &&
        (isBlankSession(session) ||
          (!!session.workspaceMode && !session.worktreeCwd && !session.busy)) &&
        session.workspaceMode === "worktree"
          ? { ...session, worktreeBase: base }
          : session,
      ),
    );
  }, []);

  const onWorktreeChange = useCallback(
    async (
      sessionId: string,
      tree: Worktree,
      fromComposer = false,
      isCurrent: () => boolean = () => true,
    ) => {
      if (!isCurrent()) return;
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (
        !current ||
        current.busy ||
        removingSessionIds.current.has(sessionId) ||
        switchingWorktrees.current.has(sessionId)
      ) {
        throw new Error("Wait for this session to finish before changing working copies.");
      }
      if (!current.worktreeRemoved && pathKey(sessionWorkCwd(current)) === pathKey(tree.path))
        return;
      if ([...removingWorktreePaths.current].some((path) => isEqualOrInside(tree.path, path))) {
        throw new Error("This worktree is being deleted. Select another working copy.");
      }
      if (!current.worktreeRemoved && current.queuedMessages?.length) {
        throw new Error("Clear queued messages before changing working copies.");
      }
      const run = orchestrator.forSession(sessionId);
      if (run && ["active", "paused"].includes(run.status)) {
        throw new Error("Stop this orchestration run before changing working copies.");
      }
      switchingWorktrees.current.set(sessionId, tree.path);
      pendingPersist.current.delete(sessionId);
      try {
        const listed = await listWorktrees(current.cwd);
        if (!isCurrent()) return;
        const target = listed.worktrees.find(
          (entry) => pathKey(entry.path) === pathKey(tree.path) && !entry.missing,
        );
        if (!target) {
          throw new Error("This worktree is no longer available. Refresh the picker.");
        }
        const source = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !source ||
          source.busy ||
          source.cwd !== current.cwd ||
          sessionWorkCwd(source) !== sessionWorkCwd(current)
        ) {
          throw new Error("The session changed. Try selecting the working copy again.");
        }
        const selected = sessionInWorktree(source, target);
        if (selected.id !== sessionId) {
          // Leave the original conversation, checkpoints, and live provider
          // context attached to the files they describe.
          const tab = newTab(selected.id);
          if (fromComposer) workspacePins.current.set(selected.id, currentWorkspace(source.cwd));
          sessionsRef.current = [...sessionsRef.current, selected];
          setSessions(sessionsRef.current);
          appendTab(tab, selected.cwd);
          setActiveTabId(tab.id);
          setComposerFocused(true);
          return;
        }
        await flushSessionCheckpoint(sessionId);
        if (!isCurrent()) return;
        for (const harness of sessionChildHarnesses(source)) {
          await forgetHarnessSession(harness, sessionId);
          if (!isCurrent()) return;
        }
        const latest = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !latest ||
          (!latest.worktreeRemoved && !isBlankSession(latest)) ||
          latest.cwd !== current.cwd ||
          sessionWorkCwd(latest) !== sessionWorkCwd(current)
        ) {
          throw new Error("The session changed. Try selecting the working copy again.");
        }
        const next = sessionInWorktree(latest, target);
        if (fromComposer) workspacePins.current.set(sessionId, currentWorkspace(latest.cwd));
        else workspacePins.current.delete(sessionId);
        if (latest.worktreeRemoved) await keepSessionChanges(sessionId, target.path);
        pendingPersist.current.delete(sessionId);
        if (shouldPersistSession(next)) await upsertSession(next);
        if (!isCurrent()) return;
        invalidateLoadedSession(sessionId);
        sessionsRef.current = sessionsRef.current.map((s) => (s.id === sessionId ? next : s));
        setSessions(sessionsRef.current);
        notifyGitChanged();
        notifyReviewChanged(sessionId);
        void refreshHistory(next.cwd);
      } finally {
        switchingWorktrees.current.delete(sessionId);
      }
    },
    [appendTab, invalidateLoadedSession, refreshHistory, setActiveTabId],
  );

  const onComposerWorktreeChange = useCallback(
    (sessionId: string, tree: Worktree) => onWorktreeChange(sessionId, tree, true),
    [onWorktreeChange],
  );

  const onSelectWorkspace = useCallback(
    (focus?: WorktreeFocus) => {
      setProjectCwd(sidebarCwdRef.current);
      workspaceNavigation.selectWorkspace(sidebarCwdRef.current, focus);
    },
    [workspaceNavigation.selectWorkspace],
  );

  /**
   * Open a run of folders from one snapshot, committed in a single transition.
   *
   * Planning per folder from refs would read state React has not rendered yet,
   * so the whole run is planned first and applied here in selection order.
   */
  const [nameConflicts, setNameConflicts] = useState<AutoNamedProject[]>([]);
  /**
   * Projects the user just added under a name the rail already shows. Each one
   * gets a unique name at once, so closing the dialog leaves no two rows alike,
   * and is then offered for renaming.
   */
  const promptAddedProjectNames = useCallback((before: readonly string[]) => {
    const added = newProjectPaths(
      before,
      loadRecents().map((item) => item.path),
    );
    const found = added.flatMap((path) => {
      const remote = remoteProjectFor(path);
      const machine = remote ? knownRemoteMachine(remote.environmentId) : undefined;
      const named = autoNameOnConflict(path, machine?.name);
      return named ? [named] : [];
    });
    if (found.length > 0) setNameConflicts((prev) => [...prev, ...found]);
  }, []);

  const openProjects = useCallback(
    (paths: readonly string[]) => {
      const knownBefore = loadRecents().map((item) => item.path);
      const steps = planProjectOpenRun({
        memory: readProjectReturnMemory(),
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        activeTabId: activeTabIdRef.current,
        paths,
      });
      const last = steps[steps.length - 1];
      if (!last) return;

      // After the early return, not before it. `pickFolders` hands back an
      // empty list when the picker is dismissed, and every path failing
      // `looksLikeProject` comes out the same way — so closing these first
      // meant cancelling a folder picker shut whatever the user had open.
      // Nothing below opens a project without also leaving one of these views.
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);

      // At most one folder can take the blank session, and it keeps the
      // retargeting rules `onCwdChange` already owns.
      const blank = steps.find(
        (step): step is Extract<ProjectOpenStep, { action: "reuse-blank" }> =>
          step.action === "reuse-blank",
      );
      if (blank) onCwdChange(blank.sessionId, blank.path);

      const created = steps.filter(
        (step): step is Extract<ProjectOpenStep, { action: "create" }> => step.action === "create",
      );
      if (created.length > 0) {
        setSessions((prev) => [...prev, ...created.map((step) => step.session)]);
        // Each tab sits beside the one before it in the run, so the folders keep
        // their selection order.
        setTabs((prev) =>
          created.reduce(
            (tabs, step) => insertBeside(tabs, step.tab, step.besideTabId, step.path),
            prev,
          ),
        );
      }

      // The folder chosen last ends up focused.
      switch (last.action) {
        case "create":
          setProjectCwd(last.path);
          setActiveTabId(last.tab.id);
          setComposerFocused(true);
          break;
        case "activate":
          setProjectCwd(last.path);
          activateTab(last.tabId, last.paneId);
          break;
        case "keep":
          setProjectCwd(last.path);
          break;
        case "reuse-blank":
          // `onCwdChange` already moved to it.
          break;
      }
      // Every project opened is remembered, the one chosen last most recently.
      for (const step of steps) setRecents(rememberProject(step.path));
      promptAddedProjectNames(knownBefore);
    },
    [activateTab, insertBeside, onCwdChange, promptAddedProjectNames, readProjectReturnMemory],
  );

  const onSelectProject = useCallback(
    (path: string) => {
      workspaceNavigation.cancel();
      openProjects([path]);
      workspaceNavigation.selectProject(path);
    },
    [openProjects, workspaceNavigation.cancel, workspaceNavigation.selectProject],
  );

  // A locked project is never on screen. This catches a lock taken while the
  // project was open, a restored tab, and a notification click alike. Nothing
  // is closed: the project's tabs and running agents stay as they are, out of
  // sight, and come back when the group is unlocked.
  const activeProjectLocked = isProjectLockedIn(lockSnapshot, sidebarCwd);
  useLayoutEffect(() => {
    if (!activeProjectLocked) return;
    const next = visibleRecents.find((project) => looksLikeProject(project.path));
    if (next) {
      openProjects([next.path]);
      return;
    }
    // Nothing unlocked to go to: a blank session with no project.
    const session = newDefaultSession("~", sessionDefaults?.runtimeMode);
    const tab = newTab(session.id);
    setSessions((prev) => [...prev, session]);
    appendTab(tab, "~");
    setActiveTabId(tab.id);
    setProjectCwd("~");
  }, [
    activeProjectLocked,
    activeTabId,
    appendTab,
    openProjects,
    sessionDefaults?.runtimeMode,
    sidebarCwd,
    visibleRecents,
  ]);

  const pickProject = useCallback(async () => {
    // Several folders can be taken at once; each opens as its own project, and
    // the last one selected ends up focused.
    openProjects(await pickFolders());
  }, [openProjects]);

  const openSyncedProject = useCallback(
    async (projectId: string, name: string) => {
      // Opening it remotely puts it on the rail before it is selected.
      const knownBefore = loadRecents().map((item) => item.path);
      const remote = await openSyncedProjectRemotely(projectId);
      if (remote.status === "opened") {
        promptAddedProjectNames(knownBefore);
        onSelectProject(remote.key);
      }
      // Its machine is saved here but did not answer: the row stays and can be
      // clicked again. With no such machine there is nothing to open.
      else if (remote.status === "failed")
        console.warn("[sync] could not open", name, remote.error);
    },
    [onSelectProject, promptAddedProjectNames],
  );

  /**
   * Open the folders of a VS Code workspace file as projects, collected in a
   * rail group named after the file.
   */
  const openCodeWorkspace = useCallback(async () => {
    const title = "Open VS Code workspace";
    const file = await pickCodeWorkspaceFile();
    if (!file) return;
    try {
      const workspace = parseCodeWorkspace(await readTextFile(file), file);
      const present = await Promise.all(
        workspace.folders.map((folder) =>
          listDir(folder).then(
            () => true,
            () => false,
          ),
        ),
      );
      const found = workspace.folders.filter((_, index) => present[index]);
      const skipped = [
        ...workspace.folders.filter((_, index) => !present[index]),
        ...workspace.unsupported,
      ];
      if (found.length === 0) {
        await message(
          skipped.length > 0
            ? `None of the workspace's folders could be opened:\n\n${skipped.join("\n")}`
            : "The workspace has no folders.",
          { title, kind: "error" },
        );
        return;
      }
      saveWorkspaceProjectNames(found, workspace.folderNames);
      openProjects(found);
      const group = assignProjectsToNamedGroup(workspace.name, found);
      // Folders skipped above are not listed, so they join the group later if
      // they appear on disk and are still in the file.
      if (group) linkProjectGroup(group.id, file, found);
      if (skipped.length > 0) {
        await message(
          `These folders could not be opened and were skipped:\n\n${skipped.join("\n")}`,
          { title, kind: "warning" },
        );
      }
    } catch (error) {
      await message(error instanceof Error ? error.message : String(error), {
        title,
        kind: "error",
      });
    }
  }, [openProjects]);

  useEffect(() => {
    const open = () => void openCodeWorkspace();
    window.addEventListener(OPEN_CODE_WORKSPACE_EVENT, open);
    return () => window.removeEventListener(OPEN_CODE_WORKSPACE_EVENT, open);
  }, [openCodeWorkspace]);

  // Groups linked to a workspace file follow it; new folders land on the rail
  // without moving focus.
  useLinkedWorkspaceGroups(useCallback(() => setRecents(loadRecents()), []));

  // A group's git overview opens a project's Changes tab.
  useEffect(() => {
    const open = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (typeof path !== "string" || !path) return;
      setSidebarTab("changes", path);
      onSelectProject(path);
    };
    window.addEventListener(OPEN_PROJECT_CHANGES_EVENT, open);
    return () => window.removeEventListener(OPEN_PROJECT_CHANGES_EVENT, open);
  }, [onSelectProject, setSidebarTab]);

  const [resumePickerFor, setResumePickerFor] = useState<ClaudeImportTarget | null>(null);

  const onResumeProviderSession = useCallback((sessionId: string) => {
    const source = sessionsRef.current.find((session) => session.id === sessionId);
    if (!source) return;
    if (isRemoteProjectPath(source.cwd)) return;
    if (source.harness === "codex") {
      requestSessionImport({ cwd: sessionWorkCwd(source), provider: "codex" });
      return;
    }
    if (source.harness !== "claude") return;
    setResumePickerFor({
      sessionId,
      // Claude files conversations under the directory it ran in, which for a
      // worktree session is the checkout rather than the project root.
      cwd: sessionWorkCwd(source),
      turnGen: turnGen.current.get(sessionId) ?? 0,
      ...(source.providerAccountId ? { providerAccountId: source.providerAccountId } : {}),
    });
  }, []);

  /**
   * Load a conversation Claude Code recorded into the thread the command was
   * run from, and bind it so the next turn continues that conversation rather
   * than starting a new one.
   */
  const importClaudeConversation = useCallback(
    async (target: ClaudeImportTarget, summary: ClaudeSessionSummary) => {
      // Each step below is a round trip the thread can change across, so the
      // target is rechecked at every one rather than once at the start. The
      // picker has already closed by now, so the composer is live throughout.
      const stillTarget = () =>
        claudeImportTarget(sessionsRef.current, target, turnGen.current.get(target.sessionId) ?? 0);
      if (!stillTarget()) return;
      const transcript = await readTextFile(summary.path).catch(() => null);
      if (transcript === null) return;
      if (!stillTarget()) return;

      // A child that is already running ignores the new binding: `ensureLive`
      // hands back the existing one before the resume state is read, so the
      // next turn would carry on the old conversation. Stopping it first makes
      // that turn spawn with `--resume`; the resume state itself survives.
      await stopHarnessSession("claude", target.sessionId).catch(() => undefined);
      if (!stillTarget()) return;

      setSessions((current) =>
        current.map((session) =>
          session.id === target.sessionId
            ? buildImportedSession({
                base: session,
                transcript,
                providerSessionId: summary.id,
                providerAccountId: session.providerAccountId,
              })
            : session,
        ),
      );
      bindHarnessSession(
        "claude",
        target.sessionId,
        summary.id,
        // Claude only resumes when the bound directory matches the one the
        // next turn runs in — which is the directory these conversations were
        // listed for, the checkout rather than the project root.
        target.cwd,
        target.providerAccountId,
      );
    },
    [],
  );

  const onPlaceSessionInFolder = useCallback((sessionId: string, target: SessionFolderTarget) => {
    const source = sessionsRef.current.find((session) => session.id === sessionId);
    if (!source || !looksLikeProject(source.cwd)) return;
    const folders = loadSessionFolders(source.cwd);
    if (target.kind === "existing" && !folders.some((folder) => folder.id === target.folderId)) {
      return;
    }
    saveSessionFolders(
      source.cwd,
      placeSessionInFolder(
        folders,
        isRemoteProjectPath(source.cwd) ? (remoteSessionFor(sessionId) ?? sessionId) : sessionId,
        target,
      ),
    );
  }, []);

  const onRemoveProject = useCallback(
    async (path: string, options: { purgeData: boolean }) => {
      const normalized = normalizeProjectPath(path);
      if (options.purgeData) {
        const projectSessions = sessionsRef.current.filter((session) =>
          sameProjectPath(session.cwd, normalized),
        );
        if (
          projectSessions.some(
            (session) => session.busy || removingSessionIds.current.has(session.id),
          )
        ) {
          throw new Error(
            t(
              "Selection changed or a project is working. Close this dialog and review your selection.",
            ),
          );
        }
        // Keep the project visible on storage failure and prevent autosave from
        // recreating a session while its persisted data is being removed.
        for (const session of projectSessions) removingSessionIds.current.add(session.id);
        try {
          await removeProjectData(normalized);
        } finally {
          for (const session of projectSessions) removingSessionIds.current.delete(session.id);
        }
      }
      const wasCurrent = sameProjectPath(projectCwdRef.current, normalized);
      const remaining = options.purgeData ? forgetProject(normalized) : archiveProject(normalized);
      if (options.purgeData) {
        forgetProjectLocation(normalized);
        setSidebarTabSelection((current) =>
          sameProjectPath(current.project, normalized)
            ? { project: "~", tab: loadProjectSidebarTab("~") }
            : current,
        );
      }
      setRecents(remaining);

      const tabs = tabsRef.current;
      const sessions = sessionsRef.current;
      const projectTabs = filterTabsForProject(tabs, sessions, normalized);
      const projectTabIds = new Set(projectTabs.map((tab) => tab.id));
      const projectSessions = sessions.filter((session) =>
        sameProjectPath(session.cwd, normalized),
      );
      const projectSessionIds = new Set(projectSessions.map((session) => session.id));

      if (options.purgeData) {
        const cachedOrLoading = new Set([
          ...loadedSessionCache.current.keys(),
          ...sessionLoads.current.keys(),
        ]);
        for (const sessionId of cachedOrLoading) {
          invalidateLoadedSession(sessionId);
        }
        for (const session of projectSessions) {
          pendingPersist.current.delete(session.id);
          if (session.busy) {
            turnGen.current.set(session.id, (turnGen.current.get(session.id) ?? 0) + 1);
            for (const id of sessionChildHarnesses(session)) {
              void cancelHarnessTurn(id, session.id);
            }
          }
          for (const id of sessionChildHarnesses(session)) {
            void forgetHarnessSession(id, session.id);
          }
          lastPersisted.current.delete(session.id);
        }
      } else {
        for (const session of projectSessions) {
          if (session.busy) continue;
          if (shouldPersistSession(session)) {
            rememberLoadedSession(loadedSessionCache.current, session);
          }
          persistSession(session);
          pendingPersist.current.delete(session.id);
          for (const id of sessionChildHarnesses(session)) {
            void forgetHarnessSession(id, session.id);
          }
        }
      }

      let nextTabs = tabs.filter((tab) => !projectTabIds.has(tab.id));
      let nextSessions = sessions.filter((session) => {
        if (!projectSessionIds.has(session.id)) return true;
        return !options.purgeData && session.busy;
      });
      let nextActiveTabId = activeTabIdRef.current;

      if (nextTabs.length === 0) {
        const fallback = nextSessions[0];
        const session = newDefaultSession("~", fallback?.runtimeMode);
        const tab = newTab(session.id);
        nextSessions = [...nextSessions, session];
        nextTabs = [tab];
        nextActiveTabId = tab.id;
      } else if (projectTabIds.has(nextActiveTabId)) {
        nextActiveTabId = nextTabs[0]?.id ?? nextActiveTabId;
      }

      sessionsRef.current = nextSessions;
      tabsRef.current = nextTabs;
      activeTabIdRef.current = nextActiveTabId;
      setSessions(nextSessions);
      setTabs(nextTabs);
      if (nextActiveTabId !== activeTabId) {
        setActiveTabId(nextActiveTabId);
      }
      setDirtyFiles((prev) => {
        const updated = new Set(prev);
        for (const tab of projectTabs) {
          for (const file of [
            ...tab.editorPanes.flatMap((pane) => pane.files),
            ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
          ]) {
            updated.delete(file.id);
          }
        }
        return updated;
      });
      setProjectTerminals((prev) =>
        prev.filter((dock) => !sameProjectPath(dock.projectPath, normalized)),
      );

      if (wasCurrent) {
        const next = remaining.find((item) => looksLikeProject(item.path));
        if (next) {
          onSelectProject(next.path);
          setProjectCwd(next.path);
        } else {
          setProjectCwd("~");
          setComposerFocused(true);
        }
      }
    },
    [activeTabId, invalidateLoadedSession, onSelectProject, persistSession],
  );

  const onRestoreProject = useCallback(
    (path: string) => {
      setRecents(rememberProject(path));
      onSelectProject(path);
    },
    [onSelectProject],
  );

  const onFileMoved = useCallback((from: string, to: string) => {
    invalidateProjectFiles();
    setTabs((prev) =>
      prev.map((tab) => {
        return {
          ...tab,
          editorPanes: tab.editorPanes.map((pane) => ({
            ...pane,
            files: pane.files.map((file) => ({
              ...file,
              cwd: rebasePath(file.cwd, from, to),
              ...(file.projectCwd ? { projectCwd: rebasePath(file.projectCwd, from, to) } : {}),
              ...(isFilesystemTab(file) ? { path: rebasePath(file.path, from, to) } : {}),
            })),
          })),
        };
      }),
    );
  }, []);

  const applyProjectLocationChange = useCallback(
    async (from: string, to: string) => {
      await rebaseProjectSessions(from, to);
      rebaseCiRepairs(from, to);

      const nextSessions = sessionsRef.current.map((session) =>
        sameProjectPath(session.cwd, from) ? { ...session, cwd: to } : session,
      );
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      for (const [id, session] of loadedSessionCache.current) {
        if (sameProjectPath(session.cwd, from)) {
          loadedSessionCache.current.set(id, { ...session, cwd: to });
        }
      }
      for (const [id, session] of pendingPersist.current) {
        if (sameProjectPath(session.cwd, from)) {
          pendingPersist.current.set(id, { ...session, cwd: to });
        }
      }
      setHistory((current) =>
        current.map((session) =>
          sameProjectPath(session.cwd, from) ? { ...session, cwd: to } : session,
        ),
      );
      setStoredLinkedSessions((current) =>
        current.map((session) =>
          sameProjectPath(session.cwd, from) ? { ...session, cwd: to } : session,
        ),
      );
      setLoadedProjects((current) => {
        const next = new Set(current);
        next.delete(normalizeProjectPath(from));
        next.add(normalizeProjectPath(to));
        return next;
      });

      if (sameProjectPath(projectCwdRef.current, from)) {
        projectCwdRef.current = to;
        setProjectCwd(to);
      }
      const nextDocks = projectTerminalsRef.current.map((dock) =>
        sameProjectPath(dock.projectPath, from) ? { ...dock, projectPath: to } : dock,
      );
      projectTerminalsRef.current = nextDocks;
      setProjectTerminals(nextDocks);
      rebaseProjectData(from, to);
      setSidebarTabSelection((current) =>
        sameProjectPath(current.project, from) ? { ...current, project: pathKey(to) } : current,
      );
      setRecents(replaceProjectPath(from, to));
      onFileMoved(from, to);
      notifyDirsChanged();
    },
    [onFileMoved],
  );

  const onFileDeleted = useCallback((path: string) => {
    invalidateProjectFiles();
    const dropped = new Set<string>();
    for (const tab of tabsRef.current) {
      for (const pane of tab.editorPanes) {
        for (const file of pane.files) {
          if (isFilesystemTab(file) && isEqualOrInside(file.path, path)) {
            dropped.add(file.id);
          }
        }
      }
    }
    setTabs((prev) =>
      prev.map((tab) => dropOpenFiles(tab, (filePath) => isEqualOrInside(filePath, path))),
    );
    if (dropped.size === 0) return;
    setDirtyFiles((prev) => {
      const next = new Set(prev);
      for (const id of dropped) next.delete(id);
      return next;
    });
  }, []);

  const onOpenFile = useCallback<
    (...args: [...Parameters<OpenFileFn>, checkout?: { cwd: string; projectCwd: string }]) => void
  >(
    (path, navigation, options, checkout) => {
      void (async () => {
        const fileCwd = checkout?.cwd ?? gitCwdRef.current;
        const fileProjectCwd = checkout?.projectCwd ?? sidebarCwdRef.current;
        const resolved = await resolveFileOpenRequest(fileCwd, path, options);
        // A folder has nothing to show in an editor tab: hand it to the
        // system's file manager instead.
        if (await isLocalDirectory(resolved)) {
          void openPathWithDefaultApp(resolved).catch((error) => {
            console.error("Failed to open folder:", error);
          });
          return;
        }
        rememberOpenedFile(fileCwd, resolved);
        const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current);
        if (!tab) return;
        const file = newFileTab(resolved, fileCwd, false, undefined, fileProjectCwd);
        const pin = !!options?.pin;
        if (checkout || loadFileTabMode() === "workspace") {
          // Built once: the updater may run twice in StrictMode.
          const created = newEditorWorkspaceTab(pin ? file : { ...file, preview: true });
          let target: { tabId: string; paneId?: string } | undefined;
          // Select inside the updater, not from `tabsRef`: two opens resuming
          // before a render would otherwise both miss the preview and append
          // twice. flushSync runs the updater now so `target` is set below.
          flushSync(() => {
            setTabs((prev) => {
              const result = openWorkspaceFile(
                prev,
                file,
                created,
                (tabs, tab) => insertBesideActive(tabs, tab, fileProjectCwd),
                pin,
              );
              target = result;
              return result.tabs;
            });
          });
          if (target?.paneId) activateTab(target.tabId, target.paneId);
          else if (target) setActiveTabId(target.tabId);
          setProjectTerminalFocused(false);
          setComposerFocused(false);
          if (navigation) {
            editorNavigationToken.current += 1;
            setEditorNavigation({
              path: resolved,
              ...navigation,
              token: editorNavigationToken.current,
            });
          }
          return;
        }
        setTabs((prev) =>
          prev.map((entry) => {
            if (entry.id !== tab.id) return entry;
            const focusedSession = sessionsRef.current.find(
              (session) => session.id === entry.focusedId,
            );
            return openEditorTab(entry, file, {
              split: focusedSession?.blocks.length === 0 ? "left" : "right",
              pin,
            });
          }),
        );
        if (navigation) {
          editorNavigationToken.current += 1;
          setEditorNavigation({
            path: resolved,
            ...navigation,
            token: editorNavigationToken.current,
          });
        }
        setComposerFocused(false);
      })();
    },
    [activateTab, insertBesideActive],
  );

  const onOpenRepository = useCallback(
    (request: RepositoryReviewRequest) => {
      const projectCwd = sidebarCwdRef.current;
      if (
        isProjectLockedIn(lockSnapshot, request.cwd) ||
        isProjectLockedIn(lockSnapshot, projectCwd)
      )
        return;
      if (request.type === "file") {
        onOpenFile(
          request.path,
          undefined,
          { exact: true, pin: request.pin },
          { cwd: request.cwd, projectCwd },
        );
      } else if (request.type === "commit") {
        onOpenCommit(request.commit, request.pin, request.cwd);
      } else if (request.path) {
        onOpenDiff(request.path, undefined, request.kind, request.pin, true, {
          cwd: request.cwd,
          projectCwd,
        });
      } else onOpenAllChanges(request.kind, request.cwd);
    },
    [lockSnapshot, onOpenFile, onOpenCommit, onOpenDiff, onOpenAllChanges],
  );

  const onOpenPlan = useCallback(
    (sessionId: string, blockId: string) => {
      const tab = tabsRef.current.find((entry) => entry.id === activeTabId);
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      const block = session?.blocks.find((entry) => entry.id === blockId);
      if (!tab || !session || !block) return;
      const file = {
        ...newPlanTab(session.id, block.id, planTitle(block.text), sessionWorkCwd(session)),
        ...(session.worktreeCwd ? { projectCwd: session.cwd } : {}),
      };
      setTabs((prev) =>
        prev.map((entry) => (entry.id === tab.id ? openEditorTab(entry, file) : entry)),
      );
      setComposerFocused(false);
    },
    [activeTabId],
  );

  const onPinFile = useCallback((fileId: string) => {
    setTabs((prev) => {
      const next = prev.map((tab) => pinEditorFile(tab, fileId));
      return next.some((tab, index) => tab !== prev[index]) ? next : prev;
    });
  }, []);

  const onFileDirtyChange = useCallback(
    (fileId: string, dirty: boolean) => {
      // An edited preview must not be replaced by the next click.
      if (dirty) onPinFile(fileId);
      setDirtyFiles((prev) => {
        if (prev.has(fileId) === dirty) return prev;
        const next = new Set(prev);
        if (dirty) next.add(fileId);
        else next.delete(fileId);
        return next;
      });
    },
    [onPinFile],
  );

  /** The editor reports 0 as it unmounts, so closed tabs drop out on their own. */
  const onFileErrorCountChange = useCallback((fileId: string, count: number) => {
    setFileErrorCounts((prev) => {
      if ((prev.get(fileId) ?? 0) === count) return prev;
      const next = new Map(prev);
      if (count > 0) next.set(fileId, count);
      else next.delete(fileId);
      return next;
    });
  }, []);

  const onSelectFileSurface = useCallback((paneId: string, fileId: string) => {
    setTabs((prev) =>
      prev.map((tab) => {
        const found = findSurfacePane(tab, paneId);
        if (!found) return tab;
        return withSurfacePanes(
          { ...tab, layout: selectPaneTab(tab.layout, paneId), focusedId: paneId },
          found.kind,
          surfacePanes(tab, found.kind).map((pane) =>
            pane.id === paneId ? { ...pane, activeFileId: fileId } : pane,
          ),
        );
      }),
    );
    setComposerFocused(false);
  }, []);

  // Choosing a signed-out or expired account opens its sign-in instead of
  // letting the next turn fail. Re-checked after the read: the user may have
  // moved to another account while it ran.
  const promptProviderAccountSignIn = useCallback(
    (sessionId: string, provider: ProviderAccountProvider, accountId: string) => {
      void loadFreshRateLimits(provider, accountId, 60_000).then((limits) => {
        if (!providerAccountSignedOut(limits)) return;
        const session = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !session ||
          session.harness !== provider ||
          sessionProviderAccountId(provider, session) !== accountId
        ) {
          return;
        }
        setProviderSignInRequest({
          key: `${sessionId}:account:${provider}:${accountId}:${Date.now()}`,
          sessionId,
          harness: provider,
          accountId,
        });
      });
    },
    [],
  );

  const onModelChange = useCallback(
    async (sessionId: string, harness: HarnessId, model: string, accountId?: string) => {
      if (isMovingPane(sessionId)) return;
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current) return;
      if (isPreparingHandoff(current)) return;
      let accountUpdate: ((session: Session) => Session) | undefined;
      if (accountId && supportsProviderAccounts(harness)) {
        if (
          current.busy &&
          (current.harness !== harness || sessionProviderAccountId(harness, current) !== accountId)
        ) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "Wait for the current turn to finish before switching accounts.",
          });
          flushHarnessEvents();
          return;
        }
        if (current.harness === harness) {
          const result = await switchSessionAccount(sessionId, harness, accountId, {
            transfer: transferProviderSession,
            forget: forgetHarnessSession,
            bind: bindHarnessSession,
            latest: (id) => sessionsRef.current.find((s) => s.id === id),
            label: providerAccountLabel,
            removing: (id) => removingSessionIds.current.has(id),
          });
          if (result.kind === "stale" || result.kind === "refused") return;
          if (result.kind === "switched") {
            accountUpdate = result.update;
            if (result.status) {
              enqueueHarnessEvent(sessionId, {
                type: "status",
                text: result.status,
              });
              flushHarnessEvents();
            }
          }
        }
      }
      const resolved = resolveModel(harness, model);
      saveRecentModelChoice(resolved.harness, resolved.id);
      if (current.modelSettings) {
        saveLastModelSettings(current.modelSettings, "fill");
      }
      const modelSettings = preferredModelSettings(resolved, current.modelSettings);
      const plan = planComposerSwitch(current, harness);
      if (
        plan.kind === "revert" &&
        accountId &&
        accountId !== (plan.restoreProviderAccountId ?? "default")
      ) {
        await forgetHarnessSession(harness, sessionId);
      }
      if (plan.kind === "empty") {
        void forgetHarnessSession(plan.forget, sessionId);
      }
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const next = withHarnessChoice(
            accountUpdate ? accountUpdate(s) : s,
            harness,
            resolved.id,
            modelSettings,
          );
          if (accountId && supportsProviderAccounts(harness)) next.providerAccountId = accountId;
          if (s.busy && !s.runningModelTarget)
            next.runningModelTarget = {
              ...queuedModelTarget(s),
              providerAccountId: supportsProviderAccounts(s.harness)
                ? sessionProviderAccountId(s.harness, s)
                : undefined,
            };
          if (plan.kind === "arm") {
            return { ...next, pendingSwitch: plan.pending };
          }
          if (plan.kind === "revert") {
            if (accountId && accountId !== (plan.restoreProviderAccountId ?? "default")) {
              return withAccountHandoff({ ...next, pendingSwitch: undefined }, accountId);
            }
            return {
              ...next,
              pendingSwitch: undefined,
              ...(plan.restoreProviderSessionId
                ? { providerSessionId: plan.restoreProviderSessionId }
                : { providerSessionId: undefined }),
              ...(plan.restoreProviderAccountId
                ? {
                    providerAccountId: accountId ?? plan.restoreProviderAccountId,
                  }
                : { providerAccountId: accountId }),
            };
          }
          if (plan.kind === "empty") {
            return { ...next, pendingSwitch: undefined };
          }
          return next;
        }),
      );
      if (accountId && supportsProviderAccounts(harness)) {
        promptProviderAccountSignIn(sessionId, harness, accountId);
      }
    },
    [enqueueHarnessEvent, flushHarnessEvents, promptProviderAccountSignIn],
  );

  const onModelSettingsChange = useCallback(
    (sessionId: string, modelSettings: Record<string, string>) => {
      if (isMovingPane(sessionId)) return;
      saveLastModelSettings(modelSettings);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                modelSettings,
                runningModelTarget: s.busy
                  ? (s.runningModelTarget ?? {
                      ...queuedModelTarget(s),
                      providerAccountId: supportsProviderAccounts(s.harness)
                        ? sessionProviderAccountId(s.harness, s)
                        : undefined,
                    })
                  : undefined,
              }
            : s,
        ),
      );
    },
    [],
  );

  const onRuntimeModeChange = useCallback((sessionId: string, runtimeMode: RuntimeMode) => {
    if (isMovingPane(sessionId)) return;
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, runtimeMode } : s)));
  }, []);

  const onSaveDraft = useCallback(
    (sessionId: string, text: string, attachments: Attachment[] = [], appRequestId?: string) => {
      const current = sessionsRef.current.find((session) => session.id === sessionId);
      if (current && remoteProjectFor(current.cwd))
        return !!remoteSessionActions(sessionId)?.saveDraft(text, attachments);
      if (
        !current ||
        current.busy ||
        sessionDraftBlock(current) ||
        current.inboxAsk ||
        current.worktreeRemoved ||
        (!text.trim() && attachments.length === 0)
      ) {
        return false;
      }
      const placeholderTitle = canReplaceSessionTitle(
        current.title,
        current.harness,
        HARNESS_LABEL[current.harness],
      );
      const title = placeholderTitle
        ? titleFromPrompt(text, current.harness, attachments)
        : current.title;
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId && !sessionDraftBlock(session)
            ? {
                ...session,
                title,
                blocks: [
                  ...session.blocks,
                  {
                    id: crypto.randomUUID(),
                    role: "user",
                    text,
                    ...(attachments.length > 0 ? { attachments } : {}),
                    draft: true,
                    ...(appRequestId ? { appRequestId } : {}),
                  },
                ],
              }
            : session,
        ),
      );
      return true;
    },
    [],
  );

  const onRemoveDraft = useCallback(
    (sessionId: string, draftBlockId: string) => {
      const current = sessionsRef.current.find((session) => session.id === sessionId);
      if (!current) return false;
      const withoutDraft = removeSessionDraft(current, draftBlockId);
      if (!withoutDraft) return false;

      if (!shouldPersistSession(withoutDraft)) {
        pendingPersist.current.delete(sessionId);
        lastPersisted.current.delete(sessionId);
        lastPersistedUserBlock.current.delete(sessionId);
        invalidateLoadedSession(sessionId);
        setHistory((history) => history.filter((session) => session.id !== sessionId));
        setStoredLinkedSessions((history) => history.filter((session) => session.id !== sessionId));
        void discardDraftSessionRecord(sessionId).catch((error) => {
          console.warn("App operation failed", error);
        });
      }

      setSessions((sessions) =>
        sessions.map((session) =>
          session.id === sessionId
            ? (removeSessionDraft(session, draftBlockId) ?? session)
            : session,
        ),
      );
      return true;
    },
    [invalidateLoadedSession],
  );

  /** Runs a `!command` in the session's working copy and shows it in the
   * transcript. The next message carries its output to the model. */
  const runSessionShell = useCallback((sessionId: string, command: string): boolean => {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (
      !session ||
      session.worktreeRemoved ||
      session.inboxAsk ||
      session.orchestrationLeadId ||
      removingSessionIds.current.has(sessionId)
    )
      return false;
    const blockId = crypto.randomUUID();
    setSessions((prev) =>
      prev.map((entry) =>
        entry.id === sessionId
          ? {
              ...entry,
              blocks: [...entry.blocks, shellBlock(blockId, command)],
            }
          : entry,
      ),
    );
    void runShellCommand(sessionWorkCwd(session), command, loadTerminalProfile())
      .catch((error): ShellResult => ({
        output: error instanceof Error ? error.message : String(error),
        exitCode: null,
        timedOut: false,
      }))
      .then((result) => {
        const finish = (entries: Session[]) =>
          entries.map((entry) =>
            entry.id === sessionId
              ? {
                  ...entry,
                  blocks: entry.blocks.map((block) =>
                    block.id === blockId ? finishShellBlock(block, result) : block,
                  ),
                }
              : entry,
          );
        // The follow-up reads sessionsRef, so it must hold the output now.
        sessionsRef.current = finish(sessionsRef.current);
        setSessions(finish);
        // Hand the result to the agent so it carries on without another message.
        if (sessionsRef.current.some((entry) => entry.id === sessionId)) {
          void submitSessionRef.current(sessionId, SHELL_FOLLOW_UP_PROMPT);
        }
      });
    return true;
  }, []);

  const submitSession = useCallback(
    (
      sessionId: string,
      text: string,
      attachments: Attachment[] = [],
      options?: SubmitOptions,
    ): SubmissionAcceptance => {
      // Preserve composer text while this session is handed to another window.
      // Other sessions remain usable throughout the move.
      if (windowTransferPendingRef.current || movingSessionIds.current.has(sessionId)) return false;
      if (retiringTurns.current.has(sessionId)) return false;
      if (sessionsRef.current.some((session) => session.id === sessionId && session.historyLoading))
        return false;
      const remote = sessionsRef.current.find((session) => session.id === sessionId);
      if (remote && remoteProjectFor(remote.cwd))
        return !!remoteSessionActions(sessionId)?.submit(text, attachments, options);
      if (sharedLocalQueueClaiming(sessionId) && !options?.sharedQueueClaimed) return false;
      if (options?.queuedMessageId && !options.sharedQueueClaimed) {
        const queuedGeneration = turnGen.current.get(sessionId);
        return submitSharedLocalQueue(
          sessionId,
          options.queuedMessageId,
          options.followUpBehavior === "steer",
          (message) =>
            submitSessionRef.current(
              sessionId,
              message?.text ?? text,
              message?.attachments ?? attachments,
              { ...options, sharedQueueClaimed: true },
            ),
          () => {
            const latest = sessionsRef.current.find((session) => session.id === sessionId);
            return (
              turnGen.current.get(sessionId) === queuedGeneration &&
              latest?.queuedMessages === remote?.queuedMessages &&
              latest?.queueStatus === remote?.queueStatus &&
              latest?.editingQueuedMessageId === remote?.editingQueuedMessageId
            );
          },
        );
      }
      // `!command` typed in the composer runs in the shell; it is not a turn,
      // so nothing below about queues, drafts or a busy session applies.
      const shellCommand =
        attachments.length === 0 &&
        !options?.managed &&
        !options?.queuedMessageId &&
        !options?.draftBlockId &&
        !options?.resendEdited &&
        !options?.appRequestId &&
        !options?.ciRepair &&
        (options?.intent ?? "default") === "default"
          ? parseShellCommand(text)
          : undefined;
      if (shellCommand) return runSessionShell(sessionId, shellCommand);
      if (editedResends.isActive(sessionId)) return false;
      // Apply received output and terminal state before reading the next turn.
      flushHarnessEvents();
      const controlError = orchestrator.submissionError(sessionId, options?.managed);
      if (controlError) {
        enqueueHarnessEvent(sessionId, { type: "status", text: controlError });
        flushHarnessEvents();
        return false;
      }
      if (options?.managed) {
        const target = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !target ||
          target.busy ||
          target.pendingSwitch ||
          isPreparingHandoff(target) ||
          removingSessionIds.current.has(sessionId)
        ) {
          options.onSettled?.({
            status: "failed",
            text: "",
            error: "Session is unavailable or already running",
          });
          return false;
        }
      }
      if (
        removingSessionIds.current.has(sessionId) ||
        switchingWorktrees.current.has(sessionId) ||
        workspaceNavigation.isSwitching(sessionId)
      )
        return false;
      const storedCurrent = sessionsRef.current.find((s) => s.id === sessionId);
      if (options?.appRequestId && storedCurrent?.busy) return false;
      if (
        options?.ciRepair &&
        storedCurrent &&
        (storedCurrent.busy || storedCurrent.pendingSwitch || isPreparingHandoff(storedCurrent))
      )
        return false;
      if (
        !storedCurrent ||
        storedCurrent.worktreeRemoved ||
        [...removingWorktreePaths.current].some((path) =>
          isEqualOrInside(sessionWorkCwd(storedCurrent), path),
        )
      )
        return false;
      const draftBlock = options?.draftBlockId
        ? storedCurrent.blocks.find(
            (block) => block.id === options.draftBlockId && block.role === "user" && block.draft,
          )
        : undefined;
      if (options?.draftBlockId && !draftBlock) return false;
      const draftCleared = draftBlock
        ? {
            ...storedCurrent,
            blocks: storedCurrent.blocks.filter((block) => block.id !== draftBlock.id),
          }
        : storedCurrent;
      let current = options?.buildTarget
        ? withPlanBuildTarget(draftCleared, options.buildTarget)
        : draftCleared;
      const queuedMessage = options?.queuedMessageId
        ? queuedMessageForSubmit(
            current,
            options.queuedMessageId,
            options.followUpBehavior === "steer" ? "steer" : "dispatch",
          )
        : undefined;
      if (options?.queuedMessageId && !queuedMessage) return false;
      const submitTarget = queuedMessage?.modelTarget ?? options?.buildTarget;
      if (queuedMessage?.modelTarget) {
        current =
          current.busy && options?.followUpBehavior === "steer"
            ? { ...current, ...queuedMessage.modelTarget }
            : withPlanBuildTarget(current, queuedMessage.modelTarget);
      }
      const editedResend = options?.resendEdited
        ? createEditedResendAttempt(current, options.onResendRejected)
        : undefined;
      if (options?.resendEdited && !editedResend) return false;
      const editedProviderTurnId = editedResend?.providerTurnId;
      if (editedResend) {
        current = { ...current, blocks: editedResend.blocks };
      }
      const intent = options?.intent ?? "default";
      if (intent === "orchestrate") {
        try {
          const run = orchestrator.forSession(sessionId);
          if (run && ["active", "paused"].includes(run.status))
            throw new Error(
              "Stop the current orchestration run before preparing another proposal.",
            );
        } catch (error) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: error instanceof Error ? error.message : String(error),
          });
          flushHarnessEvents();
          return false;
        }
      }
      const approvedPlan = options?.planBlockId
        ? current.blocks.find((block) => block.id === options.planBlockId && block.role === "plan")
        : undefined;
      if (intent === "build" && !approvedPlan?.text.trim()) return false;
      if (options?.queuedMessageId) {
        const mode = options.followUpBehavior === "steer" ? "steer" : "dispatch";
        if (!queuedMessageForSubmit(current, options.queuedMessageId, mode)) {
          return false;
        }
      }
      const noteCard = options && "noteCard" in options ? options.noteCard : current.noteCard;
      const handoffCard =
        options && "handoffCard" in options ? options.handoffCard : current.handoffCard;
      if (!text.trim() && attachments.length === 0 && !noteCard && !handoffCard) {
        return false;
      }
      if (isPreparingHandoff(current)) return false;
      saveRecentModelChoice(current.harness, current.model);
      const initialWorkCwd = sessionWorkCwd(current);
      const createDraftWorktree = !current.worktreeCwd && current.workspaceMode === "worktree";
      const accountProvider = supportsProviderAccounts(current.harness)
        ? current.harness
        : undefined;
      const providerAccountId = accountProvider
        ? sessionProviderAccountId(accountProvider, current)
        : undefined;
      if (
        accountProvider &&
        providerAccountId &&
        !providerAccountExists(accountProvider, providerAccountId)
      ) {
        setProviderAccountRecovery({ sessionId, provider: accountProvider });
        return false;
      }
      const submittedText = intent === "build" ? "Build approved plan" : text;
      const operatorCommand = consumeOperatorCommand(submittedText);
      if (
        operatorCommand.matched &&
        (intent !== "default" ||
          current.orchestrationLeadId ||
          current.inboxAsk ||
          orchestrator.run(sessionId))
      ) {
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: "Use /operator from a regular session turn, outside an orchestration run.",
        });
        flushHarnessEvents();
        return false;
      }
      const operatorAccess = operatorCommand.matched || operatorEnabledInThread(current.blocks);
      const promptText = operatorCommand.matched
        ? operatorCommand.text.trim() || "Explain what you can do in bycoda with the app CLI."
        : submittedText;
      const rawCommand =
        !operatorCommand.matched && isNativeCommandPrompt(submittedText, current.harness);
      const ciContext = options?.ciRepair?.prompt ?? options?.ciContext;
      // The `!commands` run since the last message go with this one, to the
      // harness only; a native command has to arrive exactly as typed.
      const harnessText =
        options?.ciRepair?.prompt ??
        (rawCommand
          ? submittedText
          : withShellContext(
              pendingShellRuns(current.blocks),
              composeNoteMessage(noteCard, promptText),
            ));

      const pendingSwitch =
        current.pendingSwitch && current.pendingSwitch.from !== current.harness
          ? current.pendingSwitch
          : null;

      if (current.busy && !pendingSwitch) {
        if (
          operatorCommand.matched &&
          options?.queuedMessageId &&
          options.followUpBehavior === "steer"
        ) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "/operator starts a new turn after the current turn finishes.",
          });
          flushHarnessEvents();
          return false;
        }
        // Background work with the agent yielded may never end (a dev
        // server), so there the message is steered instead of parked behind it.
        const followUpRoute = resolveFollowUpRoute({
          busy: true,
          worktreePreparing: current.worktreePreparing,
          intent,
          operatorCommand: operatorCommand.matched,
          backgroundTaskCount: current.backgroundTasks?.length ?? 0,
          backgroundOnly: isBackgroundOnly(
            !!current.busy,
            current.backgroundTasks,
            current.backgroundAgents,
          ),
          requested: options?.followUpBehavior,
          setting: loadFollowUpBehavior(),
        });
        if (followUpRoute === "queue" || !canSteerHarness(current.harness)) {
          // A queue-row action already owns retained content. Falling back to
          // the queue must leave that row in place rather than append a copy.
          if (options?.queuedMessageId) return false;
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId
                ? appendQueuedMessage(
                    {
                      ...s,
                      inboxCard: rawCommand ? s.inboxCard : undefined,
                      noteCard: rawCommand ? s.noteCard : undefined,
                      handoffCard: rawCommand ? s.handoffCard : undefined,
                    },
                    {
                      id: crypto.randomUUID(),
                      text,
                      attachments,
                      noteCard,
                      handoffCard,
                      intent,
                      modelTarget: queuedModelTarget(options?.buildTarget ?? storedCurrent),
                    },
                  )
                : s,
            ),
          );
          dismissNoticesForContinuedSession(sessionId);
          return true;
        }
        if (!isLiveHarness(current.harness) || !canSteerHarness(current.harness)) {
          // Harnesses that cannot steer (fx) used to drop the message on the
          // floor here, so a follow-up sent mid-turn just vanished. Say so.
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: `${current.harness} cannot take a follow-up mid-turn — wait for this turn to finish, or stop it first.`,
          });
          flushHarnessEvents();
          return false;
        }
        dismissNoticesForContinuedSession(sessionId);
        const visible = displayAttachments(attachments);
        const cards = userTurnCards(noteCard);
        const nextSessions = sessionsRef.current.map((s) => {
          if (s.id !== sessionId) return s;
          let next: Session = {
            ...s,
            inboxCard: rawCommand ? s.inboxCard : undefined,
            noteCard: rawCommand ? s.noteCard : undefined,
            handoffCard: rawCommand ? s.handoffCard : undefined,
          };
          if (options?.queuedMessageId) {
            next = sentQueuedMessage(next, options.queuedMessageId);
          }
          return appendSteerUser(next, submittedText, visible, cards);
        });
        sessionsRef.current = nextSessions;
        setSessions(nextSessions);
        const steerGeneration = turnGen.current.get(sessionId);
        const steerBlocks = nextSessions.find((entry) => entry.id === sessionId)?.blocks;
        const steerUserId = steerBlocks?.[steerBlocks.length - 1]?.id;
        const holdFollowUp = () =>
          setSessions((prev) =>
            prev.map((entry) =>
              entry.id === sessionId
                ? holdUndeliveredFollowUp(
                    entry,
                    {
                      id: options?.queuedMessageId ?? crypto.randomUUID(),
                      text,
                      attachments,
                      noteCard,
                      handoffCard,
                      intent,
                      modelTarget: queuedModelTarget(storedCurrent),
                    },
                    steerUserId,
                  )
                : entry,
            ),
          );
        void (async () => {
          try {
            const prepared = await prepareAttachments(attachments);
            const prompt = await preparePrompt(harnessText, {
              harness: current.harness,
              sessionId,
              cwd: initialWorkCwd,
            });
            if (turnGen.current.get(sessionId) !== steerGeneration) {
              holdFollowUp();
              return;
            }
            await steerHarnessTurn({
              harness: current.harness,
              sessionId,
              cwd: initialWorkCwd,
              model: current.model,
              modelSettings: current.modelSettings,
              text: inboxAskPrompt(rawCommand ? undefined : current.inboxAsk, prompt),
              attachments: prepared,
            });
          } catch (error: unknown) {
            if (turnGen.current.get(sessionId) !== steerGeneration) {
              holdFollowUp();
              return;
            }
            const message =
              error instanceof Error
                ? error.message
                : `${current.harness} could not steer the active turn`;
            holdFollowUp();
            enqueueHarnessEvent(sessionId, {
              type: "status",
              text: `${t("The follow-up could not be delivered. It is saved in the paused queue.")} ${message}`,
            });
            flushHarnessEvents();
          }
        })();
        return true;
      }

      if (!options?.projectLocationReady && looksLikeProject(current.cwd) && !current.worktreeCwd) {
        const preparationGen = (turnGen.current.get(sessionId) ?? 0) + 1;
        turnGen.current.set(sessionId, preparationGen);
        const preparationIsCurrent = () => turnGen.current.get(sessionId) === preparationGen;
        flushSync(() =>
          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId
                ? { ...session, busy: true, worktreePreparing: true }
                : session,
            ),
          ),
        );
        const releasePreparation = () => {
          if (!preparationIsCurrent()) return;
          flushSync(() =>
            setSessions((prev) =>
              prev.map((session) =>
                session.id === sessionId && preparationIsCurrent()
                  ? { ...session, busy: false, worktreePreparing: undefined }
                  : session,
              ),
            ),
          );
        };
        const key = pathKey(current.cwd);
        let sync = projectLocationSyncs.current.get(key);
        if (!sync) {
          sync = synchronizeProjectLocation(current.cwd);
          projectLocationSyncs.current.set(key, sync);
          void sync.then(
            () => projectLocationSyncs.current.delete(key),
            () => projectLocationSyncs.current.delete(key),
          );
        }
        return submitAfterProjectSync({
          cwd: current.cwd,
          sync,
          isCurrent: preparationIsCurrent,
          applyLocationChange: applyProjectLocationChange,
          submit: async () => {
            releasePreparation();
            const accepted = await submitAfterProjectSyncRef.current(sessionId, text, attachments, {
              ...options,
              projectLocationReady: true,
            });
            if (!accepted) {
              editedResend?.reject();
              options?.onSettled?.({
                status: "failed",
                text: "",
                error:
                  "The chat became unavailable before the request could start. Try again when it is ready.",
              });
            }
            return accepted;
          },
          onRejected: () => {
            releasePreparation();
            // Existing draft/queue rows were not removed before preparation.
            if (options?.queuedMessageId || options?.draftBlockId || editedResend) return;
            if (options?.onSendRejected?.()) return;
            const recovery: QueuedMessage = {
              id: crypto.randomUUID(),
              text,
              attachments,
              noteCard,
              handoffCard,
              intent,
              modelTarget: queuedModelTarget(options?.buildTarget ?? storedCurrent),
            };
            setSessions((prev) =>
              prev.map((session) =>
                session.id === sessionId ? holdUndeliveredFollowUp(session, recovery) : session,
              ),
            );
          },
          onError: (error: unknown) => {
            const message =
              error instanceof Error ? error.message : "The project folder could not be opened.";
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message,
            });
            flushHarnessEvents();
            editedResend?.reject();
            options?.onSettled?.({
              status: "failed",
              text: "",
              error: message,
            });
          },
        });
      }

      const traceId = beginSessionPerformanceTrace(sessionId);
      recordPerformanceEvent("send-prepare", { phase: 0 }, traceId);
      const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
      turnGen.current.set(sessionId, gen);
      const proposalId = intent === "orchestrate" ? crypto.randomUUID() : undefined;
      let proposalDraft: OrchestrationProposal | undefined = proposalId
        ? {
            version: 1,
            leadId: sessionId,
            cwd: current.cwd,
            checkoutCwd: initialWorkCwd,
            request: harnessText,
            author: {
              harness: current.harness,
              model: current.model,
              name: resolveModel(current.harness, current.model).name,
            },
            settings: { choices: [], maxWorkers: 2 },
            status: "planning",
            get title() {
              return t("Orchestration plan");
            },
            summary: "",
            tasks: [],
          }
        : undefined;
      const isFirstTurn = current.blocks.length === 0;
      const placeholderTitle =
        canReplaceSessionTitle(current.title, current.harness, HARNESS_LABEL[current.harness]) ||
        !!draftBlock;
      const titleSeed =
        isFirstTurn && !current.inboxCard && !current.noteCard && placeholderTitle
          ? titleFromPrompt(
              operatorCommand.matched ? promptText : submittedText,
              current.harness,
              attachments,
            )
          : current.title;
      const visible = displayAttachments(attachments);
      const card =
        options?.secondOpinion ?? (handoffCard ? handoffTurnCard(handoffCard) : undefined);
      const visibleText = operatorCommand.matched
        ? promptText
        : card?.kind === "handoff"
          ? submittedText
          : card
            ? SECOND_OPINION_TITLE
            : submittedText;
      const cards = {
        ...(rawCommand ? undefined : userTurnCards(noteCard, card)),
        ...(ciContext ? { ciContext } : {}),
        ...(operatorCommand.matched ? { bycoda: true } : {}),
        ...(intent === "plan" || intent === "orchestrate" ? { intent } : {}),
        ...(options?.appRequestId ? { appRequestId: options.appRequestId } : {}),
        // The orchestrator writes these turns, not the user; hide them.
        ...(options?.managed ? { internal: true } : {}),
      };
      const live = isLiveHarness(current.harness);
      const queuedHandoff = live && !pendingSwitch ? pendingHandoff(current) : null;

      if (pendingSwitch && current.busy) {
        void cancelHarnessTurn(pendingSwitch.from, sessionId);
      }

      dismissNoticesForContinuedSession(sessionId);
      const commitSubmittedTurn = () => {
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            const draftRemoved = draftBlock
              ? {
                  ...s,
                  blocks: s.blocks.filter((block) => block.id !== draftBlock.id),
                }
              : s;
            const selected = submitTarget
              ? withPlanBuildTarget(draftRemoved, submitTarget)
              : draftRemoved;
            const titled = isFirstTurn ? titleSeed : selected.title;
            let next: Session = {
              ...selected,
              runningModelTarget: {
                ...queuedModelTarget(current),
                providerAccountId: supportsProviderAccounts(current.harness)
                  ? sessionProviderAccountId(current.harness, current)
                  : undefined,
              },
              providerAccountId,
              usageLimit: undefined,
              worktreePreparing: createDraftWorktree ? true : selected.worktreePreparing,
              inboxCard: rawCommand || options?.ciRepair ? s.inboxCard : undefined,
              noteCard: rawCommand || options?.ciRepair ? s.noteCard : undefined,
              handoffCard: rawCommand || options?.ciRepair ? s.handoffCard : undefined,
            };
            if (editedResend) {
              next = editedResend.replace(next);
            }
            if (approvedPlan && intent === "build") {
              next = {
                ...next,
                blocks: next.blocks.map((block) =>
                  block.id === approvedPlan.id && block.role === "plan"
                    ? {
                        ...block,
                        plan: {
                          ...(block.plan ?? { status: "ready" as const }),
                          status: "building" as const,
                          approvedText: block.text,
                        },
                      }
                    : block,
                ),
              };
            }
            if (options?.queuedMessageId) {
              next = sentQueuedMessage(next, options.queuedMessageId);
            }
            if (!live) {
              return {
                ...next,
                title: titled,
                pendingSwitch: undefined,
                busy: false,
                blocks: [
                  ...next.blocks,
                  {
                    id: crypto.randomUUID(),
                    role: "user",
                    text: visibleText,
                    ...(visible.length > 0 ? { attachments: visible } : {}),
                    ...cards,
                  },
                  {
                    id: crypto.randomUUID(),
                    role: "system",
                    text: `${next.harness} is not connected yet — install and sign in to that provider, then retry.`,
                    notice: "error",
                  },
                ],
              };
            }
            if (pendingSwitch) {
              const sealed = stopStreaming({
                ...next,
                title: titled,
                pendingSwitch: undefined,
              });
              return appendUser(
                appendPreparingHandoff(sealed, pendingSwitch.from, next.harness),
                visibleText,
                visible,
                cards,
              );
            }
            return appendUser({ ...next, title: titled }, visibleText, visible, cards);
          }),
        );
      };
      if (!options?.resendEdited) {
        flushSync(commitSubmittedTurn);
      }

      const launchTitleGeneration = (workCwd: string) => {
        if (
          !live ||
          !shouldGenerateSessionTitle(isFirstTurn, placeholderTitle, options?.refreshTitle)
        ) {
          return;
        }
        const titleMessage = harnessText || attachments.map((file) => file.name).join(", ");
        void generateHarnessTitle(current.harness, {
          sessionId,
          cwd: workCwd,
          message: titleMessage,
          providerAccountId,
        })
          .then(async (generated) => {
            if (options?.refreshTitle && !isFirstTurn && turnGen.current.get(sessionId) !== gen) {
              return;
            }
            const linkedWorkItem = await resolveLinkedWorkItem(
              titleMessage,
              workCwd,
              generated?.workItem ?? null,
            );
            if (!generated && !linkedWorkItem) return;
            setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== sessionId) return s;
                let next = s;
                if (
                  generated &&
                  (options?.refreshTitle || canReplaceSessionTitle(s.title, s.harness, titleSeed))
                ) {
                  next = {
                    ...next,
                    title: formatSessionTitle(s.harness, generated.title),
                  };
                }
                if (linkedWorkItem && !next.linkedWorkItem) {
                  next = { ...next, linkedWorkItem };
                }
                return next;
              }),
            );
          })
          .catch((error) => {
            console.warn("App operation failed", error);
          });
      };

      if (!live) {
        if (pendingSwitch) {
          void forgetHarnessSession(pendingSwitch.from, sessionId);
        }
        editedResend?.reject();
        options?.onSettled?.({
          status: "failed",
          text: "",
          error: "Harness is not connected",
        });
        return true;
      }
      if (editedResend && canRewindHarnessLastTurn(current.harness)) {
        editedResends.start(sessionId);
        const locked = sessionsRef.current.map((session) =>
          session.id === sessionId ? { ...session, busy: true } : session,
        );
        sessionsRef.current = locked;
        syncDockBadge(locked);
        setSessions(locked);
      }

      if (proposalId && proposalDraft) {
        const draft = proposalDraft;
        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  blocks: [...session.blocks, proposalBlock(proposalId, draft)],
                }
              : session,
          ),
        );
      }

      let controlOutcome: ControlOutcome = {
        status: "failed",
        text: "",
        error: "Turn did not complete",
      };
      let controlText = "";
      let proposalText = "";
      let nativeProposalText = "";
      let completedProposal: OrchestrationProposal | undefined;
      void (async () => {
        let workCwd = initialWorkCwd;
        if (createDraftWorktree) {
          const tree = await createWorktree(
            current.cwd,
            temporaryWorktreeBranchName(),
            current.worktreeBase || "HEAD",
            false,
          );
          workCwd = tree.path;
          workspacePins.current.set(sessionId, currentWorkspace(current.cwd));
          if (proposalDraft) proposalDraft = { ...proposalDraft, checkoutCwd: tree.path };
          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    worktreeCwd: tree.path,
                    branch: tree.branch ?? undefined,
                    workspaceMode: undefined,
                    worktreeBase: undefined,
                    worktreePreparing: undefined,
                  }
                : session,
            ),
          );
          notifyReviewChanged(sessionId);

          const branchMessage = harnessText || attachments.map((file) => file.name).join(", ");
          void generateHarnessBranchName(pickTextHarness(current.harness), workCwd, branchMessage)
            .then(async (fragment) => {
              const branch = fragment ? namedWorktreeBranch(fragment) : null;
              if (!branch) return;
              const renamed = await renameWorktreeBranch(current.cwd, tree.path, branch);
              setSessions((prev) =>
                prev.map((session) =>
                  session.id === sessionId &&
                  pathKey(sessionWorkCwd(session)) === pathKey(tree.path)
                    ? { ...session, branch: renamed.branch ?? undefined }
                    : session,
                ),
              );
            })
            .catch((error) => {
              console.warn("App operation failed", error);
            });
        }
        launchTitleGeneration(workCwd);
        if (turnGen.current.get(sessionId) !== gen) return;
        if (proposalDraft && proposalId) {
          const settings = await discoverOrchestrationSettings();
          if (turnGen.current.get(sessionId) !== gen) return;
          proposalDraft = { ...proposalDraft, settings };
          const discovering = proposalDraft;
          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId
                ? withOrchestrationProposal(session, proposalId, discovering)
                : session,
            ),
          );
        }
        let wrap = handoffCard
          ? {
              from: handoffCard.from,
              to: current.harness,
              text: handoffCard.brief,
            }
          : queuedHandoff;
        if (pendingSwitch) {
          let agentText = "";
          if (shouldAskOutgoingAgent(current) && isLiveHarness(pendingSwitch.from)) {
            try {
              agentText = await requestOutgoingHandoff({
                harness: pendingSwitch.from,
                sessionId,
                cwd: workCwd,
                model: pendingSwitch.fromModel,
                modelSettings: pendingSwitch.fromSettings,
                providerAccountId: pendingSwitch.fromProviderAccountId,
                userRequest: text,
              });
            } catch {
              agentText = "";
            }
          }
          if (turnGen.current.get(sessionId) !== gen) return;
          const latest = sessionsRef.current.find((s) => s.id === sessionId);
          const brief = chooseHandoffBrief(agentText, latest ?? current, text);
          await forgetHarnessSession(pendingSwitch.from, sessionId);
          if (turnGen.current.get(sessionId) !== gen) return;
          wrap = { from: pendingSwitch.from, to: current.harness, text: brief };
        }

        const revealHandoff = (brief: string) => {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId || !isPreparingHandoff(s)) return s;
              return { ...completeHandoff(s, brief), busy: true };
            }),
          );
        };

        const planEventKey = planTurnKey(gen);
        let nativePlanSeen = false;
        let providerFailureSeen = false;
        const routePlanEvent = (event: HarnessEvent): HarnessEvent | null => {
          if (event.type === "session.error") {
            providerFailureSeen = true;
            retiringTurns.current.set(sessionId, gen);
          }
          if (proposalDraft) {
            if (event.type === "message.delta") {
              proposalText = (proposalText + event.text).slice(-200_000);
              return null;
            }
            if (event.type === "message.completed") {
              proposalText += "\n";
              return null;
            }
            if (event.type === "plan") {
              nativeProposalText = event.append ? nativeProposalText + event.text : event.text;
              return null;
            }
          }
          if (intent !== "plan") return event;
          if (event.type === "plan") {
            nativePlanSeen = true;
            return {
              ...event,
              key: planEventKey,
            };
          }
          return event;
        };

        const pendingEditedEvents: HarnessEvent[] = [];
        const applyTurnEvent = (event: HarnessEvent) => {
          orchestrator.observe(sessionId, event);
          if (options?.onSettled && event.type === "message.delta")
            controlText = (controlText + event.text).slice(-20_000);
          if (options?.onSettled && event.type === "message.completed") controlText += "\n";
          if (event.type === "session.error") controlOutcome.error = event.message;
          if (
            wrap &&
            (event.type === "session.started" || event.type === "session.providerBound")
          ) {
            revealHandoff(wrap.text);
          }
          nudgeOpenEditors(event, workCwd, deferWorkspaceWork);
          if (!orchestrator.forSession(sessionId)) trackSessionEdits(sessionId, workCwd, event);
          const routed = routePlanEvent(event);
          if (routed) enqueueHarnessEvent(sessionId, routed);
        };
        let sawProviderEvent = false;
        const routeTurnEvent = (event: HarnessEvent) => {
          if (!sawProviderEvent) {
            sawProviderEvent = true;
            recordPerformanceEvent("provider-first-event", {}, traceId);
          }
          recordPerformanceEvent("renderer-receive", {}, traceId);
          if (turnGen.current.get(sessionId) !== gen) return;
          if (editedResend && !editedResend.isAccepted()) {
            pendingEditedEvents.push(event);
            return;
          }
          applyTurnEvent(event);
        };
        const acceptEditedResend = () => {
          if (!editedResend || editedResend.isAccepted()) return;
          flushSync(commitSubmittedTurn);
          editedResend.markAccepted();
          for (const event of pendingEditedEvents) applyTurnEvent(event);
          pendingEditedEvents.length = 0;
        };
        const recoverEditedResend = () => {
          if (!editedResend || editedResend.isAccepted()) return;
          pendingEditedEvents.length = 0;
          const previous = sessionsRef.current.find((session) => session.id === sessionId);
          const recovered = previous ? editedResend.recoverAfterFailure(previous) : undefined;
          flushSync(() => {
            setSessions((prev) =>
              prev.map((session) => (session.id === sessionId && recovered ? recovered : session)),
            );
          });
        };

        let buildSucceeded = false;
        const checkpointTurnId = crypto.randomUUID();
        let checkpointStarted = false;
        let checkpointRetirementUncertain = false;
        try {
          const preparation = await prepareLocalTurn({
            traceId,
            checkpoint: () =>
              !current.inboxAsk && !orchestrator.forSession(sessionId)
                ? (checkpointStarted = true, beginSessionTurn(sessionId, workCwd, checkpointTurnId)).catch((error) => {
                    if (String(error).includes("checkpoint-coordination:")) throw error;
                    console.warn("App operation failed", error);
                  })
                : Promise.resolve(),
            attachments: () => prepareAttachments(attachments),
            prompt: () =>
              intent === "build" && approvedPlan
                ? Promise.resolve(buildPlanPrompt(approvedPlan.text))
                : preparePrompt(harnessText, { harness: current.harness, sessionId, cwd: workCwd }),
            isCurrent: () => turnGen.current.get(sessionId) === gen,
          });
          if (!preparation) return;
          const { attachments: prepared, prompt } = preparation;
          const turnPrompt = proposalDraft
            ? options?.orchestrationRetry?.response
              ? orchestrationRepairPrompt({
                  ...proposalDraft,
                  error: options.orchestrationRetry.error,
                  response: options.orchestrationRetry.response,
                })
              : orchestrationPlanningPrompt(
                  prompt,
                  proposalDraft.settings,
                  proposalDraft.checkoutCwd ?? proposalDraft.cwd,
                )
            : intent === "plan" && !rawCommand
              ? planTurnPrompt(prompt)
              : prompt;
          const earlier = queuedHandoff ? userMessagesAfterHandoff(current) : [];
          if (editedResend && canRewindHarnessLastTurn(current.harness)) {
            try {
              await rewindHarnessLastTurn({
                harness: current.harness,
                sessionId,
                cwd: workCwd,
                model: current.model,
                modelSettings: current.modelSettings,
                runtimeMode: current.runtimeMode,
                ...(editedProviderTurnId ? { providerTurnId: editedProviderTurnId } : {}),
                onEvent: (event) => {
                  if (turnGen.current.get(sessionId) !== gen) return;
                  enqueueHarnessEvent(sessionId, event);
                },
              });
            } catch (error) {
              flushHarnessEvents();
              editedResend.reject();
              throw error;
            }
            editedResend.markProviderRewound();
            flushHarnessEvents();
            if (turnGen.current.get(sessionId) !== gen) {
              const latest = sessionsRef.current.find((session) => session.id === sessionId);
              if (
                !latest ||
                (!latest.busy && latest.providerSessionId === current.providerSessionId)
              ) {
                await forgetHarnessSession(current.harness, sessionId);
                if (latest) {
                  setSessions((prev) =>
                    prev.map((session) =>
                      session.id === sessionId &&
                      session.providerSessionId === current.providerSessionId
                        ? { ...session, providerSessionId: undefined }
                        : session,
                    ),
                  );
                }
              }
              recoverEditedResend();
              return;
            }
          }
          const sendTurn = (text: string, turnAttachments = prepared) => {
            if (turnGen.current.get(sessionId) !== gen) return Promise.resolve();
            recordPerformanceEvent("dispatch", {}, traceId);
            const finishDispatch = startPerformanceSpan("dispatch", {}, traceId);
            return sendHarnessTurn({
              harness: current.harness,
              sessionId,
              cwd: workCwd,
              model: current.model,
              modelSettings: current.modelSettings,
              providerAccountId,
              runtimeMode: current.runtimeMode,
              intent: intent === "orchestrate" ? "plan" : intent,
              // A /operator user turn enables app access for this thread;
              // orchestration leads retain their separate control access.
              controlsAgents: operatorAccess || orchestrator.run(sessionId)?.status === "active",
              appAccess: operatorAccess,
              text,
              attachments: turnAttachments,
              ...(editedResend ? { onAccepted: acceptEditedResend } : {}),
              onEvent: routeTurnEvent,
            }).finally(finishDispatch);
          };
          if (wrap && !rawCommand) {
            const historySession =
              sessionsRef.current.find((session) => session.id === sessionId) ?? current;
            const budgeted = await prepareBudgetedHandoff(
              { ...historySession, model: current.model, harness: current.harness },
              wrap.text,
              [turnPrompt.trim() || CONTINUE_PROMPT, ...earlier].join("\n\n"),
            );
            if (turnGen.current.get(sessionId) !== gen) return;
            wrap = { ...wrap, text: budgeted };
          }
          let sendText = orchestrator.prompt(
            sessionId,
            inboxAskPrompt(
              rawCommand ? undefined : current.inboxAsk,
              wrap && !rawCommand
                ? wrapHandoffPrompt(
                    wrap.text,
                    wrap.from,
                    turnPrompt.trim() || CONTINUE_PROMPT,
                    earlier,
                    wrap.to,
                  )
                : turnPrompt,
            ),
          );
          if (operatorCommand.matched) {
            const cli = `${shellPath(await invoke<string>("app_cli_path"))} app`;
            sendText += `\n\n<bycoda_app>\nThe user's Operator command enables app access in this thread, including later turns without the command. You can start session tabs or split session panes right or down, list and create project worktrees, choose a new session's checkout, read and continue other project sessions, save unsent drafts, organize session folders, and read or write saved notes through its local CLI. Run \`${cli} --help\` for exact commands and JSON fields, then use it as needed for the user's request. After sessions.send, call sessions.wait with the returned requestId as sentRequestId to get that session's reply. When reading another session, start with its latest two or three user/assistant exchanges. Request older exchanges with nextBefore or a larger excerpt only if needed. The CLI uses a session credential already in your environment; never print it. New sessions inherit this session's permission mode unless runtimeMode is set explicitly. For a new session with a draft, call sessions.start with its prompt and draft:true; do not submit a seed prompt. The returned ID can be used as besideSessionId to split its pane again or moved into a folder immediately. A normal sessions.start submits its prompt but returns after acceptance, so do not wait for that agent to finish before organizing it.\n</bycoda_app>`;
          }
          await sendTurn(sendText);
          acceptEditedResend();
          if (proposalDraft && !providerFailureSeen) {
            completedProposal = await completeOrRepairOrchestrationProposal(
              proposalDraft,
              nativeProposalText || proposalText,
              async (repairPrompt) => {
                proposalText = "";
                nativeProposalText = "";
                await sendTurn(repairPrompt, []);
                if (providerFailureSeen)
                  throw new Error(
                    controlOutcome.error ?? "The lead could not repair the proposal.",
                  );
                return nativeProposalText || proposalText;
              },
              () =>
                turnGen.current.get(sessionId) === gen &&
                !isProviderFailureText(nativeProposalText || proposalText),
            );
          }
          if (turnGen.current.get(sessionId) !== gen) return;
          if (wrap) {
            const deliveredHandoff = wrap;
            setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== sessionId) return s;
                const ready = isPreparingHandoff(s) ? completeHandoff(s, deliveredHandoff.text) : s;
                // A command owns its arguments; deliver the recap with the next chat prompt.
                return rawCommand ? ready : consumeHandoff(ready);
              }),
            );
          }
          buildSucceeded = true;
        } catch (error: unknown) {
          recoverEditedResend();
          if (turnGen.current.get(sessionId) !== gen) return;
          if (wrap) revealHandoff(wrap.text);
          const message =
            error instanceof Error
              ? error.message
              : String(error) || `${current.harness} adapter failed`;
          controlOutcome.error = message;
          retiringTurns.current.set(sessionId, gen);
          if (!providerFailureSeen) {
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message,
            });
          }
          providerFailureSeen = true;
        } finally {
          flushHarnessEvents();
          controlOutcome = {
            status:
              providerFailureSeen || isProviderFailureText(controlText) || !buildSucceeded
                ? "failed"
                : "completed",
            text: controlText.trim(),
            ...(providerFailureSeen ? { error: controlOutcome.error } : {}),
          };
          // A failed provider can leave its process alive with a dead event
          // stream or poisoned turn state. Park it now; the next prompt will
          // reconnect and resume through a fresh transport.
          const finalizedCurrentTurn = await finalizeLocalTurn({
            isCurrent: () => turnGen.current.get(sessionId) === gen,
            retire: () =>
              providerFailureSeen || turnGen.current.get(sessionId) !== gen
                ? stopHarnessSession(current.harness, sessionId).catch(() => { checkpointRetirementUncertain = true; })
                : Promise.resolve(),
            settle: () => checkpointStarted
              ? finishSessionTurn(sessionId, workCwd, checkpointTurnId, checkpointRetirementUncertain).catch((error) => console.warn("Workspace checkpoint failed", error))
              : Promise.resolve(),
            checkpoint: () => flushSessionCheckpoint(sessionId),
            commit: () =>
              setSessions((prev) =>
                prev.map((s) => {
                  if (s.id !== sessionId || turnGen.current.get(sessionId) !== gen) return s;
                  const stopped = stopStreaming(s);
                  const providerFailed =
                    providerFailureSeen || isProviderFailureText(lastAssistantTextInTurn(stopped));
                  const finalized =
                    proposalDraft && proposalId
                      ? withOrchestrationProposal(
                          stopped,
                          proposalId,
                          completedProposal && !providerFailed && buildSucceeded
                            ? completedProposal
                            : completeOrchestrationProposal(
                                proposalDraft,
                                nativeProposalText || proposalText,
                                providerFailed || !buildSucceeded
                                  ? (controlOutcome.error ?? "The lead could not finish planning.")
                                  : undefined,
                              ),
                        )
                      : intent === "plan" && !nativePlanSeen && !providerFailed
                        ? promoteLastAssistantToPlan(stopped, planEventKey)
                        : stopped;
                  return approvedPlan && intent === "build"
                    ? withPlanStatus(
                        finalized,
                        approvedPlan.id,
                        buildSucceeded && !providerFailed ? "built" : "ready",
                      )
                    : finalized;
                }),
              ),
          });
          if (!finalizedCurrentTurn) return;
          // Next tick: the flush above has rendered by then, so the banner
          // quotes the reply's final text rather than the previous batch.
          deferWorkspaceWork(() => {
            if (turnGen.current.get(sessionId) !== gen) return;
            const finished = sessionsRef.current.find((s) => s.id === sessionId);
            const visible = sessionId === activeSessionIdRef.current;
            if (finished) void announceSessionFinished(finished, visible);
          }, 0);
          notifyFinishedWorkspace(sessionId, workCwd, deferWorkspaceWork, "git-first");
        }
      })()
        .catch((error: unknown) => {
          invalidateProjectLocation(current.cwd);
          controlOutcome = {
            status: "failed",
            text: controlText,
            error: error instanceof Error ? error.message : String(error),
          };
          if (turnGen.current.get(sessionId) === gen) {
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message: controlOutcome.error!,
            });
            flushHarnessEvents();
            setSessions((prev) =>
              prev.map((session) => {
                if (session.id !== sessionId || turnGen.current.get(sessionId) !== gen)
                  return session;
                const stopped = {
                  ...stopStreaming(session),
                  worktreePreparing: undefined,
                };
                return proposalId && proposalDraft
                  ? withOrchestrationProposal(
                      stopped,
                      proposalId,
                      completeOrchestrationProposal(proposalDraft, "", controlOutcome.error),
                    )
                  : stopped;
              }),
            );
          }
        })
        .finally(() => {
          if (retiringTurns.current.get(sessionId) === gen) retiringTurns.current.delete(sessionId);
          editedResend?.reject();
          if (editedResend) editedResends.finish(sessionId);
          options?.onSettled?.(
            turnGen.current.get(sessionId) !== gen
              ? { status: "cancelled", text: controlText }
              : controlOutcome,
          );
        });
      return true;
    },
    [
      applyProjectLocationChange,
      dismissNoticesForContinuedSession,
      enqueueHarnessEvent,
      flushHarnessEvents,
      runSessionShell,
    ],
  );
  submitAfterProjectSyncRef.current = submitSession;
  // Interactive callers use the immediate result to clear their composer. The
  // queued-launch receiver uses submitSession to await the actual acceptance.
  const onSubmit = useCallback(
    (...args: Parameters<Submit>): boolean => {
      // Reject before async preparation can make the composer clear its draft.
      if (workspaceNavigation.isSwitching(args[0])) return false;
      const result = submitSession(...args);
      if (typeof result === "boolean") return result;
      // Deferred errors have already been displayed by submitAfterProjectSync.
      void result.catch((error) => {
        console.warn("App operation failed", error);
      });
      return true;
    },
    [submitSession],
  );

  const automationSessionReservations = useRef(new Set<string>());
  const automationRecoveryRef = useRef<Promise<void> | null>(null);
  const automationRecoveryCutoffRef = useRef(Date.now());
  // Launches of one automation start one at a time, so the daily limit sees
  // the runs claimed alongside it.
  const automationStartGate = useRef(new Map<string, Promise<void>>());
  const onStopRef = useRef<(sessionId: string) => void>(() => undefined);

  const launchAutomation = useCallback(
    async (
      automation: Automation,
      run: AutomationRun,
      reveal = false,
      prompt = run.prompt ?? automation.prompt,
      sourceWorkItem?: LinkedWorkItem,
    ) => {
      let reservationId: string | undefined;
      let releaseAfterSettle = false;
      const releaseReservation = () => {
        if (!reservationId) return;
        automationSessionReservations.current.delete(reservationId);
        reservationId = undefined;
      };
      const limits = automationLimits(automation);
      const earlier = automationStartGate.current.get(automation.id) ?? Promise.resolve();
      let started = () => undefined as void;
      automationStartGate.current.set(
        automation.id,
        new Promise<void>((resolve) => {
          started = resolve;
        }),
      );
      let watchdog: number | undefined;
      let breach: string | null = null;
      try {
        await earlier;
        const skip = isProjectPasswordLocked(automation.cwd)
          ? LOCKED_PROJECT_SKIP
          : run.trigger === "manual"
            ? null
            : dailyRunLimitSkip(
                limits,
                limits.maxRunsPerDay > 0 ? await listAutomationRuns(automation.id) : [],
                run.id,
                Date.now(),
              );
        if (skip) {
          await updateAutomationRun(run.id, "skipped", { error: skip });
          return;
        }
        const eventRun = run.trigger === "event";
        const linkedWorkItem = sourceWorkItem ?? linkedWorkItemFromAutomationEvent(run);
        let session =
          automation.reuseSession && automation.lastSessionId
            ? sessionsRef.current.find(
                (entry) =>
                  entry.id === automation.lastSessionId &&
                  entry.harness === automation.harness &&
                  !entry.busy &&
                  !entry.worktreeRemoved &&
                  !automationSessionReservations.current.has(entry.id) &&
                  (automation.workspaceMode === "current"
                    ? entry.workspaceMode !== "worktree" &&
                      !entry.worktreeCwd &&
                      pathKey(entry.cwd) === pathKey(automation.cwd)
                    : automation.workspaceMode === "existing"
                      ? pathKey(sessionWorkCwd(entry)) === pathKey(automation.worktreeCwd ?? "")
                      : false),
              )
            : undefined;

        if (!session) {
          session = {
            ...newSession(
              automation.harness,
              automation.cwd,
              automation.model,
              automation.runtimeMode,
              automation.modelSettings,
            ),
            title: eventRun
              ? HARNESS_LABEL[automation.harness]
              : formatSessionTitle(automation.harness, automation.name),
            automationId: automation.id,
            ...(linkedWorkItem ? { linkedWorkItem } : {}),
            ...(automation.workspaceMode === "worktree"
              ? { workspaceMode: "worktree" as const, worktreeBase: "HEAD" }
              : automation.workspaceMode === "existing" && automation.worktreeCwd
                ? { worktreeCwd: automation.worktreeCwd }
                : {}),
          };
          const nextSessions = [...sessionsRef.current, session];
          sessionsRef.current = nextSessions;
          setSessions(nextSessions);
          const tab = newTab(session.id);
          appendTab(tab, automation.cwd);
          if (reveal) {
            setActiveTabId(tab.id);
            setComposerFocused(false);
          }
        } else {
          const stamped = {
            ...session,
            automationId: automation.id,
            model: automation.model,
            modelSettings: automation.modelSettings ?? {},
            runtimeMode: automation.runtimeMode,
            ...(linkedWorkItem ? { linkedWorkItem } : {}),
          };
          session = stamped;
          const nextSessions = sessionsRef.current.map((entry) =>
            entry.id === stamped.id ? stamped : entry,
          );
          sessionsRef.current = nextSessions;
          setSessions(nextSessions);
          if (reveal) {
            focusOpenSession(session.id);
          }
        }

        reservationId = session.id;
        automationSessionReservations.current.add(session.id);

        if (automation.sessionFolderId && looksLikeProject(automation.cwd)) {
          saveSessionFolders(
            automation.cwd,
            placeSessionInFolder(loadSessionFolders(automation.cwd), session.id, {
              kind: "existing",
              folderId: automation.sessionFolderId,
            }),
          );
        }

        if (reveal) {
          setSearchViewOpen(false);
          setInboxViewOpen(false);
          setNotesViewOpen(false);
          setAutomationsViewOpen(false);
          setSidebarTab("sessions", session.cwd);
        }

        await updateAutomationRun(run.id, "running", {
          sessionId: session.id,
        });
        started();
        if (limits.maxRunMinutes > 0) {
          const startedAt = Date.now();
          const sessionId = session.id;
          watchdog = window.setInterval(() => {
            breach = runLimitBreach(limits, { startedAt, now: Date.now() });
            if (!breach) return;
            window.clearInterval(watchdog);
            onStopRef.current(sessionId);
          }, 15_000);
        }
        // From here the settlement callback owns reservation cleanup, including
        // a rejected submission that never starts an agent turn.
        releaseAfterSettle = true;
        await submitWithSettlement({
          submit: (onSettled) =>
            submitSession(session.id, prompt, [], {
              refreshTitle: eventRun,
              onSettled,
            }),
          rejectionMessage: "The selected agent session could not start this run.",
          onSettled: (outcome) => {
            window.clearInterval(watchdog);
            const error = breach ?? outcome.error;
            const status = breach
              ? "failed"
              : outcome.status === "completed"
                ? "succeeded"
                : outcome.status === "cancelled"
                  ? "cancelled"
                  : "failed";
            void updateAutomationRun(run.id, status, {
              sessionId: session.id,
              ...(error ? { error } : {}),
            })
              .catch((error) => {
                console.warn("App operation failed", error);
              })
              .finally(releaseReservation);
          },
        });
      } catch (reason: unknown) {
        await updateAutomationRun(run.id, "failed", {
          error: reason instanceof Error ? reason.message : String(reason),
        }).catch((error) => {
          console.warn("App operation failed", error);
        });
        throw reason;
      } finally {
        started();
        if (!releaseAfterSettle) {
          window.clearInterval(watchdog);
          releaseReservation();
        }
      }
    },
    [appendTab, focusOpenSession, submitSession],
  );

  const launchQuickSession = useCallback(
    (launch: QuickLaunch, deliveryId: string, placement?: AppSessionPlacement) =>
      acceptQuickLaunch(
        launch,
        deliveryId,
        {
          getSessions: () => sessionsRef.current,
          updateSessions: (update) => {
            sessionsRef.current = update(sessionsRef.current);
            // Compose with submission's queued transcript updates.
            setSessions(update);
          },
          appendTab,
          placeSession: (sessionId, target, cwd) => {
            const anchor = sessionsRef.current.find(
              (session) => session.id === target.besideSessionId,
            );
            const tab = tabsRef.current.find((entry) =>
              leafIds(entry.layout).includes(target.besideSessionId),
            );
            if (!anchor || !sameProjectPath(anchor.cwd, cwd) || !tab)
              throw new Error("The target session must be open in this project");
            const nextTabs = tabsRef.current.map((entry) =>
              entry.id === tab.id
                ? {
                    ...entry,
                    layout: splitPane(
                      entry.layout,
                      target.besideSessionId,
                      target.direction,
                      sessionId,
                    ),
                    focusedId: launch.reveal ? sessionId : entry.focusedId,
                    diffFocused: launch.reveal ? false : entry.diffFocused,
                  }
                : entry,
            );
            tabsRef.current = nextTabs;
            setTabs(nextTabs);
            return tab.id;
          },
          setProjectCwd,
          setRecents,
          revealTab: (id, cwd) => {
            setActiveTabId(id);
            setComposerFocused(false);
            setSearchViewOpen(false);
            setInboxViewOpen(false);
            setNotesViewOpen(false);
            setAutomationsViewOpen(false);
            setSidebarTab("sessions", cwd);
          },
          submit: submitSession,
          saveDraft: (id, prompt, attachments, requestId) =>
            flushSync(() => onSaveDraft(id, prompt, attachments, requestId)),
        },
        placement,
      ),
    [appendTab, submitSession, onSaveDraft],
  );
  useQuickComposerLaunches(launchQuickSession);
  const launchQuickSessionRef = useRef(launchQuickSession);
  launchQuickSessionRef.current = launchQuickSession;
  const submitSessionRef = useRef(submitSession);
  submitSessionRef.current = submitSession;
  const saveDraftRef = useRef(onSaveDraft);
  saveDraftRef.current = onSaveDraft;
  const ensureOpenSessionRef = useRef(ensureOpenSession);
  ensureOpenSessionRef.current = ensureOpenSession;

  const appReceipts = useRef(new Map<string, { signature: string; promise: Promise<unknown> }>());

  const ensureAutomationRecovery = useCallback(() => {
    if (!automationRecoveryRef.current) {
      const recovery = (async () => {
        const pending = await recoverAutomationRuns(automationRecoveryCutoffRef.current);
        for (const item of pending) {
          await launchAutomation(
            item.automation,
            item.run,
            false,
            item.run.prompt ?? item.automation.prompt,
          ).catch((error) => {
            console.warn("App operation failed", error);
          });
        }
      })();
      automationRecoveryRef.current = recovery.catch((error: unknown) => {
        automationRecoveryRef.current = null;
        throw error;
      });
    }
    return automationRecoveryRef.current;
  }, [launchAutomation]);

  useEffect(() => {
    let disposed = false;
    let evaluating = false;
    const evaluate = async () => {
      if (disposed || evaluating) return;
      evaluating = true;
      try {
        await ensureAutomationRecovery();
        const due = await claimDueAutomations();
        for (const item of due) {
          if (disposed) break;
          void launchAutomation(item.automation, item.run).catch(() => undefined);
        }
      } catch {
        // Scheduling retries on the next tick; individual claimed runs record
        // launch failures in launchAutomation.
      } finally {
        evaluating = false;
      }
    };
    void evaluate();
    const timer = window.setInterval(() => void evaluate(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void evaluate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ensureAutomationRecovery, launchAutomation]);

  const onInboxActivity = useCallback(
    (
      items: Parameters<typeof claimInboxAutomationRuns>[0],
      transitions: Parameters<typeof claimInboxAutomationRuns>[2],
    ) => {
      void ensureAutomationRecovery()
        .then(() => claimInboxAutomationRuns(items, Date.now(), transitions))
        .then((due) => {
          for (const item of due) {
            void launchAutomation(
              item.automation,
              item.run,
              false,
              item.prompt,
              item.linkedWorkItem,
            ).catch((error) => {
              console.warn("App operation failed", error);
            });
          }
        })
        .catch((error) => {
          console.warn("App operation failed", error);
        });
    },
    [ensureAutomationRecovery, launchAutomation],
  );

  const onUpdatePlan = useCallback((sessionId: string, blockId: string, text: string) => {
    setSessions((prev) =>
      prev.map((session) => {
        if (remoteProjectFor(session.cwd)) return session;
        if (session.id !== sessionId || session.busy) return session;
        return {
          ...session,
          blocks: session.blocks.map((block) => {
            if (
              block.id !== blockId ||
              block.role !== "plan" ||
              block.plan?.status === "streaming" ||
              block.plan?.status === "building" ||
              block.plan?.status === "built"
            ) {
              return block;
            }
            const originalText = block.plan?.originalText ?? block.text;
            return {
              ...block,
              text,
              plan: {
                ...(block.plan ?? { status: "ready" as const }),
                status: "ready" as const,
                originalText,
                edited: text !== originalText,
              },
            };
          }),
        };
      }),
    );
  }, []);

  const onBuildPlan = useCallback(
    (sessionId: string, blockId: string, target?: PlanBuildTarget) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (session && remoteProjectFor(session.cwd)) {
        buildRemotePlan(sessionId, blockId, target);
        return;
      }
      const block = session?.blocks.find((entry) => entry.id === blockId);
      if (
        !session ||
        session.busy ||
        block?.role !== "plan" ||
        !!block.orchestration ||
        !block.text.trim() ||
        block.plan?.status === "streaming" ||
        block.plan?.status === "building" ||
        block.plan?.status === "built"
      ) {
        return;
      }
      if (target && session.modelSettings) {
        saveLastModelSettings(session.modelSettings, "fill");
      }
      onSubmit(sessionId, "Build approved plan", [], {
        intent: "build",
        planBlockId: blockId,
        buildTarget: target,
      });
    },
    [onSubmit],
  );

  useEffect(() => {
    const timers: number[] = [];
    const scheduled = new Set<string>();
    for (const session of sessions) {
      const queued = session.queuedMessages ?? [];
      if (
        windowTransferPending ||
        movingSessionIds.current.has(session.id) ||
        session.busy ||
        queued.length === 0
      )
        continue;

      if (session.queueStatus === "resuming") {
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === session.id ? { ...entry, queueStatus: "active" } : entry,
          ),
        );
        continue;
      }
      if (
        !canDispatchQueuedHead(session) ||
        !sharedLocalQueueReady(session.id) ||
        retiringTurns.current.has(session.id) ||
        queueDispatchingRef.current.has(session.id)
      ) {
        continue;
      }

      const next = queued[0];
      if (!next) continue;
      queueDispatchingRef.current.add(session.id);
      scheduled.add(session.id);
      timers.push(
        window.setTimeout(() => {
          queueDispatchingRef.current.delete(session.id);
          const latest = sessionsRef.current.find((entry) => entry.id === session.id);
          const head = latest?.queuedMessages?.[0];
          if (
            !latest ||
            !head ||
            head.id !== next.id ||
            windowTransferPendingRef.current ||
            movingSessionIds.current.has(session.id) ||
            retiringTurns.current.has(session.id) ||
            !canDispatchQueuedHead(latest)
          ) {
            return;
          }
          onSubmit(session.id, head.text, head.attachments, {
            queuedMessageId: head.id,
            noteCard: head.noteCard,
            handoffCard: head.handoffCard,
            intent: head.intent,
          });
        }, 0),
      );
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const id of scheduled) queueDispatchingRef.current.delete(id);
    };
  }, [onSubmit, sessions, movingWindows, windowTransferPending]);

  useQueuePersistence(sessions);

  const onDeleteQueuedMessage = useCallback((sessionId: string, messageId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? dequeueQueuedMessage(session, messageId) : session,
      ),
    );
  }, []);

  const onQueuedMessageEditingChange = useCallback((sessionId: string, messageId?: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? { ...session, editingQueuedMessageId: messageId } : session,
      ),
    );
  }, []);

  const onReorderQueuedMessages = useCallback((sessionId: string, messageIds: string[]) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? reorderSessionQueue(session, messageIds) : session,
      ),
    );
  }, []);

  const onEditQueuedMessage = useCallback(
    (sessionId: string, messageId: string, text: string, attachments: Attachment[]) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                queuedMessages: session.queuedMessages?.map((message) =>
                  message.id === messageId
                    ? applyQueuedEdit(message, { text, attachments })
                    : message,
                ),
                editingQueuedMessageId: undefined,
              }
            : session,
        ),
      );
    },
    [],
  );

  const onSteerQueuedMessage = useCallback(
    (sessionId: string, messageId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      const message = session ? queuedMessageForSubmit(session, messageId, "steer") : undefined;
      if (!session) return;
      if (!message) {
        if (
          session.queuedMessages?.some(
            (entry) =>
              entry.id === messageId &&
              entry.modelTarget &&
              !entry.attachments.some((file) => file.missing),
          )
        ) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "This queued message uses a different model or effort. Resume the queue to send it as a new turn with its saved settings.",
          });
          flushHarnessEvents();
        }
        return;
      }
      if (message.intent === "orchestrate" && session.busy) {
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: "Orchestration planning will start after the current turn finishes.",
        });
        flushHarnessEvents();
        return;
      }
      onSubmit(sessionId, message.text, message.attachments, {
        followUpBehavior: "steer",
        queuedMessageId: message.id,
        noteCard: message.noteCard,
        handoffCard: message.handoffCard,
        intent: message.intent,
      });
    },
    [onSubmit, enqueueHarnessEvent, flushHarnessEvents],
  );

  const onResumeQueue = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (
        !session ||
        session.busy ||
        session.queueStatus !== "paused" ||
        !session.queuedMessages?.length
      ) {
        return;
      }
      setSessions((prev) =>
        prev.map((entry) =>
          entry.id === sessionId ? { ...entry, queueStatus: "resuming" } : entry,
        ),
      );
      onSubmit(sessionId, CONTINUE_PROMPT, [], {
        followUpBehavior: "steer",
      });
    },
    [onSubmit],
  );

  const onUsageLimitDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.usageLimit
          ? { ...session, usageLimit: undefined }
          : session,
      ),
    );
  }, []);

  /** Move one session to another account of its provider, keeping the conversation. */
  const onSwitchSessionAccount = useCallback(
    async (sessionId: string, provider: ProviderAccountProvider, accountId: string) => {
      if (isMovingPane(sessionId)) return false;
      if (!providerAccountExists(provider, accountId)) return false;
      const result = await switchSessionAccount(sessionId, provider, accountId, {
        transfer: transferProviderSession,
        forget: forgetHarnessSession,
        bind: bindHarnessSession,
        latest: (id) => sessionsRef.current.find((s) => s.id === id),
        label: providerAccountLabel,
        removing: (id) => removingSessionIds.current.has(id),
      });
      const say = (text: string) => {
        enqueueHarnessEvent(sessionId, { type: "status", text });
        flushHarnessEvents();
      };
      if (result.kind === "refused") {
        say(result.status);
        return false;
      }
      if (result.kind !== "switched") {
        if (result.kind === "noop") {
          promptProviderAccountSignIn(sessionId, provider, accountId);
        }
        return result.kind === "noop";
      }
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? result.update(s) : s)));
      if (result.status) say(result.status);
      promptProviderAccountSignIn(sessionId, provider, accountId);
      return true;
    },
    [enqueueHarnessEvent, flushHarnessEvents, promptProviderAccountSignIn],
  );

  const onSelectProviderAccount = useCallback(
    (provider: ProviderAccountProvider, accountId: string) => {
      if (active) void onSwitchSessionAccount(active.id, provider, accountId);
    },
    [active?.id, onSwitchSessionAccount],
  );

  const onUsageLimitResumeAtReset = useCallback((sessionId: string, enabled: boolean) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.usageLimit
          ? {
              ...session,
              usageLimit: { ...session.usageLimit, resumeAtReset: enabled },
            }
          : session,
      ),
    );
  }, []);

  const onUsageLimitResume = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (!session?.usageLimit || session.busy) return;
      onUsageLimitDismiss(sessionId);
      onSubmit(sessionId, CONTINUE_PROMPT);
    },
    [onSubmit, onUsageLimitDismiss],
  );

  const [usageLimitTick, setUsageLimitTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const timers: number[] = [];
    const scheduled = new Set<string>();
    let nextCheck = Number.POSITIVE_INFINITY;
    for (const session of sessions) {
      const limit = session.usageLimit;
      if (windowTransferPending || movingSessionIds.current.has(session.id)) continue;
      if (!limit?.resumeAtReset || limit.resetsAt == null) continue;
      if (!usageLimitResumeDue(session, now)) {
        nextCheck = Math.min(nextCheck, limit.resetsAt + USAGE_LIMIT_RESUME_GRACE_MS - now);
        continue;
      }
      if (usageResumingRef.current.has(session.id)) continue;
      usageResumingRef.current.add(session.id);
      scheduled.add(session.id);
      timers.push(
        window.setTimeout(() => {
          usageResumingRef.current.delete(session.id);
          const latest = sessionsRef.current.find((entry) => entry.id === session.id);
          if (
            latest &&
            !windowTransferPendingRef.current &&
            !movingSessionIds.current.has(session.id) &&
            usageLimitResumeDue(latest, Date.now())
          ) {
            onUsageLimitResume(session.id);
          }
        }, 0),
      );
    }
    if (Number.isFinite(nextCheck)) {
      // Re-check every minute at most: timers drift while the machine sleeps.
      timers.push(
        window.setTimeout(
          () => setUsageLimitTick((tick) => tick + 1),
          Math.max(1_000, Math.min(nextCheck, 60_000)),
        ),
      );
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const id of scheduled) usageResumingRef.current.delete(id);
    };
  }, [onUsageLimitResume, sessions, usageLimitTick, movingWindows, windowTransferPending]);

  // The stream does not always say when the limit resets; ask the provider.
  useEffect(() => {
    for (const session of sessions) {
      const limit = session.usageLimit;
      if (!limit || limit.resetsAt != null) continue;
      if (usageResetLookups.current.has(limit)) continue;
      const provider = session.harness;
      if (provider !== "claude" && provider !== "codex") continue;
      usageResetLookups.current.add(limit);
      // Through the shared cache: several sessions hitting the limit at once
      // must not each ask the provider, which rate-limits this request.
      void loadFreshRateLimits(provider, sessionProviderAccountId(provider, session), 60_000).then(
        (limits) => {
          const resetsAt = exhaustedWindowResetAt(limits);
          if (resetsAt == null) return;
          setSessions((prev) =>
            prev.map((entry) =>
              entry.id === session.id && entry.usageLimit === limit
                ? { ...entry, usageLimit: { ...limit, resetsAt } }
                : entry,
            ),
          );
        },
      );
    }
  }, [sessions]);

  const openSessionBeside = useCallback(
    (sourceId: string, session: Session, cwd: string, focusComposer = false) => {
      const nextSessions = [...sessionsRef.current, session];
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);

      const tab = tabsRef.current.find((entry) => leafIds(entry.layout).includes(sourceId));
      if (tab) {
        const nextTabs = tabsRef.current.map((entry) =>
          entry.id === tab.id
            ? {
                ...entry,
                layout: splitPane(entry.layout, sourceId, "right", session.id),
                focusedId: session.id,
                diffFocused: false,
              }
            : entry,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        if (tab.id !== activeTabIdRef.current) setActiveTabId(tab.id);
      } else {
        const nextTab = newTab(session.id);
        appendTab(nextTab, cwd);
        setActiveTabId(nextTab.id);
      }

      setProjectTerminalFocused(false);
      setComposerFocused(focusComposer);
    },
    [appendTab],
  );

  const onSecondOpinion = useCallback(
    (sourceId: string, target: ModelTarget, turn: Block[]) => {
      const source = sessionsRef.current.find((session) => session.id === sourceId);
      if (!source || source.worktreeRemoved) return;
      const { harness, model, modelSettings } = target;
      const cwd = sessionWorkCwd(source);
      const from = harnessForTurn(source.blocks, turn, source.harness);
      const request = buildSecondOpinionRequest({
        from,
        to: harness,
        turn,
        cwd,
      });
      const session = {
        ...newSession(harness, source.cwd, model, source.runtimeMode),
        worktreeCwd: source.worktreeCwd,
        branch: source.branch,
        modelSettings: mergeModelSettings(resolveModel(harness, model), modelSettings),
        title: formatSessionTitle(harness, SECOND_OPINION_TITLE),
      };
      openSessionBeside(sourceId, session, source.cwd);
      onSubmit(session.id, request.prompt, [], request.options);
    },
    [onSubmit, openSessionBeside],
  );
  const updateBtwThread = useCallback(
    (
      sessionId: string,
      userBlockId: string,
      threadId: string,
      update: (thread: BtwThread | undefined) => BtwThread | undefined,
    ): Session | undefined => {
      const previous = sessionsRef.current;
      let updatedSession: Session | undefined;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        const blockIndex = session.blocks.findIndex(
          (block) => block.id === userBlockId && block.role === "user",
        );
        if (blockIndex < 0) return session;
        const block = session.blocks[blockIndex];
        const current = block.btwThreads?.find((thread) => thread.id === threadId);
        const nextThread = update(current);
        if (!nextThread) return session;
        const nextBlock = current
          ? replaceBtwThread(block, nextThread)
          : {
              ...block,
              btwThreads: [...(block.btwThreads ?? []), nextThread],
            };
        const blocks = session.blocks.slice();
        blocks[blockIndex] = nextBlock;
        updatedSession = { ...session, blocks };
        return updatedSession;
      });
      if (!updatedSession) return undefined;
      sessionsRef.current = next;
      setSessions(next);
      persistSession(updatedSession);
      return updatedSession;
    },
    [persistSession],
  );

  const removeBtwThread = useCallback(
    (sessionId: string, userBlockId: string, threadId: string): Session | undefined => {
      const previous = sessionsRef.current;
      let updatedSession: Session | undefined;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        const blockIndex = session.blocks.findIndex(
          (block) => block.id === userBlockId && block.role === "user",
        );
        if (blockIndex < 0) return session;
        const block = session.blocks[blockIndex];
        const threads = block.btwThreads ?? [];
        if (!threads.some((thread) => thread.id === threadId)) return session;
        const nextThreads = threads.filter((thread) => thread.id !== threadId);
        const nextBlock = {
          ...block,
          btwThreads: nextThreads.length > 0 ? nextThreads : undefined,
        };
        const blocks = session.blocks.slice();
        blocks[blockIndex] = nextBlock;
        updatedSession = { ...session, blocks };
        return updatedSession;
      });
      if (!updatedSession) return undefined;
      sessionsRef.current = next;
      setSessions(next);
      persistSession(updatedSession);
      return updatedSession;
    },
    [persistSession],
  );

  const runBtwRequest = useCallback(
    (input: {
      sessionId: string;
      userBlockId: string;
      source: Session;
      thread: BtwThread;
      harness: HarnessId;
    }) => {
      const harness = input.harness;
      if (!supportsBtwHarness(harness)) return;
      const cwd = sessionWorkCwd(input.source);
      const model = nativeModelId(input.thread.model ?? input.source.model).trim();
      if (!cwd || cwd === "~") {
        updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) =>
          thread
            ? {
                ...thread,
                status: "error",
                updatedAt: Date.now(),
                error: "A project working directory is required for this question.",
              }
            : undefined,
        );
        return;
      }
      if (!model && harness === "codex") {
        updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) =>
          thread
            ? {
                ...thread,
                status: "error",
                updatedAt: Date.now(),
                error: "The selected Codex model is unavailable.",
              }
            : undefined,
        );
        return;
      }

      let prompt: string;
      try {
        prompt = buildBtwPrompt({
          blocks: input.source.blocks,
          thread: input.thread,
          cwd,
        });
      } catch (error) {
        updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) =>
          thread
            ? {
                ...thread,
                status: "error",
                updatedAt: Date.now(),
                error:
                  error instanceof Error
                    ? error.message
                    : "The completed turn is no longer available.",
              }
            : undefined,
        );
        return;
      }

      const key = `${input.sessionId}:${input.thread.id}`;
      btwRequestsRef.current.get(key)?.controller.abort();
      const controller = new AbortController();
      btwRequestsRef.current.set(key, {
        sessionId: input.sessionId,
        controller,
      });

      const userMessageId =
        input.thread.messages[input.thread.messages.length - 1]?.id ?? input.thread.id;
      const responseModel = model || input.source.model;

      void runHarnessTextPrompt({
        harness,
        cwd,
        providerAccountId: input.source.providerAccountId,
        model: model || undefined,
        modelSettings: input.thread.modelSettings ?? input.source.modelSettings,
        threadId: input.thread.providerThreadId,
        ephemeral: false,
        onThreadId: (providerThreadId) => {
          if (controller.signal.aborted) return;
          updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) =>
            thread && thread.providerThreadId !== providerThreadId
              ? {
                  ...thread,
                  providerThreadId,
                  updatedAt: Date.now(),
                }
              : thread,
          );
        },
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) =>
            thread?.status === "running"
              ? {
                  ...thread,
                  updatedAt: Date.now(),
                  pendingBlocks: applyBtwHarnessEvent(
                    thread.pendingBlocks ?? [],
                    event,
                    harness,
                    responseModel,
                    userMessageId,
                  ),
                }
              : undefined,
          );
        },
        intent: "plan",
        prompt,
        signal: controller.signal,
      })
        .then((output) => {
          if (controller.signal.aborted) return;
          const text = output.trim();
          if (!text) {
            throw new Error(`${HARNESS_TITLE[harness]} returned an empty side answer.`);
          }
          updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) => {
            if (!thread) return undefined;
            const pendingBlocks = thread.pendingBlocks ?? [];
            const blocks =
              pendingBlocks.length > 0
                ? sealBtwResponseBlocks(pendingBlocks, harness, responseModel, userMessageId)
                : undefined;
            return {
              ...thread,
              status: "ready",
              updatedAt: Date.now(),
              pendingBlocks: undefined,
              messages: [
                ...thread.messages,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  text,
                  createdAt: Date.now(),
                  ...(blocks?.length ? { blocks } : {}),
                },
              ],
              error: undefined,
            };
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message =
            error instanceof Error
              ? error.message
              : `${HARNESS_TITLE[harness]} could not answer this side question.`;
          updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) =>
            thread
              ? {
                  ...thread,
                  status: "error",
                  updatedAt: Date.now(),
                  pendingBlocks: undefined,
                  error: message,
                }
              : undefined,
          );
        })
        .finally(() => {
          if (btwRequestsRef.current.get(key)?.controller === controller) {
            btwRequestsRef.current.delete(key);
          }
        });
    },
    [updateBtwThread],
  );

  const onBtwSubmit = useCallback(
    (
      sessionId: string,
      turn: Block[],
      threadId: string,
      messageId: string,
      text: string,
      model?: string,
      modelSettings?: Record<string, string>,
    ) => {
      const source = sessionsRef.current.find((session) => session.id === sessionId);
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      const sourceEndBlockId = turn[turn.length - 1]?.id;
      const turnHarness = source ? harnessForTurn(source.blocks, turn, source.harness) : undefined;
      const turnModel = turn.find((block) => block.role === "user")?.turnModel?.id;
      const sourceBlockEarly = source?.blocks.find(
        (block) => block.id === sourceUserId && block.role === "user",
      );
      const existingEarly = sourceBlockEarly?.btwThreads?.find((thread) => thread.id === threadId);
      const requestHarness = source
        ? supportsBtwHarness(turnHarness)
          ? turnHarness
          : (existingEarly?.harness ?? btwTurnHarness(source.blocks, turn, source.harness))
        : undefined;
      if (
        !source ||
        !supportsBtwHarness(requestHarness) ||
        source.worktreeRemoved ||
        !sourceUserId ||
        !sourceEndBlockId
      ) {
        return false;
      }
      const sourceBlock = sourceBlockEarly;
      if (!sourceBlock) return false;
      const existing = existingEarly;
      const selectedModel =
        model?.trim() || existing?.model || turnModel || nativeModelId(source.model).trim();
      const selectedModelSettings =
        modelSettings ??
        existing?.modelSettings ??
        preferredModelSettings(
          resolveModel(requestHarness!, selectedModel || source.model),
          source.modelSettings,
        );
      if (existing?.status === "running") return false;
      if (existing && existing.sourceEndBlockId !== sourceEndBlockId) {
        return false;
      }
      const now = Date.now();
      const thread: BtwThread = existing
        ? {
            ...existing,
            harness: existing.harness ?? turnHarness,
            model: selectedModel || undefined,
            modelSettings: selectedModelSettings,
            status: "running",
            updatedAt: now,
            error: undefined,
            pendingBlocks: [],
            messages: [...existing.messages, { id: messageId, role: "user", text, createdAt: now }],
          }
        : {
            id: threadId,
            sourceEndBlockId,
            createdAt: now,
            updatedAt: now,
            status: "running",
            pendingBlocks: [],
            harness: requestHarness,
            ...(selectedModel ? { model: selectedModel } : {}),
            modelSettings: selectedModelSettings,
            messages: [{ id: messageId, role: "user", text, createdAt: now }],
          };
      const updated = updateBtwThread(sessionId, sourceUserId, threadId, () => thread);
      if (!updated) return false;
      runBtwRequest({
        sessionId,
        userBlockId: sourceUserId,
        source,
        thread,
        harness: thread.harness ?? requestHarness!,
      });
      return true;
    },
    [runBtwRequest, updateBtwThread],
  );

  const onBtwModelChange = useCallback(
    (
      sessionId: string,
      turn: Block[],
      threadId: string,
      model: string,
      modelSettings: Record<string, string>,
    ) => {
      const source = sessionsRef.current.find((session) => session.id === sessionId);
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      const turnHarness = source ? harnessForTurn(source.blocks, turn, source.harness) : undefined;
      const nextModel = model.trim();
      const sourceBlock = source?.blocks.find(
        (block) => block.id === sourceUserId && block.role === "user",
      );
      const threadHarness = source
        ? (sourceBlock?.btwThreads?.find((thread) => thread.id === threadId)?.harness ??
          btwTurnHarness(source.blocks, turn, source.harness) ??
          turnHarness)
        : undefined;
      if (
        !source ||
        !supportsBtwHarness(threadHarness) ||
        source.worktreeRemoved ||
        !sourceUserId ||
        !nextModel
      ) {
        return;
      }
      updateBtwThread(sessionId, sourceUserId, threadId, (thread) =>
        thread
          ? {
              ...thread,
              model: nextModel,
              modelSettings,
              updatedAt: Date.now(),
            }
          : undefined,
      );
    },
    [updateBtwThread],
  );

  const onBtwDelete = useCallback(
    (sessionId: string, turn: Block[], threadId: string) => {
      const source = sessionsRef.current.find((session) => session.id === sessionId);
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      const turnHarness = source ? harnessForTurn(source.blocks, turn, source.harness) : undefined;
      const sourceBlock = source?.blocks.find(
        (block) => block.id === sourceUserId && block.role === "user",
      );
      const threadHarness = source
        ? (sourceBlock?.btwThreads?.find((thread) => thread.id === threadId)?.harness ??
          btwTurnHarness(source.blocks, turn, source.harness) ??
          turnHarness)
        : undefined;
      if (
        !source ||
        !supportsBtwHarness(threadHarness) ||
        source.worktreeRemoved ||
        !sourceUserId
      ) {
        return;
      }
      const requestKey = `${sessionId}:${threadId}`;
      btwRequestsRef.current.get(requestKey)?.controller.abort();
      btwRequestsRef.current.delete(requestKey);
      removeBtwThread(sessionId, sourceUserId, threadId);
    },
    [removeBtwThread],
  );

  // Stopping keeps whatever the side answer had streamed, like stopping a
  // main turn, and leaves the thread ready for the next question.
  const onBtwStop = useCallback(
    (sessionId: string, turn: Block[], threadId: string) => {
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      if (!sourceUserId) return;
      const key = `${sessionId}:${threadId}`;
      btwRequestsRef.current.get(key)?.controller.abort();
      btwRequestsRef.current.delete(key);
      updateBtwThread(sessionId, sourceUserId, threadId, (thread) => {
        if (!thread || thread.status !== "running") return thread;
        const harness = thread.harness;
        const userMessageId = thread.messages[thread.messages.length - 1]?.id ?? thread.id;
        const pending = thread.pendingBlocks ?? [];
        const blocks =
          pending.length > 0 && harness
            ? sealBtwResponseBlocks(pending, harness, thread.model ?? "", userMessageId)
            : [];
        const text = blocks
          .filter((block) => block.role === "assistant")
          .map((block) => block.text)
          .join("\n\n")
          .trim();
        const now = Date.now();
        return {
          ...thread,
          status: "ready",
          updatedAt: now,
          pendingBlocks: undefined,
          error: undefined,
          messages: blocks.length
            ? [
                ...thread.messages,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  text,
                  createdAt: now,
                  blocks,
                },
              ]
            : thread.messages,
        };
      });
    },
    [updateBtwThread],
  );

  const onBtwRetry = useCallback(
    (sessionId: string, turn: Block[], threadId: string) => {
      const source = sessionsRef.current.find((session) => session.id === sessionId);
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      const turnHarness = source ? harnessForTurn(source.blocks, turn, source.harness) : undefined;
      const sourceBlock = source?.blocks.find(
        (block) => block.id === sourceUserId && block.role === "user",
      );
      const existing = sourceBlock?.btwThreads?.find((thread) => thread.id === threadId);
      const threadHarness = source
        ? (existing?.harness ?? btwTurnHarness(source.blocks, turn, source.harness) ?? turnHarness)
        : undefined;
      if (
        !source ||
        !supportsBtwHarness(threadHarness) ||
        source.worktreeRemoved ||
        !sourceUserId
      ) {
        return;
      }
      if (!sourceBlock || !existing || existing.status !== "error") return;
      const thread: BtwThread = {
        ...existing,
        status: "running",
        updatedAt: Date.now(),
        error: undefined,
        pendingBlocks: [],
      };
      const updated = updateBtwThread(sessionId, sourceUserId, threadId, () => thread);
      if (!updated) return;
      runBtwRequest({
        sessionId,
        userBlockId: sourceUserId,
        source: updated,
        thread,
        harness: thread.harness ?? threadHarness!,
      });
    },
    [runBtwRequest, updateBtwThread],
  );

  const onHandoff = useCallback(
    (sourceId: string, target: ModelTarget, turn: Block[]) => {
      const source = sessionsRef.current.find((session) => session.id === sourceId);
      if (!source || source.worktreeRemoved) return;
      const { harness, model, modelSettings } = target;
      const cwd = sessionWorkCwd(source);
      const from = harnessForTurn(source.blocks, turn, source.harness);
      const sliced = sessionThroughTurn(source, turn);
      const userRequest = turnUserRequest(turn);
      const files = turnEditedFiles(sliced.blocks, cwd);
      const display = sessionDisplayTitle(source.title, source.harness);
      const session = {
        ...newSession(harness, source.cwd, model, source.runtimeMode),
        worktreeCwd: source.worktreeCwd,
        branch: source.branch,
        modelSettings: mergeModelSettings(resolveModel(harness, model), modelSettings),
        title: formatSessionTitle(harness, display === "New session" ? HANDOFF_TITLE : display),
        handoffCard: buildHandoffComposerCard({
          from,
          to: harness,
          brief: buildDeterministicHandoff(sliced),
          userRequest,
          files,
        }),
      };
      openSessionBeside(sourceId, session, source.cwd, true);
    },
    [openSessionBeside],
  );

  const autoContinueKey = sessions
    .filter(
      (session) =>
        !windowTransferPending &&
        !movingSessionIds.current.has(session.id) &&
        !isRecoverySessionHeld(session.id) &&
        canAutoContinue(session) &&
        isLiveHarness(session.harness) &&
        isAutoContinueDue(session.id),
    )
    .map((session) => session.id)
    .join("\n");

  useEffect(() => {
    if (!autoContinueKey) return;
    const ids = autoContinueKey.split("\n");
    // Delay past React StrictMode's dev remount so Continue is not claimed
    // against a discarded tree (sessionStorage also survives Vite reloads).
    const timer = window.setTimeout(() => {
      for (const id of ids) {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (
          !session ||
          windowTransferPendingRef.current ||
          movingSessionIds.current.has(id) ||
          isRecoverySessionHeld(id) ||
          !canAutoContinue(session) ||
          !isLiveHarness(session.harness) ||
          !claimAutoContinue(id)
        ) {
          continue;
        }
        onSubmit(id, CONTINUE_PROMPT);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoContinueKey, onSubmit]);

  const onCompactContext = useCallback(
    (sessionId: string) => {
      const current = sessionsRef.current.find((session) => session.id === sessionId);
      if (current && remoteProjectFor(current.cwd))
        return remoteSessionActions(sessionId)?.compact() ?? false;
      if (!current || current.busy || current.worktreeRemoved) return false;
      if (!canCompactHarnessContext(current.harness)) {
        const unsupported = sessionsRef.current.map((session) =>
          session.id === sessionId
            ? applyHarnessEvent(session, {
                type: "status",
                text: `${HARNESS_TITLE[current.harness]} does not support manual context compaction.`,
              })
            : session,
        );
        sessionsRef.current = unsupported;
        syncDockBadge(unsupported);
        setSessions(unsupported);
        return true;
      }

      const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
      turnGen.current.set(sessionId, gen);
      const workCwd = sessionWorkCwd(current);
      const started = sessionsRef.current.map((session) =>
        session.id === sessionId
          ? applyHarnessEvent(
              { ...session, busy: true },
              { type: "status", text: "Compacting context…" },
            )
          : session,
      );
      sessionsRef.current = started;
      syncDockBadge(started);
      setSessions(started);

      void (async () => {
        try {
          await compactHarnessContext({
            harness: current.harness,
            sessionId,
            cwd: workCwd,
            model: current.model,
            modelSettings: current.modelSettings,
            providerAccountId: supportsProviderAccounts(current.harness)
              ? sessionProviderAccountId(current.harness, current)
              : undefined,
            runtimeMode: current.runtimeMode,
            onEvent: (event) => {
              if (turnGen.current.get(sessionId) !== gen) return;
              enqueueHarnessEvent(sessionId, event);
            },
          });
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "Compacted context",
          });
        } catch (error: unknown) {
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, {
            type: "session.error",
            message:
              error instanceof Error
                ? error.message
                : `${current.harness} could not compact this context`,
          });
        } finally {
          if (turnGen.current.get(sessionId) !== gen) return;
          flushHarnessEvents();
          const finished = sessionsRef.current.map((session) =>
            session.id === sessionId ? { ...session, busy: false } : session,
          );
          sessionsRef.current = finished;
          syncDockBadge(finished);
          setSessions(finished);
        }
      })();
      return true;
    },
    [enqueueHarnessEvent, flushHarnessEvents],
  );

  const onStop = useCallback(
    (sessionId: string, managed = false) => {
      const remote = sessionsRef.current.find((s) => s.id === sessionId);
      if (remote && remoteProjectFor(remote.cwd)) {
        remoteSessionActions(sessionId)?.stop();
        return;
      }
      if (!managed) {
        const stopping = orchestrator.stopForSession(sessionId);
        if (stopping) {
          void stopping.catch(console.error);
          return;
        }
      }
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      flushHarnessEvents();
      if (session) {
        for (const id of sessionChildHarnesses(session)) {
          void cancelHarnessTurn(id, sessionId);
        }
      }
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const stopped = stopStreaming(s);
          const completed = isPreparingHandoff(stopped)
            ? completeHandoff(stopped, buildDeterministicHandoff(stopped))
            : stopped;
          const ready = { ...completed, worktreePreparing: undefined };
          return ready.queuedMessages?.length ? { ...ready, queueStatus: "paused" } : ready;
        }),
      );
      if (session) {
        notifyFinishedWorkspace(
          sessionId,
          sessionWorkCwd(session),
          deferWorkspaceWork,
          "workspace-first",
        );
      } else {
        notifyReviewChanged(sessionId);
      }
    },
    [flushHarnessEvents],
  );
  onStopRef.current = onStop;

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const inTerminal = Boolean(target?.closest(".bycoda-terminal"));
      const activeTabId = activeTabIdRef.current;
      const sessionId = focusedBusyAgentSessionId(
        activeTabId,
        tabsRef.current,
        sessionsRef.current,
        projectTerminalFocusedRef.current,
      );
      if (
        !sessionId ||
        !shouldStopFocusedTurnOnEscape(event, {
          inTerminal,
          focusedSessionBusy: true,
        })
      ) {
        return;
      }

      // Other surfaces (drag/reorder included) can claim Escape later in the
      // same keydown dispatch. Defer the destructive stop until every handler
      // has had a chance to preventDefault, then verify focus did not move.
      deferUnhandledEscape(event, () => {
        const stillFocusedSessionId = focusedBusyAgentSessionId(
          activeTabIdRef.current,
          tabsRef.current,
          sessionsRef.current,
          projectTerminalFocusedRef.current,
        );
        if (activeTabIdRef.current !== activeTabId || stillFocusedSessionId !== sessionId) {
          return;
        }
        onStop(sessionId);
      });
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onStop]);

  const onApproval = useCallback(
    (sessionId: string, requestId: number, decision: ApprovalDecision) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session || session.worktreeRemoved) return;
      if (remoteProjectFor(session.cwd)) {
        remoteSessionActions(sessionId)?.approve(requestId, decision);
        return;
      }
      respondHarnessApproval(session.harness, sessionId, requestId, decision);
    },
    [],
  );

  const onQuestionReply = useCallback(
    (sessionId: string, requestId: number, reply: UserQuestionReply) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session || session.worktreeRemoved) return;
      if (remoteProjectFor(session.cwd)) {
        remoteSessionActions(sessionId)?.answer(requestId, reply);
        return;
      }
      respondHarnessQuestion(session.harness, sessionId, requestId, reply);
    },
    [],
  );

  desktopLiveHandlers.current = {
    delete: async (sessionId, cwd) => {
      const stored = await getSession(sessionId);
      const open = sessionsRef.current.find((session) => session.id === sessionId);
      if (!stored || isRemoteProjectPath(stored.cwd) || !sameProjectPath(stored.cwd, cwd))
        throw new Error("Session does not belong to this local project");
      if (stored.busy || open?.busy || orchestrator.forSession(sessionId)?.status === "active")
        throw new Error("Stop this session before deleting it");
      if (!(await onDeleteHistorySessionNow(sessionId, true)))
        throw new Error("The conversation could not be deleted");
    },
    stop: (sessionId) => onStop(sessionId),
    approve: onApproval,
    answer: onQuestionReply,
  };

  const onQuestionInteraction = useCallback((sessionId: string, requestId: number) => {
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    if (session && remoteProjectFor(session.cwd)) return;
    if (session && !session.worktreeRemoved)
      keepHarnessQuestionOpen(session.harness, sessionId, requestId);
  }, []);

  const onOpenApprovalSession = useCallback(
    (sessionId: string) => {
      const parentId =
        sessionsRef.current.find((session) => session.id === sessionId)?.orchestrationLeadId ??
        orchestrator.forSession(sessionId)?.leadId;
      if (parentId && parentId !== sessionId) {
        setInspectedWorkerId(sessionId);
        if (!focusOpenSession(parentId)) void onSelectHistorySession(parentId);
      } else if (!focusOpenSession(sessionId)) {
        void onSelectHistorySession(sessionId);
      }
    },
    [focusOpenSession, onSelectHistorySession],
  );

  useEffect(() => {
    setSessions((prev) => attachOrchestrationWorkers(prev, orchestrationRuns));
  }, [orchestrationRuns]);

  useEffect(() => {
    const next = consolidateOrchestrationTabs(tabs, activeTabId, orchestrationRuns);
    if (next.tabs !== tabs) setTabs(next.tabs);
    if (next.activeTabId !== activeTabId) setActiveTabId(next.activeTabId);
  }, [tabs, activeTabId, orchestrationRuns]);

  useLayoutEffect(() => {
    orchestrator.bind({
      session: (id) => sessionsRef.current.find((session) => session.id === id),
      sessions: () => sessionsRef.current,
      choices: () =>
        HARNESSES.filter(isHarnessAvailable).map((harness) => ({
          harness,
          models: modelsFor(harness).map(({ id, name }) => ({ id, name })),
        })),
      createWorker: async (run, task) => {
        const projectCwd = orchestrationProjectCwd(run);
        const leadCheckoutCwd = orchestrationCheckoutCwd(run);
        const lead = sessionsRef.current.find((session) => session.id === run.leadId);
        if (!lead) throw new Error("Lead session is unavailable");
        const workspace =
          task.workspacePolicy === "shared"
            ? workspaceIdentity(projectCwd, leadCheckoutCwd)
            : task.workspace
              ? await listWorktrees(leadCheckoutCwd).then((listed) => {
                  const tree = listed.worktrees.find(
                    (entry) => pathKey(entry.path) === pathKey(task.workspace!.checkoutCwd),
                  );
                  if (!tree)
                    throw new Error(
                      "This worker's retained worktree is missing. Its saved changes cannot be retried automatically.",
                    );
                  return workspaceIdentity(
                    projectCwd,
                    tree.path,
                    tree.branch ?? task.workspace!.branch,
                  );
                })
              : await createOrchestrationWorktree(
                  leadCheckoutCwd,
                  orchestrationWorktreeBranchName(task.id),
                ).then((tree) =>
                  workspaceIdentity(projectCwd, tree.path, tree.branch ?? undefined),
                );
        const checkoutCwd = workspace.checkoutCwd;
        const scratchDir = await invoke<string>("control_attach_worker", {
          leadId: run.leadId,
          sessionId: task.sessionId,
        });
        const existing = sessionsRef.current.find((session) => session.id === task.sessionId);
        if (existing) {
          if (
            existing.harness !== task.harness ||
            existing.model !== task.model ||
            !sameProjectPath(existing.cwd, projectCwd) ||
            (!existing.worktreeRemoved && !sameProjectPath(sessionWorkCwd(existing), checkoutCwd))
          )
            throw new Error(
              "This worker's configuration changed. Restore its approved harness, model and project before retrying.",
            );
          // The lead's runtime mode governs its agents, including across a
          // change mid-run: auto stays auto, supervised asks the lead.
          const synced = {
            ...existing,
            cwd: projectCwd,
            worktreeCwd: sameProjectPath(projectCwd, checkoutCwd) ? undefined : checkoutCwd,
            branch: workspace.branch,
            worktreeRemoved: false,
            runtimeMode: lead.runtimeMode,
            orchestrationLeadId: run.leadId,
          };
          await upsertSession(synced);
          const next = sessionsRef.current.map((session) =>
            session.id === synced.id ? synced : session,
          );
          sessionsRef.current = next;
          setSessions(next);
          return { scratchDir, workspace };
        }
        const restored = await getSession(task.sessionId);
        if (restored && (restored.harness !== task.harness || restored.model !== task.model))
          throw new Error(
            "The saved worker no longer matches its approved model. Create a new assignment.",
          );
        const fresh = {
          ...newSession(task.harness, projectCwd, task.model, lead.runtimeMode),
          ...(sameProjectPath(projectCwd, checkoutCwd)
            ? {}
            : { worktreeCwd: checkoutCwd, branch: workspace.branch }),
          ...(task.modelSettings
            ? {
                modelSettings: mergeModelSettings(
                  resolveModel(task.harness, task.model),
                  task.modelSettings,
                ),
              }
            : {}),
        };
        const base = restored
          ? {
              ...restored,
              busy: false,
              cwd: projectCwd,
              worktreeCwd: sameProjectPath(projectCwd, checkoutCwd) ? undefined : checkoutCwd,
              branch: sameProjectPath(projectCwd, checkoutCwd) ? undefined : workspace.branch,
              worktreeRemoved: false,
              runtimeMode: lead.runtimeMode,
            }
          : {
              ...fresh,
              id: task.sessionId,
              title: task.title,
            };
        const worker = { ...base, orchestrationLeadId: run.leadId };
        if (worker.providerSessionId)
          bindHarnessSession(
            worker.harness,
            worker.id,
            worker.providerSessionId,
            sessionWorkCwd(worker),
            worker.providerAccountId,
            worker.blocks,
          );
        await upsertSession(worker);
        const next = [...sessionsRef.current, worker];
        sessionsRef.current = next;
        setSessions(next);
        // Workers belong to the lead's agent panel; no workspace tab is created.
        return { scratchDir, workspace };
      },
      integrateWorker: async (run, task) => {
        const fromCwd = task.workspace?.checkoutCwd;
        if (!fromCwd) throw new Error("This worker's isolated checkout is unavailable");
        const session = sessionsRef.current.find((entry) => entry.id === task.sessionId);
        if (session)
          await Promise.all(
            sessionChildHarnesses(session).map((harness) =>
              stopHarnessSession(harness, task.sessionId),
            ),
          );
        await invoke("harness_kill", { sessionId: task.sessionId });
        await invoke("control_turn_finished", { sessionId: task.sessionId });
        await flushSessionCheckpoint(task.sessionId);
        const listed = await listWorktrees(orchestrationCheckoutCwd(run));
        const workerTree = listed.worktrees.find((tree) => sameProjectPath(tree.path, fromCwd));
        const leadTree = listed.worktrees.find((tree) =>
          sameProjectPath(tree.path, orchestrationCheckoutCwd(run)),
        );
        if (!workerTree || !leadTree)
          throw new Error(
            "The worker or lead checkout is no longer registered. The worker worktree was kept.",
          );
        if (workerTree.head !== leadTree.head)
          throw new Error(
            "The worker or lead branch moved while this task was running. The worker worktree was kept for manual review.",
          );
        return applySessionCheckpoint(task.sessionId, fromCwd, orchestrationCheckoutCwd(run));
      },
      cleanupWorker: async (run, task, onlyIfUnchanged) => {
        const workspace = task.workspace;
        if (!workspace || workspace.kind !== "worktree") return true;
        const path = workspace.checkoutCwd;
        await flushSessionCheckpoint(task.sessionId);
        const listed = await listWorktrees(orchestrationCheckoutCwd(run));
        const exists = listed.worktrees.some((tree) => pathKey(tree.path) === pathKey(path));
        if (!exists && onlyIfUnchanged) return false;
        const workerTree = listed.worktrees.find((tree) => pathKey(tree.path) === pathKey(path));
        const leadTree = listed.worktrees.find((tree) =>
          sameProjectPath(tree.path, orchestrationCheckoutCwd(run)),
        );
        if (exists && (!workerTree || !leadTree || workerTree.head !== leadTree.head)) {
          if (onlyIfUnchanged) return false;
          throw new Error(
            "The worker or lead branch moved before cleanup. The worker worktree was kept for manual review.",
          );
        }
        if (onlyIfUnchanged) {
          const safe = await sessionCheckpointCleanupSafe(task.sessionId, path);
          if (!safe) return false;
        } else if (exists) {
          // Re-verify immediately before destructive cleanup. The operation is
          // idempotent, so this also finishes a partially applied integration.
          await applySessionCheckpoint(task.sessionId, path, orchestrationCheckoutCwd(run));
        }

        if (exists) {
          onStop(task.sessionId, true);
          const session = sessionsRef.current.find((entry) => entry.id === task.sessionId);
          if (session) {
            await Promise.all(
              sessionChildHarnesses(session).map((harness) =>
                stopHarnessSession(harness, task.sessionId),
              ),
            );
          }
          await invoke("harness_kill", { sessionId: task.sessionId });
          await invoke("control_turn_finished", {
            sessionId: task.sessionId,
          });
          await flushSessionWrites();
          checkOpenWorktreeFiles(path);
          const removed = await removeOrchestrationWorktree(orchestrationCheckoutCwd(run), path);
          const affected = new Set([task.sessionId, ...removed.sessionIds]);
          sessionsRef.current = sessionsRef.current.map((session) =>
            affected.has(session.id)
              ? detachSessionWorktree(session, removed.projectCwd, path)
              : session,
          );
          setSessions(sessionsRef.current);
          const detachSummary = (entry: SessionSummary) =>
            affected.has(entry.id) ? detachSessionWorktree(entry, removed.projectCwd, path) : entry;
          setHistory((current) => current.map(detachSummary));
          setStoredLinkedSessions((current) => current.map(detachSummary));
          if (session)
            await Promise.allSettled(
              sessionChildHarnesses(session).map((harness) =>
                forgetHarnessSession(harness, task.sessionId),
              ),
            );
        } else {
          const detached = sessionsRef.current.find((entry) => entry.id === task.sessionId);
          if (detached && !detached.worktreeRemoved) {
            const next = detachSessionWorktree(detached, orchestrationProjectCwd(run), path);
            sessionsRef.current = sessionsRef.current.map((entry) =>
              entry.id === task.sessionId ? next : entry,
            );
            setSessions(sessionsRef.current);
            if (shouldPersistSession(next)) await upsertSession(next);
          }
        }
        if (workspace.branch)
          await removeOrchestrationBranch(orchestrationCheckoutCwd(run), workspace.branch);
        await forgetSessionCheckpoint(task.sessionId);
        notifyReviewChanged(task.sessionId);
        return true;
      },
      submit: (id, text, done) => {
        void submitWithSettlement({
          submit: (onSettled) => {
            let acceptance: SubmissionAcceptance = false;
            // Commit an immediate turn before another scheduler update. A
            // deferred submission flushes its own turn after synchronization.
            flushSync(() => {
              acceptance = submitSession(id, text, [], {
                managed: true,
                onSettled,
              });
            });
            return acceptance;
          },
          onSettled: done,
          rejectionMessage: "The selected agent session could not accept this turn.",
        }).catch(console.error);
      },
      steer: async (id, text) => {
        flushHarnessEvents();
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (!session) throw new Error("This agent is no longer available");
        if (!session.busy)
          throw new Error("This agent is not running a turn; send it a fresh one with message.");
        if (!isLiveHarness(session.harness) || !canSteerHarness(session.harness))
          throw new Error(
            `${session.harness} cannot take guidance mid-turn. Wait for the turn to finish, then use message.`,
          );
        // Record it on the worker before dispatch, so its own transcript shows
        // why it changed course even if the harness call then fails.
        const next = sessionsRef.current.map((entry) =>
          entry.id === id ? appendSteerUser(entry, text) : entry,
        );
        sessionsRef.current = next;
        setSessions(next);
        await steerHarnessTurn({
          harness: session.harness,
          sessionId: id,
          cwd: sessionWorkCwd(session),
          model: session.model,
          modelSettings: session.modelSettings,
          text,
        });
      },
      respondApproval: (id, requestId, decision) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (session) respondHarnessApproval(session.harness, id, requestId, decision);
      },
      answerQuestion: (id, requestId, reply) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (session) respondHarnessQuestion(session.harness, id, requestId, reply);
      },
      stop: async (id) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        onStop(id, true);
        try {
          if (session)
            await Promise.all(
              sessionChildHarnesses(session).map((harness) => stopHarnessSession(harness, id)),
            );
        } finally {
          // Also reap processes left behind by a renderer reload, before the
          // corresponding session has been restored in this window.
          await invoke("harness_kill", { sessionId: id });
          await invoke("control_turn_finished", { sessionId: id });
        }
      },
    });
  }, [checkOpenWorktreeFiles, submitSession, onStop]);

  useEffect(() => {
    orchestrator.sync();
  }, [sessions]);

  useEffect(() => {
    const listening = listen<{
      id: string;
      namespace: string;
      sessionId: string;
      requestId: string;
      action: string;
      input: Record<string, unknown>;
    }>("bycoda-control-request", ({ payload }) => {
      const handle = async () => {
        if (payload.namespace === "control") {
          return orchestrator.handle(
            payload.sessionId,
            payload.requestId,
            payload.action,
            payload.input,
          );
        }
        const conversationRead = payload.namespace === "conversation-ui" &&
          (payload.action === "sessions.list" || payload.action === "sessions.read");
        if (payload.namespace === "conversation-ui" && !conversationRead) {
          const source = sessionsRef.current.find((session) => session.id === payload.sessionId);
          if (!source) throw new Error("Conversation is not open in this window.");
          if (isProjectLockedIn(getGroupLockView().lock, source.cwd)) throw new Error("Conversation project is locked.");
          if (payload.action.startsWith("ui.workspace.")) {
            const { requestAppUi } = await import("./model/appUiControl");
            return requestAppUi({ cwd: source.cwd, sessionId: source.id, title: source.title }, payload.action, payload.input);
          }
          const { requestToolsUi } = await import("../features/host-tools/toolsUiControl");
          return requestToolsUi({ cwd: source.cwd, sessionId: source.id, title: source.title }, payload.action, payload.input);
        }
        if (payload.namespace !== "app" && !conversationRead) throw new Error("Unknown CLI namespace");
        const source = sessionsRef.current.find((session) => session.id === payload.sessionId);
        if (!source || source.inboxAsk || source.orchestrationLeadId || orchestrator.run(source.id))
          throw new Error("This session cannot use the bycoda app CLI");
        if ((payload.action === "sessions.list" || payload.action === "sessions.read") &&
            isProjectLockedIn(getGroupLockView().lock, source.cwd))
          throw new Error("Conversation project is locked.");
        const key = `${source.id}:${payload.requestId}`;
        const signature = JSON.stringify([payload.action, payload.input]);
        const previous = appReceipts.current.get(key);
        if (previous) {
          if (previous.signature !== signature)
            throw new Error("Request ID was already used with different input");
          return previous.promise;
        }
        const promise = handleAgentApp(source, payload.requestId, payload.action, payload.input, {
          start: async (launch, id, placement) => {
            const open = sessionsRef.current.find((session) => session.id === id);
            const stored = open ? null : await getSession(id);
            const existing = open ?? stored;
            const previous = existing?.blocks.find((block) => block.appRequestId === id);
            if (previous) {
              if (previous.text !== launch.prompt || (!launch.draft && !!previous.draft))
                throw new Error("Request ID was already used for another session launch");
              return;
            }
            if (existing?.blocks.some((block) => block.role === "user" && !block.draft)) return;
            if (existing && sessionDraftBlock(existing))
              throw new Error("Session ID already has a different draft");
            await launchQuickSessionRef.current(launch, id, placement);
          },
          sessions: async (cwd): Promise<AppSessionListing[]> => {
            const stored = await listSessionsByProject(cwd);
            const byId = new Map<string, AppSessionListing>();
            for (const session of stored) {
              if (session.orchestrationLeadId) continue;
              byId.set(session.id, {
                id: session.id,
                title: session.title,
                harness: session.harness,
                model: session.model,
                busy: false,
                hasDraft: !!session.draft,
              });
            }
            for (const session of sessionsRef.current) {
              if (session.orchestrationLeadId || !sameProjectPath(session.cwd, cwd)) continue;
              byId.set(session.id, {
                id: session.id,
                title: session.title,
                harness: session.harness,
                model: session.model,
                busy: !!session.busy,
                hasDraft: !!sessionDraftBlock(session),
              });
            }
            return [...byId.values()];
          },
          session: async (id) => {
            const target =
              sessionsRef.current.find((session) => session.id === id) ?? (await getSession(id));
            return target && !target.orchestrationLeadId && sameProjectPath(target.cwd, source.cwd)
              ? target
              : null;
          },
          send: async (id, prompt, requestId) => {
            const target = await ensureOpenSessionRef.current(id);
            if (
              !target ||
              target.orchestrationLeadId ||
              !sameProjectPath(target.cwd, source.cwd) ||
              orchestrator.run(id)
            )
              throw new Error("Session is unavailable in this project");
            const previous = target.blocks.find((block) => block.appRequestId === requestId);
            if (previous) {
              if (previous.text !== prompt)
                throw new Error("Request ID was already used with another prompt");
              if (previous.draft) throw new Error("Request ID belongs to an unsent draft");
              return { alreadySubmitted: true };
            }
            if (target.busy) throw new Error("Session is busy; try again when it finishes");
            if (sessionDraftBlock(target))
              throw new Error("Session already has a draft; send or remove it first");
            const accepted = await submitSessionRef.current(id, prompt, [], {
              appRequestId: requestId,
            });
            if (!accepted) throw new Error("Session could not accept the follow-up");
            return { alreadySubmitted: false };
          },
          draft: async (id, prompt, requestId) => {
            const target = await ensureOpenSessionRef.current(id);
            if (
              !target ||
              target.orchestrationLeadId ||
              !sameProjectPath(target.cwd, source.cwd) ||
              orchestrator.run(id)
            )
              throw new Error("Session is unavailable in this project");
            const previous = target.blocks.find((block) => block.appRequestId === requestId);
            if (previous) {
              if (previous.text !== prompt)
                throw new Error("Request ID was already used with another prompt");
              return { alreadySaved: true, draft: !!previous.draft };
            }
            if (target.busy) throw new Error("Session is busy; try again when it finishes");
            if (sessionDraftBlock(target))
              throw new Error("Session already has a draft; send or remove it first");
            const saved = flushSync(() => saveDraftRef.current(id, prompt, [], requestId));
            if (!saved) throw new Error("Session could not accept a draft");
            return { alreadySaved: false, draft: true };
          },
          worktrees: (cwd) => listWorktrees(cwd),
          createWorktree: (cwd, branch, base, existing) =>
            createWorktree(cwd, branch, base, existing),
          notes: () => invoke("notes_list"),
          note: (id) => invoke("notes_get", { id }),
          saveNote: async (note) => {
            const saved = await upsertNote(note);
            window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
            return saved;
          },
        });
        appReceipts.current.set(key, { signature, promise });
        void promise.catch(() => {
          if (appReceipts.current.get(key)?.promise === promise) appReceipts.current.delete(key);
        });
        if (appReceipts.current.size > 256) {
          const first = appReceipts.current.keys().next().value;
          if (first) appReceipts.current.delete(first);
        }
        return promise;
      };
      void handle()
        .then(
          (result) =>
            invoke("control_reply", {
              id: payload.id,
              response: { ok: true, result },
            }),
          (error: unknown) =>
            invoke("control_reply", {
              id: payload.id,
              response: {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              },
            }),
        )
        .catch(console.error);
    });
    return () => {
      void listening.then((unlisten) => unlisten());
    };
  }, []);

  const confirmingOrchestration = useRef(new Set<string>());
  const queueWorkerPanes = useCallback(
    (workers: OrchestrationWorkerDetail[]) => {
      // Finished workers are not open; load stored transcripts before the
      // tabs appear so the pane does not flash the empty state.
      void prepareOrchestrationWorkerDetails(workers, {
        openLead: async (leadId) => {
          if (!focusOpenSession(leadId)) await onSelectHistorySession(leadId);
        },
        openWorker: ensureOpenSession,
        hasSession: (id) => sessionsRef.current.some((session) => session.id === id),
      })
        .then((request) => {
          if (request?.workers.length) setWorkerDetailRequest(request);
        })
        .catch(console.error);
    },
    [ensureOpenSession, focusOpenSession, onSelectHistorySession],
  );
  const onOpenWorkerDetails = useCallback(
    (worker: OrchestrationWorkerDetail) => {
      setInspectedWorkerId(worker.sessionId);
      queueWorkerPanes([worker]);
    },
    [queueWorkerPanes],
  );
  useEffect(() => {
    if (!workerDetailRequest) return;
    const { leadId, workers } = workerDetailRequest;
    const tab = tabs.find((entry) => leafIds(entry.layout).includes(leadId));
    if (!tab) {
      // Still opening: this runs again on the commit that lands the lead. If
      // the lead never arrived at all, drop the request rather than let it
      // fire against some later tab change.
      if (!sessionsRef.current.some((entry) => entry.id === leadId)) {
        setWorkerDetailRequest(null);
      }
      return;
    }
    setWorkerDetailRequest(null);
    // Every agent of a run shares one pane, the way files do: `openEditorTab`
    // focuses an open tab, adds to the pane already beside the lead, or splits
    // one off when there is none.
    const cwd =
      sessionsRef.current.find((entry) => entry.id === leadId)?.cwd ?? projectCwdRef.current;
    const files = workers.map((worker) =>
      newAgentTab(worker.title, cwd, {
        sessionId: worker.sessionId,
        leadId,
        harness: worker.harness,
      }),
    );
    setTabs((prev) =>
      prev.map((entry) => {
        if (entry.id !== tab.id) return entry;
        const opened = files.reduce((next, file) => openEditorTab(next, file), entry);
        // Leave the first worker focused so View agents lands on the start
        // of the run rather than the last tab added.
        return files[0] ? openEditorTab(opened, files[0]) : opened;
      }),
    );
    setActiveTabId(tab.id);
    setComposerFocused(false);
  }, [tabs, workerDetailRequest]);
  const orchestrationWorkers = useMemo(
    () => ({
      selectedId: inspectedWorkerId,
      inspect: setInspectedWorkerId,
      openDetails: onOpenWorkerDetails,
    }),
    [inspectedWorkerId, onOpenWorkerDetails],
  );
  const updateOrchestrationCard = useCallback(
    (leadId: string, blockId: string, proposal: OrchestrationProposal) => {
      const next = sessionsRef.current.map((session) =>
        session.id === leadId ? withOrchestrationProposal(session, blockId, proposal) : session,
      );
      sessionsRef.current = next;
      setSessions(next);
      return next.find((session) => session.id === leadId);
    },
    [],
  );
  const orchestrationActions = useMemo(
    () => ({
      open: onOpenApprovalSession,
      openAgents: queueWorkerPanes,
      update: (leadId: string, blockId: string, edited: OrchestrationProposal) => {
        const session = sessionsRef.current.find((entry) => entry.id === leadId);
        const proposal = session?.blocks.find((block) => block.id === blockId)?.orchestration;
        if (
          !session ||
          session.busy ||
          proposal?.status !== "ready" ||
          confirmingOrchestration.current.has(leadId)
        )
          return;
        // Keep the discovered catalog authoritative while allowing task and parallelism edits.
        const settings = validateOrchestrationSettings({
          ...proposal.settings,
          maxWorkers: edited.settings.maxWorkers,
        });
        updateOrchestrationCard(leadId, blockId, {
          ...proposal,
          settings,
          tasks: edited.tasks,
        });
      },
      confirm: async (leadId: string, blockId: string) => {
        if (confirmingOrchestration.current.has(leadId)) return;
        confirmingOrchestration.current.add(leadId);
        let proposal: OrchestrationProposal | undefined;
        try {
          await orchestrator.hydrate(leadId);
          const session = sessionsRef.current.find((entry) => entry.id === leadId);
          proposal = session?.blocks.find((block) => block.id === blockId)?.orchestration;
          if (!session || session.busy || proposal?.status !== "ready")
            throw new Error("Wait for the proposal to finish before confirming.");
          if (
            session.harness !== proposal.author.harness ||
            session.model !== proposal.author.model
          )
            throw new Error(
              "The lead model has changed. Switch back to the model shown on this card, or generate a new proposal.",
            );
          const starting = updateOrchestrationCard(leadId, blockId, {
            ...proposal,
            status: "starting",
          })!;
          // Save the edited card before anything can execute.
          await upsertSession(starting);
          await orchestrator.startApproved(leadId, blockId, proposal);
          updateOrchestrationCard(leadId, blockId, {
            ...proposal,
            status: "approved",
          });
        } catch (error) {
          if (proposal)
            updateOrchestrationCard(leadId, blockId, {
              ...proposal,
              status: "ready",
            });
          throw error;
        } finally {
          confirmingOrchestration.current.delete(leadId);
        }
      },
      retry: (leadId: string, blockId: string) => {
        const session = sessionsRef.current.find((entry) => entry.id === leadId);
        const proposal = session?.blocks.find((block) => block.id === blockId)?.orchestration;
        if (!session || session.busy || !proposal) return;
        onSubmit(leadId, proposal.request, [], {
          intent: "orchestrate",
          orchestrationRetry: proposal,
        });
      },
    }),
    [onOpenApprovalSession, queueWorkerPanes, onSubmit, updateOrchestrationCard],
  );

  const onSelectLiveAgent = useCallback(
    (sessionId: string) => {
      const elsewhere = liveAgents.find(
        (agent) => agent.id === sessionId && agent.ownerWindowLabel,
      );
      if (elsewhere) {
        void focusWindowLiveAgent(elsewhere).catch((error) => {
          void message(String(error), {
            get title() {
              return t("Open conversation window");
            },
          });
        });
        return;
      }

      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      const remote = unopenedRemoteRef.current.find(({ session }) => session.id === sessionId);
      if (remote) {
        dismissRemoteFinished(sessionId);
        onSelectRemoteSession(remote.project, sessionId);
      } else onOpenApprovalSession(sessionId);
    },
    [dismissRemoteFinished, onOpenApprovalSession, onSelectRemoteSession, liveAgents],
  );

  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    void listenForWindowLiveAgent(onOpenApprovalSession)
      .then((unlisten) => {
        if (disposed) unlisten();
        else release = unlisten;
      })
      .catch((error) => {
        console.warn("App operation failed", error);
      });
    return () => {
      disposed = true;
      release?.();
    };
  }, [onOpenApprovalSession]);

  // Sessions for the rail's "Last sessions". Kept referentially stable so the
  // rail only refetches when a title or status really changed.
  useEffect(() => {
    for (const { session: host, project, fresh } of unopenedRemote) {
      if (!fresh || !host.issue) continue;
      const session = {
        ...newSession(host.harness, project),
        id: host.id,
        title: host.title,
        busy: host.status === "running",
        retryMessage: host.issue === "retrying" ? host.issueMessage || "Retrying" : undefined,
      };
      session.blocks = [{ id: host.issueTurnId || host.runId || host.id, role: "user", text: "" }];
      if (host.issue === "failed")
        session.blocks.push({
          id: "issue",
          role: "system",
          notice: "error",
          text: host.issueMessage || "Failed",
        });
      void announceSessionIssue(session, host.issue, false);
    }
  }, [unopenedRemote]);
  const liveSessionInfoRef = useRef<ReturnType<typeof liveSessionInfos>>([]);
  const railLiveSessions = useMemo(() => {
    const next = [
      ...liveSessionInfos(sessions, unseenFinishedIds),
      ...remoteLiveSessionInfos(unopenedRemote),
    ];
    if (sameLiveSessionInfos(liveSessionInfoRef.current, next)) {
      return liveSessionInfoRef.current;
    }
    liveSessionInfoRef.current = next;
    return next;
  }, [sessions, unseenFinishedIds, unopenedRemote]);
  const recentSessions = useMemo(
    () => ({
      history,
      live: railLiveSessions,
      onPin: onPinHistorySession,
    }),
    [history, railLiveSessions, onPinHistorySession],
  );

  const nextTitleTabs: TitleTab[] = deckProjectTabs.map((tab) => ({
    ...toTitleTab(tab, sessions, dirtyFiles, unseenFinishedIds, tab.id in pendingWindowMoves),
    movingWindow: windowTransferPending || movingWindows.has(tab.id),
  }));
  tabProjectsRef.current = new Map(nextTitleTabs.map((tab) => [tab.id, tab.project]));
  const titleTabsRef = useRef(nextTitleTabs);
  if (!titleTabsEqual(titleTabsRef.current, nextTitleTabs)) {
    titleTabsRef.current = nextTitleTabs;
  }
  const titleTabs = titleTabsRef.current;

  // `history` now spans every visited project; consumers that expect the
  // current project only get this slice.
  const projectHistory = useMemo(
    () => history.filter((entry) => sameProjectPath(entry.cwd, sidebarCwd)),
    [history, sidebarCwd],
  );

  const nextSidebarHistory = useMemo(
    () =>
      historyWithLiveSessions(
        history,
        sessions,
        sidebarCwd,
        {
          ...(projectBranches?.current ? { branch: projectBranches.current } : {}),
          ...(sidebarCwd && sidebarCwd !== "~" ? { repo: projectName(sidebarCwd) } : {}),
        },
        orchestrationRuns,
      ),
    [history, projectBranches, sessions, sidebarCwd, orchestrationRuns],
  );
  const sidebarHistoryRef = useRef(nextSidebarHistory);
  if (!sessionSummariesEqual(sidebarHistoryRef.current, nextSidebarHistory)) {
    sidebarHistoryRef.current = nextSidebarHistory;
  }
  const sidebarHistory = sidebarHistoryRef.current;
  const {
    unseen: inboxUnseen,
    linkedSessionUpdateIds,
    linkedSessionUpdates,
  } = useInboxActivity(visibleRecents, sidebarCwd, sidebarHistory, {
    onActivity: onInboxActivity,
  });
  linkedSessionUpdatesRef.current = linkedSessionUpdates;
  const inboxRelatedSessions = useMemo(() => {
    const byId = new Map<string, SessionSummary>();
    for (const session of storedLinkedSessions) byId.set(session.id, session);
    for (const session of history) {
      if (session.linkedWorkItem) byId.set(session.id, session);
    }
    for (const session of sessions) {
      if (session.inboxAsk || !session.linkedWorkItem) continue;
      const current = byId.get(session.id);
      const summary = summaryFromSession(session);
      byId.set(
        session.id,
        current
          ? {
              ...current,
              harness: summary.harness,
              model: summary.model,
              runtimeMode: summary.runtimeMode,
              title: summary.title,
              cwd: summary.cwd,
              linkedWorkItem: summary.linkedWorkItem,
            }
          : summary,
      );
    }
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }, [history, sessions, storedLinkedSessions]);
  const repairSessions = useMemo(() => ciRepairSessions(history, sessions), [history, sessions]);
  const nextOpenProjectSessions = useMemo(
    () =>
      sessions
        .filter(
          (session) =>
            !session.inboxAsk &&
            !session.orchestrationLeadId &&
            sameProjectPath(session.cwd, sidebarCwd),
        )
        .map((session) =>
          summaryFromSession(session, {
            ...(projectBranches?.current ? { branch: projectBranches.current } : {}),
            ...(sidebarCwd && sidebarCwd !== "~" ? { repo: projectName(sidebarCwd) } : {}),
          }),
        ),
    [projectBranches, sessions, sidebarCwd],
  );
  const openProjectSessionsRef = useRef(nextOpenProjectSessions);
  if (!sessionSummariesEqual(openProjectSessionsRef.current, nextOpenProjectSessions)) {
    openProjectSessionsRef.current = nextOpenProjectSessions;
  }
  const openProjectSessions = openProjectSessionsRef.current;

  const nextBusyProjectPaths = useMemo(
    () =>
      workingProjectPaths([
        ...liveAgentsFromSessions(sessions),
        ...remoteLiveAgents(unopenedRemote),
      ]),
    [sessions, unopenedRemote],
  );
  const busyProjectPathsRef = useRef(nextBusyProjectPaths);
  if (!stringArraysEqual(busyProjectPathsRef.current, nextBusyProjectPaths)) {
    busyProjectPathsRef.current = nextBusyProjectPaths;
  }
  const busyProjectPaths = busyProjectPathsRef.current;
  const onRenameProjectFolder = useCallback(
    async (path: string, name: string) => {
      if (!isLocalProject(path)) throw new Error(t("Select a local project folder."));
      const invalid = folderRenameError(name);
      if (invalid) throw new Error(invalid);
      if (busyProjectPaths.some((busyPath) => isEqualOrInside(busyPath, path))) {
        throw new Error(
          t("Wait for this project's running work to finish before renaming its folder."),
        );
      }
      // Record the filesystem identity before moving so recovery can still find it.
      await synchronizeProjectLocation(path);
      const nextPath = await renamePath(path, name);
      try {
        await applyProjectLocationChange(path, nextPath);
      } catch (error) {
        console.error("Could not update renamed project paths", error);
        throw new Error(
          t(
            "Folder renamed to {p0}, but saved paths could not be updated. Reopen this folder to recover.",
            { p0: nextPath },
          ),
        );
      }
    },
    [busyProjectPaths, applyProjectLocationChange],
  );

  const onDismissUpdate = useCallback(() => setUpdateNotice(null), []);
  const onMoveTabToNewWindow = useCallback(
    (tabId: string, opts?: Parameters<typeof onMoveTabsToNewWindow>[1]) =>
      void onMoveTabsToNewWindow([tabId], opts),
    [onMoveTabsToNewWindow],
  );
  const onZoomIn = useCallback(() => {
    const next = saveUiScale(zoomInUiScale(loadUiScale()));
    void applyUiScale(next);
  }, []);
  const onZoomOut = useCallback(() => {
    const next = saveUiScale(zoomOutUiScale(loadUiScale()));
    void applyUiScale(next);
  }, []);
  const onZoomReset = useCallback(() => {
    saveUiScale(UI_SCALE_DEFAULT);
    void applyUiScale(UI_SCALE_DEFAULT);
  }, []);
  const onCloseCurrentTab = useCallback(
    () => (activeTabId ? onCloseTab(activeTabId) : undefined),
    [activeTabId, onCloseTab],
  );

  const onToggleSidebar = useCallback(() => {
    setProjectRailOpen((open) => {
      const next = !open;
      saveProjectRailOpen(next);
      return next;
    });
  }, []);

  const onToggleSessionSidebar = useCallback(() => {
    setSessionSidebarOpen((open) => {
      const next = !open;
      saveSessionSidebarOpen(next);
      return next;
    });
  }, []);

  const onToggleProjectRail = useCallback(() => {
    setProjectRailOpen((open) => {
      const next = !open;
      saveProjectRailOpen(next);
      return next;
    });
  }, []);

  const onGoToFile = useCallback(() => {
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    setFilePickerInitialQuery("");
    setFilePickerResetToken((token) => token + 1);
    setFilePickerOpen(true);
  }, []);
  const onOpenCommandPalette = useCallback(() => {
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    setFilePickerInitialQuery(">");
    setFilePickerResetToken((token) => token + 1);
    setFilePickerOpen(true);
  }, []);
  const onReload = useCallback(() => {
    void (async () => {
      if (!(await confirmReload(dirtyFilesRef.current.size > 0))) return;
      window.location.reload();
    })();
  }, []);

  const onFindInProject = useCallback(() => {
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    setSidebarTab("files");
    setFilesSearchOpen(true);
    setSearchFocusToken((token) => token + 1);
  }, []);

  const onOpenSearch = useCallback(() => {
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setSearchViewOpen(true);
      setSearchViewFocusToken((token) => token + 1);
    });
  }, []);

  const onLeaveSearch = useCallback(() => {
    setSearchViewOpen(false);
  }, []);

  const onOpenInbox = useCallback(() => {
    setPullRequestsOnly(false);
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setInboxViewOpen(true);
    });
  }, []);

  const onOpenLinkedWorkItem = useCallback(
    (item: LinkedWorkItem, sessionId: string) => {
      const request = linkedWorkItemPanelRequest.current + 1;
      linkedWorkItemPanelRequest.current = request;
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setInboxViewOpen(false);
      const cwd =
        sessionsRef.current.find((session) => session.id === sessionId)?.cwd ??
        history.find((session) => session.id === sessionId)?.cwd ??
        sidebarCwd;
      void onSelectHistorySession(sessionId).then(() => {
        if (linkedWorkItemPanelRequest.current !== request) return;
        if (!sessionsRef.current.some((session) => session.id === sessionId)) {
          return;
        }
        setLinkedWorkItemPanels((current) => {
          const next = new Map(current);
          // Reinsert the panel so it wins if this workspace tab contains
          // multiple sessions with remembered panels.
          next.delete(sessionId);
          next.set(sessionId, { item, sessionId, cwd });
          return next;
        });
      });
    },
    [history, onSelectHistorySession, sidebarCwd],
  );

  const onLeaveInbox = useCallback(() => {
    setInboxViewOpen(false);
  }, []);

  const onOpenInboxSession = useCallback(
    (sessionId: string) => {
      setInboxViewOpen(false);
      const cwd =
        sessionsRef.current.find((session) => session.id === sessionId)?.cwd ??
        history.find((session) => session.id === sessionId)?.cwd;
      setSidebarTab("sessions", cwd);
      void onSelectHistorySession(sessionId);
    },
    [history, onSelectHistorySession],
  );

  const onRepairChecks = useCallback(
    async (item: InboxItem, request: CiRepairRequest, sessionId?: string) => {
      const cwd = item.projectPath;
      if (!cwd) throw new Error("Choose a local project for this PR first.");
      let session = sessionId ? await ensureOpenSession(sessionId) : undefined;
      if (
        sessionId &&
        (!session ||
          session.inboxAsk ||
          session.orchestrationLeadId ||
          !sameProjectPath(session.cwd, cwd))
      ) {
        throw new Error("Choose a chat from this project.");
      }
      if (session && (session.busy || session.pendingSwitch || isPreparingHandoff(session))) {
        throw new Error("This chat is busy. Choose another chat or start a new one.");
      }
      if (!session) {
        session = {
          ...newDefaultSession(cwd, sessionDefaults?.runtimeMode),
          get title() {
            return t("Fix CI #{p0}: {p1}", { p0: item.number, p1: item.title });
          },
          linkedWorkItem: linkedWorkItemFromInboxItem(item) ?? undefined,
        };
        const next = [...sessionsRef.current, session];
        sessionsRef.current = next;
        setSessions(next);
      }
      const repairSessionId = session.id;
      trackCiRepair(cwd, request, repairSessionId, (settle) =>
        onSubmit(repairSessionId, request.text, [], {
          ciRepair: request,
          noteCard: undefined,
          handoffCard: undefined,
          onSettled: (outcome) => settle(outcome.status),
        }),
      );
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setSearchViewOpen(false);
      setSidebarTab("sessions", cwd);
      await onSelectHistorySession(session.id);
    },
    [ensureOpenSession, onSubmit, onSelectHistorySession, sessionDefaults?.runtimeMode],
  );

  const onOpenNotes = useCallback(() => {
    if (!loadNotesEnabled()) return;
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setAutomationsViewOpen(false);
      setNotesViewOpen(true);
    });
  }, []);

  const onLeaveNotes = useCallback(() => {
    setNotesViewOpen(false);
  }, []);

  const onOpenAutomations = useCallback(() => {
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setTaskBoardShown(false);
      setSocialBoardShown(false);
      setAutomationsViewOpen(true);
    });
  }, []);

  const onOpenTasks = useCallback(() => {
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setSocialBoardShown(false);
      setTaskBoardShown(true);
      setAutomationsViewOpen(true);
    });
  }, []);

  const onLeaveAutomations = useCallback(() => {
    setAutomationsViewOpen(false);
  }, []);

  const onOpenAutomationSession = useCallback(
    async (sessionId: string) => {
      const session = await ensureOpenSession(sessionId);
      if (!session) throw new Error("This conversation is no longer available.");
      setAutomationsViewOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setSettingsOpen(false);
      setFilePickerOpen(false);
      setSidebarTab("sessions", session.cwd);
      setProjectCwd(session.cwd);
      setRecents(rememberProject(session.cwd));
      await onSelectHistorySession(sessionId);
    },
    [ensureOpenSession, onSelectHistorySession],
  );

  // Host-owned task and automation conversations open in the normal transcript
  // pane. Local copies keep following the host through the adopted-session mirror.
  const onOpenBackgroundSession = useCallback(
    async (target: BackgroundSessionTarget) => {
      const remote = parseRemotePath(target.cwd);
      if (!remote) {
        const opened = await openLocalHostSession(target, {
          machines: () => invoke("remote_machines"),
          projects: (machineId) => remoteRequest<HostProject[]>(machineId, "projects.list"),
          load: (machineId, sessionId) => loadRemoteSession(machineId, sessionId),
          find: ensureOpenSession,
          refresh: onRefreshAdoptedSession,
          create: async (copy) => {
            if (sessionsRef.current.some((session) => session.id === copy.id)) return false;
            if (!(await upsertSessionIfUnchanged(copy, null))) return false;
            if (sessionsRef.current.some((session) => session.id === copy.id)) return false;
            invalidateLoadedSession(copy.id);
            if (!copy.worktreeRemoved && copy.providerSessionId && isLiveHarness(copy.harness)) {
              bindHarnessSession(
                copy.harness,
                copy.id,
                copy.providerSessionId,
                sessionWorkCwd(copy),
                copy.providerAccountId,
                copy.blocks,
              );
            }
            lastPersisted.current.set(copy.id, persistFingerprint(copy));
            const next = [...sessionsRef.current, copy];
            sessionsRef.current = next;
            setSessions(next);
            window.dispatchEvent(
              new CustomEvent<string>(ADOPTED_SESSION_ADDED, { detail: copy.cwd }),
            );
            return true;
          },
        });
        setAutomationsViewOpen(false);
        setSearchViewOpen(false);
        setInboxViewOpen(false);
        setNotesViewOpen(false);
        setSettingsOpen(false);
        setFilePickerOpen(false);
        setSidebarTab("sessions", opened.cwd);
        setProjectCwd(opened.cwd);
        setRecents(rememberProject(opened.cwd));
        await onSelectHistorySession(opened.sessionId);
        return;
      }
      // By the host's project ID: a task's session may run in a worktree.
      let project = remoteProjectsOn(remote.environmentId).find(
        (entry) => entry.projectId === target.projectId,
      );
      if (!project) {
        const listed = await remoteRequest<HostProject[]>(target.machineId, "projects.list");
        const host = listed.find((entry) => entry.id === target.projectId);
        if (!host) throw new Error("This project is no longer on that machine.");
        project = rememberRemoteProject(remote.environmentId, host);
      }
      const knownBefore = loadRecents().map((item) => item.path);
      setSettingsOpen(false);
      setFilePickerOpen(false);
      setRecents(rememberProject(project.key));
      promptAddedProjectNames(knownBefore);
      onSelectRemoteSession(project.key, target.sessionId);
    },
    [
      ensureOpenSession,
      invalidateLoadedSession,
      onRefreshAdoptedSession,
      onSelectHistorySession,
      onSelectRemoteSession,
      promptAddedProjectNames,
    ],
  );

  const openSettings = useCallback((section?: SettingsSectionId, anchor?: SettingsAnchor) => {
    if (!settingsOpenRef.current) {
      settingsReturnViewRef.current = {
        search: searchViewOpenRef.current,
        inbox: inboxViewOpenRef.current,
        notes: notesViewOpenRef.current,
        automations: automationsViewOpenRef.current,
      };
    }
    startTransition(() => {
      setFilePickerOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      if (section) {
        setSettingsSection(section);
        saveSettingsSection(section);
      }
      setSettingsAnchor(anchor ?? null);
      setNotificationProjectPath(null);
      setSettingsOpen(true);
    });
  }, []);

  const onOpenSettings = useCallback(() => openSettings(), [openSettings]);
  useEffect(() => {
    const openConnections = () => openSettings("connections");
    window.addEventListener(OPEN_CONNECTIONS_EVENT, openConnections);
    return () => window.removeEventListener(OPEN_CONNECTIONS_EVENT, openConnections);
  }, [openSettings]);
  // Imported sessions add projects to the rail and rows to the open project.
  const onSessionsImported = useCallback(() => {
    setRecents(loadRecents());
    void refreshHistory(sidebarCwdRef.current);
  }, [refreshHistory]);
  const [remoteProjectDialogOpen, setRemoteProjectDialogOpen] = useState(false);
  useEffect(() => {
    const open = () => setRemoteProjectDialogOpen(true);
    window.addEventListener(OPEN_REMOTE_PROJECT_EVENT, open);
    return () => window.removeEventListener(OPEN_REMOTE_PROJECT_EVENT, open);
  }, []);

  useEffect(() => {
    const onOpenMcp = () => openSettings("mcp");
    window.addEventListener("bycoda:open-mcp-settings", onOpenMcp);
    return () => window.removeEventListener("bycoda:open-mcp-settings", onOpenMcp);
  }, [openSettings]);

  const onOpenNotificationSettings = useCallback(
    (path?: string) => {
      openSettings("notifications", "project-notifications");
      setNotificationProjectPath(path ?? null);
      setNotificationSettingsRequest((request) => request + 1);
    },
    [openSettings],
  );

  const onOpenInboxIntegrations = useCallback(
    (source: ConnectableInboxSource) => openSettings("inbox", source),
    [openSettings],
  );

  const onCloseSettings = useCallback(() => {
    const returnView = settingsReturnViewRef.current;
    setSearchViewOpen(returnView.search);
    setInboxViewOpen(returnView.inbox);
    setNotesViewOpen(returnView.notes && loadNotesEnabled());
    setAutomationsViewOpen(returnView.automations);
    setSettingsOpen(false);
  }, []);

  useEffect(() => {
    const revealWorkspace = () => {
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
    };
    window.addEventListener(OPEN_USAGE_GUIDE_EVENT, revealWorkspace);
    return () => window.removeEventListener(OPEN_USAGE_GUIDE_EVENT, revealWorkspace);
  }, []);

  const onSelectSettingsSection = useCallback((section: SettingsSectionId) => {
    setSettingsSection(section);
    saveSettingsSection(section);
  }, []);

  const onOpenArchivedSession = useCallback(
    (sessionId: string) => {
      setSettingsOpen(false);
      void onSelectHistorySession(sessionId);
    },
    [onSelectHistorySession],
  );

  // Keep navigation on existing application callbacks; the native relay supplies the owner context.
  const appUiLive = useRef<(context: AppUiContext, action: AppUiAction, input: AppUiInput) => Promise<unknown>>(async () => { throw new Error("Workspace is not ready."); });
  appUiLive.current = async (context, action, input) => {
    const source = sessionsRef.current.find(session => session.id === context.sessionId);
    if (!source || pathKey(source.cwd) !== pathKey(context.cwd) || isProjectLockedIn(getGroupLockView().lock, source.cwd))
      throw new Error("Conversation workspace is unavailable or locked.");
    const visible = (marker: string) => Array.from(document.querySelectorAll<HTMLElement>(marker)).some(element => element.getClientRects().length > 0);
    const view = settingsOpen ? "settings" : searchViewOpen ? "search" : inboxViewOpen ? "inbox" : notesViewOpen ? "notes" : automationsViewOpen ? socialBoardShown ? "social" : taskBoardShown ? "tasks" : "automations" : "conversation";
    const ownProject = pathKey(projectCwd) === pathKey(source.cwd);
    const state = () => ({ view, cwd: projectCwd, sessionId: activeTab?.kind === "session" ? activeTab.focusedId : null,
      section: settingsOpen ? settingsSection : null,
      mounted: view === "conversation" ? !!activeTab : visible(`[data-app-${view}]`),
      filesOpen: ownProject && !detachedSessionWindow && sessionSidebarOpen && sidebarTab === "files" && visible('[data-side-pane="workspace"]'),
      terminalOpen: ownProject && dockVisible && visible('[data-project-terminal-dock]') });
    if (action === "ui.workspace.list") return { views: APP_UI_VIEWS.map(id => ({ id,
      available: id === "notes" ? loadNotesEnabled() : id === "terminal" ? isLocalProject(source.cwd) : id === "files" ? !detachedSessionWindow : true,
      operations: id === "conversation" ? ["open", "status"] : ["open", "close", "status"] })), settingsSections: APP_UI_SETTINGS };
    if (action === "ui.workspace.status") return state();
    if (action === "ui.workspace.close") {
      if (!ownProject) throw new Error("This conversation's project is not displayed; refusing to close another project's surface.");
      if (input.view === "conversation") throw new Error("Closing a conversation is not a navigation operation.");
      if (input.view === "files") { if (sidebarTab === "files") setSessionSidebarOpen(false); }
      else if (input.view === "terminal") onHideProjectTerminal();
      else if (view === input.view) {
        setSettingsOpen(false); setSearchViewOpen(false); setInboxViewOpen(false); setNotesViewOpen(false); setAutomationsViewOpen(false);
      }
    } else {
      if (input.view === "notes" && !loadNotesEnabled()) throw new Error("Notes is disabled; enable it in settings first.");
      if (input.view === "files" && detachedSessionWindow) throw new Error("The project file sidebar is unavailable in this detached conversation window.");
      if (input.view === "terminal" && !isLocalProject(source.cwd)) throw new Error("The desktop terminal panel does not support this remote project; use the explicit machine terminal API.");
      const needsFocus = !ownProject || activeTab?.kind !== "session" || activeTab.focusedId !== source.id;
      if (needsFocus && !focusOpenSession(source.id)) throw new Error("The calling conversation has no open workspace tab.");
      // Focus updates project routing first; never navigate using a stale callback from another project.
      const deadline = Date.now() + 10000;
      while (needsFocus && appUiLive.current === appUiExecutor) {
        if (Date.now() >= deadline) throw new Error("Conversation project focus timed out.");
        await new Promise(resolve => window.setTimeout(resolve, 40));
      }
      if (needsFocus) {
        const focused = await appUiLive.current(context, "ui.workspace.status", {}) as ReturnType<typeof state>;
        if (pathKey(focused.cwd) !== pathKey(source.cwd) || focused.sessionId !== source.id)
          throw new Error("Conversation focus changed before navigation; retry from the active conversation.");
        return appUiLive.current(context, action, input);
      }
      switch (input.view) {
        case "notes": onOpenNotes(); break;
        case "inbox": onOpenInbox(); break;
        case "automations": onOpenAutomations(); break;
        case "tasks": onOpenTasks(); break;
        case "search": onOpenSearch(); break;
        case "settings": openSettings(input.section); break;
        case "social": window.dispatchEvent(new CustomEvent(SOCIAL_PANEL_EVENT, { detail: { cwd: source.cwd } })); break;
        default:
          setSettingsOpen(false); setSearchViewOpen(false); setInboxViewOpen(false); setNotesViewOpen(false); setAutomationsViewOpen(false);
          if (input.view === "files") { setSidebarTab("files", source.cwd); setSessionSidebarOpen(true); }
          if (input.view === "terminal") onShowProjectTerminal();
      }
    }
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 40));
      const result = await appUiLive.current(context, "ui.workspace.status", {});
      const current = result as ReturnType<typeof state>;
      if (action === "ui.workspace.close" ? input.view === "files" ? !current.filesOpen : input.view === "terminal" ? !current.terminalOpen : current.view !== input.view
        : input.view === "files" ? current.filesOpen : input.view === "terminal" ? current.terminalOpen : current.view === input.view && current.mounted && (!input.section || current.section === input.section)) return result;
    }
    throw new Error("Workspace UI acknowledgement timed out; read ui.workspace.status before retrying.");
  };
  const appUiExecutor = appUiLive.current;
  useEffect(() => registerAppUiControl((context, action, input) => appUiLive.current(context, action, input)), []);

  const railSurface = {
    tabId: activeTabId,
    cwd: projectCwd,
    settings: settingsOpen,
    search: searchViewOpen,
    inbox: inboxViewOpen,
    notes: notesViewOpen,
    automations: automationsViewOpen,
  };
  const surfaceForward = useSurfaceForwardHistory(railSurface, (surface) => {
    setSettingsOpen(surface.settings);
    setSearchViewOpen(surface.search);
    setInboxViewOpen(surface.inbox);
    setNotesViewOpen(surface.notes && loadNotesEnabled());
    setAutomationsViewOpen(surface.automations);
  });

  const onRailBack = useCallback(() => {
    if (settingsOpen) {
      surfaceForward.remember({
        ...railSurface,
        ...settingsReturnViewRef.current,
        notes: settingsReturnViewRef.current.notes && loadNotesEnabled(),
        settings: false,
      });
      onCloseSettings();
      return;
    }
    if (searchViewOpen) {
      surfaceForward.remember({ ...railSurface, search: false });
      setSearchViewOpen(false);
      return;
    }
    if (inboxViewOpen) {
      surfaceForward.remember({ ...railSurface, inbox: false });
      setInboxViewOpen(false);
      return;
    }
    if (notesViewOpen) {
      surfaceForward.remember({ ...railSurface, notes: false });
      setNotesViewOpen(false);
      return;
    }
    if (automationsViewOpen) {
      surfaceForward.remember({ ...railSurface, automations: false });
      setAutomationsViewOpen(false);
      return;
    }
    onVisitBack();
  }, [
    onCloseSettings,
    onVisitBack,
    searchViewOpen,
    settingsOpen,
    inboxViewOpen,
    notesViewOpen,
    automationsViewOpen,
    surfaceForward,
    railSurface,
  ]);

  const onRailForward = useCallback(() => {
    if (surfaceForward.forward()) return;
    setSearchViewOpen(false);
    setSettingsOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    onVisitForward();
  }, [onVisitForward, surfaceForward]);

  useMouseNavigation(onRailBack, onRailForward);

  useEffect(() => {
    if (sidebarTab === "inbox") setSidebarTab("sessions");
  }, [sidebarTab]);

  useEffect(() => {
    if (!dockVisible) setProjectTerminalFocused(false);
  }, [dockVisible]);

  const openFilePaths = useMemo(() => {
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const tab of tabs) {
      for (const pane of tab.editorPanes) {
        for (const file of pane.files) {
          if (!isFilesystemTab(file) || seen.has(file.path)) continue;
          seen.add(file.path);
          paths.push(file.path);
        }
      }
    }
    return paths;
  }, [tabs]);

  useEffect(() => {
    void invoke("set_traffic_lights_visible", { visible: true }).catch(() => {});
  }, []);

  const onSessionNavigationOrder = useCallback((ids: readonly string[]) => {
    sessionNavigationIdsRef.current = ids;
  }, []);

  const onNavigateSessionList = useCallback(
    (delta: number, inCurrentTab = false) => {
      const activeWorkspace = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current);
      if (!activeWorkspace || activeWorkspace.diffFocused) return;
      const current = sessionsRef.current.find(
        (session) => session.id === activeWorkspace.focusedId,
      );
      if (!current) return;
      const remoteProject = isRemoteProjectPath(current.cwd);
      const navigationId = remoteProject ? remoteSessionFor(current.id) : current.id;
      if (!navigationId) return;

      const next = adjacentItemId(sessionNavigationIdsRef.current, navigationId, delta);
      if (!next || next === navigationId) return;
      if (remoteProject) {
        if (inCurrentTab) {
          rememberRemoteSession(current.id, next);
          setComposerFocused(true);
        } else {
          onSelectRemoteSession(current.cwd, next);
        }
        return;
      }
      // Stepping gives no hover to warm the transcript, so load the one a
      // further step away once this switch has its own session.
      const prefetchAhead = () => {
        const ahead = adjacentItemId(sessionNavigationIdsRef.current, next, delta);
        if (ahead && ahead !== current.id) onPrefetchHistorySession(ahead);
      };
      if (!inCurrentTab) {
        void onSelectHistorySession(next).then(prefetchAhead);
        return;
      }
      const activeTabId = activeWorkspace.id;
      const focusedId = current.id;
      void ensureOpenSession(next).then((session) => {
        prefetchAhead();
        if (!session || session.inboxAsk) return;
        if (activeTabIdRef.current !== activeTabId) return;
        const currentTab = tabsRef.current.find((tab) => tab.id === activeTabId);
        if (currentTab?.focusedId !== focusedId) return;
        setTabs((prev) => switchSessionInTab(prev, activeTabId, focusedId, next) ?? prev);
        setComposerFocused(true);
        const linkedUpdate = linkedSessionUpdatesRef.current.get(next);
        if (linkedUpdate) revealLinkedSessionUpdate(next, linkedUpdate);
      });
    },
    [
      ensureOpenSession,
      onPrefetchHistorySession,
      onSelectHistorySession,
      onSelectRemoteSession,
      revealLinkedSessionUpdate,
    ],
  );

  const onNavigateProjectList = useCallback(
    (delta: number) => {
      const current = normalizeProjectPath(projectCwdRef.current);
      const ids = projectRailItems(
        visibleProjects(getGroupLockView().lock, loadRecents(), (project) => project.path),
        current,
      ).map((project) => project.path);
      const next = adjacentItemId(ids, current, delta);
      if (!next || sameProjectPath(next, current)) return;
      onSelectProject(next);
    },
    [onSelectProject],
  );

  const actions = useRef({
    onArrangeActiveTab,
    onNew,
    onArchiveFocusedSession,
    onToggleNotesPanel,
    onCloseOtherTabs,
    onCloseAllTabs,
    onClosePane,
    onNext,
    onPrev,
    onVisitBack,
    onVisitForward,
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
  });
  actions.current = {
    onArrangeActiveTab,
    onNew,
    onArchiveFocusedSession,
    onToggleNotesPanel,
    onCloseOtherTabs,
    onCloseAllTabs,
    onClosePane,
    onNext,
    onPrev,
    onVisitBack,
    onVisitForward,
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

  const debounce = useRef({ name: "", at: 0 });
  const run = useCallback((name: string, fn: () => void) => {
    const now = performance.now();
    if (name === debounce.current.name && now - debounce.current.at < 80) return;
    debounce.current = { name, at: now };
    fn();
  }, []);

  useEffect(() => {
    if (!IS_MAC) return;
    void invoke("autosave_set_enabled", { enabled: loadAutosave() }).catch(console.error);
    void invoke("keybindings_set_overrides", {
      overrides: loadKeybindingOverrides(),
    }).catch(console.error);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The tour owns keyboard navigation; workspace chords must not run underneath it.
      if (document.querySelector('[data-usage-guide-running="true"]')) return;
      // The Quick Composer recorder owns the next key combination, including
      // bindings that the workspace would normally handle in capture phase.
      if (document.querySelector('[data-shortcut-recorder-active="true"]')) return;
      // Never act on a chord while an IME is composing: tabCommand and the
      // editor guards already do, and the app shortcut resolver does too, so
      // this keeps the whole handler consistent for whatever is added next.
      if (e.isComposing) return;
      const customCommand = matchCustomKeybinding(e);
      const pressed = (command: string, defaultMatch: boolean) =>
        keybindingPressed(command, e, defaultMatch);
      if (
        e.key === "Escape" &&
        nativeFullscreenRef.current &&
        !document.querySelector('[role="menu"], [role="dialog"], [data-model-picker]') &&
        !document.documentElement.classList.contains("is-grabbing") &&
        !document.body.style.cursor.includes("resize")
      ) {
        e.preventDefault();
        e.stopPropagation();
        nativeFullscreenRef.current = false;
        void getCurrentWindow().setFullscreen(false).catch(console.warn);
        return;
      }
      if (
        pressed(
          "Pane: Toggle Maximized",
          (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key === "Enter",
        )
      ) {
        if (
          !searchViewOpenRef.current &&
          !settingsOpenRef.current &&
          !inboxViewOpenRef.current &&
          !notesViewOpenRef.current &&
          !automationsViewOpenRef.current &&
          !filePickerOpenRef.current
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) onToggleMaximizePane();
        }
        return;
      }
      if (pressed("App: Toggle Full Screen", isFullscreenShortcut(e))) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) {
          const window = getCurrentWindow();
          void window
            .isFullscreen()
            .then(async (full) => {
              await window.setFullscreen(!full);
              nativeFullscreenRef.current = !full;
            })
            .catch(console.warn);
        }
        return;
      }
      // A rebound zoom chord may be Option-only, so it is resolved outside the
      // Cmd/Ctrl guard that only the browser-standard defaults need.
      const zoom = resolveZoomKeybinding(e);
      if (zoom) {
        e.preventDefault();
        e.stopPropagation();
        if (zoom === "zoom-in") {
          const next = saveUiScale(zoomInUiScale(loadUiScale()));
          void applyUiScale(next);
        } else if (zoom === "zoom-out") {
          const next = saveUiScale(zoomOutUiScale(loadUiScale()));
          void applyUiScale(next);
        } else {
          saveUiScale(UI_SCALE_DEFAULT);
          void applyUiScale(UI_SCALE_DEFAULT);
        }
        return;
      }
      const cmd = customCommand ? tabCommandForKeybinding(customCommand, e) : tabCommand(e);
      if (cmd && pressed(tabCommandKeybinding(cmd), !customCommand)) {
        if (cmd === "archive-session") {
          if (e.repeat) return;
          actions.current.onArchiveFocusedSession(e);
          return;
        }
        if (cmd === "toggle-notes") {
          if (e.repeat) return;
          actions.current.onToggleNotesPanel(e);
          return;
        }
        const target = e.target instanceof Element ? e.target : null;
        const listNavigation =
          cmd === "prev-session" ||
          cmd === "next-session" ||
          cmd === "prev-session-in-tab" ||
          cmd === "next-session-in-tab" ||
          cmd === "prev-project" ||
          cmd === "next-project";
        if (listNavigation) {
          const blockedTarget = Boolean(
            target?.closest(
              'input, textarea, select, [contenteditable="true"], .cm-editor, .bycoda-terminal, [role="dialog"], [data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-app-search]',
            ),
          );
          const emptyComposerTarget = Boolean(
            target?.matches('textarea[data-composer-empty="true"]'),
          );
          const surfaceOpen =
            searchViewOpenRef.current ||
            inboxViewOpenRef.current ||
            notesViewOpenRef.current ||
            automationsViewOpenRef.current ||
            settingsOpenRef.current ||
            filePickerOpenRef.current ||
            Boolean(whatsNewVersionRef.current);
          if (
            !shouldHandleListNavigation({
              blockedTarget,
              emptyComposerTarget,
              surfaceOpen,
            })
          ) {
            return;
          }
        }
        if (
          target?.closest(".bycoda-terminal") &&
          e.ctrlKey &&
          !e.metaKey &&
          (cmd === "back" || cmd === "forward" || /Mac|iPhone|iPad/.test(navigator.platform))
        ) {
          return;
        }
        if ((cmd === "split-right" || cmd === "split-down") && target?.closest(".cm-editor")) {
          return;
        }
        const inPicker =
          target &&
          target.closest(
            "[data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-app-search]",
          );
        if (inPicker && typeof cmd === "object" && "activate" in cmd) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const a = actions.current;
        if (cmd === "new") run("new", a.onNew);
        else if (cmd === "close-others") run("close-others", a.onCloseOtherTabs);
        else if (cmd === "close-all") run("close-all", a.onCloseAllTabs);
        else if (cmd === "close") run("close", a.onClosePane);
        else if (cmd === "next") run("next", a.onNext);
        else if (cmd === "prev") run("prev", a.onPrev);
        else if (cmd === "cycle-next") run("next", a.onNext);
        else if (cmd === "cycle-prev") run("prev", a.onPrev);
        else if (cmd === "back") run("back", a.onVisitBack);
        else if (cmd === "forward") run("forward", a.onVisitForward);
        else if (cmd === "split-right") run("split-right", () => a.onSplit("right"));
        else if (cmd === "split-down") run("split-down", () => a.onSplit("down"));
        else if (cmd === "new-terminal") run("new-terminal", a.onNewTerminal);
        else if (cmd === "new-terminal-tab") run("new-terminal-tab", a.onNewTerminalTab);
        else if (cmd === "toggle-terminal") run("toggle-terminal", a.onToggleProjectTerminal);
        else if (cmd === "prev-session") run("prev-session", () => a.onNavigateSessionList(-1));
        else if (cmd === "next-session") run("next-session", () => a.onNavigateSessionList(1));
        else if (cmd === "prev-session-in-tab")
          run("prev-session-in-tab", () => a.onNavigateSessionList(-1, true));
        else if (cmd === "next-session-in-tab")
          run("next-session-in-tab", () => a.onNavigateSessionList(1, true));
        else if (cmd === "prev-project") run("prev-project", () => a.onNavigateProjectList(-1));
        else if (cmd === "next-project") run("next-project", () => a.onNavigateProjectList(1));
        else if (typeof cmd === "object" && "focus" in cmd)
          run(`focus-${cmd.focus}`, () => a.onFocusDir(cmd.focus));
        else if (typeof cmd === "object" && "activate" in cmd)
          run(`activate-${cmd.activate}`, () => a.onActivate(cmd.activate));
        return;
      }
      if (
        !searchViewOpenRef.current &&
        !inboxViewOpenRef.current &&
        !notesViewOpenRef.current &&
        !automationsViewOpenRef.current &&
        !(
          e.target instanceof Element && e.target.closest("[data-session-drop], [data-agent-tab]")
        ) &&
        handleEditorFindKey(e)
      ) {
        e.stopPropagation();
        return;
      }
      const shortcut = resolveAppShortcut(e);
      if (shortcut) {
        if (
          shortcut === "App: Search" &&
          e.target instanceof Element &&
          e.target.closest(".bycoda-terminal") &&
          e.ctrlKey &&
          !e.metaKey
        ) {
          return;
        }
        // In the note editor the same chord makes the selection bold.
        if (
          shortcut === "App: Toggle Sidebar" &&
          e.key.toLowerCase() === "b" &&
          e.target instanceof Element &&
          e.target.closest("[data-note-editor] .cm-content")
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const a = actions.current;
        if (shortcut === "App: New Window") run("new_window", () => void invoke("open_new_window"));
        else if (shortcut === "App: Open Project") run("open_project", () => void a.pickProject());
        else if (shortcut === "App: Toggle Sidebar") run("toggle_sidebar", a.onToggleSidebar);
        else if (shortcut === "App: Toggle Session Sidebar")
          run("toggle_session_sidebar", a.onToggleSessionSidebar);
        else if (shortcut === "App: Go to File") run("go_to_file", a.onGoToFile);
        else if (shortcut === "App: Command Palette")
          run("open_command_palette", a.onOpenCommandPalette);
        else if (shortcut === "View: Reload") run("reload", a.onReload);
        else if (shortcut === "App: Search") run("open_search", a.onOpenSearch);
        else if (shortcut === "App: Settings") run("open_settings", () => a.openSettings());
        else if (shortcut === "App: Find in Files") run("find_in_project", a.onFindInProject);
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [run]);

  useEffect(() => {
    const unlisten: Array<Promise<() => void>> = [
      listen("new_tab", () => run("new", actions.current.onNew)),
      listen("close_other_tabs", () => run("close-others", actions.current.onCloseOtherTabs)),
      listen("close_all_tabs", () => run("close-all", actions.current.onCloseAllTabs)),
      listen("close_tab", () => run("close", actions.current.onClosePane)),
      listen<boolean>("toggle_autosave", ({ payload }) => {
        const saved = saveAutosave(payload);
        if (saved !== payload && IS_MAC) {
          void invoke("autosave_set_enabled", { enabled: saved });
        }
      }),
      listen("next_tab", () => run("next", actions.current.onNext)),
      listen("prev_tab", () => run("prev", actions.current.onPrev)),
      listen("back_tab", () => run("back", actions.current.onVisitBack)),
      listen("forward_tab", () => run("forward", actions.current.onVisitForward)),
      listen("split_right", () => run("split-right", () => actions.current.onSplit("right"))),
      listen("split_down", () => run("split-down", () => actions.current.onSplit("down"))),
      ...(
        [
          ["layout_columns", "columns"],
          ["layout_rows", "rows"],
          ["layout_grid", "grid"],
          ["layout_main_left", "main-left"],
          ["layout_main_top", "main-top"],
          ["layout_equalize", "equalize"],
        ] as const
      ).map(([event, preset]) =>
        listen(event, () => run(event, () => actions.current.onArrangeActiveTab(preset))),
      ),
      listen("new_terminal", () => run("new-terminal", actions.current.onNewTerminal)),
      listen("new_terminal_tab", () => run("new-terminal-tab", actions.current.onNewTerminalTab)),
      listen("toggle_terminal", () =>
        run("toggle-terminal", actions.current.onToggleProjectTerminal),
      ),
      listen("focus_left", () => run("focus-left", () => actions.current.onFocusDir("left"))),
      listen("focus_right", () => run("focus-right", () => actions.current.onFocusDir("right"))),
      listen("focus_up", () => run("focus-up", () => actions.current.onFocusDir("up"))),
      listen("focus_down", () => run("focus-down", () => actions.current.onFocusDir("down"))),
      listen("toggle_sidebar", () => run("toggle_sidebar", actions.current.onToggleSidebar)),
      listen("toggle_session_sidebar", () =>
        run("toggle_session_sidebar", actions.current.onToggleSessionSidebar),
      ),
      listen("open_project", () => {
        void actions.current.pickProject();
      }),
      listen("go_to_file", () => run("go_to_file", actions.current.onGoToFile)),
      listen("open_command_palette", () =>
        run("open_command_palette", actions.current.onOpenCommandPalette),
      ),
      listen("reload", () => run("reload", actions.current.onReload)),
      listen("open_search", () => actions.current.onOpenSearch()),
      listen("open_inbox", () => actions.current.onOpenInbox()),
      listen("open_notes", () => actions.current.onOpenNotes()),
      listen("usage_guide", openUsageGuide),
      listen("open_settings", () => actions.current.openSettings()),
      listen("check_for_updates", () => {
        void runUpdateFlow(true);
      }),
      listen("sidebar_opacity", () => {
        actions.current.openSettings("appearance");
      }),
      listen("find_in_project", () => actions.current.onFindInProject()),
      listen("find", () => {
        openFindInActiveEditor();
      }),
      listen("open_model_picker", () => {
        window.dispatchEvent(new Event("open_model_picker"));
      }),
      // Every window hears the click; only the one holding the session acts.
      listen<string>(NOTIFICATION_CLICK_EVENT, ({ payload: sessionId }) => {
        const background =
          sessionId === BACKGROUND_NOTIFICATION_TARGETS.tasks
            ? actions.current.onOpenTasks
            : sessionId === BACKGROUND_NOTIFICATION_TARGETS.automations
              ? actions.current.onOpenAutomations
              : sessionId === BACKGROUND_NOTIFICATION_TARGETS.summary
                ? () => {
                    requestSummaryPanel();
                    actions.current.onOpenTasks();
                  }
                : null;
        if (background) {
          // Background work is not held by a window: the one that announced
          // it answers the click.
          void isLeadWindow().then((lead) => {
            if (!lead) return;
            const win = getCurrentWindow();
            void restoreWindowFocus(win).catch((error) => {
              console.warn("App operation failed", error);
            });
            background();
          });
          return;
        }
        if (!sessionsRef.current.some((s) => s.id === sessionId)) return;
        const win = getCurrentWindow();
        // Windows leaves a minimized window minimized when it is only focused.
        void restoreWindowFocus(win).catch((error) => {
          console.warn("App operation failed", error);
        });
        actions.current.onOpenApprovalSession(sessionId);
      }),
      listen("zoom_in", () => {
        const next = zoomInUiScale(loadUiScale());
        saveUiScale(next);
        void applyUiScale(next);
      }),
      listen("zoom_out", () => {
        const next = zoomOutUiScale(loadUiScale());
        saveUiScale(next);
        void applyUiScale(next);
      }),
      listen("zoom_reset", () => {
        saveUiScale(UI_SCALE_DEFAULT);
        void applyUiScale(UI_SCALE_DEFAULT);
      }),
    ];
    const releases = unlisten.map((registration) =>
      retainAsyncSubscription(registration, (error) =>
        console.warn("Menu subscription failed", error),
      ),
    );
    return () => releases.forEach((release) => release());
  }, [run]);

  const dockGridRef = useRef<HTMLDivElement>(null);
  const dockDragSize = useRef<number | null>(null);
  const paintDockSize = useCallback((size: number) => {
    const dock = findProjectTerminal(projectTerminalsRef.current, projectCwdRef.current);
    const el = dockGridRef.current;
    if (!dock || !el) return;
    dockDragSize.current = size;
    applyDockGridStyle(el, dock.side, size);
  }, []);
  const commitDockSize = useCallback(
    (size: number) => {
      dockDragSize.current = null;
      onProjectTerminalSize(size);
    },
    [onProjectTerminalSize],
  );
  useLayoutEffect(() => {
    if (dockDragSize.current != null) return;
    const el = dockGridRef.current;
    if (!el) return;
    applyDockGridStyle(
      el,
      dockVisible && currentProjectDock ? currentProjectDock.side : null,
      currentProjectDock?.size ?? 0,
    );
  }, [currentProjectDock, dockVisible]);

  const lastRemoteSnapshot = useRef(new Map<string, HostSession>());
  const onRemoteSnapshot = useCallback((shellId: string, snapshot?: HostSession) => {
    if (!snapshot) {
      lastRemoteSnapshot.current.delete(shellId);
      setSessions((current) =>
        current.map((entry) =>
          entry.id === shellId
            ? {
                ...entry,
                get title() {
                  return t("New remote session");
                },
                blocks: [],
                busy: false,
              }
            : entry,
        ),
      );
      return;
    }
    if (lastRemoteSnapshot.current.get(shellId) === snapshot) return;
    lastRemoteSnapshot.current.set(shellId, snapshot);
    setSessions((current) => {
      const shell = current.find((entry) => entry.id === shellId);
      if (!shell) return current;
      const project = remoteProjectFor(shell.cwd);
      if (!project) return current;
      return current.map((entry) =>
        entry.id === shellId ? remoteSessionState(entry, snapshot, project) : entry,
      );
    });
  }, []);

  const onManageWorktrees = useCallback(() => openSettings("worktrees"), [openSettings]);

  const windowMovingSessionIds = useMemo(
    () =>
      new Set(
        tabs
          .filter((tab) => windowTransferPending || movingWindows.has(tab.id))
          .flatMap((tab) => leafIds(tab.layout)),
      ),
    [tabs, movingWindows, windowTransferPending],
  );
  const sessionPaneProps = {
    windowMovingSessionIds,
    workspaceSwitchingSessionId: workspaceNavigation.pending ? active?.id : undefined,
    recents: visibleRecents,
    hideProjectPicker: true,
    onFocus: onFocusPane,
    onClose: onClosePane,
    onCwdChange,
    onBranchChange,
    onWorktreeChange: onComposerWorktreeChange,
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
    onSelectProviderAccount: onSwitchSessionAccount,
    onInboxCardDismiss,
    onLinkedWorkItemUpdateCardDismiss,
    onNoteCardDismiss,
    onHandoffCardDismiss,
    onOpenLinkedWorkItem,
    onArchiveSession: onArchiveHistorySession,
    onDeleteSession: onDeleteHistorySession,
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
    onNewTerminal: onNewTerminalInSession,
    onRunProjectAction: onRunSessionProjectAction,
  };

  const chromeSurfaceOpen =
    searchViewOpen || settingsOpen || inboxViewOpen || notesViewOpen || automationsViewOpen;
  const compactProjectRail = collapsedProjectRailMode === "compact";
  const detachedSessionWindow = Boolean(windowTransfer || toolWindow);
  const compactRailActive = !detachedSessionWindow && compactProjectRail && !projectRailOpen;
  const trayProjectKeys = useMemo(
    () => new Set(visibleRecents.map((project) => pathKey(project.path))),
    [visibleRecents],
  );
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
  const layoutControl = useMemo(
    () => ({
      current: activeTabLayoutPreset,
      canArrange: canArrangeActiveTab,
      onArrange: onArrangeActiveTab,
      onSplit,
      maximized: maximizedPane?.tabId === activeTabId,
      onToggleMaximize: () => onToggleMaximizePane(),
    }),
    [
      activeTabLayoutPreset,
      canArrangeActiveTab,
      onArrangeActiveTab,
      onSplit,
      maximizedPane,
      activeTabId,
      onToggleMaximizePane,
    ],
  );
  const workspaceTitleBar = (
    <TitleBar
      detached={detachedSessionWindow}
      onReturnTabToMain={
        windowTransfer
          ? (tabId) => void onMoveTabsToNewWindow([tabId], { targetWindowLabel: "main" })
          : undefined
      }
      onReturnToMain={
        windowTransfer
          ? () =>
              void onMoveTabsToNewWindow(
                tabsRef.current.map((tab) => tab.id),
                { targetWindowLabel: "main" },
              )
          : undefined
      }
      tabs={titleTabs}
      activeId={activeTabId}
      cwd={sidebarCwd}
      projectRailOpen={!detachedSessionWindow && projectRailOpen}
      sessionSidebarOpen={!detachedSessionWindow && sessionSidebarOpen}
      compactRail={compactTitleBar}
      canGoBack={tabVisitNav.canBack}
      canGoForward={surfaceForward.canForward || tabVisitNav.canForward}
      onGoBack={onRailBack}
      onGoForward={onRailForward}
      onToggleSidebar={onToggleSidebar}
      onToggleSessionSidebar={onToggleSessionSidebar}
      onSelect={activateTab}
      onNew={onNew}
      onNewTerminal={onNewTerminal}
      onOpenSettings={onOpenSettings}
      onOpenInbox={onOpenInbox}
      onOpenNotes={notesEnabled ? onOpenNotes : undefined}
      onClose={onCloseTitleTab}
      onCloseMany={onCloseTabs}
      onArchiveTab={onArchiveTitleTab}
      onDeleteTab={onDeleteTitleTab}
      onReorder={onReorderTabs}
      onPlaceOnPane={onPlaceTabOnPane}
      layout={layoutControl}
      onMoveToNewWindow={onMoveTabToNewWindow}
      onCancelMoveToNewWindow={onCancelMoveToNewWindow}
      onGoToFile={onGoToFile}
      onPinFile={onPinFile}
      recents={visibleRecents}
      onSelectProject={onSelectProject}
    />
  );

  const closeRecovery = () => {
    setRecoveryOpen(false);
    const current = getSessionRecovery();
    if (!current) return;
    const next = { ...current, dismissed: true };
    setSessionRecovery(next);
    updateSessionRecovery(next);
    void saveWorkspaceSnapshot(
      collectWorkspaceSnapshot(
        tabsRef.current,
        sessionsRef.current,
        activeTabIdRef.current,
        projectCwd,
        projectReturnRef.current,
        projectTerminals,
        lastDockSide ?? undefined,
        keepWorkspaceTab,
      ),
    ).catch((error) => console.warn("Could not save session recovery", error));
  };
  const removeRecoveredSessions = async (ids: string[]) => {
    const current = getSessionRecovery();
    if (!current) return;
    const next = removeRecoverySessions(current, ids);
    setSessionRecovery(next);
    updateSessionRecovery(next);
    try {
      await saveWorkspaceSnapshot(
        collectWorkspaceSnapshot(
          tabsRef.current, sessionsRef.current, activeTabIdRef.current,
          projectCwd, projectReturnRef.current, projectTerminals,
          lastDockSide ?? undefined, keepWorkspaceTab,
        ),
      );
    } catch (error) {
      setSessionRecovery(current);
      updateSessionRecovery(current);
      throw error;
    }
  };
  const openRecoveredSessions = async (ids: string[], restoreLayout: boolean) => {
    if (!sessionRecovery) return;
    workspaceNavigation.cancel();
    const wanted = new Set(ids);
    const recoveryTabs = sessionRecoveryTabs(sessionRecovery.workspace.tabs, wanted);
    const restored = hydrateWorkspaceSnapshot(
      { ...sessionRecovery.workspace, tabs: recoveryTabs },
      new Map(),
    );
    const failed: string[] = [];
    const opened = new Set<string>();
    for (const stub of sessionRecovery.workspace.sessions.filter(
      (entry) => wanted.has(entry.id) && !isProjectLockedIn(lockSnapshot, entry.cwd),
    )) {
      if (
        removingSessionIds.current.has(stub.id) ||
        movingSessionIds.current.has(stub.id) ||
        switchingWorktrees.current.has(stub.id)
      ) {
        failed.push(stub.id);
        continue;
      }
      try {
        let session = await ensureOpenSession(stub.id);
        // Remote transcripts live on the host; restore the exact saved shell binding.
        if (!session && isRemoteProjectPath(stub.cwd) && stub.remoteSessionId) {
          session = restored?.sessions.find((entry) => entry.id === stub.id) ?? null;
          if (session) {
            const next = [...sessionsRef.current, session];
            sessionsRef.current = next;
            setSessions(next);
          }
        }
        if (!session || !sameProjectPath(session.cwd, stub.cwd)) {
          failed.push(stub.id);
          continue;
        }
        if (isProjectLockedIn(getGroupLockView().lock, stub.cwd)) continue;
        opened.add(stub.id);
      } catch {
        failed.push(stub.id);
      }
    }
    if (opened.size) {
      const previousTabs = restoreLayout
        ? sessionRecoveryTabs(sessionRecovery.workspace.tabs, opened)
        : [...opened].map((id) => newTab(id));
      const covered = new Set(previousTabs.flatMap((tab) => leafIds(tab.layout)));
      for (const id of opened) if (!covered.has(id)) previousTabs.push(newTab(id));
      const next = mergeRecoveryTabs(tabsRef.current, previousTabs);
      tabsRef.current = next;
      setTabs(next);
      const previousFocus = sessionRecovery.workspace.tabs.find(
        (tab) => tab.id === sessionRecovery.workspace.activeTabId,
      )?.focusedId;
      const target =
        (previousFocus && opened.has(previousFocus)
          ? next.find((tab) => leafIds(tab.layout).includes(previousFocus))
          : undefined) ?? next.find((tab) => leafIds(tab.layout).some((id) => opened.has(id)));
      if (target) {
        activeTabIdRef.current = target.id;
        setActiveTabId(target.id);
        const session = sessionsRef.current.find((entry) => entry.id === target.focusedId);
        if (session) followProject(session.cwd);
      }
      await removeRecoveredSessions([...opened]);
    }
    if (failed.length) throw new Error("Recovery sessions unavailable");
  };
  const recoveryCount = sessionRecovery?.workspace.sessions.filter(
    (stub) => !isProjectLockedIn(lockSnapshot, stub.cwd),
  ).length ?? 0;
  const recoveryControl = !toolWindow && !windowTransfer ? (
    <SessionRecoveryControl
      count={recoveryCount}
      onOpen={() => setRecoveryOpen(true)}
      onClear={async () => {
        const current = getSessionRecovery();
        if (!current) return;
        await removeRecoveredSessions(current.workspace.sessions.filter(
          (stub) => !isProjectLockedIn(getGroupLockView().lock, stub.cwd),
        ).map((stub) => stub.id));
      }}
    />
  ) : null;

  return (
    <OrchestrationActions.Provider value={orchestrationActions}>
      <OrchestrationWorkers.Provider value={orchestrationWorkers}>
        <div
          className={`flex h-full flex-col text-content ${
            HAS_NATIVE_GLASS ? "bg-background-base/40" : "bg-background-base"
          }`}
        >
          {compactTitleBar ? workspaceTitleBar : null}
          {detachedSessionWindow && (!IS_MAC || liveAgents.length > 0) ? (
            <DetachedWorkingBar agents={liveAgents} onSelectAgent={onSelectLiveAgent} />
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1">
            {!detachedSessionWindow ? (
              <Sidebar
                recoveryControl={recoveryControl}
                cwd={sidebarCwd}
                gitCwd={gitCwd}
                worktreeTabStats={worktreeTabStats}
                onSelectWorkspace={onSelectWorkspace}
                workspaceSwitchPending={workspaceNavigation.pending?.project === sidebarCwd}
                workspaceSwitchError={
                  workspaceNavigation.error?.project === sidebarCwd
                    ? workspaceNavigation.error.message
                    : undefined
                }
                explorerRootLabel={explorerRootLabel}
                open={sessionSidebarOpen}
                tab={sidebarTab}
                onTabChange={setSidebarTab}
                filesSearchOpen={filesSearchOpen}
                onFilesSearchOpenChange={setFilesSearchOpen}
                onOpenFilesSearch={onFindInProject}
                searchFocusToken={searchFocusToken}
                sessions={sidebarHistory}
                busySessionIds={busySessionIds}
                approvalSessionIds={approvalSessionIds}
                activeSessionId={active?.id}
                status={historyFailed ? "error" : "idle"}
                pending={historyPending}
                onSelectSession={onSelectHistorySession}
                onSelectRemoteSession={onSelectRemoteSession}
                onRemoteSessionDeleted={onRemoteSessionDeleted}
                onPrefetchSession={onPrefetchHistorySession}
                onSessionNavigationOrder={onSessionNavigationOrder}
                onPlaceSessionOnPane={onPlaceSessionOnPane}
                onPopOutSession={onPopOutSession}
                onOpenSessionsSideBySide={onOpenSessionsSideBySide}
                onRenameSession={onRenameHistorySession}
                onArchiveSession={onArchiveHistorySession}
                onArchiveSessions={onArchiveHistorySessions}
                onPinSession={onPinHistorySession}
                onPinSessions={onPinHistorySessions}
                onSetSessionLinkedWorkItem={onSetHistorySessionLinkedWorkItem}
                reminders={sessionReminders.reminders}
                onSetReminders={sessionReminders.schedule}
                onCancelReminders={sessionReminders.cancel}
                onDeleteSession={onDeleteHistorySession}
                onDeleteSessions={onDeleteHistorySessions}
                onDeleteSessionNow={onDeleteHistorySessionNow}
                onOpenFile={onOpenFile}
                onOpenTerminal={onOpenTerminal}
                onFileMoved={onFileMoved}
                onFileDeleted={onFileDeleted}
                canGoBack={
                  tabVisitNav.canBack ||
                  searchViewOpen ||
                  settingsOpen ||
                  inboxViewOpen ||
                  notesViewOpen ||
                  automationsViewOpen
                }
                canGoForward={surfaceForward.canForward || tabVisitNav.canForward}
                onGoBack={onRailBack}
                onGoForward={onRailForward}
                onOpenDiff={onOpenWorkingTreeDiff}
                onOpenAllChanges={onOpenAllChanges}
                onOpenCommit={onOpenCommit}
                onOpenRepository={onOpenRepository}
                selectedDiffPath={activeTab ? selectedChangePath(activeTab, gitCwd) : undefined}
                selectedDiffKind={activeTab ? selectedChangeKind(activeTab) : undefined}
                selectedCommitSha={activeTab ? selectedCommitSha(activeTab) : undefined}
                textHarness={pickTextHarness(active?.harness)}
                recents={recents}
                busyProjectPaths={busyProjectPaths}
                liveAgents={liveAgents}
                onSelectAgent={onSelectLiveAgent}
                recentSessions={recentSessions}
                onSelectProject={onSelectProject}
                onOpenProject={pickProject}
                onOpenSyncedProject={openSyncedProject}
                onRemoveProject={onRemoveProject}
                onRenameProjectFolder={onRenameProjectFolder}
                onNew={onNew}
                openSessions={openProjectSessions}
                onNewTerminal={onNewTerminal}
                onSearch={onOpenSearch}
                onOpenInbox={onOpenInbox}
                onOpenInboxItem={onOpenLinkedWorkItem}
                onOpenNotes={notesEnabled ? onOpenNotes : undefined}
                onOpenAutomations={onOpenAutomations}
                onOpenTasks={onOpenTasks}
                onGoToFile={onGoToFile}
                searchActive={searchViewOpen}
                inboxActive={inboxViewOpen}
                notesActive={notesViewOpen}
                automationsActive={automationsViewOpen && !taskBoardShown && !socialBoardShown}
                tasksActive={automationsViewOpen && taskBoardShown}
                socialActive={automationsViewOpen && socialBoardShown}
                notesEnabled={notesEnabled}
                projectRailOpen={projectRailOpen}
                compactProjectRail={compactProjectRail}
                titleBarAbove={compactTitleBar}
                onToggleProjectRail={onToggleProjectRail}
                unseenFinishedIds={unseenFinishedIds}
                inboxUnseen={inboxUnseen}
                linkedSessionUpdateIds={linkedSessionUpdateIds}
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

            <div className="body-glass flex min-h-0 min-w-0 flex-1 flex-col">
              <div
                className={
                  searchViewOpen ||
                  settingsOpen ||
                  inboxViewOpen ||
                  notesViewOpen ||
                  automationsViewOpen
                    ? "hidden"
                    : "flex min-h-0 min-w-0 flex-1 flex-col"
                }
                aria-hidden={
                  searchViewOpen ||
                  settingsOpen ||
                  inboxViewOpen ||
                  notesViewOpen ||
                  automationsViewOpen
                }
                inert={
                  searchViewOpen ||
                  settingsOpen ||
                  inboxViewOpen ||
                  notesViewOpen ||
                  automationsViewOpen ||
                  undefined
                }
              >
                {!IS_MAC ? (
                  <MenuBar
                    onNew={onNew}
                    onNewTerminal={onNewTerminal}
                    onToggleTerminal={onToggleProjectTerminal}
                    onGoToFile={onGoToFile}
                    onToggleSidebar={onToggleSidebar}
                    onToggleSessionSidebar={onToggleSessionSidebar}
                    onShowSourceControl={onToggleChanges}
                    onCloseCurrentTab={activeTabId ? onCloseCurrentTab : undefined}
                    onCloseOtherTabs={onCloseOtherTabs}
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

                <main className="relative flex min-h-0 min-w-0 flex-1">
                  <ToolsWorkspace>
                  <div ref={dockGridRef} className="grid h-full min-h-0 min-w-0 flex-1">
                    {projectTerminals.map((dock) => {
                      const show = dock.open && sameProjectPath(dock.projectPath, projectCwd);
                      return (
                        <div
                          key={dock.projectPath}
                          className={
                            show ? "h-full min-h-0 min-w-0 w-full overflow-hidden" : "hidden"
                          }
                          style={show ? { gridArea: "dock" } : undefined}
                          aria-hidden={!show}
                        >
                          <ProjectTerminalDock
                            dock={dock}
                            tools={
                              show && conversationTools
                                ? { ...conversationTools, onOpenFile }
                                : undefined
                            }
                            focused={show && projectTerminalFocused}
                            onFocus={focusProjectTerminal}
                            onHide={onHideProjectTerminal}
                            onSideChange={onProjectTerminalSide}
                            onSizePaint={paintDockSize}
                            onSizeCommit={commitDockSize}
                            onAddTerminal={onNewTerminal}
                            onAddTerminalWithProfile={onNewTerminalWithProfile}
                            onSplitTerminal={onSplitProjectTerminal}
                            onSelectDefaultProfile={() => openSettings("terminal")}
                            onSelectTerminal={onSelectProjectTerminal}
                            onCloseTerminal={onCloseProjectTerminal}
                            onCloseOtherTerminals={onCloseOtherProjectTerminals}
                            onReorderTerminals={onReorderProjectTerminals}
                            onTerminalMetaChange={onTerminalMetaChange}
                          />
                        </div>
                      );
                    })}
                    <div
                      className="relative flex min-h-0 min-w-0 flex-col"
                      style={{ gridArea: "main" }}
                    >
                      <div className="relative min-h-0 min-w-0 flex-1">
                        {tabs.map((tab) => (
                          <div
                            key={tab.id}
                            aria-hidden={tab.id !== activeTabId}
                            className={
                              tab.id === activeTabId
                                ? "absolute inset-0 flex h-full min-h-0 flex-col"
                                : "hidden"
                            }
                          >
                            <div
                              inert={windowTransferPending || movingWindows.has(tab.id)}
                              aria-busy={windowTransferPending || movingWindows.has(tab.id)}
                              className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
                            >
                              <PaneTree
                                {...sessionPaneProps}
                                visible={tab.id === activeTabId && !inboxViewOpen}
                                layout={tab.layout}
                                maximizedPaneId={
                                  maximizedPane?.tabId === tab.id ? maximizedPane.paneId : null
                                }
                                onToggleMaximizePane={onToggleMaximizePane}
                                sessions={sessions}
                                editorPanes={[...tab.editorPanes, ...(tab.terminalPanes ?? [])]}
                                dirtyFileIds={dirtyFiles}
                                fileErrorCounts={fileErrorCounts}
                                focusedId={
                                  tab.id === activeTabId &&
                                  !inboxViewOpen &&
                                  !tab.diffFocused &&
                                  !projectTerminalFocused
                                    ? tab.focusedId
                                    : ""
                                }
                                addToChatSessionId={tab.id === activeTabId ? active?.id : undefined}
                                composerFocused={composerFocused && !projectTerminalFocused}
                                composerFocusToken={composerFocusToken}
                                onSelectFile={onSelectFileSurface}
                                onCloseFile={onCloseFile}
                                onCloseOtherFiles={onCloseOtherFiles}
                                onOpenInNewWindow={onOpenFileInNewWindow}
                                onPinFile={onPinFile}
                                onReorderFiles={onReorderFiles}
                                onFileDirtyChange={onFileDirtyChange}
                                onFileErrorCountChange={onFileErrorCountChange}
                                transcriptPool={transcriptPool}
                                onRatio={(splitId, index, ratio) =>
                                  onRatio(tab.id, splitId, index, ratio)
                                }
                                editorNavigation={editorNavigation}
                                onUpdatePlan={onUpdatePlan}
                                onMovePane={onMovePane}
                                onMoveFile={onMoveFileBetweenPanes}
                                onDetachPane={onDetachPane}
                                onPopOutPane={onPopOutPane}
                                onTerminalMetaChange={onTerminalMetaChange}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  {[...linkedWorkItemPanels.values()].map((panel) => (
                    <LinkedWorkItemPanel
                      repairSessions={repairSessions}
                      onRepairChecks={onRepairChecks}
                      onOpenSession={(sessionId) => {
                        closeLinkedWorkItemPanel(panel.sessionId);
                        onOpenInboxSession(sessionId);
                      }}
                      key={panel.sessionId}
                      target={panel.item}
                      cwd={panel.cwd}
                      recents={visibleRecents}
                      visible={
                        !searchViewOpen &&
                        !settingsOpen &&
                        !inboxViewOpen &&
                        !notesViewOpen &&
                        !automationsViewOpen &&
                        activeLinkedWorkItemPanel?.sessionId === panel.sessionId
                      }
                      onClose={() => closeLinkedWorkItemPanel(panel.sessionId)}
                    />
                  ))}
                  </ToolsWorkspace>
                </main>
              </div>
              {searchViewOpen ? (
                <LiveSearchView
                  open
                  cwd={gitCwd}
                  recents={visibleRecents}
                  history={projectHistory}
                  lockSnapshot={lockSnapshot}
                  focusToken={searchViewFocusToken}
                  besideRail={projectRailOpen || compactProjectRail}
                  compactRail={compactRailActive}
                  onClose={onLeaveSearch}
                  onToggleSidebar={onToggleSidebar}
                  onOpenFile={onOpenFile}
                  onOpenSession={(sessionId, blockId, query) => {
                    if (blockId) requestTranscriptJump(sessionId, blockId, query);
                    void onSelectHistorySession(sessionId);
                  }}
                  onOpenProject={onSelectProject}
                />
              ) : null}
              <div className="hidden" aria-hidden>
                {sessions
                  .filter((session) => session.inboxAsk)
                  .map((session) => {
                    const visible = inboxViewOpen && inboxAskPortal?.sessionId === session.id;
                    return (
                      <SessionSurface
                        key={session.id}
                        host={visible ? inboxAskPortal.host : undefined}
                      >
                        <SessionPane
                          {...sessionPaneProps}
                          session={session}
                          visible={visible}
                          focused={visible}
                          inSplit={false}
                          composerFocused={composerFocused}
                          composerFocusToken={composerFocusToken}
                        />
                      </SessionSurface>
                    );
                  })}
              </div>
              <ToolNavigationContext.Provider
                value={{
                  active: inboxViewOpen
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
                  cwd:
                    automationsViewOpen && socialBoardShown && socialPanelCwd
                      ? socialPanelCwd
                      : projectCwd,
                  notesEnabled,
                  grouped: toolWindow?.grouped ?? true,
                  onSelect: (tool: ToolId) => {
                    setFilePickerOpen(false);
                    setSettingsOpen(false);
                    setSearchViewOpen(false);
                    setInboxViewOpen(tool === "inbox");
                    setPullRequestsOnly(false);
                    setNotesViewOpen(tool === "notes" && notesEnabled);
                    setAutomationsViewOpen(
                      tool === "social" || tool === "tasks" || tool === "automations",
                    );
                    setSocialBoardShown(tool === "social");
                    setTaskBoardShown(tool === "tasks");
                  },
                }}
              >
                <ToolPanel active={inboxViewOpen}>
                  <InboxView
                    key={pullRequestsOnly ? "pullRequests" : "inbox"}
                    pullRequestsOnly={pullRequestsOnly}
                    onOpenProject={pickProject}
                    cwd={sidebarCwd}
                    recents={visibleRecents}
                    besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
                    compactRail={compactRailActive}
                    onClose={onLeaveInbox}
                    onToggleSidebar={toolWindow ? undefined : onToggleSidebar}
                    onStart={onStartInboxItem}
                    onAsk={onAskInboxItem}
                    onAskRestart={onRestartInboxAsk}
                    onAskMount={setInboxAskPortal}
                    sessions={inboxRelatedSessions}
                    repairSessions={repairSessions}
                    onRepairChecks={onRepairChecks}
                    onOpenSession={onOpenInboxSession}
                    onOpenIntegrations={onOpenInboxIntegrations}
                  />
                </ToolPanel>
                <ToolPanel active={notesViewOpen}>
                  <NotesView
                    besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
                    compactRail={compactRailActive}
                    cwd={projectCwd}
                    recents={visibleRecents}
                    onClose={onLeaveNotes}
                    onToggleSidebar={toolWindow ? undefined : onToggleSidebar}
                  />
                </ToolPanel>
                <ToolPanel active={automationsViewOpen && socialBoardShown}>
                  <NavigationBoundary name="Social Media" onBack={onLeaveAutomations}>
                    <SocialView
                      cwd={socialPanelCwd || projectCwd}
                      besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
                      compactRail={compactRailActive}
                      onToggleSidebar={toolWindow ? undefined : onToggleSidebar}
                      onClose={onLeaveAutomations}
                    />
                  </NavigationBoundary>
                </ToolPanel>
                <ToolPanel active={automationsViewOpen && taskBoardShown && !socialBoardShown}>
                  <NavigationBoundary name="Tasks" onBack={onLeaveAutomations}>
                    <TasksView
                      besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
                      compactRail={compactRailActive}
                      cwd={projectCwd}
                      recents={visibleRecents}
                      onClose={onLeaveAutomations}
                      onToggleSidebar={toolWindow ? undefined : onToggleSidebar}
                      onOpenBackgroundSession={onOpenBackgroundSession}
                    />
                  </NavigationBoundary>
                </ToolPanel>
                <ToolPanel active={automationsViewOpen && !taskBoardShown && !socialBoardShown}>
                  <AutomationsView
                    besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
                    compactRail={compactRailActive}
                    cwd={projectCwd}
                    recents={visibleRecents}
                    onClose={onLeaveAutomations}
                    onToggleSidebar={toolWindow ? undefined : onToggleSidebar}
                    onLaunch={(automation, run) => launchAutomation(automation, run, true)}
                    onOpenSession={onOpenAutomationSession}
                    onOpenBackgroundSession={onOpenBackgroundSession}
                  />
                </ToolPanel>
              </ToolNavigationContext.Provider>
              {settingsOpen ? (
                <SettingsView
                  section={settingsSection}
                  anchor={settingsAnchor}
                  notificationProjectPath={notificationProjectPath}
                  notificationSettingsRequest={notificationSettingsRequest}
                  recents={visibleRecents}
                  cwd={sidebarCwd}
                  sessions={sidebarHistory}
                  liveSessions={sessions}
                  onRemoveWorktree={onRemoveWorktree}
                  onCheckWorktreeRemoval={onCheckWorktreeRemoval}
                  onDeleteWorktreeSessions={onDeleteWorktreeSessions}
                  onClose={onCloseSettings}
                  onSelectSection={onSelectSettingsSection}
                  onOpenSession={onOpenArchivedSession}
                  onArchiveSession={onArchiveHistorySession}
                  onDeleteSession={onDeleteHistorySession}
                  onRestoreProject={onRestoreProject}
                  onDeleteProject={(path) => onRemoveProject(path, { purgeData: true })}
                  onOpenWhatsNew={onOpenWhatsNew}
                  collapsedProjectRailMode={collapsedProjectRailMode}
                  onCollapsedProjectRailModeChange={setCollapsedProjectRailMode}
                />
              ) : null}
              <div className="flex h-8 min-w-0 shrink-0 items-center border-t border-stroke">
                {searchViewOpen ||
                inboxViewOpen ||
                notesViewOpen ||
                automationsViewOpen ||
                settingsOpen ? null : (
                  <UsageFooter
                    embedded
                    providers={usageProviders}
                    session={usageSession}
                    project={active?.cwd ?? projectCwd}
                    onSelectAccount={onSelectProviderAccount}
                    onManageAccounts={() => openSettings("providers", "provider-accounts")}
                    terminals={runningTerminals}
                    terminalOpen={runningTerminalOpen}
                    onToggleTerminal={onToggleRunningTerminal}
                    onNewTerminal={isLocalProject(projectCwd) ? onNewTerminal : undefined}
                    onShowTerminal={isLocalProject(projectCwd) ? onShowProjectTerminal : undefined}
                    projectTerminalActive={
                      !!currentProjectDock && currentProjectDock.pane.files.length > 0
                    }
                    projectTerminalVisible={dockVisible}
                    tools={conversationTools ? { ...conversationTools, onOpenFile } : undefined}
                  />
                )}
                <WorkspaceControls
                  canRefresh={
                    inboxViewOpen ||
                    (settingsOpen
                      ? settingsSection === "usage"
                      : !searchViewOpen && !notesViewOpen && !automationsViewOpen)
                  }
                  onSettings={onOpenSettings}
                  onPullRequests={() => {
                    onOpenInbox();
                    setPullRequestsOnly(true);
                  }}
                  onUsage={() => openSettings("usage")}
                  active={
                    settingsOpen
                      ? settingsSection === "usage"
                        ? "usage"
                        : "settings"
                      : inboxViewOpen && pullRequestsOnly
                        ? "pullRequests"
                        : undefined
                  }
                />
                <div className="flex shrink-0 items-center pe-2">
                  <ApprovalToasts
                    notices={pendingNotifications}
                    popupNotices={hiddenApprovalToasts}
                    topOffset={
                      48 +
                      (reminderNoticesHeight ? reminderNoticesHeight + 8 : 0) +
                      (harnessUpdateHeight ? harnessUpdateHeight + 8 : 0)
                    }
                    onFocusSession={onOpenApprovalSession}
                    onApproval={onApproval}
                  />
                </div>
              </div>
            </div>
          </div>

          {filePickerOpen ? (
            <FilePicker
              key={filePickerResetToken}
              open
              cwd={filesCwd}
              openPaths={openFilePaths}
              initialQuery={filePickerInitialQuery}
              stopBackgroundWork={
                !!active &&
                canStopHarnessBackgroundWork(active.harness) &&
                sessionHasBackgroundWork(active)
              }
              arrangeLayout={Boolean(activeTab)}
              onOpenFile={onOpenFile}
              onRunAction={(id) => {
                const layoutPreset = id.startsWith(LAYOUT_ACTION_PREFIX)
                  ? (id.slice(LAYOUT_ACTION_PREFIX.length) as LayoutPreset)
                  : null;
                if (layoutPreset) onArrangeActiveTab(layoutPreset);
                else if (id === "reload") actions.current.onReload();
                else if (id === "stop-background" && active) {
                  void stopHarnessBackgroundWork(active.harness, active.id).catch(console.error);
                } else if (id === "reconnect-remote") {
                  const remote = remoteProjectFor(filesCwd);
                  if (remote)
                    void reconnectRemoteMachine(remote.environmentId, {
                      signIn: true,
                    });
                } else if (id === "toggle-notes" && loadNotesEnabled()) toggleNotesPanel();
              }}
              onClose={() => setFilePickerOpen(false)}
            />
          ) : null}

          {recoveryOpen && sessionRecovery ? (
            <SessionRecoveryPanel
              recovery={sessionRecovery}
              sessions={sessions}
              remoteSessions={listedRemoteSessions}
              onClose={closeRecovery}
              onOpen={openRecoveredSessions}
              onRemove={removeRecoveredSessions}
            />
          ) : null}
          {sessionDeleteDialog && (
            <DeleteSessionDialog
              title={sessionDeleteDialog.title}
              unusedWorktree={sessionDeleteDialog.unusedWorktree}
              onClose={(choice) => {
                sessionDeleteDialog.resolve(choice);
                setSessionDeleteDialog(undefined);
              }}
            />
          )}
          <HarnessUpdateNotice
            topOffset={12 + (reminderNoticesHeight ? reminderNoticesHeight + 8 : 0)}
            onHeightChange={setHarnessUpdateHeight}
          />
          <ReminderNotices
            reminders={sessionReminders.due}
            error={sessionReminders.error}
            onOpen={sessionReminders.open}
            onSnooze={sessionReminders.schedule}
            onDismiss={sessionReminders.cancel}
            onRetry={sessionReminders.refresh}
            onOpenSettings={() => openSettings("notifications", "notifications")}
            onHeightChange={setReminderNoticesHeight}
          />
          <SyncMergedNotice />
          {resumePickerFor ? (
            <ClaudeSessionPicker
              cwd={resumePickerFor.cwd}
              providerAccountId={resumePickerFor.providerAccountId}
              onClose={() => setResumePickerFor(null)}
              onPick={(summary) => {
                void importClaudeConversation(resumePickerFor, summary);
                setResumePickerFor(null);
              }}
            />
          ) : null}
          {whatsNewVersion ? (
            <WhatsNewDialog version={whatsNewVersion} onClose={() => setWhatsNewVersion(null)} />
          ) : null}
          <GitFileInspector onOpenCommit={onOpenCommit} />
          <SessionImportHost onImported={onSessionsImported} />
          <OnboardingHost
            context={{
              projects: recents.length,
              sessions: bootHistory.length,
              restored: !!resumed,
              transferred: !!windowTransfer || !!toolWindow,
            }}
            onImported={onSessionsImported}
            onOpenProject={onSelectProject}
          />
          {remoteProjectDialogOpen ? (
            <AddRemoteProjectDialog
              onCancel={() => setRemoteProjectDialogOpen(false)}
              onOpen={(key) => {
                setRemoteProjectDialogOpen(false);
                onSelectProject(key);
              }}
            />
          ) : null}
          {nameConflicts[0] ? (
            <ProjectNameConflictDialog
              key={nameConflicts[0].path}
              name={nameConflicts[0].name}
              path={remoteProjectFor(nameConflicts[0].path)?.cwd ?? nameConflicts[0].path}
              suggested={nameConflicts[0].suggested}
              validate={(name) => projectNameError(nameConflicts[0].path, name)}
              onConfirm={(name) => {
                saveTabGroupLabel(projectKey(nameConflicts[0].path), name);
                setNameConflicts((prev) => prev.slice(1));
              }}
              onCancel={() => setNameConflicts((prev) => prev.slice(1))}
            />
          ) : null}
          {providerAccountRecovery ? (
            <ProviderAccountRecoveryDialog
              key={providerAccountRecovery.sessionId}
              provider={providerAccountRecovery.provider}
              onSelect={(accountId) =>
                onSwitchSessionAccount(
                  providerAccountRecovery.sessionId,
                  providerAccountRecovery.provider,
                  accountId,
                )
              }
              onClose={() => setProviderAccountRecovery(null)}
              onManage={() => {
                setProviderAccountRecovery(null);
                openSettings("providers", "provider-accounts");
              }}
            />
          ) : null}
          {providerSignInRequest ? (
            <ProviderSignInDialog
              key={providerSignInRequest.key}
              harness={providerSignInRequest.harness}
              accountId={providerSignInRequest.accountId}
              onSignedIn={() => {
                const { harness, accountId } = providerSignInRequest;
                if (!accountId || !supportsProviderAccounts(harness)) return;
                clearCachedRateLimits(harness, accountId);
                void loadRateLimits(harness, accountId, true);
              }}
              onClose={() => setProviderSignInRequest(null)}
            />
          ) : null}
        </div>
        <TranscriptPoolOutlet pool={transcriptPool} />
      </OrchestrationWorkers.Provider>
    </OrchestrationActions.Provider>
  );
}
function conversationTitle(session: Session): string {
  const hostId = isRemoteProjectPath(session.cwd) ? remoteSessionFor(session.id) : undefined;
  const remote = hostId ? cachedRemoteSessionSummary(session.cwd, hostId) : undefined;
  const title = sessionDisplayTitle(
    remote?.title ?? session.title,
    remote?.harness ?? session.harness,
  );
  return title === "New session" ? "" : title;
}

function lastUserBlockId(session: Session): string | undefined {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    if (session.blocks[i]?.role === "user") return session.blocks[i]?.id;
  }
  return undefined;
}

function providerSignInRequestKey(session: Session): string {
  const lastBlockId = session.blocks[session.blocks.length - 1]?.id;
  return `${session.id}:${lastUserBlockId(session) ?? lastBlockId ?? "auth"}`;
}

function selectedChangePath(tab: WorkspaceTab, gitCwd?: string): string | undefined {
  const file = focusedFileTab(tab);
  if (!file || !isFilesystemTab(file) || !file.review) return undefined;
  return displayPath(file.path, gitCwd || file.cwd);
}

function selectedChangeKind(tab: WorkspaceTab): GitFileDiffKind | undefined {
  const file = focusedFileTab(tab);
  return file?.review ? file.changeKind : undefined;
}

function selectedCommitSha(tab: WorkspaceTab): string | undefined {
  const focused = focusedFileTab(tab);
  if (focused && isCommitTab(focused)) return focused.commit.sha;
  for (const pane of tab.editorPanes) {
    const file = pane.files.find((entry) => entry.id === pane.activeFileId);
    if (file && isCommitTab(file)) return file.commit.sha;
  }
}

/** Search reads message text, so it subscribes to the live sessions itself. */
function LiveSearchView({
  lockSnapshot,
  ...props
}: Omit<ComponentProps<typeof SearchView>, "sessions"> & {
  lockSnapshot: ReturnType<typeof useLockSnapshot>;
}) {
  useLocale();
  const live = useLiveSessions();
  const sessions = useMemo(
    () =>
      live.filter((session) => !session.inboxAsk && !isProjectLockedIn(lockSnapshot, session.cwd)),
    [live, lockSnapshot],
  );
  return <SearchView {...props} sessions={sessions} />;
}

function isBlankWorkspaceTab(tab: WorkspaceTab, sessions: Session[]): boolean {
  if (tab.editorPanes.some((pane) => pane.files.length > 0)) return false;
  if ((tab.terminalPanes ?? []).some((pane) => pane.files.length > 0)) return false;
  const ids = leafIds(tab.layout);
  if (ids.length !== 1) return false;
  if (remoteSessionFor(ids[0]) || remotePendingWorktree(ids[0])) return false;
  return isBlankSession(sessions.find((entry) => entry.id === ids[0]));
}

function toTitleTab(
  tab: WorkspaceTab,
  sessions: Session[],
  dirtyFiles: Set<string>,
  unseenFinishedIds: ReadonlySet<string>,
  pendingWindowMove = false,
): TitleTab {
  const paneIds = leafIds(tab.layout);
  const multiPane = paneIds.length > 1;
  const tabSessions = paneIds
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is Session => session != null);
  const sessionFocused = tabSessions.some((session) => session.id === tab.focusedId);
  const fileFocused =
    !sessionFocused &&
    (tab.editorPanes.some((pane) => pane.id === tab.focusedId) ||
      (tab.terminalPanes ?? []).some((pane) => pane.id === tab.focusedId));
  const focused = sessions.find((session) => session.id === tab.focusedId) ?? tabSessions[0];

  const seen = new Set<HarnessId>();
  const harnesses: HarnessId[] = [];
  const busySeen = new Set<HarnessId>();
  const busyHarnesses: HarnessId[] = [];
  const doneSeen = new Set<HarnessId>();
  const doneHarnesses: HarnessId[] = [];
  const ordered = focused
    ? [focused, ...tabSessions.filter((session) => session.id !== focused.id)]
    : tabSessions;
  for (const session of ordered) {
    if (session.busy && !sessionNeedsInput(session) && !busySeen.has(session.harness)) {
      busySeen.add(session.harness);
      busyHarnesses.push(session.harness);
    }
    if (unseenFinishedIds.has(session.id) && !doneSeen.has(session.harness)) {
      doneSeen.add(session.harness);
      doneHarnesses.push(session.harness);
    }
    if (seen.has(session.harness)) continue;
    seen.add(session.harness);
    harnesses.push(session.harness);
  }

  const files: string[] = [];
  const seenKeys = new Set<string>();
  const pushFile = (file: FilePaneTab) => {
    const key = file.terminal
      ? `terminal:${file.id}`
      : file.plan
        ? `plan:${file.plan.blockId}`
        : file.releaseNotes
          ? `release-notes:${file.releaseNotes.version}`
          : file.path;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    files.push(
      file.plan?.title?.trim() ||
        (file.releaseNotes
          ? releaseNotesTitle(file.releaseNotes.version)
          : file.terminal
            ? terminalTabLabel(file)
            : basename(file.path)),
    );
  };
  const focusedPane =
    tab.editorPanes.find((pane) => pane.id === tab.focusedId) ??
    (tab.terminalPanes ?? []).find((pane) => pane.id === tab.focusedId);
  const otherPanes = [
    ...tab.editorPanes.filter((pane) => pane.id !== focusedPane?.id),
    ...(tab.terminalPanes ?? []).filter((pane) => pane.id !== focusedPane?.id),
  ];
  const panes = focusedPane ? [focusedPane, ...otherPanes] : otherPanes;
  for (const pane of panes) {
    const active = pane.files.find((file) => file.id === pane.activeFileId);
    if (active) pushFile(active);
  }
  for (const pane of panes) {
    for (const file of pane.files) pushFile(file);
  }

  const more = tabSessions
    .filter((session) => session.id !== focused?.id)
    .map(conversationTitle)
    .filter(Boolean);

  const hasTerminal = (tab.terminalPanes ?? []).some((pane) => pane.files.some(isTerminalTab));
  const focusedFile = focusedFileTab(tab);

  return {
    id: tab.id,
    project: focused
      ? projectName(focused.cwd)
      : focusedFile
        ? projectName(focusedFile.projectCwd ?? focusedFile.cwd)
        : "~",
    title: focused ? conversationTitle(focused) : "",
    more,
    sessionCount: tabSessions.length,
    focusedPaneId: tab.focusedId,
    paneIds: [...paneIds, ...filesInWorkspaceTabs([tab]).map((file) => file.id)],
    fileDragId:
      paneIds.length === 1 &&
      tab.editorPanes.length === 1 &&
      tab.editorPanes[0].files.length === 1 &&
      isFilesystemTab(tab.editorPanes[0].files[0])
        ? tab.editorPanes[0].files[0].id
        : undefined,
    harnesses,
    busyHarnesses,
    doneHarnesses,
    files,
    multiPane,
    fileFocused,
    blank: isBlankWorkspaceTab(tab, sessions),
    dirty: tab.editorPanes.some((pane) =>
      pane.files.some((file) => isFilesystemTab(file) && dirtyFiles.has(file.id)),
    ),
    terminal: hasTerminal && harnesses.length === 0,
    hasTerminal,
    pendingWindowMove: pendingWindowMove || undefined,
    previewFileId: previewWorkspaceFile(tab)?.id,
    groupId: tab.groupId,
  };
}

function dropOpenFiles(tab: WorkspaceTab, shouldDrop: (path: string) => boolean): WorkspaceTab {
  let layout = tab.layout;
  let focusedId = tab.focusedId;
  const editorPanes: EditorPane[] = [];
  for (const pane of tab.editorPanes) {
    const files = pane.files.filter((file) => !isFilesystemTab(file) || !shouldDrop(file.path));
    if (files.length === 0) {
      const sibling = siblingLeafId(layout, pane.id);
      const withoutPane = removePane(layout, pane.id);
      if (withoutPane) {
        layout = withoutPane;
        if (focusedId === pane.id) focusedId = sibling ?? firstLeafId(withoutPane);
      }
      continue;
    }
    editorPanes.push({
      ...pane,
      files,
      activeFileId: files.some((file) => file.id === pane.activeFileId)
        ? pane.activeFileId
        : files[0].id,
    });
  }
  return { ...tab, layout, focusedId, editorPanes };
}

function trackSessionEdits(sessionId: string, cwd: string, event: HarnessEvent) {
  if (event.type !== "tool.started" && event.type !== "tool.updated") return;
  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const paths = [
    ...(event.paths ?? []),
    ...(event.preview?.path ? [event.preview.path] : []),
  ].filter((path, index, all) => all.indexOf(path) === index);
  if (paths.length === 0 || cwd === "~") return;
  const completed =
    event.type === "tool.updated" && (event.status === "completed" || event.status === "success");
  if (!completed) {
    void prepareSessionCheckpoint(sessionId, cwd, paths).catch((error) => {
      console.warn("App operation failed", error);
    });
    return;
  }
  void captureSessionCheckpoint(sessionId, cwd, paths)
    .catch((error) => {
      console.warn("App operation failed", error);
    })
    .then(() => notifyReviewChanged(sessionId));
}

/** Keep synchronous subscriber ordering explicit for the two existing completion paths. */
function notifyFinishedWorkspace(
  sessionId: string,
  cwd: string,
  defer: (callback: () => void, delay: number) => void,
  order: "git-first" | "workspace-first",
) {
  notifyReviewChanged(sessionId);
  if (order === "git-first") {
    notifyGitChanged(cwd, "index");
    nudgeWorkspace(cwd);
  } else {
    nudgeWorkspace(cwd);
    notifyGitChanged(cwd, "index");
  }
  nudgeWatchedFiles();
  defer(() => nudgeWatchedFiles(), 150);
}

function nudgeWorkspace(cwd?: string) {
  invalidateProjectFiles(cwd);
  notifyDirsChanged();
}

function nudgeOpenEditors(
  event: HarnessEvent,
  cwd: string,
  defer: (callback: () => void, delay: number) => void,
) {
  if (event.type !== "tool.updated") return;
  const completed = event.status === "completed" || event.status === "success";

  const kind = event.kind?.trim().toLowerCase();
  if (kind === "execute" || event.preview?.kind === "shell") {
    if (!completed) return;
    nudgeWatchedFiles();
    defer(() => nudgeWatchedFiles(), 150);
    notifyGitChanged(cwd, "index");
    nudgeWorkspace(cwd);
    defer(() => nudgeWorkspace(cwd), 150);
    return;
  }

  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const resolved = [...(event.paths ?? []), ...(event.preview?.path ? [event.preview.path] : [])]
    .map((path) => resolveWorkspacePath(path, cwd) ?? path)
    .filter((path, index, paths) => paths.indexOf(path) === index);
  if (completed) {
    // A successful edit is authoritative. Reload it even if a startup race or
    // coarse filesystem timestamp makes the mtime appear unchanged.
    invalidateWatchedFiles(resolved.length > 0 ? resolved : undefined);
  } else if (resolved.length > 0) {
    nudgeWatchedFiles(resolved);
  }
  if (completed) {
    defer(() => nudgeWatchedFiles(resolved.length > 0 ? resolved : undefined), 150);
    notifyGitChanged(cwd, "index");
    nudgeWorkspace(cwd);
  }
}

function sameSettings(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}
