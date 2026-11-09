import { useEffect, useState } from "react";
import { createStore } from "../../../shared/lib/store";
import { sameProjectPath } from "../../projects/model/recents";
import {
  mergeInboxSeenStorage,
  readInboxSeenStorage,
  seedInboxSeenStorage,
} from "./inboxSeenStorage";

const KEY = "bycoda.inboxSeen";
const LEGACY_KEY = "bycoda.inboxSeenAt";
const COLD_MARKER = "bycoda.inboxSeen.indexed.v1";
const HOT_LIMIT = 1024;
// Never evict a seen identity merely because a partial provider fetch omitted it.
const MAX_SEEN_ITEMS = 50_000;
// Seen records older than this are dropped. An item older than the window with no
// record counts as seen, so pruning never resurfaces old activity as unread.
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

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

const listeners = createStore();
let cachedRaw: string | null | undefined;
let cachedStore: SeenStore | undefined;
const knownItems = new Map<string, InboxSeenEntry & { projectPaths: string[] }>();
type ColdState = "legacy" | "loading" | "ready" | "error";
let coldState: ColdState = "legacy";
let coldError: string | undefined;
let coldSeeded = false;
let coldReady: Promise<void> | undefined;
let coldInitGeneration = 0;
let coldGeneration = 0;
const hot = new Map<string, number | undefined>();
const pendingKeys = new Set<string>();
let readScheduled = false;
let inflightReads = 0;
const aggregates = new Map<string, { generation: number; value?: boolean; pending: boolean }>();
let channel: BroadcastChannel | undefined;

function coldAvailable() {
  return typeof indexedDB !== "undefined";
}
function coldRequired() {
  try {
    return localStorage.getItem(COLD_MARKER) === "1";
  } catch {
    return true;
  }
}
function trimHot() {
  while (hot.size > HOT_LIMIT) hot.delete(hot.keys().next().value!);
}
function retentionCutoff(): number {
  return Date.now() - RETENTION_MS;
}
function pruneSeenItems(items: SeenMap, cutoff: number): SeenMap {
  const kept: SeenMap = {};
  for (const [key, value] of Object.entries(items)) if (value >= cutoff) kept[key] = value;
  return kept;
}
/** Whether an item is unseen given its seen record (`undefined` when it has none). */
function unseenAgainst(entry: InboxSeenEntry, value: number | undefined): boolean {
  // An unreadable timestamp cannot prove the item is old, so a new one stays unseen.
  if (value == null) return !hasReadableTime(entry) || inboxUpdatedAt(entry) >= retentionCutoff();
  return inboxUpdatedAt(entry) > value;
}
function hasReadableTime(item: { updatedAt: string }): boolean {
  return Number.isFinite(Date.parse(item.updatedAt));
}
function legacySnapshot(raw: string | null): SeenStore {
  if (!raw) return { seeded: false, items: {} };
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Saved Inbox history is invalid.");
  const value = parsed as { seeded?: unknown; items?: unknown };
  if (typeof value.seeded === "boolean" && isSeenMap(value.items))
    return { seeded: value.seeded, items: value.items };
  if (isSeenMap(parsed)) return { seeded: true, items: parsed };
  throw new Error("Saved Inbox history is invalid.");
}
function signalCold() {
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel ??= new BroadcastChannel("bycoda-inbox-seen-v1");
      channel.onmessage = () => {
        coldGeneration++;
        hot.clear();
        notifyInboxSeen();
      };
    }
  } catch {
    channel = undefined;
  }
}
function broadcastCold() {
  try {
    signalCold();
    channel?.postMessage("changed");
  } catch {
    /* Commit succeeded; other windows refresh on focus. */
  }
}
async function ensureCold(): Promise<void> {
  if (!coldAvailable()) {
    if (coldRequired()) {
      coldState = "error";
      coldError = "Saved Inbox history is unavailable.";
      throw new Error(coldError);
    }
    return;
  }
  if (coldReady) return coldReady;
  coldState = "loading";
  const initialization = ++coldInitGeneration;
  coldReady = (async () => {
    let stable = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const raw = localStorage.getItem(KEY);
      const legacy = legacySnapshot(raw);
      const entries = Object.entries(legacy.items);
      for (let index = 0; index < entries.length; index += 512)
        await mergeInboxSeenStorage({
          seeded: false,
          items: Object.fromEntries(entries.slice(index, index + 512)),
        });
      if (legacy.seeded) await mergeInboxSeenStorage({ seeded: true, items: {} });
      if (raw === localStorage.getItem(KEY)) {
        stable = true;
        break;
      }
    }
    if (!stable) throw new Error("Inbox history changed during migration. Retry.");
    const meta = await readInboxSeenStorage([]);
    if (initialization !== coldInitGeneration) return await ensureCold();
    // Keep legacy bytes: old windows cannot participate in a compare-and-delete.
    if (localStorage.getItem(COLD_MARKER) !== "1") localStorage.setItem(COLD_MARKER, "1");
    coldSeeded = meta.seeded;
    coldState = "ready";
    coldError = undefined;
    signalCold();
    notifyInboxSeen();
  })().catch((error) => {
    if (initialization !== coldInitGeneration) return;
    coldState = "error";
    coldError = error instanceof Error ? error.message : "Inbox history is unavailable.";
    coldReady = undefined;
    notifyInboxSeen();
    throw error;
  });
  return coldReady;
}
function scheduleColdRead(key: string) {
  if (!key) return;
  if (coldState === "error") return;
  pendingKeys.add(key);
  if (readScheduled) return;
  readScheduled = true;
  queueMicrotask(() => {
    readScheduled = false;
    const keys = [...pendingKeys];
    pendingKeys.clear();
    const generation = coldGeneration;
    inflightReads++;
    notifyInboxSeen();
    void ensureCold()
      .then(async () => {
        const items = new Map<string, number | undefined>();
        let seeded = false;
        for (let index = 0; index < keys.length; index += 512) {
          const result = await readInboxSeenStorage(keys.slice(index, index + 512));
          seeded = result.seeded;
          for (const [key, value] of result.items) items.set(key, value);
        }
        return { seeded, items };
      })
      .then((result) => {
        if (generation !== coldGeneration) {
          for (const key of keys) scheduleColdRead(key);
          return;
        }
        coldSeeded = result.seeded;
        for (const [key, value] of result.items) {
          hot.delete(key);
          hot.set(key, value);
        }
        trimHot();
        notifyInboxSeen();
      })
      .catch((error) => {
        coldState = "error";
        coldError = error instanceof Error ? error.message : "Inbox history is unavailable.";
      })
      .finally(() => {
        inflightReads--;
        notifyInboxSeen();
      });
  });
}
async function mergeCold(entries: readonly InboxSeenEntry[], seeded = false): Promise<boolean> {
  try {
    await ensureCold();
    const items = mapFrom(entries);
    const pairs = Object.entries(items);
    for (let index = 0; index < pairs.length; index += 512)
      await mergeInboxSeenStorage({
        seeded: false,
        items: Object.fromEntries(pairs.slice(index, index + 512)),
      });
    if (seeded) await mergeInboxSeenStorage({ seeded: true, items: {} });
    coldGeneration++;
    for (const key of Object.keys(items)) hot.delete(key);
    if (seeded) coldSeeded = true;
    broadcastCold();
    notifyInboxSeen();
    return true;
  } catch (error) {
    coldGeneration++;
    hot.clear();
    broadcastCold();
    coldState = "error";
    coldError = error instanceof Error ? error.message : "Inbox history is unavailable.";
    notifyInboxSeen();
    return false;
  }
}

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
  if (changed) {
    const cutoff = retentionCutoff();
    for (const [key, entry] of knownItems)
      if (hasReadableTime(entry) && inboxUpdatedAt(entry) < cutoff) knownItems.delete(key);
    notifyInboxSeen();
  }
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
  listeners.notify();
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

