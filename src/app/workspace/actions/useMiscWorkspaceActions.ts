import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Session } from "../../../features/sessions/model/session";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import {
  findSurfacePane,
  leafIds,
  surfacePanes,
  withSurfacePanes,
} from "../../../features/workspace/model/layout";
import { orderByIds } from "../../../shared/lib/reorder";
import { planWorkspaceTabClose } from "../../../features/workspace/model/workspaceTabGroups";
import { remoteSessionFor } from "../../../features/connections/model/connections";
import { shouldToggleNotesPanel, toggleNotesPanel } from "../../../features/notes/notesPanel";
import { loadNotesEnabled } from "../../../features/settings/model/settings";
import type { SettingsSectionId } from "../../../features/settings/model/settings";
import { isRemoteProjectPath } from "../../../features/projects/model/recents";
import { requestSessionImport } from "../../../features/sessions/import/importModel";
import { sessionWorkCwd } from "../../../features/sessions/model/session";
import type { ClaudeImportTarget } from "../../../features/sessions/model/claudeSessionImport";
import type { useMoveTabsToNewWindow } from "../windows/useMoveTabsToNewWindow";

/** Closing a tab whose remote session was deleted on the host (keeps or closes per plan). */
export function useRemoteSessionDeleted(deps: {
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  tabCloseScope: Parameters<typeof planWorkspaceTabClose>[0]["scope"];
  tabWorktreeOf: Parameters<typeof planWorkspaceTabClose>[0]["worktreeOf"];
  onClearTabSession: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}): { onRemoteSessionDeleted: (remoteSessionId: string) => void } {
  const { tabsRef, sessionsRef, tabCloseScope, tabWorktreeOf, onClearTabSession, onCloseTab } =
    deps;

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

  return { onRemoteSessionDeleted };
}

/** Activates the tab in a numbered slot of the project's deck (negative slot = last tab). */
export function useTabSlotActions(deps: {
  activateTab: (tabId: string) => void;
  deckProjectTabs: WorkspaceTab[];
}): { onActivate: (slot: number) => void } {
  const { activateTab, deckProjectTabs } = deps;

  const onActivate = useCallback(
    (slot: number) => {
      const tab = slot < 0 ? deckProjectTabs[deckProjectTabs.length - 1] : deckProjectTabs[slot];
      if (tab) activateTab(tab.id);
    },
    [activateTab, deckProjectTabs],
  );

  return { onActivate };
}

/** Reorders the files of one editor pane. */
export function usePaneFileOrder(deps: {
  isMovingPane: (paneId: string) => boolean;
  setTabs: (update: (prev: WorkspaceTab[]) => WorkspaceTab[]) => void;
}): { onReorderFiles: (paneId: string, ids: string[]) => void } {
  const { isMovingPane, setTabs } = deps;

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

  return { onReorderFiles };
}

/** Editor error counts per file. */
export function useFileErrorCounts(deps: {
  setFileErrorCounts: Dispatch<SetStateAction<Map<string, number>>>;
}): { onFileErrorCountChange: (fileId: string, count: number) => void } {
  const { setFileErrorCounts } = deps;

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

  return { onFileErrorCountChange };
}

/** Keyboard toggle of the notes panel, gated by the current surface and focus. */
export function useNotesPanelToggle(deps: {
  activeTabIdRef: MutableRefObject<Parameters<typeof shouldToggleNotesPanel>[0]["activeTabId"]>;
  tabsRef: MutableRefObject<Parameters<typeof shouldToggleNotesPanel>[0]["tabs"]>;
  sessionsRef: MutableRefObject<Parameters<typeof shouldToggleNotesPanel>[0]["sessions"]>;
  projectTerminalFocusedRef: MutableRefObject<boolean>;
  searchViewOpenRef: MutableRefObject<boolean>;
  inboxViewOpenRef: MutableRefObject<boolean>;
  notesViewOpenRef: MutableRefObject<boolean>;
  automationsViewOpenRef: MutableRefObject<boolean>;
  serversViewOpenRef?: MutableRefObject<boolean>;
  settingsOpenRef: MutableRefObject<boolean>;
  filePickerOpenRef: MutableRefObject<boolean>;
  whatsNewVersionRef: MutableRefObject<string | null>;
}): { onToggleNotesPanel: (event: KeyboardEvent) => void } {
  const {
    activeTabIdRef,
    tabsRef,
    sessionsRef,
    projectTerminalFocusedRef,
    searchViewOpenRef,
    inboxViewOpenRef,
    notesViewOpenRef,
    automationsViewOpenRef,
    serversViewOpenRef,
    settingsOpenRef,
    filePickerOpenRef,
    whatsNewVersionRef,
  } = deps;

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
          serversViewOpenRef?.current ||
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

  return { onToggleNotesPanel };
}

/** Resumes a session in its provider: codex imports, claude opens the resume picker. */
export function useResumeProviderSession(deps: {
  sessionsRef: MutableRefObject<Session[]>;
  turnGen: MutableRefObject<Map<string, number>>;
  setResumePickerFor: Dispatch<SetStateAction<ClaudeImportTarget | null>>;
}): { onResumeProviderSession: (sessionId: string) => void } {
  const { sessionsRef, turnGen, setResumePickerFor } = deps;

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

  return { onResumeProviderSession };
}

/** Moves one tab into a new window through the multi-window transfer hook. */
export function useMoveTabToNewWindow(deps: {
  onMoveTabsToNewWindow: ReturnType<typeof useMoveTabsToNewWindow>["onMoveTabsToNewWindow"];
}): {
  onMoveTabToNewWindow: (
    tabId: string,
    opts?: Parameters<ReturnType<typeof useMoveTabsToNewWindow>["onMoveTabsToNewWindow"]>[1],
  ) => void;
} {
  const { onMoveTabsToNewWindow } = deps;

  const onMoveTabToNewWindow = useCallback(
    (tabId: string, opts?: Parameters<typeof onMoveTabsToNewWindow>[1]) =>
      void onMoveTabsToNewWindow([tabId], opts),
    [onMoveTabsToNewWindow],
  );

  return { onMoveTabToNewWindow };
}

/** Opens an archived session from the history list in the main pane. */
export function useOpenArchivedSession(deps: {
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  onSelectHistorySession: (sessionId: string) => Promise<unknown>;
}): { onOpenArchivedSession: (sessionId: string) => void } {
  const { setSettingsOpen, onSelectHistorySession } = deps;

  const onOpenArchivedSession = useCallback(
    (sessionId: string) => {
      setSettingsOpen(false);
      void onSelectHistorySession(sessionId);
    },
    [onSelectHistorySession],
  );

  return { onOpenArchivedSession };
}

/** Opens the worktrees settings section. */
export function useManageWorktrees(deps: { openSettings: (section?: SettingsSectionId) => void }): {
  onManageWorktrees: () => void;
} {
  const { openSettings } = deps;

  const onManageWorktrees = useCallback(() => openSettings("worktrees"), [openSettings]);

  return { onManageWorktrees };
}
