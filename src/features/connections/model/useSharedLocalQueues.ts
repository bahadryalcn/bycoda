import { invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore, type MutableRefObject } from "react";
import { t } from "../../../shared/i18n";
import type { QueueActionResult } from "../../sessions/model/queueAction";
import {
  lateSettlementPossible,
  setQueueHoldReason,
  trackLateSettlement,
} from "../../sessions/model/deliveryReview";
import type { QueuedMessage, Session } from "../../sessions/model/session";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { loadRemoteCapabilities } from "./connections";
import { isLocalSyncMachine } from "./localSync";
import type { RemoteMachine } from "./protocol";
import { queueSessionFields, type RemoteQueue } from "./remoteQueue";
import { nextQueueStatus } from "./queueState";
import { QueueNotReadyError, sameQueueValue, SHARED_QUEUE_CAPABILITY } from "./sharedQueue";
import { desktopQueueClientId, SharedQueueClient } from "./sharedQueueClient";
import {
  beginDeliveryProgress,
  updateDeliveryProgress,
} from "../../sessions/model/deliveryProgress";
import { DeliveryUnknownError } from "../../../shared/lib/deliveryUnknown";
import { LOCAL_HOST_REACHABLE_EVENT } from "./hostWake";

type Entry = {
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
  apply: (allowClaim?: boolean) => void;
  publish: () => boolean;
  read: () => RemoteQueue;
  /** The conversation is busy or held by the host: a refused dispatch is not a failure.
   * A selected send (`steer`) goes into the running turn, so a busy turn explains nothing there:
   * only another computer's turn or an open conflict does. */
  held: (steer: boolean) => boolean;
};
const localQueues = new Map<string, Entry>();
const queueListeners = new Set<() => void>();
const notifyQueues = () => queueListeners.forEach((listener) => listener());
export function useLocalSharedQueueClient(sessionId: string) {
  return useSyncExternalStore(
    (listener) => {
      queueListeners.add(listener);
      return () => {
        queueListeners.delete(listener);
      };
    },
    () => localQueues.get(sessionId)?.client,
  );
}
/** Queues change through another device, a lease, a settle or an explicit action;
 * each of those wakes the dispatcher (`wakeSharedLocalQueues`, session changes,
 * focus, a lease expiring), so this re-read is only the one safety pass. */
const IDLE_SYNC_MS = 60_000;
/** Retry of a queue whose last look failed while the host is reachable: it doubles up to the safety pass. */
const ERROR_RETRY_MS = 1_500;
/** How long a claimed send may wait for the provider before Resume gives up on it. */
export const HUNG_CLAIM_MS = 30_000;
/** Queues another computer changed, to be read at once even if idle or hidden. */
const woken = new Set<string>();
let wakeAll = false;
let runTick: (() => void) | undefined;
/** The host saw another computer change these shared queues (`undefined`: any). */
export function wakeSharedLocalQueues(ids?: string[]): void {
  if (ids && ids.length === 0) return;
  if (!ids) wakeAll = true;
  else for (const id of ids) if (localQueues.has(id) || woken.size < 256) woken.add(id);
  runTick?.();
}
/** The conversations this window shows; a queue whose conversation moved away is not its own. */
let windowSessions: (() => Session[]) | undefined;
const inThisWindow = (id: string): boolean =>
  !windowSessions || !!sessionById(windowSessions(), id);
/**
 * The drain leases this window holds, for the desktop heartbeat to keep alive.
 * Only conversations this window still shows: renewing the lease of one that
 * moved to another window would keep that window's queue held for good.
 */
export function heldSharedQueueLeases(): {
  sessionId: string;
  epoch: number;
  /** This window holds the lease but cannot send now: the host must not wait for it. */
  blocked?: true;
}[] {
  return [...localQueues.entries()].flatMap(([id, entry]) => {
    const lease = inThisWindow(id) ? entry.client.heldLease() : undefined;
    return lease
      ? [{ ...lease, ...(drainBlocked(id, entry) ? { blocked: true as const } : {}) }]
      : [];
  });
}
/**
 * The lease is held but the head cannot go out from this window: the adopted
 * conversation diverged from the host copy, an unconfirmed delivery is under
 * review, or a late provider answer is still possible. The host must not send it
 * in this window's place either.
 */
