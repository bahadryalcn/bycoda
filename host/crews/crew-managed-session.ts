import type { HostStore } from "../store";

export const CREW_MANAGED_SESSION_CODE = "crew_managed_session";
export const CREW_MANAGED_SESSION_MESSAGE =
  "This conversation is managed by a crew. Stop or delete the work from Crews.";
export const COORDINATOR_DELETED =
  "The coordinator conversation was deleted. Resume the crew or start a new crew conversation to continue.";
export const COORDINATOR_STOPPED =
  "The coordinator conversation was stopped outside Crews. Resume the crew to continue.";

/** Refusal for owner actions aimed at a conversation that a crew run owns. */
export class CrewManagedSessionError extends Error {
  readonly code = CREW_MANAGED_SESSION_CODE;
  constructor() {
    super(CREW_MANAGED_SESSION_MESSAGE);
    this.name = "CrewManagedSessionError";
  }
}

export type CrewManagedSession = { runId: string; role: "coordinator" | "member" };

/**
 * The unfinished crew run that owns a session as its coordinator, a member task
 * session or a task reviewer session. Finished runs release their conversations.
 */
export async function crewManagedSession(
  store: Pick<HostStore, "db">,
  sessionId: string,
): Promise<CrewManagedSession | undefined> {
  if (!sessionId) return undefined;
  try {
    return await lookup(store, sessionId);
  } catch (error) {
    // Hosts that never initialized crews or tasks have no managed sessions.
    if (error instanceof Error && /no such table/i.test(error.message)) return undefined;
    throw error;
  }
}

async function lookup(store: Pick<HostStore, "db">, sessionId: string) {
  const coordinator = await store.db
    .prepare(
      "SELECT run_id FROM crew_runs_v2 WHERE coordinator_session_id=? AND status<>'finished' LIMIT 1",
    )
    .get(sessionId);
  if (coordinator) return { runId: String(coordinator.run_id), role: "coordinator" } as const;
  const member = await store.db
    .prepare(
      `SELECT r.run_id FROM tasks t JOIN crew_runs_v2 r ON r.run_id=json_extract(t.value,'$.crewRunId')
       WHERE r.status<>'finished'
         AND (json_extract(t.value,'$.sessionId')=? OR json_extract(t.value,'$.reviewer.sessionId')=?)
       LIMIT 1`,
    )
    .get(sessionId, sessionId);
  return member ? ({ runId: String(member.run_id), role: "member" } as const) : undefined;
}

export async function assertNotCrewManaged(
  store: Pick<HostStore, "db">,
  sessionId: string,
): Promise<void> {
  if (await crewManagedSession(store, sessionId)) throw new CrewManagedSessionError();
}

/** `notifications` key counting coordinator relaunches; the first launch keeps the bare request id. */
export const LAUNCH_GENERATION = "launch:generation";
export function launchGeneration(run: { notifications: Record<string, string> }): number {
  const value = Number(run.notifications?.[LAUNCH_GENERATION]);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}