function saveInboxSeenStore(unpruned: SeenStore): boolean {
  try {
    const store: SeenStore = {
      ...unpruned,
      items: pruneSeenItems(unpruned.items, retentionCutoff()),
    };
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
  coldGeneration++;
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
  return unseenAgainst(entry, items[entry.key]);
}

export function inboxSeenIsSeeded(): boolean {
  if (coldAvailable() || coldRequired()) {
    if (coldState === "legacy") void ensureCold().catch(() => {});
    return coldState === "ready" && coldSeeded;
  }
  return loadInboxSeenStore().seeded;
}

export function isInboxEntryUnseen(entry: InboxSeenEntry): boolean {
  if (coldAvailable() || coldRequired()) {
    if (!entry.key) return false;
    if (coldState === "error") return false;
    if (coldState !== "ready" || !hot.has(entry.key)) {
      scheduleColdRead(entry.key);
      return false;
    }
    if (!coldSeeded) return false;
    const value = hot.get(entry.key);
    hot.delete(entry.key);
    hot.set(entry.key, value);
    return unseenAgainst(entry, value);
  }
  const store = loadInboxSeenStore();
  if (!store.seeded) return false;
  return entryIsUnseen(entry, store.items);
}

export function inboxSeenGeneration(): number {
  return coldGeneration;
}

export async function readInboxEntryUnseen(entry: InboxSeenEntry): Promise<boolean> {
  if (!coldAvailable() && !coldRequired()) return isInboxEntryUnseen(entry);
  try {
    await ensureCold();
    const result = await readInboxSeenStorage([entry.key]);
    const value = result.items.get(entry.key);
    return !!entry.key && result.seeded && unseenAgainst(entry, value);
  } catch (error) {
    coldState = "error";
    coldError = error instanceof Error ? error.message : "Inbox history is unavailable.";
    notifyInboxSeen();
    return false;
  }
}

export function markInboxItemSeen(entry: InboxSeenEntry): boolean | Promise<boolean> {
  if (coldAvailable() || coldRequired()) return mergeCold([entry]);
  const store = loadInboxSeenStore();
  return saveInboxSeenStore({
    ...store,
    items: mergeSeen(store.items, entry),
  });
}

export function markInboxItemsSeen(entries: readonly InboxSeenEntry[]): boolean | Promise<boolean> {
  if (coldAvailable() || coldRequired()) return mergeCold(entries);
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
  if (coldAvailable() || coldRequired()) {
    if (coldState === "error") return false;
    if (!items.length) return;
    return (async () => {
      try {
        await ensureCold();
        await seedInboxSeenStorage(mapFrom(items));
        coldSeeded = true;
        coldGeneration++;
        hot.clear();
        broadcastCold();
        notifyInboxSeen();
      } catch (error) {
        coldState = "error";
        coldError = error instanceof Error ? error.message : "Inbox history is unavailable.";
        notifyInboxSeen();
      }
    })();
  }
  const store = loadInboxSeenStore();
  if (store.seeded || items.length === 0) return;
  saveInboxSeenStore({
    seeded: true,
    items: { ...store.items, ...mapFrom(items) },
  });
}

export function inboxHasUnseenItems(items: readonly InboxSeenEntry[]): boolean {
  if (coldAvailable() || coldRequired()) {
    if (coldState === "error") return false;
    const key = JSON.stringify(items.map((item) => [item.key, item.updatedAt]));
    const cached = aggregates.get(key);
    if (cached?.generation === coldGeneration) return cached.value ?? false;
    const current = { generation: coldGeneration, pending: true } as {
      generation: number;
      value?: boolean;
      pending: boolean;
    };
    aggregates.delete(key);
    aggregates.set(key, current);
    while (aggregates.size > 32) aggregates.delete(aggregates.keys().next().value!);
    queueMicrotask(() => {
      inflightReads++;
      notifyInboxSeen();
      void (async () => {
        await ensureCold();
        let unseen = false;
        for (let index = 0; index < items.length; index += 512) {
          const page = items.slice(index, index + 512);
          const found = await readInboxSeenStorage(page.map((item) => item.key).filter(Boolean));
          if (
            found.seeded &&
            page.some((item) => item.key && unseenAgainst(item, found.items.get(item.key)))
          ) {
            unseen = true;
            break;
          }
        }
        if (aggregates.get(key) === current && current.generation === coldGeneration) {
          current.value = unseen;
          current.pending = false;
        }
      })()
        .catch((error) => {
          coldState = "error";
          coldError = error instanceof Error ? error.message : "Inbox history is unavailable.";
        })
        .finally(() => {
          inflightReads--;
          notifyInboxSeen();
        });
    });
    return false;
  }
  const store = loadInboxSeenStore();
  if (!store.seeded) return false;
  return items.some((item) => entryIsUnseen(item, store.items));
}

export function subscribeInboxSeen(listener: Listener): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
  }
  const unsubscribe = listeners.subscribe(listener);
  return () => {
    unsubscribe();
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    }
  };
}
function onFocus() {
  if (coldState === "ready") {
    coldGeneration++;
    hot.clear();
    notifyInboxSeen();
  }
}

