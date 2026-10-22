import { useCallback, useEffect, useRef, useState } from "react";
import { cancelProjectSearch, searchProject, type ProjectSearchMatch } from "./search";

type Result = { matches: ProjectSearchMatch[]; truncated: boolean };
const EMPTY: Result = { matches: [], truncated: false };

/** Results belong to one project/query, including during the debounce interval. */
export function useProjectFileSearch(enabled: boolean, cwd: string, query: string) {
  const key = JSON.stringify([cwd, query]);
  const request = useRef({ cwd, query });
  request.current = { cwd, query };
  const [retryTick, setRetryTick] = useState(0);
  const [state, setState] = useState({
    key: "",
    result: EMPTY,
    error: null as string | null,
    loading: false,
  });
  const retry = useCallback(() => setRetryTick((value) => value + 1), []);

  useEffect(() => {
    if (!enabled || !request.current.query.trim()) return;
    let cancelled = false;
    let started = false;
    const searchId = crypto.randomUUID();
    const options = request.current;
    const timer = window.setTimeout(() => {
      started = true;
      setState({ key, result: EMPTY, error: null, loading: true });
      void searchProject({ ...options, searchId })
        .then(
          (result) => {
            if (!cancelled) setState({ key, result, error: null, loading: false });
          },
          (cause: unknown) => {
            if (!cancelled)
              setState({
                key,
                result: EMPTY,
                error: cause instanceof Error ? cause.message : String(cause),
                loading: false,
              });
          },
        )
        .finally(() => {
          started = false;
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (started) void cancelProjectSearch(options.cwd, searchId).catch(() => undefined);
    };
  }, [enabled, key, retryTick]);

  const active = enabled && !!query.trim();
  const current = active && state.key === key;
  return {
    result: current ? state.result : EMPTY,
    error: current ? state.error : null,
    loading: active && (!current || state.loading),
    retry,
  };
}
