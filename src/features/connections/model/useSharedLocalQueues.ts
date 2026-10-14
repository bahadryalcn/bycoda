import { invoke } from "@tauri-apps/api/core";
import { useEffect, type MutableRefObject } from "react";
import type { QueuedMessage, Session } from "../../sessions/model/session";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { loadRemoteCapabilities } from "./connections";
import { isLocalSyncMachine } from "./localSync";
import type { RemoteMachine } from "./protocol";
import { queueSessionFields, type RemoteQueue } from "./remoteQueue";
import { sameQueueValue, SHARED_QUEUE_CAPABILITY } from "./sharedQueue";
import { desktopQueueClientId, SharedQueueClient } from "./sharedQueueClient";

type Entry = {
  client: SharedQueueClient;
  observed: RemoteQueue;
  claiming: boolean;
  apply: (allowClaim?: boolean) => void;
  publish: () => boolean;
  read: () => RemoteQueue;
};
const localQueues = new Map<string, Entry>();
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
  let token: string | undefined;
  let accepted = false;
  try {
    entry.publish();
    if (steer) {
      if (entry.client.snapshot().error) {
        await entry.client.retry();
        return false; // A recovered edit is shown as a paused copy before another send action.
      }
      await entry.client.retry();
      entry.client.update((queue) => ({ ...queue, status: "active", editingId: undefined }), true);
    }
    token = await entry.client.claim(id, steer);
    if (!token) return false;
    if (!isCurrent()) return false;
    entry.apply(true);
    const message = entry.client.snapshot().queue.messages.find((row) => row.id === id);
    if (!message) return false;
    accepted = await send(message);
    return accepted;
  } catch (error) {
    console.warn("Shared queued send is held", error);
    return false;
  } finally {
    if (token) {
      try {
        await entry.client.finish(token, accepted);
        if (!accepted) {
          const local = entry.read();
          entry.client.update((queue) => ({
            ...queue,
            status: local.status,
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
        if (entry && !entry.claiming) entry.publish();
      }
      if (!hostReachable.current) return;
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
        for (const session of sessionsRef.current) {
          if (stopped) return;
          if (
            session.inboxAsk ||
            session.worktreeRemoved ||
            isRemoteProjectPath(session.cwd) ||
            !session.blocks.some((block) => block.role === "user" && !block.draft)
          )
            continue;
          let entry = localQueues.get(session.id);
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
              apply: () => {},
              publish: () => true,
              read: () =>
                fields(sessionsRef.current.find((value) => value.id === session.id) ?? session),
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
                const existing = sessions.find((value) => value.id === session.id);
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
              const value = sessionsRef.current.find((row) => row.id === session.id);
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
            owned.add(session.id);
            await client.initialize(current.observed);
            current.apply();
          } else if (!entry.claiming) {
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
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
      for (const id of owned) localQueues.delete(id);
    };
  }, [sessionsRef, setSessions, hostReachable]);
}
