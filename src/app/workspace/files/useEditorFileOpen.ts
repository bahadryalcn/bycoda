import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import { loadFileTabMode } from "../../../features/settings/model/settings";
import { planTitle } from "../../../features/sessions/model/plan";
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
import {
  isLocalDirectory,
  openPathWithDefaultApp,
} from "../../../platform/tauri/fs";
import {
  newEditorWorkspaceTab,
  newFileTab,
  newPlanTab,
  openEditorTab,
  openWorkspaceFile,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import {
  rememberOpenedFile,
  resolveFileOpenRequest,
} from "../../../features/files/model/fileIndex";
import type { EditorNavigationTarget, OpenFileFn } from "../../../features/search/model/search";
import { useExternalFileDrop } from "./useExternalFileDrop";

export interface EditorFileOpenDeps {
  activeTabId: string;
  activateTab: (tabId: string, paneId?: string) => void;
  insertBesideActive: (prev: WorkspaceTab[], tab: WorkspaceTab, cwd?: string) => WorkspaceTab[];
  gitCwdRef: MutableRefObject<string>;
  sidebarCwdRef: MutableRefObject<string>;
  activeTabIdRef: MutableRefObject<string>;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setActiveTabId: (id: string) => void;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setEditorNavigation: Dispatch<SetStateAction<EditorNavigationTarget | null>>;
  editorNavigationToken: MutableRefObject<number>;
}

export interface EditorFileOpen {
  onOpenFile: (
    ...args: [...Parameters<OpenFileFn>, checkout?: { cwd: string; projectCwd: string; external?: boolean }]
  ) => void;
  onOpenPlan: (sessionId: string, blockId: string) => void;
}

/** Opens files and plans in the editor, either in the active tab or in a workspace file tab. */
export function useEditorFileOpen(deps: EditorFileOpenDeps): EditorFileOpen {
  const {
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
  } = deps;

  const onOpenFile = useCallback<
    (...args: [...Parameters<OpenFileFn>, checkout?: { cwd: string; projectCwd: string; external?: boolean }]) => void
  >(
    (path, navigation, options, checkout) => {
      void (async () => {
        const fileCwd = checkout?.cwd ?? gitCwdRef.current;
        const fileProjectCwd = checkout?.projectCwd ?? sidebarCwdRef.current;
        const resolved = await resolveFileOpenRequest(fileCwd, path, options);
        // A folder has nothing to show in an editor tab: hand it to the
        // system's file manager instead.
        // Native external drops have already checked this path. A second IPC
        // round trip delays the tab without adding another validation.
        if (!checkout?.external && await isLocalDirectory(resolved)) {
          void openPathWithDefaultApp(resolved).catch((error) => {
            console.error("Failed to open folder:", error);
          });
          return;
        }
        rememberOpenedFile(fileCwd, resolved);
        const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current);
        const file = {
          ...newFileTab(resolved, fileCwd, false, undefined, fileProjectCwd),
          ...(checkout?.external ? { external: true } : {}),
        };
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
        if (!tab) return;
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

  useExternalFileDrop(onOpenFile);
  return { onOpenFile, onOpenPlan };
}
