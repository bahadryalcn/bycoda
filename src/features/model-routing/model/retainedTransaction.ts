import { useSyncExternalStore } from "react";

type Cell = { value: unknown; listeners: Set<() => void>; write: (next: unknown) => void };
const cells = new Map<string, Cell>();
function retainedCell(key: string, initial: unknown): Cell {
  const existing = cells.get(key);
  if (existing) return existing;
  const cell: Cell = {
    value: initial,
    listeners: new Set(),
    write: (next) => {
      const value =
        typeof next === "function" ? (next as (current: unknown) => unknown)(cell.value) : next;
      if (Object.is(value, cell.value)) return;
      cell.value = value;
      cell.listeners.forEach((listener) => listener());
    },
  };
  cells.set(key, cell);
  return cell;
}
/** Retains non-secret Host editing state and notifies remounted owners. */
export function useRetainedTransaction<T>(
  key: string,
  initial: T,
): [T, (next: T | ((current: T) => T)) => void] {
  const target = retainedCell(key, initial);
  const value = useSyncExternalStore(
    (listener) => {
      target.listeners.add(listener);
      return () => target.listeners.delete(listener);
    },
    () => target.value as T,
  );
  return [value, target.write];
}
export function retainedTransactionValue<T>(key: string): T | undefined {
  return cells.get(key)?.value as T | undefined;
}
export function clearRetainedTransactions() {
  cells.clear();
}
