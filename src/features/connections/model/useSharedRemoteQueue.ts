import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { subscribeRemoteRecovered } from "./remoteHealth";
import { remoteBackoffDelay } from "./remotePollingPolicy";
import { loadStoredQueue, setSessionQueue } from "../../sessions/data/sessionStore";
import type { Attachment } from "../../sessions/model/session";
import { SharedQueueClient } from "./sharedQueueClient";
import { sharedQueueStorageId } from "./sharedQueue";
import {
  editRemoteMessage,
  enqueueRemoteMessage,
  pauseRemoteQueue,
  releaseRemoteQueue,
  removeRemoteMessage,
  reorderRemoteMessages,
  setRemoteEditing,
  type RemoteQueueDraft,
} from "./remoteQueue";
import { useRemoteQueue } from "./useRemoteQueue";

/** Old hosts retain their existing local queue; upgraded hosts own shared state. */
export function useSharedRemoteQueue(
  key: string | undefined,
  machineId: string,
  environmentId: string,
  enabled: boolean,
) {
  const fallback = useRemoteQueue(enabled ? undefined : key);
  const client = useMemo(
    () => (enabled && key ? new SharedQueueClient(machineId, environmentId, key) : undefined),
    [key, machineId, environmentId, enabled],
  );
  const empty = useMemo(() => ({ queue: { messages: [], revision: 0 }, loaded: false }), []);
  const state = useSyncExternalStore(
    client?.subscribe ?? (() => () => {}),
    client?.snapshot ?? (() => empty),
  );
  const initializeRef = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    if (!client || !key) return;
    let stopped = false;
    let initializing: Promise<void> | undefined;
    let polling: Promise<void> | undefined;
    let wakePending = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const storedKey = sharedQueueStorageId(environmentId, key);
    const initialize = (): Promise<void> => {
      if (stopped) return Promise.resolve();
      if (initializing) return initializing;
      const request = loadStoredQueue(storedKey)
        .then(async (messages) => (messages.length ? messages : loadStoredQueue(key)))
        .then(async (messages) => {
          if (!stopped) await client.initialize({ messages, status: "restored" });
        })
        .finally(() => {
          if (initializing === request) initializing = undefined;
        });
      initializing = request;
      return request;
    };
    initializeRef.current = initialize;
    const poll = () => {
      if (stopped) return;
      if (polling) {
        wakePending = true;
        return;
      }
      const request = client.snapshot().loaded ? client.sync() : initialize();
      polling = request
        .catch((error) => {
          if (!stopped) client.hold(error);
        })
        .finally(() => {
          polling = undefined;
          if (stopped) return;
          failures = client.snapshot().error ? Math.min(4, failures + 1) : 0;
          timer = setTimeout(
            poll,
            wakePending ? 0 : failures ? remoteBackoffDelay(failures) : 1500,
          );
          wakePending = false;
        });
    };
    const wake = () => {
      if (stopped) return;
      clearTimeout(timer);
      poll();
    };
    const visible = () => {
      if (!document.hidden) wake();
    };
    const stopRecovered = subscribeRemoteRecovered((recovered) => {
      if (!recovered || recovered === environmentId) wake();
    });
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", visible);
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stopRecovered();
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", visible);
      if (initializeRef.current === initialize) initializeRef.current = undefined;
    };
  }, [client, key, environmentId]);
  useEffect(() => {
    if (client && key && state.loaded)
      void setSessionQueue(sharedQueueStorageId(environmentId, key), state.queue.messages).catch(
        () => {},
      );
  }, [client, key, environmentId, state.queue.messages, state.loaded]);
  if (!enabled || !client)
    return {
      ...fallback,
      release: async (isCurrent: () => boolean = () => true) => {
        if (!isCurrent())
          throw new Error("Queue resume was cancelled. The messages remain queued.");
        fallback.release();
        return true;
      },
      canDrain: true,
      dispatch: (_id: string, _selected = false) => undefined,
      prepareSend: async (selected = false) => {
        if (selected) fallback.pause();
        return true;
      },
    };
  return {
    queue: state.queue,
    current: () => client.snapshot().queue,
    loaded: state.loaded,
    error: state.error,
    retry: () => {
      const retry = state.loaded
        ? client.retry()
        : (initializeRef.current?.() ?? Promise.resolve());
      void retry.catch((error) => client.hold(error));
    },
    enqueue: (message: RemoteQueueDraft) =>
      client.update((queue) => enqueueRemoteMessage(queue, message)),
    remove: (id: string) => client.update((queue) => removeRemoteMessage(queue, id)),
    edit: (id: string, text: string, attachments: Attachment[]) =>
      client.update((queue) => editRemoteMessage(queue, id, text, attachments)),
    setEditing: (id?: string) => client.update((queue) => setRemoteEditing(queue, id)),
    reorder: (ids: string[]) => client.update((queue) => reorderRemoteMessages(queue, ids)),
    release: async (isCurrent: () => boolean = () => true) => {
      await client.retry();
      if (!isCurrent()) throw new Error("Queue resume was cancelled. The messages remain queued.");
      if (!client.update((queue) => ({ ...releaseRemoteQueue(queue), editingId: undefined }), true))
        throw new Error(
          client.snapshot().error ?? "The queue is being sent elsewhere. Wait and try again.",
        );
      await client.sync();
      if (!isCurrent()) {
        client.update(pauseRemoteQueue);
        await client.sync();
        throw new Error("Queue resume was cancelled. The messages remain queued.");
      }
      if (!client.canDrain())
        throw new Error(client.snapshot().error ?? "The queue could not be resumed. Try again.");
      if (client.snapshot().queue.status !== "active")
        throw new Error("Queue resume was cancelled. The messages remain queued.");
      return true;
    },
    pause: () => client.update(pauseRemoteQueue),
    // The host consumes a queued row with its command receipt, never with an optimistic UI return.
    sent: (_id: string) => {
      void client.sync().catch(() => {});
    },
    canDrain: client.canDrain(),
    dispatch: (id: string, selected = false) => client.dispatch(id, selected),
    prepareSend: async (selected = false) => {
      if (client.snapshot().error) {
        await client.retry();
        if (client.snapshot().error) return false;
      }
      if (
        !client.update(
          (queue) => ({
            ...(selected ? pauseRemoteQueue(queue) : releaseRemoteQueue(queue)),
            editingId: undefined,
          }),
          true,
        )
      )
        return false;
      await client.sync();
      return client.canDrain();
    },
  };
}
