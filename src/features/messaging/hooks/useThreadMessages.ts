import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../../shared/lib/errors";
import { listThreadMessages } from "../model/messagingApi";
import type { MessageThread, ThreadMessage } from "../model/messagingTypes";
import {
  appendThreadMessage,
  extendThreadPage,
  refreshThreadPage,
  type ThreadPageState,
} from "../model/threadMessages";
import { threadKey } from "../model/messageThreads";
import {
  accountGeneration,
  isAccountLive,
  rememberThreadPage,
  subscribeMessagingCaches,
  threadPageCache,
} from "../model/messagingCache";

type LoadedState = {
  key: string;
  page: ThreadPageState | null;
  error: string | null;
};

type EarlierState = { key: string; loading: boolean; error: string | null };

/**
 * Messages of one thread, oldest first, as the newest page plus any earlier pages the reader
 * opened. A refresh merges the newest page into what is loaded instead of replacing it; a
 * response for a thread that is no longer the requested one is dropped; the cached newest page
 * shows at once while a reload runs.
 */
export function useThreadMessages(thread: MessageThread) {
  const key = threadKey(thread);
  const [state, setState] = useState<LoadedState>(() => ({
    key,
    page: threadPageCache.get(key) ?? null,
    error: null,
  }));
  const [earlierState, setEarlierState] = useState<EarlierState>({
    key,
    loading: false,
    error: null,
  });
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const earlierRequest = useRef(0);
  const earlierPending = useRef(false);
  const { accountId, id: threadId } = thread;

  /** `replace` (an explicit reload) starts over from the newest page; a refresh merges into it. */
  const load = useCallback(
    (replace: boolean) => {
      const requestKey = threadKey({ accountId, id: threadId });
      const token = ++request.current;
      const generation = accountGeneration(accountId);
      // Stale once a newer load started, or the account was dropped (removed, disconnected, re-identified).
      const stale = () => token !== request.current || accountGeneration(accountId) !== generation;
      Promise.resolve()
        .then(() => {
          if (token === request.current) setLoading(true);
          return listThreadMessages(accountId, threadId);
        })
        .then((page) => {
          if (stale()) return;
          const messages = Array.isArray(page.messages) ? page.messages : [];
          const newest = { messages, earlier: page.earlier };
          rememberThreadPage(requestKey, refreshThreadPage(null, newest));
          setState((previous) => ({
            key: requestKey,
            page: refreshThreadPage(
              replace || previous.key !== requestKey ? null : previous.page,
              newest,
            ),
            error: null,
          }));
        })
        .catch((error: unknown) => {
          if (stale()) return;
          setState((previous) => ({
            key: requestKey,
            page: previous.key === requestKey ? previous.page : null,
            error: errorText(error),
          }));
        })
        .finally(() => {
          if (token === request.current) setLoading(false);
        });
    },
    [accountId, threadId],
  );

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Drop the conversation and outstanding reads when the shared account cache is cleared.
  useEffect(
    () =>
      subscribeMessagingCaches((dropped) => {
        if (dropped !== accountId) return;
        request.current += 1;
        earlierRequest.current += 1;
        earlierPending.current = false;
        setLoading(false);
        setState({ key: threadKey({ accountId, id: threadId }), page: null, error: null });
        setEarlierState({
          key: threadKey({ accountId, id: threadId }),
          loading: false,
          error: null,
        });
      }),
    [accountId, threadId],
  );

  // A new thread or newer activity refreshes; the cleanup's token bump drops a response for
  // the previous thread or one that lands after unmount.
  useEffect(() => {
    load(false);
    return () => {
      request.current += 1;
    };
  }, [load, thread.updatedAt]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Invalidate outstanding pagination requests when the thread changes or unmounts.
  useEffect(
    () => () => {
      earlierRequest.current += 1;
      earlierPending.current = false;
    },
    [accountId, threadId],
  );

  const view =
    state.key === key ? state : { key, page: threadPageCache.get(key) ?? null, error: null };
  const cursor = view.page?.earlier ?? null;

  const loadEarlier = useCallback(() => {
    if (!cursor || earlierPending.current) return;
    const requestKey = threadKey({ accountId, id: threadId });
    const token = ++earlierRequest.current;
    earlierPending.current = true;
    setEarlierState({ key: requestKey, loading: true, error: null });
    listThreadMessages(accountId, threadId, cursor)
      .then((page) => {
        if (token !== earlierRequest.current) return;
        const messages = Array.isArray(page.messages) ? page.messages : [];
        setState((previous) => {
          if (previous.key !== requestKey || !previous.page) return previous;
          const next = extendThreadPage(previous.page, cursor, { messages, earlier: page.earlier });
          return next ? { ...previous, page: next } : previous;
        });
        setEarlierState({ key: requestKey, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (token !== earlierRequest.current) return;
        setEarlierState({ key: requestKey, loading: false, error: errorText(error) });
      })
      .finally(() => {
        if (token === earlierRequest.current) earlierPending.current = false;
      });
  }, [accountId, threadId, cursor]);

  /** Adds a sent message to this thread, even if the user moved to another thread meanwhile. */
  const append = useCallback(
    (message: ThreadMessage) => {
      const target = threadKey({ accountId, id: threadId });
      const cached = threadPageCache.get(target);
      const next = {
        messages: appendThreadMessage(cached?.messages ?? [], message),
        earlier: cached?.earlier ?? null,
      };
      // A reply sent after its account was dropped stays out of the cache.
      if (isAccountLive(accountId)) rememberThreadPage(target, next);
      setState((previous) =>
        previous.key === target
          ? {
              ...previous,
              page: {
                messages: appendThreadMessage(previous.page?.messages ?? [], message),
                earlier: previous.page?.earlier ?? null,
              },
            }
          : { key: target, page: next, error: null },
      );
    },
    [accountId, threadId],
  );

  const reload = useCallback(() => load(true), [load]);
  const earlier = earlierState.key === key ? earlierState : null;
  return {
    messages: view.page?.messages ?? null,
    error: view.error,
    loading,
    reload,
    append,
    hasEarlier: cursor !== null,
    loadingEarlier: earlier?.loading ?? false,
    earlierError: earlier?.error ?? null,
    loadEarlier,
  };
}
