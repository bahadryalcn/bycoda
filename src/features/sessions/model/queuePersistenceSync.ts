import { isRemoteProjectPath } from "../../projects/public/recents";
import type { QueuedMessage, Session } from "./session";

/** First retry delay; each further failure doubles it up to the cap. */
export const QUEUE_RETRY_BASE_MS = 1_000;
export const QUEUE_RETRY_MAX_MS = 30_000;
/** Automatic retries per failed queue; a manual retry starts a new round. */
export const QUEUE_RETRY_LIMIT = 8;
/** Consecutive failures before the user is told the queue is not saved. */
export const QUEUE_UNSAVED_AFTER = 2;

type QueueSession = Pick<Session, "id" | "cwd" | "inboxAsk" | "queuedMessages">;

type Entry = {
  /** The queue (by identity) the last write was issued for; the latest edit the store was given. */
  requested: QueuedMessage[] | undefined;
  /** Identifies the newest write, so a settled older write cannot change this entry. */
  token: number;
  pending: boolean;
  failures: number;
  timer?: ReturnType<typeof setTimeout>;
};

export type QueuePersistenceSync = {
  /** Begin (or resume after `stop`) reconciling; keeps what is already written or pending. */
  start(): void;
  /** Reconcile with the sessions' current queues; call on every shell change. */
  sync(): void;
  /** Start a new retry round now for every queue that is not saved. */
  retryUnsaved(): void;
  /** Cancel retry timers and silence the notice; `start` picks up where this left off. */
  stop(): void;
};

export function queueRetryDelay(failures: number): number {
  return Math.min(QUEUE_RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), QUEUE_RETRY_MAX_MS);
}

function persists(session: QueueSession): boolean {
  // Remote sessions have no app-side queue: their host owns the conversation.
  return !session.inboxAsk && !isRemoteProjectPath(session.cwd);
}

/**
 * Writes each session's queued follow-ups through as they change and keeps trying
 * when a write fails. The queue arrays are replaced rather than mutated, so
 * identity says whether one changed.
 *
 * A failed write retries on a bounded backoff timer owned by the session, not on
 * unrelated shell changes. Only the newest queue is ever (re)written: an edit,
 * send or removal made after a failure cancels the old retry, so a stale queue
 * cannot land after a newer one and bring back a message that was already
 * delivered. Writes of one session are serialized by the store; the token keeps a
 * late settlement of an older write from touching the newer one's state.
 */
export function createQueuePersistenceSync(deps: {
  sessions: () => readonly QueueSession[];
  write: (sessionId: string, queue: QueuedMessage[] | undefined) => Promise<void>;
  /** True while at least one queue has failed repeatedly and is still unsaved; `retry` is the manual retry. */
  onUnsavedChange: (unsaved: boolean, retry: () => void) => void;
}): QueuePersistenceSync {
  const entries = new Map<string, Entry>();
  const unsaved = new Set<string>();
  let running = false;
  let tokens = 0;

  const notify = (): void => deps.onUnsavedChange(unsaved.size > 0, retryUnsaved);

  const setUnsaved = (id: string, value: boolean): void => {
    const had = unsaved.size > 0;
    if (value) unsaved.add(id);
    else unsaved.delete(id);
    if (running && had !== unsaved.size > 0) notify();
  };

  const clearTimer = (entry: Entry): void => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
  };

  const forget = (id: string): void => {
    const entry = entries.get(id);
    if (entry) clearTimer(entry);
    entries.delete(id);
    setUnsaved(id, false);
  };

  /** Arm the next automatic retry after a failure, unless the round is spent or the sync is stopped. */
  const scheduleRetry = (id: string, entry: Entry): void => {
    if (!running || entry.timer || entry.pending) return;
    if (entry.failures === 0 || entry.failures > QUEUE_RETRY_LIMIT) return;
    entry.timer = setTimeout(() => retry(id, entry), queueRetryDelay(entry.failures));
  };

  const send = (
    id: string,
    entry: Entry,
    queue: QueuedMessage[] | undefined,
    failures: number,
  ): void => {
    clearTimer(entry);
    const token = ++tokens;
    entry.requested = queue;
    entry.token = token;
    entry.pending = true;
    entry.failures = failures;
    const current = () => entries.get(id) === entry && entry.token === token;
    let attempt: Promise<void>;
    try {
      attempt = deps.write(id, queue);
    } catch (error) {
      attempt = Promise.reject(error);
    }
    void attempt.then(
      () => {
        if (!current()) return;
        entry.pending = false;
        entry.failures = 0;
        setUnsaved(id, false);
      },
      () => {
        if (!current()) return;
        entry.pending = false;
        entry.failures += 1;
        if (entry.failures >= QUEUE_UNSAVED_AFTER) setUnsaved(id, true);
        scheduleRetry(id, entry);
      },
    );
  };

  function retry(id: string, entry: Entry): void {
    entry.timer = undefined;
    if (!running || entries.get(id) !== entry) return;
    const session = deps.sessions().find((candidate) => candidate.id === id);
    if (!session || !persists(session)) {
      forget(id);
      return;
    }
    // The newest queue wins: an edit since the failure is written by `sync`, never by this retry.
    if (session.queuedMessages !== entry.requested) {
      sync();
      return;
    }
    send(id, entry, entry.requested, entry.failures);
  }

  function sync(): void {
    if (!running) return;
    const tracked = deps.sessions().filter(persists);
    const live = new Set(tracked.map((session) => session.id));
    for (const id of [...entries.keys()]) if (!live.has(id)) forget(id);
    for (const session of tracked) {
      const queue = session.queuedMessages;
      const entry = entries.get(session.id);
      // An unchanged queue is already saved or owned by its retry timer.
      if (entry && entry.requested === queue) continue;
      if (!entry) {
        const created: Entry = { requested: queue, token: 0, pending: false, failures: 0 };
        entries.set(session.id, created);
        // Nothing queued and nothing ever written: no row to create or clear.
        if (!queue?.length) continue;
        send(session.id, created, queue, 0);
        continue;
      }
      send(session.id, entry, queue, 0);
    }
  }

  function retryUnsaved(): void {
    if (!running) return;
    for (const id of [...unsaved]) {
      const entry = entries.get(id);
      if (!entry || entry.pending) continue;
      clearTimer(entry);
      // A fresh round: a failure of this retry resumes at the first delay.
      entry.failures = 0;
      retry(id, entry);
    }
  }

  return {
    start: () => {
      if (running) return;
      running = true;
      if (unsaved.size > 0) notify();
      // Failures that settled while stopped had no timer; arm them again.
      for (const [id, entry] of entries) scheduleRetry(id, entry);
      sync();
    },
    sync,
    retryUnsaved,
    stop: () => {
      if (!running) return;
      running = false;
      for (const entry of entries.values()) clearTimer(entry);
      if (unsaved.size > 0) deps.onUnsavedChange(false, retryUnsaved);
    },
  };
}
