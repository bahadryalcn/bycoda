import { useEffect, useRef, useState } from "react";

/** Presentation follows one explicit action; the caller retains the host-wide mutex. */
export function useSocialPending() {
  const [action, setAction] = useState<string>();
  const occupied = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return {
    is: (key: string) => action === key,
    async run<T>(key: string, work: () => Promise<T>): Promise<T | undefined> {
      if (occupied.current) return undefined;
      occupied.current = true;
      setAction(key);
      try {
        return await work();
      } finally {
        occupied.current = false;
        if (mounted.current) setAction(undefined);
      }
    },
  };
}