function onStorage(event: StorageEvent) {
  if (event.key !== KEY && event.key !== COLD_MARKER && event.key !== null) return;
  cachedRaw = undefined;
  cachedStore = undefined;
  coldGeneration++;
  coldInitGeneration++;
  hot.clear();
  coldReady = undefined;
  if (coldAvailable() || coldRequired()) void ensureCold().catch(() => {});
  notifyInboxSeen();
}

export function useInboxSeenTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribeInboxSeen(() => setTick((value) => value + 1));
    if (coldAvailable() || coldRequired()) void ensureCold().catch(() => {});
    return unsubscribe;
  }, []);
  return tick;
}

export function useInboxItemUnseen(entry: InboxSeenEntry, visible: boolean): boolean {
  useInboxSeenTick();
  const [resolved, setResolved] = useState(false);
  const generation = inboxSeenGeneration();
  useEffect(() => {
    if (!visible) return;
    let current = true;
    void readInboxEntryUnseen({ key: entry.key, updatedAt: entry.updatedAt })
      .then((value) => {
        if (current) setResolved(value);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [visible, entry.key, entry.updatedAt, generation]);
  return typeof indexedDB === "undefined" ? isInboxEntryUnseen(entry) : resolved;
}

export function inboxSeenStatus(): { state: ColdState; error?: string } {
  return {
    state: coldState === "ready" && (readScheduled || inflightReads > 0) ? "loading" : coldState,
    ...(coldError ? { error: coldError } : {}),
  };
}
export function retryInboxSeenStorage(): void {
  coldReady = undefined;
  void ensureCold().catch(() => {});
}