function drainBlocked(id: string, entry: Entry): boolean {
  const session = windowSessions ? sessionById(windowSessions(), id) : undefined;
  const state = entry.client.snapshot();
  return !!session?.adoptedSyncConflict || lateSettlementPossible(id) || !!state.recovery;
}
/** The host's answer to the heartbeat: a lease that was lost is looked at again at once. */
export function noteSharedQueueLeases(
  answers: Record<string, { holder: string; epoch: number; expiresAt: number } | null>,
): void {
  for (const [id, lease] of Object.entries(answers)) {
    const entry = localQueues.get(id);
    if (!entry) continue;
    entry.client.noteLease(lease);
    if (lease === null) wakeSharedLocalQueues([id]);
  }
}
/** Another window of this computer holds the queue's drain lease right now. */
export function sharedLocalQueueLeaseHeld(sessionId: string): boolean {
  return !!localQueues.get(sessionId)?.client.heldByOther();
}
const noSubscribe = () => () => {};
/**
 * Whether another window holds the lease of a queue that has work waiting. The
 * lease holder sends it, so this window shows who and offers an explicit takeover.
 */
export function useSharedQueueLeaseHeld(sessionId: string): boolean {
  const client = useLocalSharedQueueClient(sessionId);
  return useSyncExternalStore(
    client?.subscribe ?? noSubscribe,
    () => !!client && client.heldByOther() && client.snapshot().queue.messages.length > 0,
  );
}
/**
 * "Take over": this window sends the queue although another window's lease is
 * still live. A new epoch fences the old holder; the queue itself is unchanged.
 */
export async function takeOverSharedLocalQueue(sessionId: string): Promise<QueueActionResult> {
  const entry = localQueues.get(sessionId);
  if (!entry) return false;
  if (entry.claiming)
    return {
      kind: "waiting",
      message: t("A send is still waiting for confirmation. Try Resume again in a moment."),
    };
  const { release } = takeQueue(entry);
  try {
    entry.publish();
    await entry.client.takeOver();
  } finally {
    release();
    entry.apply();
    runTick?.();
  }
  return { kind: "waiting", message: t("This window now sends the queue.") };
}
const sessionIndexes = new WeakMap<Session[], Map<string, Session>>();
/** O(1) lookup by id, built once per sessions array. */
function sessionById(sessions: Session[], id: string): Session | undefined {
  let index = sessionIndexes.get(sessions);
  if (!index) {
    index = new Map(sessions.map((session) => [session.id, session]));
    sessionIndexes.set(sessions, index);
  }
  return index.get(id);
}
const interactiveSession = (session: Session) => !!session.busy || !!session.queuedMessages?.length;
const sortedSessions = new WeakMap<Session[], Session[]>();
/** Interactive sessions first, sorted once per sessions array. */
function syncOrder(sessions: Session[]): Session[] {
  let sorted = sortedSessions.get(sessions);
  if (!sorted) {
    sorted = [...sessions].sort(
      (a, b) => Number(interactiveSession(b)) - Number(interactiveSession(a)),
    );
    sortedSessions.set(sessions, sorted);
  }
  return sorted;
}

const fields = (session: Session): RemoteQueue => ({
  messages: session.queuedMessages ?? [],
  status: session.queueStatus,
  editingId: session.editingQueuedMessageId,
});

/**
 * What a window publishes of its session. `resuming` is this window's transient
 * Resume in flight: sending it would let a second window read it as an orphan
 * and demote it, so the last published status stands in until the Resume ends.
 */
const outgoing = (session: Session, published: RemoteQueue): RemoteQueue => {
  const queue = fields(session);
  return queue.status === "resuming" ? { ...queue, status: published.status } : queue;
};

