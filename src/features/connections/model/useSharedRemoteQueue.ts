import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { subscribeRemoteRecovered } from "./remoteHealth";
import { remoteBackoffDelay } from "./remotePollingPolicy";
import { loadStoredQueue, setSessionQueue } from "../../sessions/data/sessionStore";
import type { Attachment } from "../../sessions/model/session";
import { SharedQueueClient } from "./sharedQueueClient";
import { sameQueueValue, sharedQueueStorageId, type SharedQueue } from "./sharedQueue";
import {
  editRemoteMessage,
  enqueueRemoteMessage,
  pauseRemoteQueue,
  releaseRemoteQueue,
  removeRemoteMessage,
  reorderRemoteMessages,
  resolveUnknownRow,
  setRemoteEditing,
  type RemoteQueueDraft,
} from "./remoteQueue";
import { useRemoteQueue } from "./useRemoteQueue";
import {
  setQueueHoldReason,
  type DeliveryReviewOutcome,
} from "../../sessions/model/deliveryReview";

/**
 * The queue is read when something says it may have changed (the session's
 * snapshot moved, the window was shown or focused, the host came back) and, as a
 * safety net, on this slow cadence while the window is visible. A hidden window
 * reads nothing until it is shown again.
 */
export const REMOTE_QUEUE_SAFETY_MS = 15_000;
/**
 * A moved session wakes the queue read at most this often. A running turn moves the
 * snapshot every flush; the queue is not read at that rate (the safety pass, focus
 * and a turn starting or ending still read it).
 */
export const REMOTE_QUEUE_WAKE_MIN_MS = 4_000;
/** A follow-up that could not be stored is tried again this many times, a little later each time. */
const KEEP_ATTEMPTS = 4;
const KEEP_RETRY_MS = 1_000;

/** Old hosts retain their existing local queue; upgraded hosts own shared state. */
export function useSharedRemoteQueue(
  key: string | undefined,
  machineId: string,
  environmentId: string,
  enabled: boolean,
  /** Changes when the host reported the session moved (its snapshot revision or status):
   * the queue is read at once instead of waiting for the safety pass. */
  wakeToken?: unknown,
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
  const wakeRef = useRef<(() => void) | undefined>(undefined);
  const lastWake = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    // The first token is the initial read, which the client effect makes itself.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const wait = lastWake.current + REMOTE_QUEUE_WAKE_MIN_MS - Date.now();
    const run = () => {
      lastWake.current = Date.now();
      wakeRef.current?.();
    };
    if (wait <= 0) {
      run();
      return;
    }
    // Too soon after the last wake: one read at the end of the window.
    const timer = setTimeout(run, wait);
    return () => clearTimeout(timer);
  }, [wakeToken]);
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
          if (!stopped) await client.initialize({ messages, status: "paused" });
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
          // A hidden window waits for being shown (`visible`); a visible one only
          // keeps the slow safety pass, plus the backoff of a failing read.
          const delay = wakePending
            ? 0
            : document.hidden
              ? undefined
              : failures
                ? remoteBackoffDelay(failures)
                : REMOTE_QUEUE_SAFETY_MS;
          if (delay !== undefined)
            timer = setTimeout(() => {
              if (!document.hidden) poll();
            }, delay);
          wakePending = false;
        });
    };
    const wake = () => {
      if (stopped) return;
      clearTimeout(timer);
      poll();
    };
    wakeRef.current = wake;
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
      if (wakeRef.current === wake) wakeRef.current = undefined;
      stopRecovered();
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", visible);
      if (initializeRef.current === initialize) initializeRef.current = undefined;
    };
  }, [client, key, environmentId]);
  // Why the host holds the queue (a Stop, a provider error), for the banner of this pane.
  useEffect(() => {
    if (!client || !key) return;
    setQueueHoldReason(
      key,
      state.queue.status === "paused" ? (state.queue as SharedQueue).holdReason : undefined,
    );
    return () => setQueueHoldReason(key, undefined);
  }, [client, key, state.queue]);
  // The native copy is written when the rows changed, not on every read of the host.
  const savedRows = useRef<{ id: string; rows: SharedQueue["messages"] }>(undefined);
  useEffect(() => {
    if (!client || !key || !state.loaded) return;
    const id = sharedQueueStorageId(environmentId, key);
    const saved = savedRows.current;
    if (saved?.id === id && sameQueueValue(saved.rows, state.queue.messages)) return;
    savedRows.current = { id, rows: state.queue.messages };
    void setSessionQueue(id, state.queue.messages).catch(() => {
      savedRows.current = undefined; // not written: try again with the next change
    });
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
      keep: async (message: RemoteQueueDraft, pause: boolean) => {
        try {
          fallback.enqueue(message);
        } catch {
          return false; // the saved queue is full
        }
        if (pause) fallback.pause();
        return true;
      },
      dispatch: (_id: string, _selected = false) => undefined,
      resolveDelivery: async (_id: string, _outcome: DeliveryReviewOutcome) => {},
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
      if (!client.canDrain() && !client.hostDrains())
        throw new Error(client.snapshot().error ?? "The queue could not be resumed. Try again.");
      if (client.snapshot().queue.status !== "active")
        throw new Error("Queue resume was cancelled. The messages remain queued.");
      return true;
    },
    pause: () => client.update(pauseRemoteQueue),
    /**
     * Settles a row whose delivery nobody confirmed, from this computer: the host
     * never sends such a row by itself. Delivered and discard take it out, send
     * again queues it and lets the queue drain, keep pauses the queue.
     */
    resolveDelivery: async (id: string, outcome: DeliveryReviewOutcome): Promise<void> => {
      if (client.snapshot().error || !client.snapshot().loaded) await client.retry();
      const row = client.snapshot().queue.messages.find((entry) => entry.id === id);
      if (!row?.deliveryUnknown) return; // another computer already decided
      if (!client.update((queue) => resolveUnknownRow(queue, id, outcome)))
        throw new Error(
          client.snapshot().error ?? "The queue is being sent elsewhere. Wait and try again.",
        );
      await client.sync(true);
      const left = client.snapshot().queue.messages.find((entry) => entry.id === id);
      if (client.snapshot().error || left?.deliveryUnknown)
        throw new Error(client.snapshot().error ?? "The choice could not be saved. Try again.");
    },
    /**
     * Puts a follow-up the host did not take back into the shared queue, paused
     * or not. The queue may be busy for a moment (the desktop is claiming a row,
     * a read is in flight), so this waits and tries again before it reports that
     * the message was not kept. It never drops the message on its own.
     */
    keep: async (message: RemoteQueueDraft, pause: boolean): Promise<boolean> => {
      for (let attempt = 0; attempt < KEEP_ATTEMPTS; attempt++) {
        if (attempt) {
          await new Promise((resolve) => setTimeout(resolve, KEEP_RETRY_MS * attempt));
          await client.retry().catch(() => {});
        }
        try {
          if (
            client.update((queue) => {
              const kept = queue.messages.some((row) => row.id === message.id)
                ? queue
                : enqueueRemoteMessage(queue, message);
              return pause ? pauseRemoteQueue(kept) : kept;
            })
          )
            return true;
        } catch {
          return false; // the queue is full: waiting does not make room
        }
      }
      return false;
    },
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
      return selected ? client.canSendSelected() : client.canDrain() || client.hostDrains();
    },
  };
}
