import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import * as zlib from "node:zlib";
import { join } from "node:path";
import type { UsageRow } from "../../src/features/providers/model/usagePricing";

/** Token usage from the Claude Code / Codex session logs on the Host, mirroring
 * `src-tauri/src/provider_usage.rs` (same request keys and de-duplication). */

/** `session` is the provider log session id (the transcript file), when the request came from a file. */
export type LogRequest = Omit<UsageRow, "slot"> & { ts: number; session?: string };
export type KeyedRequest = [key: string, request: LogRequest];
export type Provider = "claude" | "codex";

const MAX_DEPTH = 5;
const MAX_FILES = 20_000;

const count = (value: unknown, key: string): number => {
  const found = (value as Record<string, unknown> | null)?.[key];
  return typeof found === "number" && Number.isFinite(found) && found >= 0 ? found : 0;
};
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function parseTimestamp(value: unknown): number | null {
  const ms = Date.parse(text(value));
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export function parseClaudeLine(line: string): KeyedRequest | null {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null;
  let entry: Record<string, unknown> | null;
  try {
    entry = object(JSON.parse(line));
  } catch {
    return null;
  }
  const message = object(entry?.message);
  const usage = object(message?.usage);
  const model = text(message?.model);
  const ts = parseTimestamp(entry?.timestamp);
  // Locally generated notices ("<synthetic>") were never billed.
  if (
    !entry ||
    entry.type !== "assistant" ||
    !message ||
    !usage ||
    !model ||
    model.startsWith("<") ||
    ts === null
  )
    return null;
  const total = count(usage, "cache_creation_input_tokens");
  const split = object(usage.cache_creation);
  const w5 = split ? count(split, "ephemeral_5m_input_tokens") : total;
  const w1 = split ? count(split, "ephemeral_1h_input_tokens") : 0;
  const key =
    text(message.id) || text(entry.requestId)
      ? `${text(message.id)}:${text(entry.requestId)}`
      : text(entry.uuid);
  return [
    key,
    {
      ts,
      model,
      project: text(entry.cwd),
      input: count(usage, "input_tokens"),
      cacheRead: count(usage, "cache_read_input_tokens"),
      // Older logs report only the total; treat it all as 5-minute writes.
      cacheWrite5m: w5 + w1 === 0 ? total : w5,
      cacheWrite1h: w1,
      output: count(usage, "output_tokens"),
    },
  ];
}

export type CodexCarry = { project: string; model: string; lastTotal: number | null };

export function parseCodexLine(line: string, carry: CodexCarry): KeyedRequest | null {
  if (
    !line.includes("token_count") &&
    !line.includes("turn_context") &&
    !line.includes("session_meta")
  )
    return null;
  let entry: Record<string, unknown> | null;
  try {
    entry = object(JSON.parse(line));
  } catch {
    return null;
  }
  const payload = object(entry?.payload);
  if (!entry || !payload) return null;
  if (entry.type === "session_meta" || entry.type === "turn_context") {
    if (text(payload.cwd)) carry.project = text(payload.cwd);
    if (text(payload.model)) carry.model = text(payload.model);
    return null;
  }
  if (entry.type !== "event_msg" || payload.type !== "token_count") return null;
  const info = object(payload.info);
  if (!info) return null;
  const totalUsage = object(info.total_token_usage);
  const total = totalUsage ? count(totalUsage, "total_tokens") : null;
  // A repeated running total is the same response reported twice.
  if (total !== null && total === carry.lastTotal) return null;
  carry.lastTotal = total;
  const last = object(info.last_token_usage);
  const ts = parseTimestamp(entry.timestamp);
  if (!last || ts === null) return null;
  const input = count(last, "input_tokens");
  const cached = Math.min(count(last, "cached_input_tokens"), input);
  return [
    `${text(entry.timestamp)}|${JSON.stringify(info.total_token_usage ?? null)}|${JSON.stringify(last)}`,
    {
      ts,
      model: carry.model || "codex",
      project: carry.project,
      input: input - cached,
      cacheRead: cached,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      output: count(last, "output_tokens"),
    },
  ];
}

const FIELDS = ["input", "cacheRead", "cacheWrite5m", "cacheWrite1h", "output"] as const;

/** Claude repeats a request with growing counts (keep each largest); Codex repeats it verbatim (first wins). */
export function mergeRequest(
  into: Map<string, LogRequest>,
  provider: Provider,
  key: string,
  request: LogRequest,
) {
  const kept = into.get(key);
  if (!kept) into.set(key, { ...request });
  else if (provider === "claude")
    for (const field of FIELDS) kept[field] = Math.max(kept[field], request[field]);
}

// shortcut: zstd logs are read only on Node versions that ship zstd (22.15+); older ones skip them.
const zstd = (zlib as unknown as { createZstdDecompress?: () => NodeJS.ReadWriteStream })
  .createZstdDecompress;

async function* lines(path: string): AsyncGenerator<string> {
  const source = createReadStream(path);
  source.on("error", () => undefined);
  let input: NodeJS.ReadableStream = source;
  if (path.endsWith(".zst")) {
    if (!zstd) return;
    const decoder = zstd();
    decoder.on("error", () => undefined);
    input = source.pipe(decoder);
  }
  yield* createInterface({ input, crlfDelay: Infinity });
}

/** The transcript's session id; a Claude subagent log (`<session>/subagents/agent-x`) belongs to its parent session. */
export function sessionOf(path: string): string {
  const parts = path.split(/[\\/]+/);
  const name = (parts.pop() ?? "").replace(/\.zst$/, "").replace(/\.jsonl$/, "");
  return parts.at(-1) === "subagents" && parts.length >= 2 ? (parts.at(-2) as string) : name;
}

async function parseFile(path: string, provider: Provider): Promise<KeyedRequest[]> {
  const merged = new Map<string, LogRequest>();
  const carry: CodexCarry = { project: "", model: "", lastTotal: null };
  const session = sessionOf(path);
  try {
    for await (const line of lines(path)) {
      const parsed = provider === "claude" ? parseClaudeLine(line) : parseCodexLine(line, carry);
      if (parsed) mergeRequest(merged, provider, parsed[0], { ...parsed[1], session });
    }
  } catch {
    /* A truncated or unreadable log contributes what it parsed. */
  }
  return [...merged];
}

const isLog = (name: string) => name.endsWith(".jsonl") || name.endsWith(".jsonl.zst");
const baseName = (path: string) => path.replace(/^.*[\\/]/, "").replace(/\.zst$/, "");

type Found = { path: string; mtime: number; size: number };

const STAT_CONCURRENCY = 16;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function collect(dir: string, sinceMs: number, depth: number, out: Found[]) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  // Stat this directory's logs with a small concurrency limit; the walk below keeps readdir order.
  const logs = entries.filter((entry) => entry.isFile() && isLog(entry.name));
  const infos = await mapLimit(logs, STAT_CONCURRENCY, (entry) =>
    stat(join(dir, entry.name)).catch(() => null),
  );
  const statOf = new Map(logs.map((entry, index) => [entry.name, infos[index]]));
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) await collect(path, sinceMs, depth + 1, out);
    } else {
      const info = statOf.get(entry.name);
      // A transcript last written before the cutoff holds nothing newer.
      if (info && info.mtimeMs >= sinceMs) out.push({ path, mtime: info.mtimeMs, size: info.size });
    }
  }
}

