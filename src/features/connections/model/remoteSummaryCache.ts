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

export function writeRemoteSummaryCache(key: string, value: string): void {
  if (!key.startsWith(PREFIX)) throw new Error("Invalid summary cache key");
  if (value.length * 2 > REMOTE_SUMMARY_CACHE_BYTES) {
    localStorage.removeItem(key);
    return;
  }
  const entries: string[] = [];
  let bytes = value.length * 2;
  for (let index = 0; index < localStorage.length; index++) {
    const entry = localStorage.key(index);
    if (entry?.startsWith(PREFIX) && entry !== key) {
      entries.push(entry);
      bytes += (localStorage.getItem(entry)?.length ?? 0) * 2;
    }
  }
  let count = entries.length + 1;
  for (const entry of entries) {
    if (bytes <= REMOTE_SUMMARY_CACHE_BYTES && count <= REMOTE_SUMMARY_CACHE_ENTRIES) break;
    bytes -= (localStorage.getItem(entry)?.length ?? 0) * 2;
    localStorage.removeItem(entry);
    count--;
  }
  // Reinsert makes the storage ordering an approximate recent-write order.
  localStorage.removeItem(key);
  localStorage.setItem(key, value);
}
