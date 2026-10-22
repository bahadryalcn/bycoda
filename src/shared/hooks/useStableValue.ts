import { useRef } from "react";

/**
 * Keeps returning the previous reference while `equal` says the new value is
 * the same content, so memoized children do not re-render for a value that
 * was only rebuilt.
 */
export function useStableValue<T>(next: T, equal: (previous: T, next: T) => boolean): T {
  const kept = useRef(next);
  if (kept.current !== next && !equal(kept.current, next)) kept.current = next;
  return kept.current;
}
