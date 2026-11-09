import { useEffect, useMemo, useState } from "react";
import { type Session, sessionNeedsInput } from "../../../features/sessions/model/session";
import { useUnseenFinishedSessions } from "../../../features/sessions/hooks/useUnseenFinishedSessions";
import {
  delegationParentOf,
  isDelegatedChildOf,
} from "../../../features/sessions/model/delegatedAgents";
import {
  sessionWait,
  sessionWaitsEqual,
  type SessionWait,
} from "../../../features/sessions/model/sessionWait";
import { liveAgentsFromSessions } from "../../../features/sessions/model/liveAgents";
import {
  remoteLiveAgents,
  remoteSessionWait,
  type RemoteRailSession,
} from "../../../features/connections/model/remoteRailSessions";
import { remoteSessionFor } from "../../../features/connections/model/connections";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import type { useLockSnapshot } from "../../../features/group-lock/hooks/useGroupLock";
import { liveAgentsEqual } from "../../model/sidebarEquality";
import { useWindowLiveAgents } from "../../model/useWindowLiveAgents";
import { setsEqual } from "../helpers/appHelpers";

/**
 * Keeps the previous reference while `equal` says the rebuilt value has the same content.
 * Held in state (adjusted during render) rather than a ref so render stays pure.
 */
function useStableState<T>(next: T, equal: (previous: T, next: T) => boolean): T {
  const [kept, setKept] = useState(next);
  if (kept === next || equal(kept, next)) return kept;
  setKept(next);
  return next;
}

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
  return useStableState(nextBusySessionIds, setsEqual);
}

/**
 * Waiting status per session id: busy with background work, idle with delegated
 * children running, or idle with a pending Host wake source. Listed host sessions
 * are keyed by their host id too, so remote project rows read the same map; a
 * local tab bound to a host session takes that row's Host wait and wake sources.
 */
export function computeSessionWaits(
  sessions: readonly Session[],
  listedRemote: readonly RemoteRailSession[] = [],
  now = Date.now(),
): Map<string, SessionWait> {
  const listedById = new Map(listedRemote.map(({ session }) => [session.id, session]));
  const childrenByParent = new Map<string, Session[]>();
  for (const session of sessions) {
    const parentId = delegationParentOf(session)?.parentSessionId;
    if (!parentId) continue;
    const list = childrenByParent.get(parentId);
    if (list) list.push(session);
    else childrenByParent.set(parentId, [session]);
  }
  const waits = new Map<string, SessionWait>();
  for (const session of sessions) {
    const children = (childrenByParent.get(session.id) ?? []).filter((child) =>
      isDelegatedChildOf(child, session),
    );
    const hostId = remoteSessionFor(session.id);
    const wait = sessionWait(session, children, hostId ? listedById.get(hostId) : undefined, now);
    if (wait) waits.set(session.id, wait);
  }
  for (const [id, row] of listedById) {
    const wait = remoteSessionWait(row, now);
    if (wait) waits.set(id, wait);
  }
  return waits;
}

/** The next time a listed wake source expires, after `now`. */
function nextWakeExpiry(listedRemote: readonly RemoteRailSession[], now: number) {
  let next: number | undefined;
  for (const { session } of listedRemote)
    for (const source of session.wakeSources ?? [])
      if (
        source.until !== undefined &&
        source.until > now &&
        (next === undefined || source.until < next)
      )
        next = source.until;
  return next;
}

function waitMapsEqual(a: ReadonlyMap<string, SessionWait>, b: ReadonlyMap<string, SessionWait>) {
  if (a.size !== b.size) return false;
  for (const [id, wait] of a) if (!sessionWaitsEqual(wait, b.get(id) ?? null)) return false;
  return true;
}

/** Ref-stable map of sessions in the "Waiting" state; unchanged while no wait changes.
 * Re-reads itself when a wake source's `until` passes, so no stale Waiting stays up. */
export function useSessionWaits(
  sessions: Session[],
  listedRemote: readonly RemoteRailSession[] = [],
): ReadonlyMap<string, SessionWait> {
  const [now, setNow] = useState(() => Date.now());
  const next = useMemo(
    () => computeSessionWaits(sessions, listedRemote, now),
    [sessions, listedRemote, now],
  );
  const expiry = nextWakeExpiry(listedRemote, now);
  useEffect(() => {
    if (expiry === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, expiry - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [expiry]);
  return useStableState(next, waitMapsEqual);
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
  return useStableState(nextApprovalSessionIds, setsEqual);
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
  /** Every listed host session of the rail's remote projects, opened here or not. */
  listedRemoteSessions: readonly RemoteRailSession[];
  unseenFinishedIds: Set<string>;
  unopenedRemote: Parameters<typeof remoteLiveAgents>[0];
  remoteUnseenFinishedIds: Parameters<typeof remoteLiveAgents>[1];
  lockSnapshot: ReturnType<typeof useLockSnapshot>;
  liveAgentsEnabled: boolean;
}

/** Live agents rail list: local sessions plus unopened remote sessions, filtered by group lock and window ownership.
 * Also returns the waiting map that session rows read, so both agree. */
export function useLiveAgentStatus({
  sessions,
  listedRemoteSessions,
  unseenFinishedIds,
  unopenedRemote,
  remoteUnseenFinishedIds,
  lockSnapshot,
  liveAgentsEnabled,
}: LiveAgentStatusDeps) {
  const sessionWaits = useSessionWaits(sessions, listedRemoteSessions);
  const nextLiveAgents = useMemo(
    () => [
      ...liveAgentsFromSessions(sessions, unseenFinishedIds, sessionWaits),
      ...remoteLiveAgents(unopenedRemote, remoteUnseenFinishedIds),
    ],
    [sessions, unseenFinishedIds, sessionWaits, unopenedRemote, remoteUnseenFinishedIds],
  );
  const stableLiveAgents = useStableState(nextLiveAgents, liveAgentsEqual);
  const ownedLiveSessionKeys = useMemo(
    () =>
      Object.fromEntries(
        sessions.map((session) => [session.id, remoteSessionFor(session.id) ?? session.id]),
      ),
    [sessions],
  );
  const windowLiveAgents = useWindowLiveAgents(stableLiveAgents, ownedLiveSessionKeys);
  const liveAgents = useMemo(
    () =>
      liveAgentsEnabled
        ? windowLiveAgents.filter((agent) => !isProjectLockedIn(lockSnapshot, agent.cwd))
        : [],
    [windowLiveAgents, lockSnapshot, liveAgentsEnabled],
  );
  return { nextLiveAgents, liveAgents, ownedLiveSessionKeys, sessionWaits };
}
