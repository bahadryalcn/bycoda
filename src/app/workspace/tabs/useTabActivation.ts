import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  leafIds,
  selectPaneTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { insertTabBesideActive } from "../../../features/workspace/model/tabGroups";
import { focusedWorkspaceTabCwd } from "../../../features/workspace/model/workspaceTabGroups";
import {
  looksLikeProject,
  normalizeProjectPath,
  rememberProject,
  sameProjectPath,
} from "../../../features/projects/model/recents";
import { type Session } from "../../../features/sessions/model/session";
import { projectName } from "../../../shared/lib/paths";

export interface TabActivationDeps {
  projectCwdRef: MutableRefObject<string>;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setRecents: Dispatch<SetStateAction<ReturnType<typeof rememberProject>>>;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  activeTabIdRef: MutableRefObject<string>;
  setActiveTabIdState: Dispatch<SetStateAction<string>>;
  setActiveTabId: (id: string) => void;
  setTabs: (
    update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[]),
  ) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  projectOfTab: (id: string) => string | undefined;
}

export interface TabActivation {
  followProject: (cwd: string | null | undefined) => void;
  activateTab: (id: string, paneId?: string, reason?: "session" | "workspace") => void;
  insertBeside: (
    prev: WorkspaceTab[],
    tab: WorkspaceTab,
    anchorId: string | undefined,
    cwd?: string,
  ) => WorkspaceTab[];
  insertBesideActive: (prev: WorkspaceTab[], tab: WorkspaceTab, cwd?: string) => WorkspaceTab[];
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
}

/** Tab activation and insertion. Pure callbacks only; no effects. */
export function useTabActivation(deps: TabActivationDeps): TabActivation {
  const {
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
  } = deps;

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

  return { followProject, activateTab, insertBeside, insertBesideActive, appendTab };
}
