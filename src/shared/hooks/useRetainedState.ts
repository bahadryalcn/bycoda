import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

type Entry = { value: unknown; initial: unknown; dirty: boolean; viewOnly: boolean; listeners: Set<() => void> };
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

function admit(key: string, entry: Entry): void {
  if (entries.get(key) === entry) return;
  if (entries.has(key)) throw new Error("Retained state entry was replaced before subscription.");
  if (entries.size >= RETAINED_STATE_CAPACITY) {
    const victim = [...entries].find(([, candidate]) => !candidate.dirty && candidate.listeners.size === 0);
    if (!victim) throw new RetainedStateCapacityError();
    entries.delete(victim[0]);
  }
  entries.set(key, entry);
}

/** Window-lifetime drafts. Non-primitive values remain protected until explicitly retired. */
export function useRetainedState<T>(key: string, initial: T | (() => T), mode: "draft" | "view" = "draft") {
  let entry = entries.get(key);
  if (!entry) {
    const value = typeof initial === "function" ? (initial as () => T)() : initial;
    entry = { value, initial: value, dirty: mode === "draft" && !isPrimitive(value), viewOnly: mode === "view", listeners: new Set() };
    admit(key, entry);
  }
  const current = entry;
  if (mode === "draft" && current.viewOnly) {
    current.viewOnly = false;
    current.dirty = !isPrimitive(current.value) || !Object.is(current.value, current.initial);
  }
  const subscribe = useCallback((listener: () => void) => {
    admit(key, current);
    current.listeners.add(listener);
    return () => {
      current.listeners.delete(listener);
      if (entries.get(key) === current) {
        entries.delete(key);
        entries.set(key, current);
      }
    };
  }, [key, current]);
  const snapshot = useCallback(() => current.value as T, [current]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const setValue = useCallback((next: SetStateAction<T>) => {
    if (entries.get(key) !== current) return;
    const value = typeof next === "function" ? (next as (value: T) => T)(current.value as T) : next;
    if (Object.is(value, current.value)) return;
    current.value = value;
    current.dirty = !current.viewOnly && (!isPrimitive(value) || !Object.is(value, current.initial));
    current.listeners.forEach((listener) => listener());
  }, [key, current]);
  // A completed save/discard can retire only the same entry and exact value.
  const retire = useCallback((expected: T, ...replacement: [] | [T]) => {
    if (entries.get(key) !== current || !Object.is(current.value, expected)) return false;
    const changed = replacement.length > 0 && !Object.is(current.value, replacement[0]);
    if (changed) current.value = replacement[0];
    current.initial = current.value;
    current.dirty = false;
    if (!current.listeners.size) entries.delete(key);
    else if (changed) current.listeners.forEach((listener) => listener());
    return true;
  }, [key, current]);
  return [value, setValue, retire] as const;
}

export function resetRetainedState() {
  entries.clear();
}