const stateKeyOf = (session: Session): string =>
  `${session.busy ? 1 : 0}${session.continuingElsewhere ? 1 : 0}${session.adoptedSyncConflict ? 1 : 0}`;
/** Sessions that never take part in shared queues. */
const queueEligible = (session: Session): boolean =>
  !session.inboxAsk &&
  !session.worktreeRemoved &&
  !isRemoteProjectPath(session.cwd) &&
  session.blocks.some((block) => block.role === "user" && !block.draft);

/** The local desktop is the sole provider writer; host claims protect its queued sends. */
export async function submitSharedLocalQueue(
  sessionId: string,
  id: string,
  steer: boolean,
  send: (message?: QueuedMessage) => boolean | Promise<boolean>,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  const entry = localQueues.get(sessionId);
  if (!entry) return send(); // Local-only installs keep their existing queue contract.
  if (entry.claiming) return false;
  const { release, owns } = takeQueue(entry);
  const progress = beginDeliveryProgress(sessionId, id, "syncing");
  const heldStatus = entry.read().status;
  let failure: string | undefined;
  let token: string | undefined;
  let accepted = false;
  let uncertain = false;
  let transientHold = false;
  let handedOver = false;
  try {
    entry.publish();
    if (steer) {
      await entry.client.retry();
      if (entry.client.snapshot().error) throw new Error(entry.client.snapshot().error);
      if (!isCurrent()) {
        failure = "The selected message or turn changed while waiting. The message remains queued.";
        return false;
      }
      // A single selected send is not permission to release the rest of a held queue.
      if (!entry.client.update((queue) => ({ ...queue, editingId: undefined }), true))
        throw new QueueNotReadyError(
          entry.client.snapshot().error ??
            "Another send owns this queue. Wait for its confirmation.",
        );
    }
    updateDeliveryProgress(sessionId, progress, "claiming");
    token = await entry.client.claim(id, steer);
    if (!token)
      throw new QueueNotReadyError(
        entry.client.snapshot().error ?? "Another send owns this queue. Wait for its confirmation.",
      );
    if (!isCurrent() || !owns()) {
      failure = "The selected message or turn changed while waiting. The message remains queued.";
      return false;
    }
    entry.apply(true);
    const message = entry.client.snapshot().queue.messages.find((row) => row.id === id);
    if (!message) return false;
    uncertain = true;
    handedOver = true;
    updateDeliveryProgress(sessionId, progress, "preparing");
    const sending = Promise.resolve(send(message));
    // Resume may give up on a provider call that never settles. The row is then
    // held as unconfirmed, and a late answer still settles it exactly once.
    const given = new Promise<never>((_, reject) => {
      entry.abandon = () =>
        reject(
          new DeliveryUnknownError(
            "The provider did not answer. Delivery is not confirmed.",
            sending.then(
              (ok) => (ok ? "accepted" : "rejected"),
              () => "unknown",
            ),
          ),
        );
    });
    accepted = await Promise.race([sending, given]);
    uncertain = false;
    if (!accepted) {
      // Busy, or held by the host's own turn, is the dispatcher's wait state:
      // it sends the row once the conversation is free. Only a refusal for any
      // other reason holds the queue for the owner's review.
      transientHold = entry.held(steer);
      failure = transientHold
        ? steer
          ? t(
              "Another computer is running this conversation. The message remains queued; the queue is unchanged.",
            )
          : t(
              "The conversation is busy elsewhere. The message remains queued and sends when it is free.",
            )
        : t(
            "The send was cancelled or rejected. The message remains queued and the queue is paused.",
          );
    }
    return accepted;
  } catch (error) {
    failure = String(error).replace(/^Error: /, "");
    // Nothing reached the provider: a host that could not be asked or a queue
    // another computer changed is a coordination wait, not a failed delivery.
    if (
      !handedOver &&
      !(error instanceof DeliveryUnknownError) &&
      !(error instanceof QueueNotReadyError)
    )
      error = new QueueNotReadyError(failure);
    if (error instanceof DeliveryUnknownError && token) {
      const heldToken = token;
      failure = t(
        "Delivery is not confirmed. The message is held and will not be sent again automatically.",
      );
      // While the provider may still answer, "Send again" would risk a duplicate.
      trackLateSettlement(sessionId, error.settlement);
      // Whatever it answers, the dispatcher looks at the queue again: it was held back meanwhile.
      void error.settlement.finally(() => {
        entry.apply();
        entry.nextIdleSyncAt = 0;
        runTick?.();
      });
      void error.settlement.then(async (result) => {
        if (result === "unknown") return;
        try {
          await entry.client.sync().catch(() => {});
          // An explicit recovery decision may already have settled this token,
          // or a newer send may own the queue. Never rewrite its journal.
          if (entry.client.snapshot().queue.claim?.token !== heldToken) {
            // The owner kept the row queued meanwhile, yet the provider did take
            // the message: leaving it would send it twice on the next Resume.
            if (
              result === "accepted" &&
              !entry.claiming &&
              !entry.client.snapshot().queue.claim &&
              entry.client.update((queue) => ({
                ...queue,
                messages: queue.messages.filter((row) => row.id !== id),
                editingId: queue.editingId === id ? undefined : queue.editingId,
              }))
            ) {
              entry.apply();
              updateDeliveryProgress(
                sessionId,
                progress,
                "accepted",
                t("The provider confirmed delivery. The message was removed from the queue."),
              );
            }
            return;
          }
          await entry.client.finish(heldToken, result === "accepted");
          entry.apply();
          updateDeliveryProgress(
            sessionId,
            progress,
            result === "accepted" ? "accepted" : "rejected",
            result === "accepted"
              ? t("The provider confirmed delivery. The message was not sent again.")
              : t("The provider rejected the message. It remains queued and paused."),
          );
        } catch (reason) {
          entry.client.hold(reason);
          entry.apply();
        }
      });
    }
    console.warn("Shared queued send is held", error);
    throw error;
  } finally {
    if (token && !uncertain) {
      try {
        await entry.client.finish(token, accepted, !accepted && !transientHold);
        if (!accepted && !transientHold) {
          const local = entry.read();
          entry.client.update((queue) => ({
            ...queue,
            status: nextQueueStatus(
              local.status === "paused" || local.status === "restored" ? local.status : heldStatus,
              "reject",
            ),
            editingId: local.editingId,
          }));
          await entry.client.sync();
        }
      } catch (error) {
        console.warn("Shared queued send acknowledgement is pending", error);
      }
    }
    release();
    entry.apply();
    // The send settled: the queue is read once more (an unconfirmed delivery is
    // found by it), with whatever waited for it: a change another computer made
    // meanwhile, the lease expiry timer.
    entry.nextIdleSyncAt = 0;
    runTick?.();
    updateDeliveryProgress(
      sessionId,
      progress,
      accepted ? "accepted" : uncertain ? "unknown" : "rejected",
      failure,
    );
  }
}

