import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { confirmCloseTerminals } from "../../../features/terminal/model/terminalClose";
import {
  closeSurfacePanes,
  isFilesystemTab,
  leafIds,
  resetTabToSession,
  type FilePaneTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import {
  planWorkspaceTabClose,
  type WorkspaceTabCloseScope,
} from "../../../features/workspace/model/workspaceTabGroups";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { confirmWorkspaceClose } from "../../model/closeConfirmation";
import { confirmDiscardUnsaved } from "../helpers/appHelpers";
import { t } from "../../../shared/i18n";
import { sameTabIdentity, type useCloseTabActions } from "./useCloseTabActions";

export interface CloseAllTabsDeps {
  onCloseTab: ReturnType<typeof useCloseTabActions>["onCloseTab"];
  onCloseTabs: ReturnType<typeof useCloseTabActions>["onCloseTabs"];
  onClearTabSession: (id: string) => void;
  projectCwd: string;
  tabCloseScope: WorkspaceTabCloseScope;
  tabWorktreeOf: (tab: WorkspaceTab) => string | null;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  activeTabIdRef: MutableRefObject<string>;
  windowTransferPendingRef: MutableRefObject<boolean>;
  dirtyFilesRef: MutableRefObject<Set<string>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
}

const editorFilesOf = (tab: WorkspaceTab) => tab.editorPanes.flatMap((pane) => pane.files);
const filesOf = (tab: WorkspaceTab) => [
  ...editorFilesOf(tab),
  ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
];

/** Ctrl-style "close all": closes open editor files first, then every other tab. */
export function useCloseAllTabs({
  onCloseTab,
  onCloseTabs,
  onClearTabSession,
  projectCwd,
  tabCloseScope,
  tabWorktreeOf,
  tabsRef,
  sessionsRef,
  activeTabIdRef,
  windowTransferPendingRef,
  dirtyFilesRef,
  setDirtyFiles,
  setTabs,
  setSessions,
  setComposerFocused,
}: CloseAllTabsDeps) {
  // The confirmation dialogs outlive the render that started the command, so
  // the continuation must call the latest callbacks, not the captured ones.
  const latestActions = useRef({ onCloseTabs, onClearTabSession });
  latestActions.current = { onCloseTabs, onClearTabSession };

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
    // Every await invalidates the workspace snapshot, so state is read again
    // after each confirmation and only what the user approved is closed.
    const approvedDirty = new Set<string>();
    const approvedTerminals = new Set<string>();
    const unsavedOf = (files: FilePaneTab[]) =>
      files.filter(
        (file) =>
          isFilesystemTab(file) &&
          dirtyFilesRef.current.has(file.id) &&
          !approvedDirty.has(file.id),
      );
    const terminalsOf = (files: FilePaneTab[]) =>
      files.filter((file) => file.terminal && !approvedTerminals.has(file.id));

    // Stage one: files open in the active tab's editor panes close first.
    // Only when none are open does the command close every workspace tab.
    if (editorFilesOf(tab).length > 0) {
      if (!closeSurfacePanes(tab, "editor")) {
        const closePlan = planWorkspaceTabClose({
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          closingTabId: tab.id,
          scope: tabCloseScope,
          worktreeOf: tabWorktreeOf,
          activeCwd: projectCwd,
        });
        if (closePlan.action === "close") {
          onCloseTab(tab.id);
          return;
        }
      }

      const readEditorState = () => {
        if (windowTransferPendingRef.current) return;
        const current = tabsRef.current.find((entry) => entry.id === tab.id);
        if (!current) return;
        const files = editorFilesOf(current);
        if (files.length === 0) return;
        return { current, files, unsaved: unsavedOf(files) };
      };

      void (async () => {
        let state;
        while ((state = readEditorState()) && state.unsaved.length > 0) {
          const files = state.unsaved;
          const ok = await confirmDiscardUnsaved({
            title: t("Close all open files without saving?"),
            confirmLabel: t("Discard and close"),
            files,
          });
          if (!ok) return;
          for (const file of files) approvedDirty.add(file.id);
        }
        if (!state) return;

        const { current, files } = state;
        const remaining = closeSurfacePanes(current, "editor");
        // The tab held only editor panes and must stay: seed a session.
        const seeded = remaining
          ? undefined
          : seedSession(files[0].projectCwd || files[0].cwd || projectCwd);
        if (seeded) setSessions((prev) => [...prev, seeded]);
        // shortcut: only a change landing in the same tick as this commit can
        // slip past the check above; the updater still keeps unapproved files.
        setTabs((prev) =>
          prev.map((entry) => {
            if (entry.id !== tab.id || unsavedOf(editorFilesOf(entry)).length > 0) return entry;
            const next = closeSurfacePanes(entry, "editor");
            if (next) return next;
            return seeded ? resetTabToSession(entry, seeded.id) : entry;
          }),
        );
        setDirtyFiles((prev) => {
          const updated = new Set(prev);
          for (const file of files) updated.delete(file.id);
          return updated;
        });
        setComposerFocused(
          remaining
            ? sessionsRef.current.some((session) => session.id === remaining.focusedId)
            : true,
        );
      })().catch(console.error);
      return;
    }

    // Stage two: the workspace always keeps one tab, so close every other
    // tab and reset the active one to a blank session. Every confirmation
    // runs before any tab changes, so a cancelled prompt leaves all tabs.
    // Tabs opened during a prompt were never offered to the user: they stay.
    const targets = tabsRef.current.filter((entry) => entry.id !== tab.id);
    const readWorkspaceState = () => {
      if (windowTransferPendingRef.current) return;
      const active = tabsRef.current.find((entry) => entry.id === tab.id);
      if (!active) return;
      // A tab whose id or hosted sessions changed is a different tab now.
      const closing = tabsRef.current.filter((entry) =>
        targets.some((target) => sameTabIdentity(target, entry)),
      );
      const files = [...closing.flatMap(filesOf), ...filesOf(active)];
      return {
        active,
        closingIds: closing.map((entry) => entry.id),
        terminalFiles: (active.terminalPanes ?? []).flatMap((pane) => pane.files),
        unsaved: unsavedOf(files),
        terminals: terminalsOf(files),
      };
    };

    void (async () => {
      let state;
      while (
        (state = readWorkspaceState()) &&
        (state.unsaved.length > 0 || state.terminals.length > 0)
      ) {
        const { unsaved, terminals } = state;
        if (
          !(await confirmWorkspaceClose(
            unsaved.length > 0
              ? () =>
                  confirmDiscardUnsaved({
                    title: t("Close all tabs with unsaved files?"),
                    confirmLabel: t("Discard and close"),
                    files: unsaved,
                  })
              : undefined,
            terminals.length > 0 ? () => confirmCloseTerminals(terminals) : undefined,
          ))
        )
          return;
        for (const file of unsaved) approvedDirty.add(file.id);
        for (const file of terminals) approvedTerminals.add(file.id);
      }
      if (!state) return;

      if (state.closingIds.length > 0) {
        latestActions.current.onCloseTabs(state.closingIds, tab.id, { confirmed: true });
      }
      const hasSession = leafIds(state.active.layout).some((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      if (hasSession) {
        // No editor files remain, so this commits without a prompt.
        latestActions.current.onClearTabSession(tab.id);
        return;
      }
      // The tab held no session: seed one so the workspace stays usable.
      const { terminalFiles } = state;
      const session = seedSession(
        terminalFiles[0]?.projectCwd || terminalFiles[0]?.cwd || projectCwd,
      );
      setSessions((prev) => [...prev, session]);
      setTabs((prev) =>
        prev.map((entry) => (entry.id === tab.id ? resetTabToSession(entry, session.id) : entry)),
      );
      setComposerFocused(true);
    })().catch(console.error);
  }, [
    onCloseTab,
    projectCwd,
    tabCloseScope,
    tabsRef,
    sessionsRef,
    setTabs,
    tabWorktreeOf,
    setDirtyFiles,
    dirtyFilesRef,
    setSessions,
    activeTabIdRef,
    windowTransferPendingRef,
    setComposerFocused,
  ]);

  return { onCloseAllTabs };
}
