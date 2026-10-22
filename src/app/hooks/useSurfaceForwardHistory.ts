import { useEffect, useState } from "react";

/** Remember surfaces dismissed by Back so Forward can restore them. */
export function useSurfaceForwardHistory<T>(current: T, restore: (surface: T) => void) {
  const key = JSON.stringify(current);
  const [history, setHistory] = useState<{ entries: T[]; expectedKey: string }>({
    entries: [],
    expectedKey: key,
  });
  const canForward = history.entries.length > 0 && history.expectedKey === key;

  useEffect(() => {
    // A new view, tab or project starts a different navigation path.
    if (history.expectedKey !== key && history.entries.length > 0) {
      setHistory({ entries: [], expectedKey: key });
    }
  }, [key, history]);

  return {
    canForward,
    remember(destination: T) {
      setHistory({
        entries: [...(canForward ? history.entries : []), current],
        expectedKey: JSON.stringify(destination),
      });
    },
    forward() {
      if (!canForward) return false;
      const surface = history.entries[history.entries.length - 1];
      setHistory({ entries: history.entries.slice(0, -1), expectedKey: JSON.stringify(surface) });
      restore(surface);
      return true;
    },
  };
}
