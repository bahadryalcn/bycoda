import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelSessionSearch,
  searchSessionContent,
  type SessionContentResult,
} from "../../sessions/data/sessionStore";

type Options = Omit<Parameters<typeof searchSessionContent>[0], "searchOwner" | "retryIndex">;
const EMPTY: SessionContentResult = {
  sessions: [],
  truncated: false,
  pending: 0,
};

/** Own the request lifecycle separately from the file-search channel. */
export function useConversationSearch(enabled: boolean, options: Options, revision?: string) {
  const key = JSON.stringify([options, revision]);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [retryTick, setRetryTick] = useState(0);
  const retryIndexKey = useRef<string | null>(null);
  const [state, setState] = useState({
    key: "",
    result: EMPTY,
    error: null as string | null,
    loading: false,
    attempt: 0,
  });
  const retry = useCallback(() => {
    retryIndexKey.current = key;
    setRetryTick((value) => value + 1);
  }, [key]);

  useEffect(() => {
    if (retryIndexKey.current !== key) retryIndexKey.current = null;
    if (!enabled || !optionsRef.current.query.trim()) return;
    let cancelled = false;
    let owner: string | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const requestOptions = optionsRef.current;
    const run = async () => {
      const searchOwner = crypto.randomUUID();
      owner = searchOwner;
      setState((previous) => ({
        key,
        result: previous.key === key ? previous.result : EMPTY,
        error: null,
        loading: true,
        attempt: retryTick,
      }));
      try {
        const retryCurrentIndex = retryIndexKey.current === key;
        if (retryCurrentIndex) retryIndexKey.current = null;
        const result = await searchSessionContent({
          ...requestOptions,
          searchOwner,
          ...(retryCurrentIndex ? { retryIndex: true } : {}),
        });
        if (cancelled) return;
        setState({
          key,
          result,
          error: result.indexError ?? null,
          loading: false,
          attempt: retryTick,
        });
        if (result.pending > 0 && !result.indexError) timer = setTimeout(() => void run(), 2000);
      } catch (reason) {
        if (cancelled) return;
        setState((previous) => ({
          key,
          result: previous.key === key ? previous.result : EMPTY,
          error: reason instanceof Error ? reason.message : String(reason),
          loading: false,
          attempt: retryTick,
        }));
      } finally {
        if (owner === searchOwner) owner = null;
      }
    };
    timer = setTimeout(() => void run(), 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (owner) void cancelSessionSearch(owner).catch(() => undefined);
    };
  }, [enabled, key, retryTick]);

  const active = enabled && !!options.query.trim();
  const current = active && state.key === key;
  return {
    result: current ? state.result : EMPTY,
    error: current ? state.error : null,
    loading: active && (!current || state.attempt !== retryTick || state.loading),
    retry,
  };
}
