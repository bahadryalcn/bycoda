import { useCallback, useRef, useState } from "react";
import {
  loadProjectRailOpen,
  loadSessionSidebarOpen,
} from "../../../features/settings/model/appearance";
import type { EditorNavigationTarget } from "../../../features/search/model/search";
import type { WorktreeManagementRequest } from "../../../features/source-control/model/worktreeManagement";
import type { SessionSummary } from "../../../features/sessions/data/sessionStore";
import type { WindowTransferPayload } from "../../model/windowTransfer";
import type { ResumedWorkspace } from "../../model/appLifecycle";

export interface ComposerRailStateDeps {
  windowTransfer: WindowTransferPayload | null;
  resumed: ResumedWorkspace | null;
}

/** Composer focus, the project rail and session sidebar, and the tab -> project map. */
export function useComposerRailState({ windowTransfer, resumed }: ComposerRailStateDeps) {
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
  return {
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
  };
}

export interface WorkspaceUiStateDeps {
  windowTransfer: WindowTransferPayload | null;
  bootHistory: SessionSummary[];
}

/** Notification, worktree-management, editor, file-picker, dirty-file and history state. */
export function useWorkspaceUiState({ windowTransfer, bootHistory }: WorkspaceUiStateDeps) {
  const [notificationProjectPath, setNotificationProjectPath] = useState<string | null>(null);
  const [notificationSettingsRequest, setNotificationSettingsRequest] = useState(0);
  const [worktreeManagementRequest, setWorktreeManagementRequest] =
    useState<WorktreeManagementRequest | null>(null);
  const [worktreeManagementRevision, setWorktreeManagementRevision] = useState(0);
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
  return {
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
  };
}
