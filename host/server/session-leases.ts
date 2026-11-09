import { type RunLease } from "../../src/features/sync/model/runLease";
import type { ServerBindings } from "./bindings";
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
  let heartbeatEffects = Promise.resolve();
  dependencies.desktop.live.onBusy = (id, clientId) => {
    const acceptedAt = Date.now();
    heartbeatEffects = heartbeatEffects
      .then(async () => {
        // Workspace bookkeeping runs before taking the store queue: it lists every
        // workspace and writes one, which is no reason to hold the other requests back.
        if (dependencies.desktop.live.busyClient(id) !== clientId) return;
        await dependencies.touchSessionWorkspace(id);
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
    if (reason !== "gone")
      heartbeatEffects = heartbeatEffects.then(() => dependencies.touchSessionWorkspace(id));
  };
  /**
   * A heartbeat answer is built from memory plus a bounded wait on the store: the window
   * counts silence as gone, so a stalled store queue must not delay the reply. Whatever
   * has not finished keeps running and lands later; the missing part of the answer is
   * simply absent, which the window treats as "no news".
   */
  const BEAT_STORE_WAIT_MS = 1_500;
  const withinBeat = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
    const pending = work();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback), BEAT_STORE_WAIT_MS);
          timer.unref?.();
        }),
      ]);
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
      lease: import("../../src/features/connections/model/sharedQueue").DrainLease;
      version: number;
      blocked: boolean;
      checkedAt: number;
    }
  >();
  const renewQueueLeases = async (params: Record<string, unknown>) => {
    if (!Array.isArray(params.queueLeases) || typeof params.clientId !== "string") return undefined;
    const holder = `desktop:${params.clientId}`;
    const leases: Record<
      string,
      import("../../src/features/connections/model/sharedQueue").DrainLease | null
    > = {};
    for (const entry of params.queueLeases.slice(0, 256)) {
      const { sessionId, epoch, blocked } = (entry ?? {}) as {
        sessionId?: unknown;
        epoch?: unknown;
        blocked?: unknown;
      };
      if (typeof sessionId !== "string" || !Number.isSafeInteger(epoch)) continue;
      const key = JSON.stringify([holder, sessionId, epoch]);
      const cached = queueLeaseAnswers.get(key);
      if (
        cached &&
        cached.version === dependencies.engine.store.db.dataMutationVersion &&
        cached.blocked === (blocked === true) &&
        Date.now() - cached.checkedAt < 5000 &&
        cached.lease.expiresAt > Date.now() + 5000
      ) {
        leases[sessionId] = await dependencies.sessionQueues.renew(
          sessionId,
          holder,
          Number(epoch),
        );
        continue;
      }
      // A holder that cannot send for a reason of its own (a sync conflict on its
      // copy) is neither stalled nor replaced by the host sending on its own copy.
      dependencies.queueDrainer.noteBlocked(sessionId, holder, blocked === true);
      // A holder that could send but does not is not renewed: its lease ends
      // and the host sends the row.
      leases[sessionId] = (await dependencies.queueDrainer.holderStalled(sessionId))
        ? await dependencies.sessionQueues.release(sessionId, holder, Number(epoch))
        : await dependencies.sessionQueues.renew(sessionId, holder, Number(epoch));
      const lease = leases[sessionId];
      if (lease)
        queueLeaseAnswers.set(key, {
          lease,
          version: dependencies.engine.store.db.dataMutationVersion,
          blocked: blocked === true,
          checkedAt: Date.now(),
        });
      else queueLeaseAnswers.delete(key);
      while (queueLeaseAnswers.size > 1024)
        queueLeaseAnswers.delete(queueLeaseAnswers.keys().next().value!);
    }
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
