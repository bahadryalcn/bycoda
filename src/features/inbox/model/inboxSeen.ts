import { useEffect, useState } from "react";
import { sameProjectPath } from "../../projects/model/recents";

const KEY = "bycoda.inboxSeen";
const LEGACY_KEY = "bycoda.inboxSeenAt";
/** Newest entries (by the item's update time) kept on every write. */
export const INBOX_SEEN_MAX_ENTRIES = 2000;
/** Entries whose item update time is older than this are dropped on write. */
export const INBOX_SEEN_MAX_AGE_MS = 90 * 86_400_000;

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

const EMPTY_STORE: SeenStore = { seeded: false, items: {} };

function parseInboxSeenStore(raw: string | null): SeenStore {
  if (!raw) return EMPTY_STORE;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY_STORE;
  const record = parsed as { seeded?: unknown; items?: unknown };
  if (typeof record.seeded === "boolean" && isSeenMap(record.items)) {
    return { seeded: record.seeded, items: record.items };
  }
  if (isSeenMap(parsed)) return { seeded: true, items: parsed };
  return EMPTY_STORE;
}

// Parsed store keyed on the raw stored string: every list, poll and row read goes
// through here, but only a changed string (this window's write, or another
// window's through the `storage` event) is parsed again.
let cachedRaw: string | null | undefined;
let cachedStore: SeenStore = EMPTY_STORE;

function loadInboxSeenStore(): SeenStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === cachedRaw) return cachedStore;
    const store = parseInboxSeenStore(raw);
    cachedRaw = raw;
    cachedStore = store;
    return store;
  } catch {
    return EMPTY_STORE;
  }
}

/**
 * Bounded store: entries for items that left the Inbox long ago carry no
 * information, so the newest `INBOX_SEEN_MAX_ENTRIES` by item update time are
 * kept and anything older than `INBOX_SEEN_MAX_AGE_MS` is dropped. Items the
 * app currently lists keep their entry whatever their age, otherwise a stale
 * open issue would flip back to "new" after each prune.
 */
function pruneSeenMap(items: SeenMap, now = Date.now()): SeenMap {
  const entries = Object.entries(items);
  const cutoff = now - INBOX_SEEN_MAX_AGE_MS;
  let kept = entries.filter(([key, updatedAt]) => updatedAt >= cutoff || knownItems.has(key));
  if (kept.length > INBOX_SEEN_MAX_ENTRIES) {
    kept = kept.sort((a, b) => b[1] - a[1]).slice(0, INBOX_SEEN_MAX_ENTRIES);
  }
  if (kept.length === entries.length) return items;
  return Object.fromEntries(kept);
}

function saveInboxSeenStore(store: SeenStore): boolean {
  const next: SeenStore = { seeded: store.seeded, items: pruneSeenMap(store.items) };
  try {
    const raw = JSON.stringify(next);
    localStorage.setItem(KEY, raw);
    cachedRaw = raw;
    cachedStore = next;
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

/** Keys of the unseen entries, read from one store snapshot for a whole list. */
export function unseenInboxKeys(entries: readonly InboxSeenEntry[]): ReadonlySet<string> {
  const unseen = new Set<string>();
  const store = loadInboxSeenStore();
  if (!store.seeded) return unseen;
  for (const entry of entries) if (entryIsUnseen(entry, store.items)) unseen.add(entry.key);
  return unseen;
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
  return saveInboxSeenStore({
    ...store,
    items: entries.reduce(mergeSeen, store.items),
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

// One `storage` listener for the module, held while anyone subscribes: another
// window's write invalidates the parsed cache and wakes the subscribers.
let stopStorageListener: (() => void) | undefined;

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== KEY) return;
  cachedRaw = undefined;
  notifyInboxSeen();
}

export function subscribeInboxSeen(listener: Listener): () => void {
  listeners.add(listener);
  if (!stopStorageListener && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    stopStorageListener = () => window.removeEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopStorageListener) {
      stopStorageListener();
      stopStorageListener = undefined;
    }
  };
}

export function useInboxSeenTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeInboxSeen(() => setTick((value) => value + 1)), []);
  return tick;
}
