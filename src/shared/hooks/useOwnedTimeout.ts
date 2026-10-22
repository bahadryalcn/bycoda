import { useCallback, useEffect, useRef } from "react";

/** Owns deferred UI work and prevents it from escaping its mounted owner. */
export function useOwnedTimeout() {
  const timers = useRef(new Set<number>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current.clear();
    };
  }, []);
  return useCallback((callback: () => void, delay: number) => {
    if (!mounted.current) return;
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      if (mounted.current) callback();
    }, delay);
    timers.current.add(timer);
  }, []);
}
