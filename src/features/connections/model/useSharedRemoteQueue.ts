import { useEffect, useMemo, useSyncExternalStore } from "react";
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
  useEffect(() => {
    if (!client || !key) return;
    let stopped = false;
    const storedKey = sharedQueueStorageId(environmentId, key);
    void loadStoredQueue(storedKey)
      .then(async (messages) => (messages.length ? messages : loadStoredQueue(key)))
      .then((messages) => {
        if (!stopped) return client.initialize({ messages, status: "restored" });
      })
      .catch((error) => {
        if (!stopped) client.hold(error);
      });
    const timer = setInterval(() => {
      if (!stopped && client.snapshot().loaded) void client.sync().catch(() => {});
    }, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
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
        : loadStoredQueue(sharedQueueStorageId(environmentId, key!))
            .then(async (messages) => (messages.length ? messages : loadStoredQueue(key!)))
            .then((messages) => client.initialize({ messages, status: "restored" }));
      void retry.catch((error) => client.hold(error));
    },
    enqueue: (message: RemoteQueueDraft) =>
      client.update((queue) => enqueueRemoteMessage(queue, message)),
    remove: (id: string) => client.update((queue) => removeRemoteMessage(queue, id)),
    edit: (id: string, text: string, attachments: Attachment[]) =>
      client.update((queue) => editRemoteMessage(queue, id, text, attachments)),
    setEditing: (id?: string) => client.update((queue) => setRemoteEditing(queue, id)),
    reorder: (ids: string[]) => client.update((queue) => reorderRemoteMessages(queue, ids)),
    release: () =>
      client.update((queue) => ({ ...releaseRemoteQueue(queue), editingId: undefined }), true),
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
        return false;
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
