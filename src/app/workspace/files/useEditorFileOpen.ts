import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import { loadFileTabMode } from "../../../features/settings/model/settings";
import { planTitle } from "../../../features/sessions/model/plan";
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
import { isLocalDirectory, openPathWithDefaultApp } from "../../../platform/tauri/fs";
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
    ...args: [
      ...Parameters<OpenFileFn>,
      checkout?: { cwd: string; projectCwd: string; external?: boolean },
    ]
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

  const openRequest = useRef(0);
  const lastOpenedLocation = useRef<{
    request: number;
    origin: string;
    tab: string;
    focus?: string;
  } | null>(null);
  const onOpenFile = useCallback<
    (
      ...args: [
        ...Parameters<OpenFileFn>,
        checkout?: { cwd: string; projectCwd: string; external?: boolean },
      ]
    ) => void
  >(
    (path, navigation, options, checkout) => {
      const request = ++openRequest.current;
      const originTabId = activeTabIdRef.current;
      const originProject = sidebarCwdRef.current;
      const originTab = tabsRef.current.find((entry) => entry.id === originTabId);
      const originFocus = originTab?.focusedId;
      void (async () => {
        const fileCwd = checkout?.cwd ?? gitCwdRef.current;
        const fileProjectCwd = checkout?.projectCwd ?? sidebarCwdRef.current;
        const resolved = await resolveFileOpenRequest(fileCwd, path, options);
        // A folder has nothing to show in an editor tab: hand it to the
        // system's file manager instead.
        // Native external drops have already checked this path. A second IPC
        // round trip delays the tab without adding another validation.
        if (!checkout?.external && (await isLocalDirectory(resolved))) {
          void openPathWithDefaultApp(resolved).catch((error) => {
            console.error("Failed to open folder:", error);
          });
          return;
        }
        // Older pinned requests in one batch still belong to the original pane,
        // even when the latest request already activated its destination.
        const latest = lastOpenedLocation.current;
        const followsBatchOpen =
          !!options?.pin &&
          latest?.origin === originTabId &&
          latest.request > request &&
          activeTabIdRef.current === latest.tab &&
          tabsRef.current.find((entry) => entry.id === latest.tab)?.focusedId === latest.focus;
        // Ignore superseded navigation and requests whose origin has disappeared.
        if (
          (!options?.pin && request !== openRequest.current) ||
          (activeTabIdRef.current !== originTabId && !followsBatchOpen) ||
          sidebarCwdRef.current !== originProject
        )
          return;
        const tab = tabsRef.current.find((entry) => entry.id === originTabId);
        if (originTab && (!tab || (tab.focusedId !== originFocus && !followsBatchOpen))) return;
        rememberOpenedFile(fileCwd, resolved);
        const file = {
          ...newFileTab(resolved, fileCwd, false, undefined, fileProjectCwd),
          ...(checkout?.external ? { external: true } : {}),
        };
        const pin = !!options?.pin;
        const foreground = request === openRequest.current;
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
              return foreground ? result.tabs : preserveOpenFocus(prev, result.tabs);
            });
          });
          if (!foreground) return;
          if (target?.paneId) activateTab(target.tabId, target.paneId);
          else if (target) setActiveTabId(target.tabId);
          if (target) {
            const tabId = target.tabId;
            lastOpenedLocation.current = {
              request,
              origin: originTabId,
              tab: tabId,
              focus: tabsRef.current.find((entry) => entry.id === tabId)?.focusedId,
            };
          }
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
        flushSync(() =>
          setTabs((prev) =>
            prev.map((entry) => {
              if (entry.id !== tab.id) return entry;
              const focusedSession = sessionsRef.current.find(
                (session) => session.id === entry.focusedId,
              );
              const opened = openEditorTab(entry, file, {
                split: focusedSession?.blocks.length === 0 ? "left" : "right",
                pin,
              });
              return foreground
                ? opened
                : {
                    ...opened,
                    focusedId: entry.focusedId,
                    editorPanes: opened.editorPanes.map((pane) => {
                      const previous = entry.editorPanes.find((old) => old.id === pane.id);
                      return previous ? { ...pane, activeFileId: previous.activeFileId } : pane;
                    }),
                  };
            }),
          ),
        );
        if (!foreground) return;
        lastOpenedLocation.current = {
          request,
          origin: originTabId,
          tab: tab.id,
          focus: tabsRef.current.find((entry) => entry.id === tab.id)?.focusedId,
        };
        if (navigation) {
          editorNavigationToken.current += 1;
          setEditorNavigation({
            path: resolved,
            ...navigation,
            token: editorNavigationToken.current,
          });
        }
        setComposerFocused(false);
      })().catch((error) => console.error("Failed to open file:", error));
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

function preserveOpenFocus(previous: WorkspaceTab[], next: WorkspaceTab[]): WorkspaceTab[] {
  return next.map((tab) => {
    const old = previous.find((entry) => entry.id === tab.id);
    if (!old) return tab;
    return {
      ...tab,
      focusedId: old.focusedId,
      editorPanes: tab.editorPanes.map((pane) => {
        const prior = old.editorPanes.find((entry) => entry.id === pane.id);
        return prior ? { ...pane, activeFileId: prior.activeFileId } : pane;
      }),
    };
  });
}