type CacheEntry = { size: number; mtime: number; requests: KeyedRequest[] };

/** Parsed requests per log file. Map order is recency: a hit or insert moves the entry last. */
const fileCache = new Map<string, CacheEntry>();
let cachedRequests = 0;
let maxCachedRequests = 150_000;
/** Cache keys of the files each running scan is using; eviction leaves them alone. */
const activeScans = new Set<Set<string>>();

export const clearScanCache = () => {
  fileCache.clear();
  cachedRequests = 0;
};
/** Cache size, and a smaller request budget for tests. */
export const scanCacheState = () => ({ files: fileCache.size, requests: cachedRequests });
export const setScanCacheLimit = (requests: number) => {
  maxCachedRequests = requests;
};

const isPinned = (key: string) => {
  for (const pinned of activeScans) if (pinned.has(key)) return true;
  return false;
};

function touch(key: string, entry: CacheEntry) {
  fileCache.delete(key);
  fileCache.set(key, entry);
}

/** Cache `entry` within the request budget by evicting the least recently used files no running scan
 * needs. When the running scans alone fill the budget the entry is skipped, so what is cached stays
 * a stable subset instead of being thrown away and re-parsed in full on every refresh. */
function remember(key: string, entry: CacheEntry) {
  const previous = fileCache.get(key);
  if (previous) {
    fileCache.delete(key);
    cachedRequests -= previous.requests.length;
  }
  const size = entry.requests.length;
  if (size > maxCachedRequests) return;
  for (const [other, cached] of fileCache) {
    if (cachedRequests + size <= maxCachedRequests) break;
    if (isPinned(other)) continue;
    fileCache.delete(other);
    cachedRequests -= cached.requests.length;
  }
  if (cachedRequests + size > maxCachedRequests) return;
  fileCache.set(key, entry);
  cachedRequests += size;
}

export type ScanResult = { requests: LogRequest[]; files: number; truncated: boolean };

/** Every request logged at or after `sinceMs` under the account log roots, each counted once. */
export async function scanLogs(
  roots: string[],
  provider: Provider,
  sinceMs: number,
): Promise<ScanResult> {
  const found: Found[] = [];
  const owner = new Map<string, number>();
  for (const [index, root] of roots.entries()) {
    const here: Found[] = [];
    await collect(root, sinceMs, 0, here);
    // The same session under two roots (moved while scanning) counts once.
    for (const file of here) {
      const name = baseName(file.path);
      if ((owner.get(name) ?? index) !== index) continue;
      owner.set(name, index);
      found.push(file);
    }
  }
  // Oldest first, so a resumed session's replayed request belongs to the log that first recorded it.
  found.sort((a, b) => a.mtime - b.mtime);
  const merged = new Map<string, LogRequest>();
  const cacheKey = (path: string) => `${provider}\0${path}`;
  // Pin this scan's files so a concurrent scan cannot evict them mid-run.
  const live = new Set(found.map((file) => cacheKey(file.path)));
  activeScans.add(live);
  try {
    for (const { path, size, mtime } of found) {
      const key = cacheKey(path);
      let entry = fileCache.get(key);
      // The size and mtime come from the walk's stat, taken before the parse: a file that grows
      // while it is read no longer matches and is parsed again next time.
      if (entry && entry.size === size && entry.mtime === mtime) touch(key, entry);
      else {
        entry = { size, mtime, requests: await parseFile(path, provider) };
        remember(key, entry);
      }
      for (const [requestKey, request] of entry.requests)
        mergeRequest(merged, provider, requestKey, request);
    }
  } finally {
    activeScans.delete(live);
  }
  return {
    requests: [...merged.values()].filter((request) => request.ts * 1000 >= sinceMs),
    files: found.length,
    truncated: found.length >= MAX_FILES,
  };
}
