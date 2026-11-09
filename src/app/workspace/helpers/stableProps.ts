import { useRef } from "react";
import { useStableHandlers } from "../../../shared/hooks/useStableHandlers";

function sameEntries(a: object, b: object): boolean {
  const left = Object.keys(a);
  if (left.length !== Object.keys(b).length) return false;
  return left.every((key) =>
    Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * `useStableHandlers` for an object handed down as one prop: the object itself
 * keeps its identity while every value is unchanged, functions included (they
 * are stable proxies). Only for event handlers, never for functions called
 * during render.
 */
export function useStableProps<P extends object>(props: P): P {
  const proxied = useStableHandlers(props);
  const kept = useRef(proxied);
  if (!sameEntries(kept.current, proxied)) kept.current = proxied;
  return kept.current;
}

/** Same length and each item holds the same values (one level deep). Workspace
 * lists are rebuilt from the session shell on every status change; this keeps a
 * memoized consumer from re-rendering for a list that came out the same. */
export function sameShallowItems<T extends object>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => sameEntries(item, b[index]));
}

/** The value from the last render in which `live` was true. */
export function useHeldValue<T>(value: T, live: boolean): T {
  const held = useRef(value);
  if (live) held.current = value;
  return held.current;
}
