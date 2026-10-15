import { useMemo, useRef } from "react";
import { type Session, sessionNeedsInput } from "../../../features/sessions/model/session";
import { useUnseenFinishedSessions } from "../../../features/sessions/hooks/useUnseenFinishedSessions";
import { liveAgentsFromSessions } from "../../../features/sessions/model/liveAgents";
import { remoteLiveAgents } from "../../../features/connections/model/remoteRailSessions";
import { remoteSessionFor } from "../../../features/connections/model/connections";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import type { useLockSnapshot } from "../../../features/group-lock/hooks/useGroupLock";
import { liveAgentsEqual } from "../../model/sidebarEquality";
import { useWindowLiveAgents } from "../../model/useWindowLiveAgents";
import { setsEqual } from "../helpers/appHelpers";

/** Session ids that are busy, plus their orchestration leads. */
export function useBusySessionIds(sessions: Session[]): Set<string> {
  const nextBusySessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (session.busy || session.continuingElsewhere) {
        ids.add(session.id);
        if (session.orchestrationLeadId) ids.add(session.orchestrationLeadId);
      }
    }
    return ids;
  }, [sessions]);
  const busySessionIdsRef = useRef(nextBusySessionIds);
  if (!setsEqual(busySessionIdsRef.current, nextBusySessionIds)) {
    busySessionIdsRef.current = nextBusySessionIds;
  }
  return busySessionIdsRef.current;
}

/** Session ids waiting on the user (approval or question), plus their orchestration leads. */
export function useApprovalSessionIds(sessions: Session[]): Set<string> {
  const nextApprovalSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (sessionNeedsInput(session)) {
        ids.add(session.id);
        if (session.orchestrationLeadId) ids.add(session.orchestrationLeadId);
      }
    }
    return ids;
  }, [sessions]);
  const approvalSessionIdsRef = useRef(nextApprovalSessionIds);
  if (!setsEqual(approvalSessionIdsRef.current, nextApprovalSessionIds)) {
    approvalSessionIdsRef.current = nextApprovalSessionIds;
  }
  return approvalSessionIdsRef.current;
}

/** Finished sessions the user has not looked at yet. Wraps useUnseenFinishedSessions. */
export function useUnseenFinishedIds(
  sessions: Session[],
  busySessionIds: Set<string>,
  activeSessionId: Parameters<typeof useUnseenFinishedSessions>[2],
): Set<string> {
  return useUnseenFinishedSessions(sessions, busySessionIds, activeSessionId);
}

export interface LiveAgentStatusDeps {
  sessions: Session[];
  unseenFinishedIds: Set<string>;
  unopenedRemote: Parameters<typeof remoteLiveAgents>[0];
  remoteUnseenFinishedIds: Parameters<typeof remoteLiveAgents>[1];
  lockSnapshot: ReturnType<typeof useLockSnapshot>;
  liveAgentsEnabled: boolean;
}

/** Live agents rail list: local sessions plus unopened remote sessions, filtered by group lock and window ownership. */
export function useLiveAgentStatus({
  sessions,
  unseenFinishedIds,
  unopenedRemote,
  remoteUnseenFinishedIds,
  lockSnapshot,
  liveAgentsEnabled,
}: LiveAgentStatusDeps) {
  const nextLiveAgents = useMemo(
    () => [
      ...liveAgentsFromSessions(sessions, unseenFinishedIds),
      ...remoteLiveAgents(unopenedRemote, remoteUnseenFinishedIds),
    ],
    [sessions, unseenFinishedIds, unopenedRemote, remoteUnseenFinishedIds],
  );
  const liveAgentsRef = useRef(nextLiveAgents);
  if (!liveAgentsEqual(liveAgentsRef.current, nextLiveAgents)) {
    liveAgentsRef.current = nextLiveAgents;
  }
  const ownedLiveSessionKeys = useMemo(
    () =>
      Object.fromEntries(
        sessions.map((session) => [session.id, remoteSessionFor(session.id) ?? session.id]),
      ),
    [sessions],
  );
  const windowLiveAgents = useWindowLiveAgents(liveAgentsRef.current, ownedLiveSessionKeys);
  const liveAgents = useMemo(
    () =>
      liveAgentsEnabled
        ? windowLiveAgents.filter((agent) => !isProjectLockedIn(lockSnapshot, agent.cwd))
        : [],
    [windowLiveAgents, lockSnapshot, liveAgentsEnabled],
  );
  return { nextLiveAgents, liveAgents, ownedLiveSessionKeys };
}