/** Marks the queue as busy with one owner; the returned release is a no-op once superseded. */
function takeQueue(entry: Entry): { release: () => void; owns: () => boolean } {
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

/**
 * How an explicit Resume ended on the shared queue.
 *  - resumed: the queue is active again and the dispatcher drains it
 *  - pending: a send is still waiting for the provider; Resume can be tried again
 *  - review:  a delivery has no acknowledgement; the owner must choose first
 *  - late:    a given-up send may still be answered by its provider; resuming now
 *             could send the same message twice, so Resume waits for the answer
 */
export type SharedResume = "resumed" | "pending" | "review" | "late";

/** The provider call of the queued send in flight is starting: the hung-send clock begins here. */
export function markSharedProviderSend(sessionId: string): void {
  const entry = localQueues.get(sessionId);
  if (entry?.claiming && entry.sendStartedAt === undefined) entry.sendStartedAt = Date.now();
}

/**
 * A send that is still waiting for the provider when the owner acts on the queue.
 *  - pending: it is young; it may still be answered, so nothing is changed
 *  - review:  it never settled within `HUNG_CLAIM_MS` and was given up. Its
 *             row is held as unconfirmed for the owner's choice, never resent.
 */
export async function settleSharedSend(
  sessionId: string,
): Promise<"pending" | "review" | undefined> {
  const entry = localQueues.get(sessionId);
  if (!entry?.claiming) return undefined;
  // The clock runs from the provider call, not from the claim: the run lease, the
  // preparation and any dialog before it are waiting for someone, not hung.
  if (entry.sendStartedAt === undefined || Date.now() - entry.sendStartedAt < HUNG_CLAIM_MS)
    return "pending";
  if (!entry.abandon) return "pending";
  entry.abandon();
  await entry.released;
  return (await entry.client.unconfirmed()) ? "review" : "pending";
}

/**
 * Explicit Resume also acquires desktop ownership and awaits durable release.
 * It always ends in one of the `SharedResume` answers. A send that never
 * settles is given up after `HUNG_CLAIM_MS`, so Stop is not the only way out.
 */
export async function resumeSharedLocalQueue(
  sessionId: string,
  isCurrent: () => boolean = () => true,
): Promise<SharedResume> {
  const entry = localQueues.get(sessionId);
  if (!entry) return "resumed";
  const stuck = await settleSharedSend(sessionId);
  if (stuck) return stuck;
  if (lateSettlementPossible(sessionId)) return "late";
  // A Resume that never finished (the host did not answer) is replaced here.
  const { release } = takeQueue(entry);
  try {
    entry.publish();
    if (await entry.client.unconfirmed()) return "review";
    await entry.client.retry();
    if (!isCurrent()) throw new Error("Queue resume was cancelled. The messages remain queued.");
    if (
      !entry.client.update((queue) => ({ ...queue, status: "active", editingId: undefined }), true)
    )
      throw new Error(
        entry.client.snapshot().error ?? "The queue is being sent elsewhere. Wait and try again.",
      );
    await entry.client.sync();
    if (!isCurrent()) {
      entry.client.update((queue) => ({ ...queue, status: entry.read().status ?? "paused" }));
      await entry.client.sync();
      throw new Error("Queue resume was cancelled. The messages remain queued.");
    }
    if (!entry.client.canDrain())
      throw new Error(
        entry.client.snapshot().error ?? "The queue could not be resumed. Try again.",
      );
    return "resumed";
  } finally {
    release();
    entry.apply();
    runTick?.();
  }
}

/**
 * The owner pressed Stop: a send that is still unsettled pauses the queue when it
 * settles, even if the display already shows the queue paused, so a late success
 * does not start draining against the Stop.
 */
export function noteSharedLocalStop(sessionId: string): void {
  localQueues.get(sessionId)?.client.noteStop();
}

/** Whether a sent row has no acknowledgement yet (never while a send is in flight). */
export async function sharedLocalDeliveryUnconfirmed(sessionId: string): Promise<boolean> {
  const entry = localQueues.get(sessionId);
  if (!entry || entry.claiming) return false;
  return entry.client.unconfirmed();
}

export function sharedLocalQueueReady(sessionId: string): boolean {
  const entry = localQueues.get(sessionId);
  // While a given-up send may still be answered, sending its row again could duplicate it.
  return (
    !entry || (!entry.claiming && entry.client.canDrain() && !lateSettlementPossible(sessionId))
  );
}
export function sharedLocalQueueClaiming(sessionId: string): boolean {
  return !!localQueues.get(sessionId)?.claiming;
}

export function useSharedLocalQueues(
  sessionsRef: MutableRefObject<Session[]>,
  setSessions: (update: (sessions: Session[]) => Session[]) => void,
  hostReachable: MutableRefObject<boolean>,
  /** Called when the sessions changed (not for streamed text): a local queue edit
   * or a settle wakes the dispatcher at once instead of waiting for a timer. */
  subscribeSessions?: (listener: () => void) => () => void,
): void {
  useEffect(() => {
    let stopped = false;
    let running = false;
    /** A wake arrived while a pass ran: run once more when it ends. */
    let again = false;
    /** The slow pass reads every queue; focus/visibility/reachability catch up the interactive ones. */
    let safety = false;
    let catchUp = false;
    let errorDelay = ERROR_RETRY_MS;
    let leaseTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let machine: RemoteMachine | undefined;
    let checkedAt = 0;
    const owned = new Set<string>();
    windowSessions = () => sessionsRef.current;
    /** A conversation that left this window (moved or deleted) is no longer its queue to serve:
     * the lease it holds is not renewed, so it runs out and the queue goes to whoever shows it now. */
    const prune = () => {
      let pruned = false;
      for (const id of owned) {
        const entry = localQueues.get(id);
        if (entry?.claiming || sessionById(sessionsRef.current, id)) continue;
        localQueues.delete(id);
        owned.delete(id);
        woken.delete(id);
        setQueueHoldReason(id, undefined);
        // Give the lease back now: no other window should wait for it to run out.
        void entry?.client.releaseLease();
        pruned = true;
      }
      if (pruned) notifyQueues();
    };
    const tick = async () => {
      if (running) {
        again = true;
        return;
      }
      prune();
      for (const id of owned) {
        const entry = localQueues.get(id);
        if (!entry || entry.claiming) continue;
        const before = entry.observed;
        entry.publish();
        // A local edit (even one that empties the queue) goes out on this tick.
        if (entry.observed !== before) entry.nextIdleSyncAt = 0;
      }
      if (!hostReachable.current) return;
      // Hidden windows keep serving busy and queued sessions only.
      const hidden = typeof document !== "undefined" && document.hidden;
      const forceAll = safety;
      const catchingUp = catchUp;
      safety = false;
      catchUp = false;
      again = false;
      let initPending = false;
      running = true;
      try {
        if (!machine || Date.now() - checkedAt > 15_000) {
          checkedAt = Date.now();
          const machines = await invoke<RemoteMachine[]>("remote_machines");
          const found = machines.find(isLocalSyncMachine);
          const capabilities = found && (await loadRemoteCapabilities(found.environmentId));
          machine = found && capabilities?.includes(SHARED_QUEUE_CAPABILITY) ? found : undefined;
        }
        if (!machine || stopped) return;
        let idleInitializations = 0;
        // Interactive sessions go first; opening a project with much history
        // must not put its active queue behind every empty historical queue.
        // A queue another computer just changed is read even if idle or hidden.
        const changed = wakeAll
          ? sessionsRef.current.filter((session) => localQueues.has(session.id))
          : [...woken].flatMap((id) => {
              const session = sessionById(sessionsRef.current, id);
              return session ? [session] : [];
            });
        const wokenNow = new Set(changed.map((session) => session.id));
        wakeAll = false;
        woken.clear();
        const candidates = wokenNow.size
          ? [...changed, ...syncOrder(sessionsRef.current).filter((s) => !wokenNow.has(s.id))]
          : syncOrder(sessionsRef.current);
        for (const session of candidates) {
          if (stopped) return;
          if (!queueEligible(session)) continue;
          let entry = localQueues.get(session.id);
          const justChanged = wokenNow.has(session.id);
          if (justChanged && entry) entry.nextIdleSyncAt = 0;
          const interactive = interactiveSession(session) || justChanged;
          // Sorted interactive-first: nothing after the first idle one needs a hidden sync.
          if (!interactive && hidden) break;
          if (!entry && !interactive && idleInitializations++ >= 8) {
            initPending = true;
            continue;
          }
          // Only what was woken, what a catch-up or the safety pass asks for, a
          // failed queue, or one that is due is read: no interactive queue is polled.
          if (
            entry &&
            !justChanged &&
            !forceAll &&
            !(catchingUp && interactive) &&
            !entry.client.snapshot().error &&
            Date.now() < entry.nextIdleSyncAt
          )
            continue;
          if (!entry) {
            const client = new SharedQueueClient(
              machine.id,
              machine.environmentId,
              session.id,
              desktopQueueClientId,
            );
            entry = {
              client,
              observed: fields(session),
              claiming: false,
              claimedAt: 0,
              nextIdleSyncAt: 0,
              stateKey: stateKeyOf(session),
              ready: false,
              apply: () => {},
              publish: () => true,
              read: () => fields(sessionById(sessionsRef.current, session.id) ?? session),
              held: (steer) => {
                const latest = sessionById(sessionsRef.current, session.id);
                return (
                  !!latest &&
                  ((!steer && !!latest.busy) ||
                    !!latest.continuingElsewhere ||
                    !!latest.adoptedSyncConflict)
                );
              },
            };
            const current = entry;
            current.apply = (allowClaim = false) => {
              const state = client.snapshot();
              if (!state.loaded || (current.claiming && !allowClaim) || stopped) return;
              if (!current.claiming && !current.publish()) return;
              const latest = client.snapshot();
              const queue: RemoteQueue = {
                messages: latest.queue.messages,
                editingId: latest.queue.editingId,
                // An unconfirmed delivery is a hold the owner must decide. Whoever
                // holds the drain lease is not a status: nothing waits for a click.
                status: latest.recovery ? "paused" : latest.queue.status,
              };
              current.observed = queue;
              setQueueHoldReason(
                session.id,
                queue.status === "paused"
                  ? (latest.queue.holdReason ?? (latest.notice ? t(latest.notice) : undefined))
                  : undefined,
              );
              // Becoming able to send changes no queue field, yet the dispatcher must look again.
              const ready = client.canDrain() && !lateSettlementPossible(session.id);
              const woke = ready && !current.ready;
              current.ready = ready;
              setSessions((sessions) => {
                const existing = sessionById(sessions, session.id);
                if (!existing) return sessions;
                // This window's Resume in flight is its own: a read of the host's
                // (not yet resumed) queue must not cancel it half way.
                const shown: RemoteQueue =
                  existing.queueStatus === "resuming" && queue.status !== "active"
                    ? { ...queue, status: "resuming" }
                    : queue;
                if (sameQueueValue(fields(existing), shown))
                  return woke ? sessions.slice() : sessions;
                const next = sessions.map((value) =>
                  value.id === session.id && !sameQueueValue(fields(value), shown)
                    ? { ...value, ...queueSessionFields(shown) }
                    : value,
                );
                return next;
              });
            };
            current.publish = () => {
              const value = sessionById(sessionsRef.current, session.id);
              if (!value) return true;
              const next = outgoing(value, current.observed);
              if (sameQueueValue(current.observed, next)) return true;
              const before = current.observed;
              const changed = client.mergeLocal(
                before,
                next,
                next.status === "active" && before.status !== "active",
              );
              if (changed) current.observed = next;
              return changed;
            };
            localQueues.set(session.id, current);
            notifyQueues();
            owned.add(session.id);
            await client.initialize(current.observed);
            current.nextIdleSyncAt = Date.now() + IDLE_SYNC_MS;
            current.apply();
          } else if (entry.claiming) {
            // A send owns the queue: the change is read once it is released.
            if (justChanged) woken.add(session.id);
          } else {
            entry.nextIdleSyncAt = Date.now() + IDLE_SYNC_MS;
            if (!entry.client.snapshot().loaded) {
              await entry.client.initialize(entry.observed);
              entry.apply();
              continue;
            }
            entry.publish();
            try {
              await entry.client.sync();
            } catch {}
            entry.apply();
          }
        }
      } catch (error) {
        console.warn("Shared queue synchronization is pending", error);
      } finally {
        running = false;
        if (!stopped) {
          rearm(initPending && !hidden);
          if (again) void tick();
        }
      }
    };
    /** The only timers besides the safety pass, each armed for one known moment:
     * the earliest expiry of another window's lease on a queue waiting to be sent
     * (this window may take it over then), a failed queue's retry with backoff,
     * and the next batch of idle queues still to be looked at once. */
    const rearm = (moreIdleQueues: boolean) => {
      if (leaseTimer !== undefined) clearTimeout(leaseTimer);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      leaseTimer = retryTimer = undefined;
      let leaseAt: number | undefined;
      let failed = false;
      for (const id of owned) {
        const client = localQueues.get(id)?.client;
        if (!client) continue;
        const end = client.foreignLeaseEnds();
        if (end !== undefined) leaseAt = Math.min(leaseAt ?? end, end);
        if (client.snapshot().error) failed = true;
      }
      if (leaseAt !== undefined)
        leaseTimer = setTimeout(
          () => {
            for (const id of owned) {
              const end = localQueues.get(id)?.client.foreignLeaseEnds();
              if (end === undefined || end - Date.now() < 1_000) woken.add(id);
            }
            void tick();
          },
          Math.max(0, leaseAt - Date.now()) + 250,
        );
      if (!failed) errorDelay = ERROR_RETRY_MS;
      else if (hostReachable.current) {
        retryTimer = setTimeout(() => void tick(), errorDelay);
        errorDelay = Math.min(errorDelay * 2, IDLE_SYNC_MS);
      }
      if (moreIdleQueues && retryTimer === undefined)
        retryTimer = setTimeout(() => void tick(), ERROR_RETRY_MS);
    };
    /** This window is closing: the leases it holds go back to the host. */
    const releaseAll = () => {
      for (const id of owned) {
        const entry = localQueues.get(id);
        if (entry && !entry.claiming) void entry.client.releaseLease();
      }
    };
    window.addEventListener("pagehide", releaseAll);
    const timer = setInterval(() => {
      safety = true;
      void tick();
    }, IDLE_SYNC_MS);
    runTick = () => void tick();
    // Back on screen, focused, or the host reachable again: catch up at once.
    const onCatchUp = () => {
      catchUp = true;
      void tick();
    };
    const onVisible = () => {
      if (!document.hidden) onCatchUp();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onCatchUp);
    window.addEventListener(LOCAL_HOST_REACHABLE_EVENT, onCatchUp);
    // A local queue edit, a turn that settled or started, or a conversation the
    // host took over: the session changed, so the dispatcher looks at its queue.
    const checked = new WeakSet<Session>();
    const unsubscribe = subscribeSessions?.(() => {
      prune();
      let attention = false;
      for (const session of sessionsRef.current) {
        if (checked.has(session)) continue;
        checked.add(session);
        if (!queueEligible(session)) continue;
        const entry = localQueues.get(session.id);
        if (!entry) {
          if (interactiveSession(session)) attention = true;
          continue;
        }
        const key = stateKeyOf(session);
        if (key !== entry.stateKey) {
          entry.stateKey = key;
          entry.nextIdleSyncAt = 0;
          attention = true;
        } else if (
          !entry.claiming &&
          !sameQueueValue(entry.observed, outgoing(session, entry.observed))
        )
          attention = true;
      }
      if (attention) void tick();
    });
    void tick();
    return () => {
      stopped = true;
      window.removeEventListener("pagehide", releaseAll);
      clearInterval(timer);
      if (leaseTimer !== undefined) clearTimeout(leaseTimer);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      unsubscribe?.();
      runTick = undefined;
      windowSessions = undefined;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onCatchUp);
      window.removeEventListener(LOCAL_HOST_REACHABLE_EVENT, onCatchUp);
      for (const id of owned) localQueues.delete(id);
      notifyQueues();
    };
  }, [sessionsRef, setSessions, hostReachable]);
}
