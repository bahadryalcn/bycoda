import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

type Entry = { value: unknown; listeners: Set<() => void> };
const entries = new Map<string, Entry>();

function updateEntry<T>(entry: Entry, next: SetStateAction<T>) {
  const value = typeof next === "function" ? (next as (value: T) => T)(entry.value as T) : next;
  if (Object.is(value, entry.value)) return;
  entry.value = value;
  entry.listeners.forEach((listener) => listener());
}

/** Window-lifetime UI drafts/preferences. Scope keys by feature and project;
 * never retain fetched results, loading flags, open dialogs or credentials here. */
export function useRetainedState<T>(key: string, initial: T | (() => T)) {
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      value: typeof initial === "function" ? (initial as () => T)() : initial,
      listeners: new Set(),
    };
    entries.set(key, entry);
  }
  const current = entry;
  const subscribe = useCallback(
    (listener: () => void) => {
      current.listeners.add(listener);
      return () => {
        current.listeners.delete(listener);
      };
    },
    [current],
  );
  const snapshot = useCallback(() => current.value as T, [current]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const setValue = useCallback(
    (next: SetStateAction<T>) => {
      updateEntry(current, next);
    },
    [current],
  );
  return [value, setValue] as const;
}

export function resetRetainedState() {
  entries.clear();
}
