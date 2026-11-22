import { adoptedTranscriptLead } from "../../src/features/connections/model/adoptedSessions";
import type { DrainLease } from "../../src/features/connections/model/sharedQueue";
import { type RunLease } from "../../src/features/sync/model/runLease";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { createLogger } from "../diagnostics/logger";
import { recordDuration } from "../diagnostics/perf-metrics";
import type { ServerBindings } from "./bindings";

const beatLog = createLogger("host.sessions");

export function createSessionLeasesRuntime(
  dependencies: Pick<
    ServerBindings,
    | "desktop"
    | "touchSessionWorkspace"
    | "engine"
    | "runLeases"
    | "hostRuns"
    | "sessionQueues"
    | "queueDrainer"
  >,
) {
  // A window's heartbeat keeps its lease alive while the conversation is busy
  // there; the beat that reports it idle (or its silence) ends the lease.
  /** When each window last reported a conversation busy: a lease granted after that is a newer turn's. */
  const lastBusy = new Map<string, number>();
  const WORKSPACE_TOUCH_INTERVAL_MS = 30_000;
  /** When a busy session's workspace activity was last recorded from a beat. */
  const lastWorkspaceTouch = new Map<string, number>();
  let heartbeatEffects = Promise.resolve();
  dependencies.desktop.live.onBusy = (id, clientId) => {
    const acceptedAt = Date.now();
    heartbeatEffects = heartbeatEffects
      .then(async () => {
        // Workspace bookkeeping runs before taking the store queue: it lists every
        // workspace and writes one, which is no reason to hold the other requests back.
        if (dependencies.desktop.live.busyClient(id) !== clientId) return;
        // Workspace activity needs no beat resolution; one touch per interval keeps a busy
        // turn's beats from rewriting its workspace every few seconds.
        const touched = lastWorkspaceTouch.get(id);
        if (touched === undefined || elapsedSince(touched) >= WORKSPACE_TOUCH_INTERVAL_MS) {
          lastWorkspaceTouch.delete(id);
          lastWorkspaceTouch.set(id, monotonicNow());
          while (lastWorkspaceTouch.size > 1024)
            lastWorkspaceTouch.delete(lastWorkspaceTouch.keys().next().value!);
          await dependencies.touchSessionWorkspace(id);
        }
        await dependencies.engine.store.db.scope(async () => {
          // A later heartbeat may already have released or replaced this owner.
          if (dependencies.desktop.live.busyClient(id) !== clientId) return;
          const holder = `desktop:${clientId}`;
          let heldBefore = acceptedAt;
          // A window running a turn holds the conversation whether or not it asked first
          // (an older app, or a release that raced with its next turn).
          if (!dependencies.runLeases.renew(id, holder)) {
            try {
              const running = await dependencies.hostRuns(id);
              if (dependencies.desktop.live.busyClient(id) !== clientId) return;
              const existing = dependencies.runLeases.holder(id);
              dependencies.runLeases.acquire(id, holder, () =>
                running || dependencies.engine.hasRetainedProviderWriter(id) ? "host" : undefined,
              );
              // An implicit grant can happen after this beat was accepted.
              // Include that grant in its idle cutoff, but never a newer
              // explicit grant that appeared while the database was read.
              if (!existing) heldBefore = Date.now();
            } catch {
              /* another side holds it: that one stays */
            }
          }
          // After the grant, so the lease of this very turn counts as held by now.
          const key = `${id}\0${clientId}`;
          lastBusy.delete(key);
          lastBusy.set(key, heldBefore);
          while (lastBusy.size > 1024) lastBusy.delete(lastBusy.keys().next().value!);
        });
      })
      .catch((error) => console.warn("Desktop heartbeat lease update failed", error));
  };
  dependencies.desktop.live.onIdle = (id, clientId, reason) => {
    // A window that went quiet may be a hidden, throttled one that still writes:
    // its lease runs out on its own (longer than the longest beat gap).
    if (reason !== "gone")
      dependencies.runLeases.drop(
        id,
        `desktop:${clientId}`,
        lastBusy.get(`${id}\0${clientId}`) ?? 0,
      );
    if (reason !== "gone") {
      // The idle touch records the turn's end, and the next turn's first beat touches again.
      lastWorkspaceTouch.delete(id);
      heartbeatEffects = heartbeatEffects.then(() => dependencies.touchSessionWorkspace(id));
    }
  };
  /**
   * A heartbeat answer is built from memory plus a bounded wait on the store: the window
   * counts silence as gone, so a stalled store queue must not delay the reply. Whatever
   * has not finished keeps running and lands later; the missing part of the answer is
   * simply absent, which the window treats as "no news".
   *
   * With a `stage`, at most one copy of that stage's work runs per window: while an
   * earlier copy is still running (up to a minute) the beat answers the fallback without
   * starting another, so a slow store does not pile up copies. Every fallback of a stage is
   * counted as the `<stage>.fallback` perf metric and logged at most once a minute.
   */
  const BEAT_STORE_WAIT_MS = 1_500;
  const BEAT_COALESCE_MAX_MS = 60_000;
  const inFlight = new Map<string, { pending: Promise<unknown>; startedAt: number }>();
  const fallbacks = new Map<string, { count: number; loggedAt: number }>();
  const noteFallback = (stage: string, reason: "timeout" | "busy") => {
    recordDuration(`${stage}.fallback`, reason === "timeout" ? BEAT_STORE_WAIT_MS : 0);
    const seen = fallbacks.get(stage) ?? { count: 0, loggedAt: -Infinity };
    seen.count++;
    fallbacks.set(stage, seen);
    const now = monotonicNow();
    if (elapsedSince(seen.loggedAt, now) < 60_000) return;
    beatLog.warn("heartbeat fallback", { stage, reason, count: seen.count });
    seen.count = 0;
    seen.loggedAt = now;
  };
  const withinBeat = async <T>(
    work: () => Promise<T>,
    fallback: T,
    stage?: { name: string; owner: string },
  ): Promise<T> => {
    const key = stage && `${stage.name}\0${stage.owner}`;
    const running = key ? inFlight.get(key) : undefined;
    // A copy that never settles must not switch the stage off for good: past the cap the
    // next beat starts a fresh copy.
    if (stage && running && elapsedSince(running.startedAt) < BEAT_COALESCE_MAX_MS) {
      noteFallback(stage.name, "busy");
      return fallback;
    }
    const pending = work();
    if (key) {
      const entry = { pending, startedAt: monotonicNow() };
      inFlight.set(key, entry);
      void pending
        .catch(() => undefined)
        .finally(() => {
          if (inFlight.get(key) === entry) inFlight.delete(key);
        });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = Symbol("late");
    try {
      const outcome = await Promise.race([
        pending,
        new Promise<typeof late>((resolve) => {
          timer = setTimeout(() => resolve(late), BEAT_STORE_WAIT_MS);
          timer.unref?.();
        }),
      ]);
      if (outcome !== late) return outcome;
      if (stage) noteFallback(stage.name, "timeout");
      return fallback;
    } finally {
      clearTimeout(timer);
      // An abandoned wait must not surface as an unhandled rejection.
      pending.catch(() => undefined);
    }
  };
  /**
   * The run leases a desktop window says it holds (for the conversations it runs
   * a turn of), answered with the lease kept or `null` when it was lost: another
   * side runs a turn now, so the window must stop writing to the conversation.
   * A lease that merely ran out (a long gap, a host restart) is granted again
   * when nobody took the conversation meanwhile.
   */
  const renewRunLeases = async (params: Record<string, unknown>) => {
    if (!Array.isArray(params.runLeases) || typeof params.clientId !== "string") return undefined;
    const holder = `desktop:${params.clientId}`;
    const answers: Record<string, RunLease | null> = {};
    const reported: { sessionId: string; epoch: number }[] = [];
    for (const entry of params.runLeases.slice(0, 256)) {
      const { sessionId, epoch } = (entry ?? {}) as { sessionId?: unknown; epoch?: unknown };
      if (typeof sessionId !== "string" || sessionId.length > 200 || !Number.isSafeInteger(epoch))
        continue;
      reported.push({ sessionId, epoch: Number(epoch) });
    }
    // Whether the host runs a conversation is a store read, needed only for the ones
    // nobody holds yet. All of them are read in one bounded wait and one store scope.
    // When that wait runs out, grants answer from the engine's own memory of its runs.
    const unheld = [
      ...new Set(
        reported
          .map(({ sessionId }) => sessionId)
          .filter((sessionId) => !dependencies.runLeases.holder(sessionId)),
      ),
    ];
    let storeRuns: Map<string, boolean> | undefined;
    let hostRunsError: unknown;
    let closed = false;
    if (unheld.length) {
      try {
        storeRuns = await withinBeat(
          () =>
            dependencies.engine.store.db.scope(async () => {
              const running = new Map<string, boolean>();
              for (const sessionId of unheld) {
                if (closed) return undefined;
                running.set(sessionId, await dependencies.hostRuns(sessionId));
              }
              return running;
            }),
          undefined,
          { name: "desktopLive.runLeases", owner: holder },
        );
      } catch (error) {
        hostRunsError = error;
      }
      closed = true;
    }
    for (const { sessionId, epoch } of reported) {
      const current = dependencies.runLeases.holder(sessionId);
      if (current && current.holder !== holder) answers[sessionId] = null;
      else if (current)
        answers[sessionId] = dependencies.runLeases.renew(sessionId, holder, epoch) ?? null;
      else {
        try {
          if (hostRunsError) throw hostRunsError;
          // A lease that lapsed during the read has no store answer: the engine's memory stands in.
          const hostRunning =
            storeRuns?.get(sessionId) ?? dependencies.engine.hasActiveRun(sessionId);
          answers[sessionId] = dependencies.runLeases.acquire(sessionId, holder, () => {
            // Heartbeats observe ownership; they cannot retire a Host writer.
            if (hostRunning || dependencies.engine.hasRetainedProviderWriter(sessionId))
              return "host";
            const busy = dependencies.desktop.live.busyClient(sessionId);
            return busy && `desktop:${busy}` !== holder ? `desktop:${busy}` : undefined;
          });
        } catch {
          answers[sessionId] = null;
        }
      }
    }
    return answers;
  };
  /** Renews the drain leases a desktop reports on its heartbeat. */
  const queueLeaseAnswers = new Map<
    string,
    {
      lease: DrainLease;
      /** The queue's own revision when the answer was made: a change to that queue ends the answer. */
      revision: number;
      blocked: boolean;
      syncPending: boolean;
      checkedAt: number;
    }
  >();
  type QueueLeaseEntry = {
    sessionId: string;
    epoch: number;
    blocked: boolean;
    syncPending: boolean;
  };

  const desktopCopyAlreadySeen = async (id: string): Promise<boolean> => {
    try {
      const { desktop, authorityGeneration, projectId, session, status } =
        await dependencies.engine.store.session(id);
      if (!desktop || authorityGeneration !== undefined || status !== "idle") return false;
      const stamp = await dependencies.desktop.stampAsync(id);
      if (!stamp || stamp.running || stamp.updatedAt > desktop.updatedAt) return false;
      const snapshot = await dependencies.desktop.snapshotAsync(id, projectId, session.cwd);
      if (!snapshot || snapshot.status !== "idle" || snapshot.updatedAt !== stamp.updatedAt)
        return false;
      const lead = adoptedTranscriptLead(snapshot.session, session);
      return lead === "same" || lead === "host";
    } catch {
      return false;
    }
  };
  const renewQueueLease = async (
    holder: string,
    { sessionId, epoch, blocked, syncPending }: QueueLeaseEntry,
  ): Promise<DrainLease | null> => {
    const key = JSON.stringify([holder, sessionId, epoch]);
    const cached = queueLeaseAnswers.get(key);
    // A revision read from before a change can only miss the cache, never hit a changed queue.
    const { revision } = await dependencies.sessionQueues.get(sessionId);
    if (
      cached &&
      cached.revision === revision &&
      cached.blocked === blocked &&
      cached.syncPending === syncPending &&
      Date.now() - cached.checkedAt < 5000 &&
      cached.lease.expiresAt > Date.now() + 5000
    )
      return dependencies.sessionQueues.renew(sessionId, holder, epoch);
    // A holder that cannot send for a reason of its own (a sync conflict on its
    // copy) is neither stalled nor replaced by the host sending on its own copy.
    // A mirror that has yet to receive Host changes may yield to the Host only
    // when its persisted history has already been seen. Divergence and uncertain
    // delivery continue to use the unconditional block.
    dependencies.queueDrainer.noteBlocked(
      sessionId,
      holder,
      blocked && !(syncPending && (await desktopCopyAlreadySeen(sessionId))),
    );
    // A holder that could send but does not is not renewed: its lease ends
    // and the host sends the row.
    const lease = (await dependencies.queueDrainer.holderStalled(sessionId))
      ? await dependencies.sessionQueues.release(sessionId, holder, epoch)
      : await dependencies.sessionQueues.renew(sessionId, holder, epoch);
    if (lease)
      queueLeaseAnswers.set(key, { lease, revision, blocked, syncPending, checkedAt: Date.now() });
    else queueLeaseAnswers.delete(key);
    while (queueLeaseAnswers.size > 1024)
      queueLeaseAnswers.delete(queueLeaseAnswers.keys().next().value!);
    return lease;
  };
  const renewQueueLeases = async (params: Record<string, unknown>) => {
    if (!Array.isArray(params.queueLeases) || typeof params.clientId !== "string") return undefined;
    const holder = `desktop:${params.clientId}`;
    const reported: QueueLeaseEntry[] = [];
    for (const entry of params.queueLeases.slice(0, 256)) {
      const { sessionId, epoch, blocked, syncPending } = (entry ?? {}) as {
        sessionId?: unknown;
        epoch?: unknown;
        blocked?: unknown;
        syncPending?: unknown;
      };
      if (typeof sessionId !== "string" || !Number.isSafeInteger(epoch)) continue;
      reported.push({
        sessionId,
        epoch: Number(epoch),
        blocked: blocked === true,
        syncPending: syncPending === true,
      });
    }
    // One store scope for the whole beat. Entries of one session run in the reported
    // order (a later one sees the earlier one's write); different sessions run side by side.
    const bySession = new Map<string, number[]>();
    reported.forEach(({ sessionId }, index) => {
      bySession.set(sessionId, [...(bySession.get(sessionId) ?? []), index]);
    });
    const answers: (DrainLease | null)[] = [];
    await dependencies.engine.store.db.scope(() =>
      Promise.all(
        [...bySession.values()].map(async (indexes) => {
          for (const index of indexes)
            answers[index] = await renewQueueLease(holder, reported[index]);
        }),
      ),
    );
    // Reported order, so a session listed twice keeps the answer of its last entry.
    const leases: Record<string, DrainLease | null> = {};
    reported.forEach(({ sessionId }, index) => {
      leases[sessionId] = answers[index] ?? null;
    });
    return leases;
  };
  return {
    lastBusy,
    get heartbeatEffects() {
      return heartbeatEffects;
    },
    set heartbeatEffects(value: typeof heartbeatEffects) {
      heartbeatEffects = value;
    },
    BEAT_STORE_WAIT_MS,
    withinBeat,
    renewRunLeases,
    queueLeaseAnswers,
    renewQueueLeases,
  };
}
