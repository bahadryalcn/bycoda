import { useRef, useState } from "react";
import { normalizeProjectPath } from "../../../features/projects/model/recents";
import type { SessionSummary } from "../../../features/sessions/data/sessionStore";

export interface HistoryStateDeps {
  bootHistory: SessionSummary[];
  bootHistoryCwd: string | null;
}

/** Linked-session list, btw request map, loaded project set and listing error state. */
export function useHistoryState({ bootHistory, bootHistoryCwd }: HistoryStateDeps) {
  const [storedLinkedSessions, setStoredLinkedSessions] = useState<SessionSummary[]>(() =>
    bootHistory.filter((session) => session.linkedWorkItem),
  );
  const btwRequestsRef = useRef(
    new Map<string, { sessionId: string; controller: AbortController }>(),
  );
  /**
   * Projects whose rows are already in `history`. This has to be state, not a
   * ref: `sidebarCwd` is derived during render, so the frame that first shows
   * a new project must already know the listing has not arrived yet.
   */
  const [loadedProjects, setLoadedProjects] = useState<ReadonlySet<string>>(() =>
    bootHistoryCwd ? new Set([normalizeProjectPath(bootHistoryCwd)]) : new Set(),
  );
  const loadedProjectsRef = useRef(loadedProjects);
  loadedProjectsRef.current = loadedProjects;
  /** Project whose listing failed, so the error cannot leak to another one. */
  const [historyErrorCwd, setHistoryErrorCwd] = useState<string | null>(null);
  return {
    storedLinkedSessions,
    setStoredLinkedSessions,
    btwRequestsRef,
    loadedProjects,
    setLoadedProjects,
    loadedProjectsRef,
    historyErrorCwd,
    setHistoryErrorCwd,
  };
}
