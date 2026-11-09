import { noteRemoteActivity } from "../../sessions/public/remoteActivityNotice";
import type { HostSessionSummary, MachineChanges, RemoteMachine } from "./protocol";
import type { RemoteSessionLists } from "./remoteSessionLists";

type ProjectChange = MachineChanges["projects"][number];

/** How long this client's own delete/archive stays excluded from remote notices. */
export const OWN_ACTION_TTL_MS = 2 * 60_000;
const MAX_OWN = 512;

const own = new Map<string, number>();
const ownKey = (machineId: string, sessionId: string, kind: "deleted" | "archived") =>
  JSON.stringify([machineId, sessionId, kind]);

/** Records a delete or archive this client sent, so its echo in the change feed
 * is not reported as another device's action. */
export function noteOwnSessionAction(
  machineId: string,
  sessionId: string,
  kind: "deleted" | "archived",
  now = Date.now(),
): void {
  own.delete(ownKey(machineId, sessionId, kind));
  own.set(ownKey(machineId, sessionId, kind), now + OWN_ACTION_TTL_MS);
  while (own.size > MAX_OWN) own.delete(own.keys().next().value!);
}

/** Records the own action a `sessions.*` request carries; other requests are ignored.
 * Called before the request is sent: the change feed can report it before the reply. */
export function noteOwnSessionRequest(machineId: string, method: string, params: unknown): void {
  if (!params || typeof params !== "object" || !("sessionId" in params)) return;
  const { sessionId } = params;
  if (typeof sessionId !== "string") return;
  if (method === "sessions.delete") noteOwnSessionAction(machineId, sessionId, "deleted");
  else if (method === "sessions.update" && "archived" in params && params.archived === true)
    noteOwnSessionAction(machineId, sessionId, "archived");
}

function takeOwn(machineId: string, sessionId: string, kind: "deleted" | "archived", now: number) {
  const key = ownKey(machineId, sessionId, kind);
  const until = own.get(key);
  own.delete(key);
  return until !== undefined && until > now;
}

export type RemoteListActivity = { deleted: number; archived: number };

/**
 * What other devices did to a project's list, read from one incremental change
 * against the list this client already held. Initial loads, resets, full
 * snapshots and changes that do not continue the held list report nothing.
 */
export function remoteListActivity(
  machineId: string,
  held: { sessions: readonly HostSessionSummary[]; etag?: string } | undefined,
  change: ProjectChange,
  reset: boolean,
  now = Date.now(),
): RemoteListActivity {
  const none = { deleted: 0, archived: 0 };
  if (reset || !held || change.sessions || !change.base || held.etag !== change.base) return none;
  const before = new Map(held.sessions.map((session) => [session.id, session]));
  const upserted = new Set((change.upserts ?? []).map((session) => session.id));
  let deleted = 0;
  let archived = 0;
  // shortcut: a project-list `removed` id is "absent from the project now"; the Host sends no
  // deleted marker there, so a conversation moved out of the project would also count.
  // Upgrade when the Host reports deletions for project lists.
  for (const id of change.removed ?? [])
    if (before.has(id) && !upserted.has(id) && !takeOwn(machineId, id, "deleted", now)) deleted++;
  for (const next of change.upserts ?? []) {
    const previous = before.get(next.id);
    if (
      previous &&
      !previous.archived &&
      next.archived &&
      !takeOwn(machineId, next.id, "archived", now)
    )
      archived++;
  }
  return { deleted, archived };
}

/** Applies one machine change to the shared list and tells the person what other
 * devices deleted or archived in it. */
export function applyProjectChange(
  lists: Pick<RemoteSessionLists, "held" | "applyChange">,
  machine: Pick<RemoteMachine, "id" | "name">,
  remote: { key: string; projectId: string },
  changed: ProjectChange,
  reset: boolean,
): HostSessionSummary[] | undefined {
  const activity = remoteListActivity(
    machine.id,
    lists.held(machine.id, remote.projectId),
    changed,
    reset,
  );
  const next = lists.applyChange(machine.id, remote.projectId, changed, reset);
  if (next)
    for (const kind of ["deleted", "archived"] as const)
      for (let index = 0; index < activity[kind]; index++)
        noteRemoteActivity({ scope: { cwd: remote.key }, kind, device: machine.name });
  return next;
}
