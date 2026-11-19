/** Only disposable remote summaries, never drafts/outbox/credentials. Old v2
 * cache keys remain readable; writes evict earlier entries at explicit budgets. */
const PREFIX = "bycoda.remote-history.v2:";
export const REMOTE_SUMMARY_CACHE_BYTES = 2 * 1024 * 1024;
export const REMOTE_SUMMARY_CACHE_ENTRIES = 64;
const pending = new Map<string, string>();
let pendingBytes = 0;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/** Coalesce disposable list updates and yield between storage writes. */
export function queueRemoteSummaryCache(key: string, value: string): void {
  if (!key.startsWith(PREFIX)) throw new Error("Invalid summary cache key");
  pendingBytes -= (pending.get(key)?.length ?? 0) * 2;
  pending.delete(key);
  if (value.length * 2 <= REMOTE_SUMMARY_CACHE_BYTES) {
    pending.set(key, value);
    pendingBytes += value.length * 2;
  }
  while (pending.size > REMOTE_SUMMARY_CACHE_ENTRIES || pendingBytes > REMOTE_SUMMARY_CACHE_BYTES) {
    const oldest = pending.keys().next().value!;
    pendingBytes -= pending.get(oldest)!.length * 2;
    pending.delete(oldest);
  }
  if (!flushTimer && pending.size) flushTimer = setTimeout(flushOne, 0);
}

function flushOne(): void {
  flushTimer = undefined;
  const key = pending.keys().next().value;
  if (key === undefined) return;
  const value = pending.get(key)!;
  pendingBytes -= value.length * 2;
  pending.delete(key);
  try {
    writeRemoteSummaryCache(key, value);
  } catch {
    /* cache is disposable */
  }
  if (pending.size) flushTimer = setTimeout(flushOne, 0);
}

/** In-memory index of cached keys to byte size, oldest write first (Map insertion
 * order). Writes consult it instead of scanning and re-reading localStorage. Values
 * are read from storage only for keys the index has not seen (first build, or keys
 * another writer added). Other windows are folded in through `storage` events;
 * `knownLength` detects any other change (clear, same-window foreign writes) and
 * triggers a key-only rescan. */
let sizes: Map<string, number> | undefined;
let totalBytes = 0;
let knownLength = -1;
let listening = false;

function track(key: string, bytes?: number): void {
  const old = sizes!.get(key);
  if (old !== undefined) {
    totalBytes -= old;
    sizes!.delete(key);
  }
  if (bytes !== undefined) {
    sizes!.set(key, bytes);
    totalBytes += bytes;
  }
}

function onStorage(event: StorageEvent): void {
  if (event.storageArea && event.storageArea !== localStorage) return;
  if (!sizes) return;
  if (event.key === null) {
    sizes = undefined; // clear(): rebuild lazily on the next write
    return;
  }
  if (event.key.startsWith(PREFIX)) {
    track(event.key, event.newValue === null ? undefined : event.newValue.length * 2);
  }
  knownLength = localStorage.length;
}

function syncIndex(): Map<string, number> {
  if (sizes && knownLength === localStorage.length) return sizes;
  const present = new Set<string>();
  const added: string[] = [];
  for (let position = 0; position < localStorage.length; position++) {
    const entry = localStorage.key(position);
    if (!entry?.startsWith(PREFIX)) continue;
    present.add(entry);
    if (!sizes?.has(entry)) added.push(entry);
  }
  const next = new Map<string, number>();
  let bytes = 0;
  for (const [entry, size] of sizes ?? []) {
    if (!present.has(entry)) continue;
    next.set(entry, size);
    bytes += size;
  }
  for (const entry of added) {
    const size = (localStorage.getItem(entry)?.length ?? 0) * 2;
    next.set(entry, size);
    bytes += size;
  }
  sizes = next;
  totalBytes = bytes;
  knownLength = localStorage.length;
  if (!listening && typeof window !== "undefined") {
    listening = true;
    // Keeps the index correct for writes made by other windows; lives for the page.
    window.addEventListener("storage", onStorage);
  }
  return next;
}

export function writeRemoteSummaryCache(key: string, value: string): void {
  if (!key.startsWith(PREFIX)) throw new Error("Invalid summary cache key");
  const size = value.length * 2;
  const entries = syncIndex();
  try {
    if (size > REMOTE_SUMMARY_CACHE_BYTES) {
      localStorage.removeItem(key);
      track(key);
      return;
    }
    track(key);
    for (const entry of entries.keys()) {
      if (totalBytes + size <= REMOTE_SUMMARY_CACHE_BYTES && entries.size + 1 <= REMOTE_SUMMARY_CACHE_ENTRIES) break;
      localStorage.removeItem(entry);
      track(entry);
    }
    // Remove first so a larger replacement fits; the index then lists the key as newest.
    localStorage.removeItem(key);
    localStorage.setItem(key, value);
    track(key, size);
  } finally {
    knownLength = localStorage.length;
  }
}
