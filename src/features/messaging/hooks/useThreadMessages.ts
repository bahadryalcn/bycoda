import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../../shared/lib/errors";
import { listThreadMessages } from "../model/messagingApi";
import type { MessageThread, ThreadMessage } from "../model/messagingTypes";
import { appendThreadMessage, sortThreadMessages } from "../model/threadMessages";
import { threadKey } from "../model/messageThreads";

const MAX_CACHED_THREADS = 50;
const cache = new Map<string, ThreadMessage[]>();

function remember(key: string, messages: ThreadMessage[]) {
  cache.delete(key);
  cache.set(key, messages);
  while (cache.size > MAX_CACHED_THREADS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Messages of one thread, oldest first. A response for a thread that is no longer the
 * requested one is dropped; cached messages show at once while a reload runs.
 */
export function useThreadMessages(thread: MessageThread) {
  const key = threadKey(thread);
  const [state, setState] = useState<{
    key: string;
    messages: ThreadMessage[] | null;
    error: string | null;
  }>(() => ({ key, messages: cache.get(key) ?? null, error: null }));
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const { accountId, id: threadId } = thread;

  const load = useCallback(() => {
    const requestKey = threadKey({ accountId, id: threadId });
    const token = ++request.current;
    Promise.resolve()
      .then(() => {
        if (token === request.current) setLoading(true);
        return listThreadMessages(accountId, threadId);
      })
      .then((messages) => {
        if (token !== request.current) return;
        const sorted = sortThreadMessages(Array.isArray(messages) ? messages : []);
        remember(requestKey, sorted);
        setState({ key: requestKey, messages: sorted, error: null });
      })
      .catch((error: unknown) => {
        if (token !== request.current) return;
        setState((previous) => ({
          key: requestKey,
          messages: previous.key === requestKey ? previous.messages : null,
          error: errorText(error),
        }));
      })
      .finally(() => {
        if (token === request.current) setLoading(false);
      });
  }, [accountId, threadId]);

  // A new thread or newer activity reloads; the cleanup's token bump drops a response for
  // the previous thread or one that lands after unmount.
  useEffect(() => {
    load();
    return () => {
      request.current += 1;
    };
  }, [load, thread.updatedAt]);

  /** Adds a sent message to this thread, even if the user moved to another thread meanwhile. */
  const append = useCallback(
    (message: ThreadMessage) => {
      const target = threadKey({ accountId, id: threadId });
      const next = appendThreadMessage(cache.get(target) ?? [], message);
      remember(target, next);
      setState((previous) =>
        previous.key === target
          ? { ...previous, messages: appendThreadMessage(previous.messages ?? [], message) }
          : { key: target, messages: next, error: null },
      );
    },
    [accountId, threadId],
  );

  const messages = state.key === key ? state.messages : (cache.get(key) ?? null);
  const error = state.key === key ? state.error : null;
  return { messages, error, loading, reload: load, append };
}
