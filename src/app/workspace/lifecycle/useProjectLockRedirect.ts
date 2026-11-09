import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { isProjectLockedIn, type LockSnapshot } from "../../../features/group-lock/model/lockState";
import { looksLikeProject } from "../../../features/projects/model/recents";
import { newDefaultSession, type RuntimeMode } from "../../../features/sessions/model/session";
import { setSessions } from "../../../features/sessions/model/sessionsStore";
import { newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { t } from "../../../shared/i18n";
import { showLockRedirectNotice } from "./lockRedirectNotice";

const projectName = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || path;

export interface ProjectLockRedirectDeps {
  lockSnapshot: LockSnapshot;
  sidebarCwd: string;
  visibleRecents: ReadonlyArray<{ readonly path: string }>;
  activeTabId: string;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  openProjects: (paths: readonly string[]) => void | Promise<void>;
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
  // Where the window was sent from and to, so the unlock can bring it back.
  const redirected = useRef<{ from: string; to: string } | null>(null);
  useLayoutEffect(() => {
    const memory = redirected.current;
    if (!activeProjectLocked && memory) {
      if (sidebarCwd !== memory.to) {
        // The person went somewhere else on their own: nothing to return to.
        redirected.current = null;
      } else if (!isProjectLockedIn(lockSnapshot, memory.from)) {
        redirected.current = null;
        void Promise.resolve(openProjects([memory.from])).catch((error: unknown) =>
          console.error("Could not remember project", error),
        );
        return;
      }
    }
    if (!activeProjectLocked) return;
    const notice = (to: string) => {
      // The same move can run again before the screen has followed it.
      if (memory?.from === sidebarCwd) return;
      console.warn(`[lock] ${sidebarCwd} is in a locked group; moved to ${to}`);
      showLockRedirectNotice(
        t(
          "{p0} is in a locked group, so the window moved away from it. Unlock the group to return.",
          {
            p0: projectName(sidebarCwd),
          },
        ),
      );
    };
    const next = visibleRecents.find((project) => looksLikeProject(project.path));
    if (next) {
      redirected.current = { from: sidebarCwd, to: next.path };
      notice(next.path);
      void Promise.resolve(openProjects([next.path])).catch((error: unknown) =>
        console.error("Could not remember project", error),
      );
      return;
    }
    redirected.current = { from: sidebarCwd, to: "~" };
    notice("~");
    // Nothing unlocked to go to: a blank session with no project.
    const session = newDefaultSession("~", runtimeMode);
    const tab = newTab(session.id);
    setSessions((prev) => [...prev, session]);
    appendTab(tab, "~");
    setActiveTabId(tab.id);
    setProjectCwd("~");
  }, [
    activeProjectLocked,
    lockSnapshot,
    activeTabId,
    appendTab,
    openProjects,
    runtimeMode,
    sidebarCwd,
    visibleRecents,
  ]);
}
