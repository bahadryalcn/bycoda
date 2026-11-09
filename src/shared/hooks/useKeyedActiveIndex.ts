import { useState } from "react";

type IndexUpdate = number | ((current: number) => number);

/** Keeps `index` inside a list of `count` rows; -1 (or an empty list) means no active row. */
export function clampActiveIndex(index: number, count: number): number {
  if (count <= 0 || index < 0) return -1;
  return Math.min(index, count - 1);
}

/**
 * Keyboard-active row for a listbox, menu or picker without reset/clamp effects.
 *
 * The chosen row belongs to `resetKey` (for example `${open}:${query}`): when the key
 * changes, the row starts again from `initial`, and a shrinking list clamps it during
 * render. Callers build the key from whatever should restart navigation (opening,
 * typing, switching tabs) and leave unrelated re-renders, such as a new `options`
 * array with the same content, alone.
 */
export function useKeyedActiveIndex(
  resetKey: string,
  count: number,
  initial: number | (() => number) = 0,
) {
  const [chosen, setChosen] = useState<{ key: string; index: number } | null>(null);
  const resolve = (state: { key: string; index: number } | null) =>
    clampActiveIndex(
      state && state.key === resetKey
        ? state.index
        : typeof initial === "function"
          ? initial()
          : initial,
      count,
    );
  const active = resolve(chosen);
  const setActive = (next: IndexUpdate) =>
    setChosen((previous) => ({
      key: resetKey,
      index: typeof next === "function" ? next(resolve(previous)) : next,
    }));
  return [active, setActive] as const;
}
