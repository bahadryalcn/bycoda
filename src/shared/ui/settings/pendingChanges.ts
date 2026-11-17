import { useEffect, useRef, useSyncExternalStore } from "react";

/** One unsaved edit, as the owner would name it. */
export type PendingChange = {
  id: string;
  /** What changed, e.g. "Effort" or "Task worker". */
  label: string;
  /** Where it applies, e.g. "Claude Code · Personal"; changes group by it. */
  scope?: string;
  /** The new value or the edit, e.g. "Medium → High". */
  detail?: string;
  /** Undo only this change; omitted when the editor cannot revert one change alone. */
  revert?: () => void;
};

/** One editor's unsaved draft: a page section with its own Save. */
export type PendingSource = {
  id: string;
  /** Section name the leave prompt lists, e.g. "Background work". */
  title: string;
  changes: readonly PendingChange[];
  /** False while the draft is invalid or conflicted; Save all then keeps the owner here. */
  canSave: boolean;
  /** A storage request is already committing; neither save nor discard may interrupt it. */
  pending?: boolean;
  save: () => unknown;
  discard: () => void;
};

const sources = new Map<string, PendingSource>();
const listeners = new Set<() => void>();
let snapshot: readonly PendingSource[] = [];

function publish() {
  snapshot = [...sources.values()].filter((source) => source.changes.length > 0);
  listeners.forEach((listener) => listener());
}

const signature = (source: PendingSource | undefined) =>
  source
    ? JSON.stringify([
        source.title,
        source.canSave,
        source.pending,
        source.changes.map((change) => [change.id, change.label, change.scope, change.detail]),
      ])
    : "";

function setSource(id: string, source: PendingSource | undefined) {
  const before = sources.get(id);
  if (source) sources.set(id, source);
  else sources.delete(id);
  // Callbacks change every render; only what the owner sees triggers a re-render.
  if (signature(before) !== signature(source)) publish();
}

export function subscribePendingSources(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sources with at least one unsaved change. */
export const pendingSources = (): readonly PendingSource[] => snapshot;

export function usePendingSources(): readonly PendingSource[] {
  return useSyncExternalStore(subscribePendingSources, pendingSources, pendingSources);
}

/**
 * Registers this editor's unsaved draft while it is mounted, so the settings shell can ask
 * before the owner leaves. Pass null (or no changes) when there is nothing to save.
 */
export function usePendingSource(source: PendingSource | null) {
  const id = source?.id;
  const latest = useRef(source);
  // Sync the registry after each render; callbacks read the latest draft through the ref.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps the module-level pending registry in step with this editor while mounted.
  useEffect(() => {
    latest.current = source;
    const current = source;
    if (!id || !current) return;
    setSource(id, {
      ...current,
      save: () => latest.current?.save(),
      discard: () => latest.current?.discard(),
      changes: current.changes,
    });
  });
  // Withdraw the source when its editor unmounts or changes identity.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Removes this editor from the module-level pending registry on unmount.
  useEffect(() => {
    if (!id) return;
    return () => setSource(id, undefined);
  }, [id]);
}

/** Save every source that can save; resolves true when nothing unsaved remains. */
export async function saveAllPending(): Promise<boolean> {
  const current = pendingSources();
  if (current.some((source) => !source.canSave || source.pending)) return false;
  for (const source of current) await source.save();
  // Editors report a failed save through their own state, so read the registry once React has
  // committed the results.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return pendingSources().length === 0;
}

export function discardAllPending() {
  const current = pendingSources();
  if (current.some((source) => source.pending)) return false;
  for (const source of current) source.discard();
  return true;
}

/** Total unsaved changes across every registered source. */
export const pendingChangeCount = (list: readonly PendingSource[]) =>
  list.reduce((total, source) => total + source.changes.length, 0);
