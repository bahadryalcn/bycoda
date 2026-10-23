import { invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore, type MutableRefObject } from "react";
import type { QueuedMessage, Session } from "../../sessions/model/session";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { loadRemoteCapabilities } from "./connections";
import { isLocalSyncMachine } from "./localSync";
import type { RemoteMachine } from "./protocol";
import { queueSessionFields, type RemoteQueue } from "./remoteQueue";
import { sameQueueValue, SHARED_QUEUE_CAPABILITY } from "./sharedQueue";
import { desktopQueueClientId, SharedQueueClient } from "./sharedQueueClient";
import {
  beginDeliveryProgress,
  updateDeliveryProgress,
} from "../../sessions/model/deliveryProgress";
import { DeliveryUnknownError } from "../../../shared/lib/deliveryUnknown";

type Entry = {
  client: SharedQueueClient;
  observed: RemoteQueue;
  claiming: boolean;
  nextIdleSyncAt: number;
  apply: (allowClaim?: boolean) => void;
  publish: () => boolean;
  read: () => RemoteQueue;
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
/** Idle queues change only through another device; their safety re-read is slow. */
const IDLE_SYNC_MS = 60_000;
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
  entry.claiming = true;
  const progress = beginDeliveryProgress(sessionId, id, "syncing");
  const heldStatus = entry.read().status;
  let failure: string | undefined;
  let token: string | undefined;
  let accepted = false;
  let uncertain = false;
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
        throw new Error(
          entry.client.snapshot().error ??
            "Another send owns this queue. Wait for its confirmation.",
        );
    }
    updateDeliveryProgress(sessionId, progress, "claiming");
    token = await entry.client.claim(id, steer);
    if (!token)
      throw new Error(
        entry.client.snapshot().error ?? "Another send owns this queue. Wait for its confirmation.",
      );
    if (!isCurrent()) {
      failure = "The selected message or turn changed while waiting. The message remains queued.";
      return false;
    }
    entry.apply(true);
    const message = entry.client.snapshot().queue.messages.find((row) => row.id === id);
    if (!message) return false;
    uncertain = true;
    updateDeliveryProgress(sessionId, progress, "preparing");
    accepted = await send(message);
    uncertain = false;
    if (!accepted)
      failure =
        "The send was cancelled or rejected. The message remains queued and the queue is paused.";
    return accepted;
  } catch (error) {
    failure = String(error).replace(/^Error: /, "");
    if (error instanceof DeliveryUnknownError && token) {
      const heldToken = token;
      failure =
        "Delivery is not confirmed. The message is held and will not be sent again automatically.";
      void error.settlement.then(async (result) => {
        if (result === "unknown") return;
        try {
          await entry.client.sync().catch(() => {});
          // An explicit recovery decision may already have settled this token,
          // or a newer send may own the queue. Never rewrite its journal.
          if (entry.client.snapshot().queue.claim?.token !== heldToken) return;
          await entry.client.finish(heldToken, result === "accepted");
          entry.apply();
          updateDeliveryProgress(
            sessionId,
            progress,
            result === "accepted" ? "accepted" : "rejected",
            result === "accepted"
              ? "The provider confirmed delivery. The message was not sent again."
              : "The provider rejected the message. It remains queued and paused.",
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
        await entry.client.finish(token, accepted);
        if (!accepted) {
          const local = entry.read();
          entry.client.update((queue) => ({
            ...queue,
            status:
              local.status === "paused" || local.status === "restored"
                ? local.status
                : heldStatus === "restored"
                  ? "restored"
                  : "paused",
            editingId: local.editingId,
          }));
          await entry.client.sync();
        }
      } catch (error) {
        console.warn("Shared queued send acknowledgement is pending", error);
      }
    }
    entry.claiming = false;
    entry.apply();
    updateDeliveryProgress(
      sessionId,
      progress,
      accepted ? "accepted" : uncertain ? "unknown" : "rejected",
      failure,
    );
  }
}

/** Explicit Resume also acquires desktop ownership and awaits durable release. */
export async function resumeSharedLocalQueue(
  sessionId: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const entry = localQueues.get(sessionId);
  if (!entry) return;
  if (entry.claiming) throw new Error("A queue action is already waiting for confirmation.");
  entry.claiming = true;
  try {
    entry.publish();
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
  } finally {
    entry.claiming = false;
    entry.apply();
  }
}

export function sharedLocalQueueReady(sessionId: string): boolean {
  const entry = localQueues.get(sessionId);
  return !entry || (!entry.claiming && entry.client.canDrain());
}
export function sharedLocalQueueClaiming(sessionId: string): boolean {
  return !!localQueues.get(sessionId)?.claiming;
}

export function useSharedLocalQueues(
  sessionsRef: MutableRefObject<Session[]>,
  setSessions: (update: (sessions: Session[]) => Session[]) => void,
  hostReachable: MutableRefObject<boolean>,
): void {
  useEffect(() => {
    let stopped = false;
    let running = false;
    let machine: RemoteMachine | undefined;
    let checkedAt = 0;
    const owned = new Set<string>();
    const tick = async () => {
      if (running) return;
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
        const candidates = syncOrder(sessionsRef.current);
        for (const session of candidates) {
          if (stopped) return;
          if (
            session.inboxAsk ||
            session.worktreeRemoved ||
            isRemoteProjectPath(session.cwd) ||
            !session.blocks.some((block) => block.role === "user" && !block.draft)
          )
            continue;
          let entry = localQueues.get(session.id);
          const interactive = interactiveSession(session);
          // Sorted interactive-first: nothing after the first idle one needs a hidden sync.
          if (!interactive && hidden) break;
          if (!entry && !interactive && idleInitializations++ >= 8) continue;
          if (
            entry &&
            !interactive &&
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
              nextIdleSyncAt: 0,
              apply: () => {},
              publish: () => true,
              read: () => fields(sessionById(sessionsRef.current, session.id) ?? session),
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
                status:
                  latest.error ||
                  (latest.queue.consumer !== client.clientId && latest.queue.status === "active")
                    ? "restored"
                    : latest.queue.status,
              };
              current.observed = queue;
              setSessions((sessions) => {
                const existing = sessionById(sessions, session.id);
                if (!existing || sameQueueValue(fields(existing), queue)) return sessions;
                const next = sessions.map((value) =>
                  value.id === session.id && !sameQueueValue(fields(value), queue)
                    ? { ...value, ...queueSessionFields(queue) }
                    : value,
                );
                return next;
              });
            };
            current.publish = () => {
              const value = sessionById(sessionsRef.current, session.id);
              if (!value) return true;
              const next = fields(value);
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
          } else if (!entry.claiming) {
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
      }
    };
    const timer = setInterval(() => void tick(), 1500);
    // Back on screen: catch up at once instead of waiting for the next tick.
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      for (const id of owned) localQueues.delete(id);
      notifyQueues();
    };
  }, [sessionsRef, setSessions, hostReachable]);
}
