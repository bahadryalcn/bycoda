import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelSessionSearch,
  searchSessionContent,
  type SessionContentResult,
} from "../../sessions/data/sessionStore";

type Options = Omit<Parameters<typeof searchSessionContent>[0], "searchOwner">;
const EMPTY: SessionContentResult = {
  sessions: [],
  truncated: false,
  pending: 0,
};

/** Own the request lifecycle separately from the file-search channel. */
export function useConversationSearch(enabled: boolean, options: Options) {
  const key = JSON.stringify(options);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [retryTick, setRetryTick] = useState(0);
  const [state, setState] = useState({
    key: "",
    result: EMPTY,
    error: null as string | null,
    loading: false,
  });
  const retry = useCallback(() => setRetryTick((value) => value + 1), []);

  useEffect(() => {
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
      }));
      try {
        const result = await searchSessionContent({
          ...requestOptions,
          searchOwner,
        });
        if (cancelled) return;
        setState({ key, result, error: null, loading: false });
        if (result.pending > 0) timer = setTimeout(() => void run(), 2000);
      } catch (reason) {
        if (cancelled) return;
        setState((previous) => ({
          key,
          result: previous.key === key ? previous.result : EMPTY,
          error: reason instanceof Error ? reason.message : String(reason),
          loading: false,
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
    loading: active && (!current || state.loading),
    retry,
  };
}
