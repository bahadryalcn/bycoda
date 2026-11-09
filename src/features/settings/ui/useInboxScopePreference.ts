import { useCallback, useEffect, useRef, useState } from "react";

/** Settings edits patch fresh durable scope and verify model saves that may otherwise swallow failure. */
export function useInboxScopePreference<T extends string | number>(
  key: string,
  event: string,
  valid: (value: unknown) => value is T,
  save: (value: T[]) => void,
  owner: string,
) {
  const read = useCallback((): T[] => {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed) || !parsed.every(valid))
      throw new Error("Saved Inbox scope is unavailable.");
    return parsed;
  }, [key, valid]);
  const [state, setState] = useState<{ value: T[]; available: boolean; error: boolean }>(() => {
    try {
      return { value: read(), available: true, error: false };
    } catch {
      return { value: [], available: false, error: true };
    }
  });
  const pending = useRef<((current: T[]) => T[]) | null>(null);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const update = useCallback(
    (patch: (current: T[]) => T[]) => {
      if (owner !== currentOwner.current) return false;
      pending.current = patch;
      try {
        const next = [...new Set(patch(read()))];
        save(next);
        const persisted = read();
        if (persisted.length !== next.length || next.some((id) => !persisted.includes(id)))
          throw new Error("Inbox scope was not saved.");
        pending.current = null;
        setState({ value: persisted, available: true, error: false });
        return true;
      } catch {
        setState((previous) => ({ ...previous, error: true }));
        return false;
      }
    },
    [read, save, owner],
  );
  const reload = useCallback(() => {
    try {
      setState({ value: read(), available: true, error: false });
    } catch {
      setState((previous) => ({ ...previous, available: false, error: true }));
    }
  }, [read]);
  const retry = useCallback(() => {
    if (pending.current) update(pending.current);
    else reload();
  }, [reload, update]);
  // The initial state already read the current scope; only a new owner or key needs a fresh read.
  const loadedFor = useRef({ owner, reload });
  useEffect(() => {
    if (loadedFor.current.owner === owner && loadedFor.current.reload === reload) return;
    loadedFor.current = { owner, reload };
    pending.current = null;
    reload();
  }, [owner, reload]);
  useEffect(() => {
    const onStorage = (change: StorageEvent) => {
      if (change.storageArea && change.storageArea !== localStorage) return;
      if (change.key !== null && change.key !== key) return;
      // A newer sibling choice supersedes an old failed edit.
      pending.current = null;
      reload();
    };
    window.addEventListener(event, reload);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(event, reload);
      window.removeEventListener("storage", onStorage);
    };
  }, [key, event, reload]);
  return { ...state, update, retry };
}

export const isInboxScopeString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
export const isInboxScopeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
