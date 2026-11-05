import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

type Entry = {
  value: unknown;
  initial: unknown;
  dirty: boolean;
  viewOnly: boolean;
  listeners: Set<() => void>;
};
const entries = new Map<string, Entry>();
export const RETAINED_STATE_CAPACITY = 512;

export class RetainedStateCapacityError extends Error {
  constructor() {
    super("Retained state is full. Save or discard existing drafts before opening another.");
    this.name = "RetainedStateCapacityError";
  }
}

function isPrimitive(value: unknown): boolean {
  return value === null || (typeof value !== "object" && typeof value !== "function");
}

let capacityWarned = false;

/**
 * Makes room for one entry. Only clean entries with no live listener are evicted, least
 * recently used first. Unsaved drafts are never dropped to make room. When nothing is
 * evictable the map admits the entry over the cap (soft cap) and logs once, so render never throws.
 */
function makeRoom(): void {
  for (const [key, candidate] of entries) {
    if (candidate.dirty || candidate.listeners.size > 0) continue;
    entries.delete(key);
    return;
  }
  if (capacityWarned) return;
  capacityWarned = true;
  console.warn(
    `Retained state holds ${entries.size} entries, above the ${RETAINED_STATE_CAPACITY} soft cap, because every entry is a live or unsaved draft.`,
  );
}

function admit(key: string, entry: Entry): void {
  if (entries.get(key) === entry) return;
  if (entries.has(key)) throw new Error("Retained state entry was replaced before subscription.");
  if (entries.size >= RETAINED_STATE_CAPACITY) makeRoom();
  entries.set(key, entry);
}

/**
 * Window-lifetime drafts. Non-primitive values remain protected until explicitly retired.
 * `"view"` entries (scroll positions, read-only snapshots) stay evictable until a real
 * `setValue` from a `"draft"` caller turns them into a draft.
 */
export function useRetainedState<T>(
  key: string,
  initial: T | (() => T),
  mode: "draft" | "view" = "draft",
) {
  let entry = entries.get(key);
  if (!entry) {
    const value = typeof initial === "function" ? (initial as () => T)() : initial;
    entry = {
      value,
      initial: value,
      dirty: mode === "draft" && !isPrimitive(value),
      viewOnly: mode === "view",
      listeners: new Set(),
    };
    admit(key, entry);
  }
  const current = entry;
  const subscribe = useCallback(
    (listener: () => void) => {
      admit(key, current);
      current.listeners.add(listener);
      return () => {
        current.listeners.delete(listener);
        if (entries.get(key) === current) {
          entries.delete(key);
          entries.set(key, current);
        }
      };
    },
    [key, current],
  );
  const snapshot = useCallback(() => current.value as T, [current]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const setValue = useCallback(
    (next: SetStateAction<T>) => {
      if (entries.get(key) !== current) return;
      const value =
        typeof next === "function" ? (next as (value: T) => T)(current.value as T) : next;
      if (Object.is(value, current.value)) return;
      current.value = value;
      if (mode === "draft") current.viewOnly = false;
      current.dirty =
        !current.viewOnly && (!isPrimitive(value) || !Object.is(value, current.initial));
      current.listeners.forEach((listener) => listener());
    },
    [key, mode, current],
  );
  // A completed save/discard can retire only the same entry and exact value.
  const retire = useCallback(
    (expected: T, ...replacement: [] | [T]) => {
      if (entries.get(key) !== current || !Object.is(current.value, expected)) return false;
      const changed = replacement.length > 0 && !Object.is(current.value, replacement[0]);
      if (changed) current.value = replacement[0];
      current.initial = current.value;
      current.dirty = false;
      if (!current.listeners.size) entries.delete(key);
      else if (changed) current.listeners.forEach((listener) => listener());
      return true;
    },
    [key, current],
  );
  return [value, setValue, retire] as const;
}

export function resetRetainedState() {
  entries.clear();
}
