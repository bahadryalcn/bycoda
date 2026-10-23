import { useRef } from "react";

type Handler = (...args: never[]) => unknown;

/**
 * `useStableCallback` for every function prop of an object: each one becomes a
 * proxy that keeps one identity per key while always calling the latest
 * function. A memoized child then skips renders when its parent recreates its
 * handlers on every render. Only for event handlers: a function called during
 * render must not go through this. A prop that switches between a function and
 * undefined still changes, so optional actions appear and disappear.
 */
export function useStableHandlers<P extends object>(props: P): P {
  const latest = useRef(props);
  latest.current = props;
  const proxies = useRef(new Map<string, Handler>());
  const next = { ...props } as Record<string, unknown>;
  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== "function") continue;
    let proxy = proxies.current.get(key);
    if (!proxy) {
      proxy = (...args: never[]) =>
        (latest.current as Record<string, Handler | undefined>)[key]?.(...args);
      proxies.current.set(key, proxy);
    }
    next[key] = proxy;
  }
  return next as P;
}
