import { useEffect, useState } from "react";
import { sameProjectPath } from "../../projects/model/recents";

const KEY = "bycoda.inboxSeen";
const LEGACY_KEY = "bycoda.inboxSeenAt";
// Never evict a seen identity merely because a partial provider fetch omitted it.
const MAX_SEEN_ITEMS = 50_000;

export type InboxSeenEntry = {
  key: string;
  updatedAt: string;
};

type SeenMap = Record<string, number>;

type SeenStore = {
  seeded: boolean;
  items: SeenMap;
};

type Listener = () => void;

const listeners = new Set<Listener>();
let cachedRaw: string | null | undefined;
let cachedStore: SeenStore | undefined;
const knownItems = new Map<string, InboxSeenEntry & { projectPaths: string[] }>();

/** Share fetched activity across the Inbox view, background poll, and rail menu. */
export function rememberInboxItems(entries: readonly (InboxSeenEntry & { projectPath: string })[]) {
  let changed = false;
  for (const entry of entries) {
    const previous = knownItems.get(entry.key);
    const projectPaths = previous?.projectPaths ?? [];
    const knownPath = projectPaths.some((path) => sameProjectPath(path, entry.projectPath));
    const newer = !previous || inboxUpdatedAt(entry) > inboxUpdatedAt(previous);
    if (knownPath && !newer) continue;
    knownItems.set(entry.key, {
      key: entry.key,
      updatedAt: newer ? entry.updatedAt : previous!.updatedAt,
      projectPaths: knownPath ? projectPaths : [...projectPaths, entry.projectPath],
    });
    changed = true;
  }
  if (changed) notifyInboxSeen();
}

export function knownInboxEntries(projectPaths: readonly string[]): InboxSeenEntry[] {
  return [...knownItems.values()].filter((entry) =>
    entry.projectPaths.some(
      (knownPath) => !knownPath || projectPaths.some((path) => sameProjectPath(path, knownPath)),
    ),
  );
}

export function clearKnownInboxItems() {
  knownItems.clear();
  notifyInboxSeen();
}

export function inboxUpdatedAt(item: { updatedAt: string }): number {
  const value = Date.parse(item.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

function notifyInboxSeen() {
  for (const listener of listeners) listener();
}

function isSeenMap(value: unknown): value is SeenMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function loadInboxSeenStore(): SeenStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === cachedRaw && cachedStore) return cachedStore;
    if (!raw) {
      cachedRaw = raw;
      return (cachedStore = { seeded: false, items: {} });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      cachedRaw = raw;
      return (cachedStore = { seeded: false, items: {} });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      cachedRaw = raw;
      return (cachedStore = { seeded: false, items: {} });
    }
    const record = parsed as { seeded?: unknown; items?: unknown };
    if (typeof record.seeded === "boolean" && isSeenMap(record.items)) {
      cachedRaw = raw;
      return (cachedStore = { seeded: record.seeded, items: record.items });
    }
    if (isSeenMap(parsed)) {
      cachedRaw = raw;
      return (cachedStore = { seeded: true, items: parsed });
    }
    cachedRaw = raw;
    return (cachedStore = { seeded: false, items: {} });
  } catch {
    cachedRaw = undefined;
    cachedStore = undefined;
    return { seeded: false, items: {} };
  }
}

function saveInboxSeenStore(store: SeenStore): boolean {
  try {
    const existing = loadInboxSeenStore();
    if (
      Object.keys(store.items).length > MAX_SEEN_ITEMS &&
      Object.keys(store.items).length > Object.keys(existing.items).length
    )
      return false;
    const raw = JSON.stringify({ seeded: store.seeded, items: store.items });
    localStorage.setItem(KEY, raw);
    cachedRaw = raw;
    cachedStore = store;
  } catch {
    return false;
  }
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Legacy cleanup must not turn a successful write into a failure.
  }
  notifyInboxSeen();
  return true;
}

function mapFrom(items: readonly InboxSeenEntry[]): SeenMap {
  const next: SeenMap = {};
  for (const item of items) {
    if (!item.key) continue;
    next[item.key] = inboxUpdatedAt(item);
  }
  return next;
}

function mergeSeen(items: SeenMap, entry: InboxSeenEntry): SeenMap {
  if (!entry.key) return items;
  return {
    ...items,
    [entry.key]: Math.max(items[entry.key] ?? 0, inboxUpdatedAt(entry)),
  };
}

function entryIsUnseen(entry: InboxSeenEntry, items: SeenMap): boolean {
  if (!entry.key) return false;
  const was = items[entry.key];
  if (was == null) return true;
  return inboxUpdatedAt(entry) > was;
}

export function inboxSeenIsSeeded(): boolean {
  return loadInboxSeenStore().seeded;
}

export function isInboxEntryUnseen(entry: InboxSeenEntry): boolean {
  const store = loadInboxSeenStore();
  if (!store.seeded) return false;
  return entryIsUnseen(entry, store.items);
}

export function markInboxItemSeen(entry: InboxSeenEntry): boolean {
  const store = loadInboxSeenStore();
  return saveInboxSeenStore({
    ...store,
    items: mergeSeen(store.items, entry),
  });
}

export function markInboxItemsSeen(entries: readonly InboxSeenEntry[]): boolean {
  const store = loadInboxSeenStore();
  const items = { ...store.items };
  for (const entry of entries)
    if (entry.key) items[entry.key] = Math.max(items[entry.key] ?? 0, inboxUpdatedAt(entry));
  return saveInboxSeenStore({
    ...store,
    items,
  });
}

/** First snapshot of the list is remembered so existing items do not badge. */
export function seedInboxSeenIfNeeded(items: readonly InboxSeenEntry[]) {
  const store = loadInboxSeenStore();
  if (store.seeded || items.length === 0) return;
  saveInboxSeenStore({
    seeded: true,
    items: { ...store.items, ...mapFrom(items) },
  });
}

export function inboxHasUnseenItems(items: readonly InboxSeenEntry[]): boolean {
  const store = loadInboxSeenStore();
  if (!store.seeded) return false;
  return items.some((item) => entryIsUnseen(item, store.items));
}

export function subscribeInboxSeen(listener: Listener): () => void {
  if (listeners.size === 0 && typeof window !== "undefined")
    window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
  };
}

function onStorage(event: StorageEvent) {
  if (event.key !== KEY && event.key !== null) return;
  cachedRaw = undefined;
  cachedStore = undefined;
  notifyInboxSeen();
}

export function useInboxSeenTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeInboxSeen(() => setTick((value) => value + 1)), []);
  return tick;
}
