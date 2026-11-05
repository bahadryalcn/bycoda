import { hostSessionBinding } from "./sessionExecutionBinding";
import { isRemoteProjectPath } from "../../projects/public/recents";
import type { QueuedMessage, Session } from "../../sessions";
import type { RemoteQueue } from "./remoteQueue";
import type { SharedQueueClient } from "./sharedQueueClient";

const sessionIndexes = new WeakMap<Session[], Map<string, Session>>();
/** O(1) lookup by id, built once per sessions array. */
export function sessionById(sessions: Session[], id: string): Session | undefined {
  let index = sessionIndexes.get(sessions);
  if (!index) {
    index = new Map(sessions.map((session) => [session.id, session]));
    sessionIndexes.set(sessions, index);
  }
  return index.get(id);
}
export const interactiveSession = (session: Session) =>
  !!session.busy || !!session.queuedMessages?.length;
const sortedSessions = new WeakMap<Session[], Session[]>();
/** Interactive sessions first, sorted once per sessions array. */
export function syncOrder(sessions: Session[]): Session[] {
  let sorted = sortedSessions.get(sessions);
  if (!sorted) {
    sorted = [...sessions].sort(
      (a, b) => Number(interactiveSession(b)) - Number(interactiveSession(a)),
    );
    sortedSessions.set(sessions, sorted);
  }
  return sorted;
}

export const fields = (session: Session): RemoteQueue => ({
  messages: session.queuedMessages ?? [],
  status: session.queueStatus,
  editingId: session.editingQueuedMessageId,
});

/**
 * What a window publishes of its session. `resuming` is this window's transient
 * Resume in flight: sending it would let a second window read it as an orphan
 * and demote it, so the last published status stands in until the Resume ends.
 */
export const outgoing = (session: Session, published: RemoteQueue): RemoteQueue => {
  const queue = fields(session);
  return queue.status === "resuming" ? { ...queue, status: published.status } : queue;
};

export const stateKeyOf = (session: Session): string =>
  `${session.busy ? 1 : 0}${session.continuingElsewhere ? 1 : 0}${session.adoptedSyncConflict ? 1 : 0}`;
/** Sessions that never take part in shared queues. */
export const queueEligible = (session: Session): boolean =>
  !hostSessionBinding(session) &&
  !session.inboxAsk &&
  !session.worktreeRemoved &&
  !isRemoteProjectPath(session.cwd) &&
  session.blocks.some((block) => block.role === "user" && !block.draft);

/** Puts a restored row at the head of a queue, also clearing an emptied queue's missing status. */
export function headedQueue(queue: RemoteQueue, restored: QueuedMessage): RemoteQueue {
  return {
    ...queue,
    // An emptied queue has no status; a row in it is sent as an active queue.
    status: queue.status ?? "active",
    messages: [restored, ...queue.messages.filter((row) => row.id !== restored.id)],
  };
}

/** Shows a restored row at the head of one session's queue; other sessions are unchanged. */
export function restoreRowInSessions(
  sessions: Session[],
  sessionId: string,
  restored: QueuedMessage,
): Session[] {
  return sessions.map((value) =>
    value.id === sessionId
      ? {
          ...value,
          queuedMessages: [
            restored,
            ...(value.queuedMessages ?? []).filter((row) => row.id !== restored.id),
          ],
        }
      : value,
  );
}

export type Entry = {
  client: SharedQueueClient;
  observed: RemoteQueue;
  /** A send or a Resume owns the queue: ticks and other actions wait for it. */
  claiming: boolean;
  claimedAt: number;
  claimOwner?: symbol;
  /** When the provider call of the claimed send began (not the lease, claim or dialogs before it). */
  sendStartedAt?: number;
  /** Gives up on a send whose provider call never settles; it becomes unconfirmed. */
  abandon?: () => void;
  /** Resolves when the current owner has released the queue. */
  released?: Promise<void>;
  nextIdleSyncAt: number;
  /** The busy/elsewhere/conflict state at the last look: a flip is a settle or a takeover to react to. */
  stateKey: string;
  /** Whether this window could send the head at the last look: a change wakes the dispatcher. */
  ready: boolean;
  /** A row whose deferred send is put back at the head: applied by the next `apply`. */
  restore?: QueuedMessage;
  apply: (allowClaim?: boolean) => void;
  publish: () => boolean;
  read: () => RemoteQueue;
  /** The conversation is busy or held by the host: a refused dispatch is not a failure.
   * A selected send (`steer`) goes into the running turn, so a busy turn explains nothing there:
   * only another computer's turn or an open conflict does. */
  held: (steer: boolean) => boolean;
};

export function takeQueue(entry: Entry): { release: () => void; owns: () => boolean } {
  const owner = Symbol();
  let done!: () => void;
  entry.claiming = true;
  entry.claimedAt = Date.now();
  entry.sendStartedAt = undefined;
  entry.claimOwner = owner;
  entry.abandon = undefined;
  entry.released = new Promise<void>((resolve) => (done = resolve));
  return {
    owns: () => entry.claimOwner === owner,
    release: () => {
      done();
      if (entry.claimOwner !== owner) return;
      entry.claiming = false;
      entry.claimOwner = undefined;
      entry.abandon = undefined;
    },
  };
}
