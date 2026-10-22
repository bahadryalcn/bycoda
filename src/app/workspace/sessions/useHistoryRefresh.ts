import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { ADOPTED_SESSION_ADDED } from "../../../features/connections/model/adoptedSessions";
import { normalizeProjectPath, sameProjectPath } from "../../../features/projects/model/recents";
import { replaceProjectHistory } from "../../../features/sessions/data/sessionHistory";
import {
  listSessionsByProject,
  type SessionSummary,
} from "../../../features/sessions/data/sessionStore";

export interface HistoryRefreshDeps {
  sidebarCwd: string;
  sidebarCwdRef: MutableRefObject<string>;
  loadedProjectsRef: MutableRefObject<ReadonlySet<string>>;
  setHistory: Dispatch<SetStateAction<SessionSummary[]>>;
  setLoadedProjects: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setHistoryErrorCwd: Dispatch<SetStateAction<string | null>>;
}

export interface HistoryRefresh {
  refreshHistory: (cwd: string) => Promise<void>;
}

/**
 * Project history revalidation (`refreshHistory`), its refresh-on-cwd-change
 * effect and the adopted-session listener that refreshes the current project.
 */
export function useHistoryRefresh({
  sidebarCwd,
  sidebarCwdRef,
  loadedProjectsRef,
  setHistory,
  setLoadedProjects,
  setHistoryErrorCwd,
}: HistoryRefreshDeps): HistoryRefresh {
  const refreshHistory = useCallback(async (cwd: string) => {
    if (!cwd || cwd === "~") return;
    // `history` holds every visited project's rows and the sidebar filters it
    // by cwd, so a project loaded once paints from cache on the way back and
    // revalidates quietly underneath the cards already on screen. Whether the
    // first load is still pending is derived from `loadedProjects`, not
    // tracked here — a status set from this effect lands a render too late to
    // suppress the empty state.
    const key = normalizeProjectPath(cwd);
    setHistoryErrorCwd((prev) => (prev === key ? null : prev));
    try {
      const rows = await listSessionsByProject(cwd);
      if (cwd !== sidebarCwdRef.current) return;
      setHistory((current) => replaceProjectHistory(current, cwd, rows));
      setLoadedProjects((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    } catch {
      if (cwd !== sidebarCwdRef.current) return;
      // A failed revalidate keeps the cached cards rather than replacing a
      // good list with an error.
      if (!loadedProjectsRef.current.has(key)) setHistoryErrorCwd(key);
    }
  }, []);

  useEffect(() => {
    void refreshHistory(sidebarCwd);
  }, [sidebarCwd, refreshHistory]);

  // A session another computer started in this machine's project, through
  // this machine's host, joins the list as soon as its copy is saved here.
  useEffect(() => {
    const onAdded = (event: Event) => {
      const cwd = (event as CustomEvent<string>).detail;
      if (cwd && sameProjectPath(cwd, sidebarCwdRef.current))
        void refreshHistory(sidebarCwdRef.current);
    };
    window.addEventListener(ADOPTED_SESSION_ADDED, onAdded);
    return () => window.removeEventListener(ADOPTED_SESSION_ADDED, onAdded);
  }, [refreshHistory]);
  return { refreshHistory };
}
