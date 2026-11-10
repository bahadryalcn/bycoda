import { useSyncExternalStore } from "react";
import { createStore } from "../../../shared/lib/store";
import type { CrewRole } from "./crew";
import type { CrewRunView } from "./crewClient";
import { crewRunMember, crewRunRoleMember } from "./crewPresentation";

/** Error code the Host answers with when a crew-managed session is stopped, deleted or written to. */
export const CREW_MANAGED_SESSION_CODE = "crew_managed_session";

/** Whether a failure is the Host refusing an operation on a crew-managed session. */
export function isCrewManagedRefusal(error: unknown): boolean {
  if (!error || typeof error !== "object") return String(error).includes(CREW_MANAGED_SESSION_CODE);
  const code = (error as { code?: unknown }).code;
  if (code === CREW_MANAGED_SESSION_CODE) return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes(CREW_MANAGED_SESSION_CODE);
}

/** A conversation owned by a live crew: it is managed from Crews, not from the session. */
export type CrewManagedSession = {
  sessionId: string;
  runId: string;
  definitionId: string;
  crewName: string;
  role: CrewRole;
  memberName?: string;
  /** Machine whose host owns the run, when the feed knows it. */
  machineId?: string;
};

type RunTask = CrewRunView["tasks"][number];

function taskWorkerSessionIds(task: RunTask): string[] {
  return [
    task.sessionId,
    task.blockedTakeover?.previousSessionId,
    ...(task.attemptHistory ?? []).map((entry) => entry.workerSessionId),
  ].filter((id): id is string => typeof id === "string");
}

function taskReviewSessionIds(task: RunTask): string[] {
  return [
    task.reviewer?.sessionId,
    task.verification?.review?.sessionId,
    ...(task.attemptHistory ?? []).map((entry) => entry.reviewerSessionId),
    ...(task.reviewNotes ?? []).flatMap((note) => [note.sessionId, ...(note.sessionIds ?? [])]),
  ].filter((id): id is string => typeof id === "string");
}

/**
 * Sessions of runs that are still managed (active or paused): the coordinator, every task
 * worker and every reviewer. A finished run releases its conversations to the owner; a
 * deleted run is gone from the list, so its sessions are released too.
 */
export function crewManagedSessions(
  runs: readonly CrewRunView[],
  machineId?: string,
): Map<string, CrewManagedSession> {
  const managed = new Map<string, CrewManagedSession>();
  for (const run of runs) {
    if (run.status === "finished") continue;
    const base = {
      runId: run.id,
      definitionId: run.definition.id,
      crewName: run.definition.name,
      machineId,
    };
    const add = (sessionId: string | undefined, role: CrewRole, memberName?: string) => {
      if (!sessionId?.trim() || managed.has(sessionId)) return;
      managed.set(sessionId, {
        ...base,
        sessionId,
        role,
        memberName: memberName?.trim() || undefined,
      });
    };
    add(run.coordinatorSessionId, "coordinator", crewRunRoleMember(run, "coordinator")?.name);
    for (const task of run.tasks) {
      const worker = crewRunMember(
        run,
        run.assignments.find((item) => item.taskId === task.id)?.memberId,
      );
      const reviewer = crewRunRoleMember(run, "reviewer")?.name;
      // Every conversation the task ever had stays with the crew, earlier attempts included.
      for (const id of taskWorkerSessionIds(task))
        add(id, worker?.role ?? "specialist", worker?.name);
      for (const id of taskReviewSessionIds(task)) add(id, "reviewer", reviewer);
    }
  }
  return managed;
}

const sources = new Map<string, Map<string, CrewManagedSession>>();
let merged = new Map<string, CrewManagedSession>();
const store = createStore();

function remerge() {
  merged = new Map();
  for (const source of sources.values()) for (const [id, item] of source) merged.set(id, item);
  store.notify();
}

/** Replace what one project (`sourceKey`) reports as crew-managed. */
export function setCrewManagedSource(
  sourceKey: string,
  managed: ReadonlyMap<string, CrewManagedSession> | undefined,
) {
  if (managed?.size) sources.set(sourceKey, new Map(managed));
  else if (!sources.delete(sourceKey)) return;
  remerge();
}

/** Forget every project that is no longer followed. */
export function pruneCrewManagedSources(live: ReadonlySet<string>) {
  const stale = Array.from(sources.keys()).filter((key) => !live.has(key));
  for (const key of stale) setCrewManagedSource(key, undefined);
}

/** The crew that manages this session, if any. Safe in non-React code (shortcuts, handlers). */
export function crewManagedSession(sessionId: string | undefined): CrewManagedSession | undefined {
  return sessionId ? merged.get(sessionId) : undefined;
}

export function useCrewManagedSession(sessionId: string | undefined) {
  return useSyncExternalStore(
    store.subscribe,
    () => crewManagedSession(sessionId),
    () => undefined,
  );
}

/** Subscribes to the whole index; re-renders when any session's managed state changes. */
export function useCrewManagedIndex(): ReadonlyMap<string, CrewManagedSession> {
  return useSyncExternalStore(
    store.subscribe,
    () => merged,
    () => merged,
  );
}

/** Test seam. */
export function resetCrewManagedSessions() {
  sources.clear();
  remerge();
}
