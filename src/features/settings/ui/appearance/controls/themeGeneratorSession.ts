import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../../../../shared/lib/store";

/**
 * Generator state that outlives the Settings window: closing Appearance keeps the prompt, the
 * suggestions, each chip's image and any drawing still in flight, so reopening shows them again.
 * It lives for the app session only; saved themes and the image library are the durable record.
 */
const values = new Map<string, unknown>();
const changes = createStore();
let gradientCallback:
  | ((suggestion: import("../../../model/backgroundGradient").BackgroundGradientSuggestion) => void)
  | undefined;

/** The first read seeds a missing key, so later reads return the same reference (stable snapshot). */
export function readGeneratorValue<T>(key: string, initial: T | (() => T)): T {
  if (!values.has(key))
    values.set(key, typeof initial === "function" ? (initial as () => T)() : initial);
  return values.get(key) as T;
}

export function writeGeneratorValue<T>(
  key: string,
  next: T | ((current: T) => T),
  initial: T | (() => T),
) {
  const current = readGeneratorValue(key, initial);
  const value = typeof next === "function" ? (next as (current: T) => T)(current) : next;
  if (Object.is(value, current)) return;
  values.set(key, value);
  changes.notify();
}

/**
 * `useState` whose value is kept in the generator session instead of the component. Values must
 * not be functions; `initial` may be a lazy initializer, as with `useState`.
 */
export function useGeneratorState<T>(key: string, initial: T | (() => T)) {
  const value = useSyncExternalStore(
    changes.subscribe,
    () => readGeneratorValue(key, initial),
    () => readGeneratorValue(key, initial),
  );
  const set = useCallback(
    (next: T | ((current: T) => T)) => writeGeneratorValue(key, next, initial),
    [key, initial],
  );
  return [value, set] as const;
}

type SessionState = {
  epoch: number;
  batch: number;
  selected: number | null;
  appearance: unknown;
  intent: number;
};
const state: SessionState = { epoch: 0, batch: 0, selected: null, appearance: null, intent: 0 };

/**
 * Session counters and handles (the old `useRef`s) that background work reads after the generator
 * closes. Functions, not fields: components may not mutate module state directly.
 */
export const generatorSession = {
  /** Theme request generation; a stale request is dropped when a newer one started. */
  nextEpoch: () => ++state.epoch,
  epoch: () => state.epoch,
  /** Suggestion-list generation; drawings for an older list never reach the new chips. */
  bumpBatch: () => {
    state.batch += 1;
  },
  batch: () => state.batch,
  /** The chip chosen last: only its image is applied; the others stay on their chips. */
  select: (index: number | null) => {
    state.selected = index;
  },
  selected: () => state.selected,
  /** Revoke pending image application when the owner changes the look. */
  invalidateImageIntent: () => {
    state.selected = null;
    state.intent += 1;
  },
  imageIntent: () => state.intent,
  bindGradient: (callback: typeof gradientCallback) => {
    gradientCallback = callback;
  },
  applyGradient: (
    suggestion: import("../../../model/backgroundGradient").BackgroundGradientSuggestion,
  ) => gradientCallback?.(suggestion),
  /** The newest mounted Appearance API, or the last one when Settings is closed. */
  bindAppearance: (appearance: unknown) => {
    state.appearance = appearance;
  },
  appearance: () => state.appearance,
};

/** Test helper: forget everything, as a fresh app start would. */
export function resetGeneratorSession() {
  values.clear();
  gradientCallback = undefined;
  Object.assign(state, { epoch: 0, batch: 0, selected: null, appearance: null, intent: 0 });
  changes.notify();
}
