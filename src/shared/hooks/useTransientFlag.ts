import { useCallback, useEffect, useRef, useState } from "react";

/** Restartable short feedback with ownership of its timer and unmount lifecycle. */
export function useTransientFlag(durationMs: number) {
  const [flag, setFlag] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const set = useCallback(
    (value: boolean) => {
      if (!mounted.current) return;
      clearTimeout(timer.current);
      setFlag(value);
      if (value) timer.current = setTimeout(() => setFlag(false), durationMs);
    },
    [durationMs],
  );
  return [flag, set] as const;
}
