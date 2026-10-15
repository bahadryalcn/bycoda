import { useMemo, useRef } from "react";
import { type Session } from "../../../features/sessions/model/session";
import { type SessionSummary } from "../../../features/sessions/data/sessionStore";
import {
  historyWithLiveSessions,
  summaryFromSession,
} from "../../../features/sessions/data/sessionHistory";
import { sameProjectPath } from "../../../features/projects/model/recents";
import { projectName } from "../../../shared/lib/paths";
import {
  liveAgentsFromSessions,
  workingProjectPaths,
} from "../../../features/sessions/model/liveAgents";
import { remoteLiveAgents } from "../../../features/connections/model/remoteRailSessions";
import { useProjectBranches } from "../../../features/source-control/hooks/useProjectBranches";
import { sessionSummariesEqual, stringArraysEqual } from "../../model/sidebarEquality";

export interface HistoryListsDeps {
  history: SessionSummary[];
  sessions: Session[];
  sidebarCwd: string;
  projectBranches: ReturnType<typeof useProjectBranches>;
  orchestrationRuns: Parameters<typeof historyWithLiveSessions>[4];
  unopenedRemote: Parameters<typeof remoteLiveAgents>[0];
}

export interface HistoryLists {
  projectHistory: SessionSummary[];
  sidebarHistory: SessionSummary[];
  openProjectSessions: SessionSummary[];
  busyProjectPaths: string[];
}

/** Session-list derivations for the sidebar and project views. Memos and
 * render-synced refs only; history fetching stays in Workspace. */
export function useHistoryLists(deps: HistoryListsDeps): HistoryLists {
  const { history, sessions, sidebarCwd, projectBranches, orchestrationRuns, unopenedRemote } =
    deps;
  // `history` now spans every visited project; consumers that expect the
  // current project only get this slice.
  const projectHistory = useMemo(
    () => history.filter((entry) => sameProjectPath(entry.cwd, sidebarCwd)),
    [history, sidebarCwd],
  );

  const nextSidebarHistory = useMemo(
    () =>
      historyWithLiveSessions(
        history,
        sessions,
        sidebarCwd,
        {
          ...(projectBranches?.current ? { branch: projectBranches.current } : {}),
          ...(sidebarCwd && sidebarCwd !== "~" ? { repo: projectName(sidebarCwd) } : {}),
        },
        orchestrationRuns,
      ),
    [history, projectBranches, sessions, sidebarCwd, orchestrationRuns],
  );
  const sidebarHistoryRef = useRef(nextSidebarHistory);
  if (!sessionSummariesEqual(sidebarHistoryRef.current, nextSidebarHistory)) {
    sidebarHistoryRef.current = nextSidebarHistory;
  }
  const sidebarHistory = sidebarHistoryRef.current;

  const nextOpenProjectSessions = useMemo(
    () =>
      sessions
        .filter(
          (session) =>
            !session.inboxAsk &&
            !session.orchestrationLeadId &&
            sameProjectPath(session.cwd, sidebarCwd),
        )
        .map((session) =>
          summaryFromSession(session, {
            ...(projectBranches?.current ? { branch: projectBranches.current } : {}),
            ...(sidebarCwd && sidebarCwd !== "~" ? { repo: projectName(sidebarCwd) } : {}),
          }),
        ),
    [projectBranches, sessions, sidebarCwd],
  );
  const openProjectSessionsRef = useRef(nextOpenProjectSessions);
  if (!sessionSummariesEqual(openProjectSessionsRef.current, nextOpenProjectSessions)) {
    openProjectSessionsRef.current = nextOpenProjectSessions;
  }
  const openProjectSessions = openProjectSessionsRef.current;

  const nextBusyProjectPaths = useMemo(
    () =>
      workingProjectPaths([
        ...liveAgentsFromSessions(sessions),
        ...remoteLiveAgents(unopenedRemote),
      ]),
    [sessions, unopenedRemote],
  );
  const busyProjectPathsRef = useRef(nextBusyProjectPaths);
  if (!stringArraysEqual(busyProjectPathsRef.current, nextBusyProjectPaths)) {
    busyProjectPathsRef.current = nextBusyProjectPaths;
  }
  const busyProjectPaths = busyProjectPathsRef.current;

  return { projectHistory, sidebarHistory, openProjectSessions, busyProjectPaths };
}
