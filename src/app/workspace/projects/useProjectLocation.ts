import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import type { Session } from "../../../features/sessions/model/session";
import {
  rebaseProjectSessions,
  type SessionSummary,
} from "../../../features/sessions/data/sessionStore";
import { rebaseCiRepairs } from "../../../features/inbox/model/ciRepairTracking";
import {
  isLocalProject,
  normalizeProjectPath,
  replaceProjectPath,
  sameProjectPath,
  type RecentProject,
} from "../../../features/projects/model/recents";
import { rebaseProjectData } from "../../../features/projects/model/projectData";
import { synchronizeProjectLocation } from "../../../features/projects/model/projectLocation";
import { folderRenameError } from "../../../features/projects/model/projectFolderRename";
import { notifyDirsChanged } from "../../../features/files/model/fileTree";
import { renamePath } from "../../../platform/tauri/fs";
import { isEqualOrInside, pathKey } from "../../../shared/lib/paths";
import { t } from "../../../shared/i18n";
import type { SidebarTabId } from "../../../features/settings/model/appearance";
import type { ProjectTerminalDockState } from "../terminal/useProjectTerminalDockState";
import type { EditorFileEvents } from "../files/useEditorFileEvents";

/** Per-project sync handles, shared with the submit path that waits on a project's location sync. */
export function useProjectLocationSyncs() {
  const projectLocationSyncs = useRef(
    new Map<string, ReturnType<typeof synchronizeProjectLocation>>(),
  );
  return projectLocationSyncs;
}

export interface ProjectLocationChangeDeps {
  onFileMoved: EditorFileEvents["onFileMoved"];
  sessionsRef: { current: Session[] };
  loadedSessionCache: MutableRefObject<Map<string, Session>>;
  pendingPersist: MutableRefObject<Map<string, Session>>;
  setSessions: typeof setSessions;
  setHistory: Dispatch<SetStateAction<SessionSummary[]>>;
  setStoredLinkedSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setLoadedProjects: Dispatch<SetStateAction<ReadonlySet<string>>>;
  projectCwdRef: MutableRefObject<string>;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  projectTerminalsRef: ProjectTerminalDockState["projectTerminalsRef"];
  setProjectTerminals: ProjectTerminalDockState["setProjectTerminals"];
  setSidebarTabSelection: Dispatch<SetStateAction<{ project: string; tab: SidebarTabId }>>;
  setRecents: Dispatch<SetStateAction<RecentProject[]>>;
}

/** Rebases every stored path from one project location to another after a folder move. */
export function useProjectLocationChange({
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
}: ProjectLocationChangeDeps) {
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

  return { applyProjectLocationChange };
}

export interface ProjectFolderRenameDeps {
  busyProjectPaths: readonly string[];
  applyProjectLocationChange: (from: string, to: string) => Promise<void>;
}

/** Renames a local project folder on disk and then rebases the saved paths to the new name. */
export function useProjectFolderRename({
  busyProjectPaths,
  applyProjectLocationChange,
}: ProjectFolderRenameDeps) {
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

  return { onRenameProjectFolder };
}
