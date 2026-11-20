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
  /**
   * Resolves `true` only once storage or the Host durably acknowledged every change listed when
   * the save began. A refusal, a failure or an edit that landed while saving resolves `false`
   * (or throws) and keeps the draft; the editor shows its own error.
   */
  save: () => boolean | Promise<boolean>;
  discard: () => void;
};

const sources = new Map<string, PendingSource>();
const listeners = new Set<() => void>();
let snapshot: readonly PendingSource[] = [];

function publish() {
  snapshot = [...sources.values()].filter((source) => source.changes.length > 0);
  listeners.forEach((listener) => listener());
}

/** Same changes in the same order by what the owner sees; a rebuilt array of equal changes is not a change. */
const sameChanges = (a: readonly PendingChange[], b: readonly PendingChange[]) =>
  a.length === b.length &&
  a.every((change, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      change.id === other.id &&
      change.label === other.label &&
      change.scope === other.scope &&
      change.detail === other.detail
    );
  });

const sameVisible = (before: PendingSource | undefined, source: PendingSource | undefined) =>
  before === source ||
  (!!before &&
    !!source &&
    before.title === source.title &&
    before.canSave === source.canSave &&
    before.pending === source.pending &&
    sameChanges(before.changes, source.changes));

function setSource(id: string, source: PendingSource | undefined) {
  const before = sources.get(id);
  if (source) sources.set(id, source);
  else sources.delete(id);
  // Callbacks change every render; only what the owner sees triggers a re-render.
  if (!sameVisible(before, source)) publish();
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
      // A draft that already left the registry has nothing to acknowledge.
      save: () => latest.current?.save() ?? false,
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

let savingAll: Promise<boolean> | null = null;

async function acknowledged(source: PendingSource): Promise<boolean> {
  try {
    return (await source.save()) === true;
  } catch {
    // The editor reports its own failure; the draft stays where it is.
    return false;
  }
}

async function saveEach(): Promise<boolean> {
  const current = pendingSources();
  if (current.some((source) => !source.canSave || source.pending)) return false;
  const saving = new Set(current.map((source) => source.id));
  for (const source of current) {
    // The first save the editor did not acknowledge stops the chain; later drafts stay untouched.
    if (!(await acknowledged(source))) return false;
  }
  // A draft that registered while saving was never part of the request, so leaving would drop it.
  return pendingSources().every((source) => saving.has(source.id));
}

/**
 * Saves every pending source in order. Resolves true only when each editor acknowledged its own
 * durable save and no other draft appeared meanwhile; never on a timer or on the registry
 * looking empty. A second call while one runs shares it, so the saves run once.
 */
export function saveAllPending(): Promise<boolean> {
  savingAll ??= saveEach().finally(() => {
    savingAll = null;
  });
  return savingAll;
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
