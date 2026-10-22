import { useLayoutEffect, useRef } from "react";

type Delegate = (...args: unknown[]) => unknown;

/** Stable event delegates; optional actions stay absent and committed closures stay fresh. */
export function useSidebarActions<T extends Record<string, unknown>>(actions: T): T {
  const latest = useRef(actions);
  // Delegates are created on demand per key, so keys added after mount still get a stable identity.
  const delegates = useRef(new Map<string, Delegate>());
  useLayoutEffect(() => {
    latest.current = actions;
  });
  const delegate = (key: string): Delegate => {
    let fn = delegates.current.get(key);
    if (!fn) {
      fn = (...args) => (latest.current[key] as (...values: unknown[]) => unknown)(...args);
      delegates.current.set(key, fn);
    }
    return fn;
  };
  return Object.fromEntries(
    Object.entries(actions).map(([key, action]) => [
      key,
      typeof action === "function" ? delegate(key) : action,
    ]),
  ) as T;
}
