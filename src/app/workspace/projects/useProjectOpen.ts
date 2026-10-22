import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import type { Session } from "../../../features/sessions/model/session";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import {
  loadRecents,
  newProjectPaths,
  rememberProject,
} from "../../../features/projects/model/recents";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import { knownRemoteMachine } from "../../../features/connections/model/connections";
import {
  autoNameOnConflict,
  type AutoNamedProject,
} from "../../../features/projects/model/projectNames";
import {
  planProjectOpenRun,
  type ProjectOpenStep,
} from "../../../features/projects/model/projectOpenRun";
import { pickFolders } from "../../../platform/tauri/fs";
import { openSyncedProjectRemotely } from "../../../features/sync/model/syncRemoteProjects";
import type { TabActivation } from "../tabs/useTabActivation";

export interface ProjectOpenDeps {
  readProjectReturnMemory: () => Parameters<typeof planProjectOpenRun>[0]["memory"];
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: { current: Session[] };
  activeTabIdRef: MutableRefObject<string>;
  setSearchViewOpen: Dispatch<SetStateAction<boolean>>;
  setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
  setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
  setAutomationsViewOpen: Dispatch<SetStateAction<boolean>>;
  setServersViewOpen?: Dispatch<SetStateAction<boolean>>;
  onCwdChange: (sessionId: string, cwd: string) => void;
  setSessions: typeof setSessions;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  insertBeside: TabActivation["insertBeside"];
  setProjectCwd: Dispatch<SetStateAction<string>>;
  activateTab: TabActivation["activateTab"];
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setRecents: Dispatch<SetStateAction<ReturnType<typeof rememberProject>>>;
  workspaceNavigation: { cancel: () => void; selectProject: (path: string) => void };
}

/** Opening folders as projects: the open run, selecting a project, picking folders, and synced projects. */
export function useProjectOpen({
  readProjectReturnMemory,
  tabsRef,
  sessionsRef,
  activeTabIdRef,
  setSearchViewOpen,
  setInboxViewOpen,
  setNotesViewOpen,
  setAutomationsViewOpen,
  setServersViewOpen,
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
}: ProjectOpenDeps) {
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
      setServersViewOpen?.(false);

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

  return {
    nameConflicts,
    setNameConflicts,
    promptAddedProjectNames,
    openProjects,
    onSelectProject,
    pickProject,
    openSyncedProject,
  };
}
