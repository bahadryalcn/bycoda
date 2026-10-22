import { useLayoutEffect, type Dispatch, type SetStateAction } from "react";
import { isProjectLockedIn, type LockSnapshot } from "../../../features/group-lock/model/lockState";
import { looksLikeProject } from "../../../features/projects/model/recents";
import {
  newDefaultSession,
  type RuntimeMode,
} from "../../../features/sessions/model/session";
import { setSessions } from "../../../features/sessions/model/sessionsStore";
import { newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";

export interface ProjectLockRedirectDeps {
  lockSnapshot: LockSnapshot;
  sidebarCwd: string;
  visibleRecents: ReadonlyArray<{ readonly path: string }>;
  activeTabId: string;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  openProjects: (paths: readonly string[]) => void;
  runtimeMode: RuntimeMode | undefined;
  setActiveTabId: (id: string) => void;
  setProjectCwd: Dispatch<SetStateAction<string>>;
}

/** Moves an active locked project off screen to the first unlocked project, or a blank session. */
export function useProjectLockRedirect({
  lockSnapshot,
  sidebarCwd,
  visibleRecents,
  activeTabId,
  appendTab,
  openProjects,
  runtimeMode,
  setActiveTabId,
  setProjectCwd,
}: ProjectLockRedirectDeps): void {
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
    const session = newDefaultSession("~", runtimeMode);
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
    runtimeMode,
    sidebarCwd,
    visibleRecents,
  ]);
}
