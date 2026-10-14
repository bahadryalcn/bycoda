import { useCallback, useRef } from "react";

/** A callback that keeps one identity while always calling the latest one. */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
export function useStableCallback<A extends unknown[], R>(
  fn: ((...args: A) => R) | undefined,
): ((...args: A) => R) | undefined;
export function useStableCallback<A extends unknown[], R>(
  fn: ((...args: A) => R) | undefined,
): ((...args: A) => R) | undefined {
  const latest = useRef(fn);
  latest.current = fn;
  const stable = useCallback((...args: A) => latest.current?.(...args) as R, []);
  return fn ? stable : undefined;
}
