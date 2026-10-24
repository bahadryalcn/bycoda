import type { Block } from "../../sessions/model/session";
import type { HostSession } from "./protocol";

export const REMOTE_PAGE_CACHE_SCHEMA = 1;
export const REMOTE_PAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const REMOTE_PAGE_CACHE_MAX_ENTRIES = 8;
export const REMOTE_PAGE_CACHE_MAX_BYTES = 8 * 1024 * 1024;
export const REMOTE_PAGE_CACHE_MAX_RECORD_BYTES = 1024 * 1024;
const REMOTE_PAGE_CACHE_MAX_STRING_CHARS = 64 * 1024;

export type RemotePageCacheKey = { environmentId: string; sessionId: string };
export type RemotePageSnapshot = Pick<
  HostSession,
  "session" | "projectId" | "revision" | "status" | "updatedAt"
> & {
  history: NonNullable<HostSession["history"]>;
};
export type RemotePageCacheRecord = {
  schema: number;
  key: string;
  savedAt: number;
  bytes: number;
  snapshot: RemotePageSnapshot;
};

const DB_NAME = "bycoda-remote-page-cache";
const STORE_NAME = "pages";
const META_STORE_NAME = "page-metadata";
const DATABASE_VERSION = 2;
const encoder = new TextEncoder();
const validKey = (key: RemotePageCacheKey) =>
  !!key &&
  typeof key.environmentId === "string" &&
  key.environmentId.length > 0 &&
  typeof key.sessionId === "string" &&
  key.sessionId.length > 0;
const storageKey = (key: RemotePageCacheKey) => JSON.stringify([key.environmentId, key.sessionId]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const nonNegativeInteger = (value: unknown): value is number =>
  finite(value) && Number.isInteger(value) && value >= 0;

function boundedJson(
  value: unknown,
  seen = new Set<object>(),
  budget = { nodes: 50_000 },
): boolean {
  if (typeof value === "string") return value.length <= REMOTE_PAGE_CACHE_MAX_STRING_CHARS;
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === undefined
  )
    return true;
  if (typeof value !== "object" || seen.has(value) || --budget.nodes < 0) return false;
  seen.add(value);
  if (Array.isArray(value))
    return value.length <= 10_000 && value.every((item) => boundedJson(item, seen, budget));
  return Object.entries(value).every(
    ([key, item]) => key.length <= 256 && boundedJson(item, seen, budget),
  );
}

function safeBlock(value: unknown): Block | undefined {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.text !== "string" ||
    ![
      "user",
      "assistant",
      "image",
      "reasoning",
      "tool",
      "approval",
      "tasks",
      "plan",
      "system",
      "handoff",
    ].includes(String(value.role)) ||
    value.draft === true
  )
    return undefined;
  // Remote previews have a deliberately narrow shape; never persist arbitrary block properties.
  const block: Record<string, unknown> = {
    id: value.id,
    role: value.role,
    text: value.text,
  };
  for (const key of [
    "remoteContent",
    "startedAt",
    "durationMs",
    "turnModel",
    "providerTurnId",
    "bycoda",
    "intent",
    "turnMetrics",
    "tool",
    "approval",
    "agentRun",
    "taskList",
    "plan",
    "orchestrationLeadId",
    "internal",
    "handoff",
    "secondOpinion",
    "btwThreads",
    "noteCard",
    "ciContext",
    "interjection",
    "shell",
    "notice",
  ])
    if (key in value) block[key] = safeJson(value[key]);
  if (Array.isArray(value.attachments)) {
    block.attachments = value.attachments.slice(0, 128).map((attachment) => {
      if (!isObject(attachment)) return {};
      const {
        data: _data,
        path: _path,
        previewUrl: _previewUrl,
        loadPreview: _loadPreview,
        ...metadata
      } = attachment;
      return safeJson(metadata) as Record<string, unknown>;
    });
  }
  return block as unknown as Block;
}

function safeJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean" || finite(value))
    return value;
  if (Array.isArray(value)) return value.map(safeJson).filter((item) => item !== undefined);
  if (!isObject(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      /draft|outbox|credential|password|secret|authorization|auth|apikey|accesstoken|refreshtoken/i.test(
        key,
      )
    )
      continue;
    const safe = safeJson(item);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

/** Projects a page to a JSON-only display snapshot and rejects unsafe/unbounded content. */
function projectRemotePageSnapshot(
  value: unknown,
): { snapshot: RemotePageSnapshot; json: string; bytes: number } | undefined {
  try {
    if (
      !isObject(value) ||
      !isObject(value.session) ||
      !Array.isArray(value.session.blocks) ||
      typeof value.projectId !== "string" ||
      !nonNegativeInteger(value.revision) ||
      !finite(value.updatedAt) ||
      !["idle", "running", "interrupted"].includes(String(value.status)) ||
      !isObject(value.history) ||
      !nonNegativeInteger(value.history.revision) ||
      value.history.revision !== value.revision ||
      !nonNegativeInteger(value.history.totalBlocks) ||
      (value.history.before !== undefined && !nonNegativeInteger(value.history.before)) ||
      typeof value.session.id !== "string" ||
      typeof value.session.cwd !== "string" ||
      typeof value.session.title !== "string" ||
      typeof value.session.model !== "string" ||
      typeof value.session.harness !== "string" ||
      typeof value.session.runtimeMode !== "string" ||
      (value.session.modelSettings !== undefined && !isObject(value.session.modelSettings))
    )
      return undefined;
    const sourceBlocks = value.session.blocks.slice(-100);
    const dropped = value.session.blocks.length - sourceBlocks.length;
    if (sourceBlocks.some((block) => !boundedJson(block))) return undefined;
    const blocks = sourceBlocks
      .filter((block) => !(isObject(block) && block.draft === true))
      .map(safeBlock);
    if (blocks.some((block) => !block)) return undefined;
    const session: Record<string, unknown> = {
      id: value.session.id,
      cwd: value.session.cwd,
      title: value.session.title,
      model: value.session.model,
      harness: value.session.harness,
      runtimeMode: value.session.runtimeMode,
      blocks,
      modelSettings: Object.fromEntries(
        Object.entries(value.session.modelSettings ?? {}).filter(
          ([name, setting]) =>
            typeof setting === "string" &&
            !/draft|outbox|credential|password|secret|authorization|auth|apikey|token/i.test(name),
        ),
      ),
    };
    if (typeof value.session.providerSessionId === "string")
      session.providerSessionId = value.session.providerSessionId;
    if (typeof value.session.branch === "string") session.branch = value.session.branch;
    if (typeof value.session.worktreeCwd === "string")
      session.worktreeCwd = value.session.worktreeCwd;
    const before =
      value.history.before === undefined && dropped === 0
        ? undefined
        : (value.history.before ?? 0) + dropped;
    if (before !== undefined && before + blocks.length > value.history.totalBlocks)
      return undefined;
    const history = {
      revision: value.history.revision,
      totalBlocks: value.history.totalBlocks,
      ...(before !== undefined ? { before } : {}),
    };
    const snapshot = {
      projectId: value.projectId,
      revision: value.revision,
      updatedAt: value.updatedAt,
      status: value.status,
      history,
      session,
    } as RemotePageSnapshot;
    try {
      const json = JSON.stringify(snapshot);
      const bytes = encoder.encode(json).byteLength;
      if (bytes > REMOTE_PAGE_CACHE_MAX_RECORD_BYTES) return undefined;
      // Ensure the projected value is JSON-safe (no cycles, bigint, or custom serialization).
      JSON.parse(json);
      return { snapshot, json, bytes };
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
}

export function sanitizeRemotePageSnapshot(value: unknown): RemotePageSnapshot | undefined {
  return projectRemotePageSnapshot(value)?.snapshot;
}

export function parseRemotePageCacheRecord(
  value: unknown,
  key: RemotePageCacheKey,
  now = Date.now(),
): RemotePageSnapshot | undefined {
  if (
    !validKey(key) ||
    !isObject(value) ||
    value.schema !== REMOTE_PAGE_CACHE_SCHEMA ||
    value.key !== storageKey(key) ||
    !finite(value.savedAt) ||
    !finite(value.bytes)
  )
    return undefined;
  const savedAt = value.savedAt;
  const recordBytes = value.bytes;
  if (
    now - savedAt > REMOTE_PAGE_CACHE_TTL_MS ||
    savedAt > now + 60_000 ||
    recordBytes > REMOTE_PAGE_CACHE_MAX_RECORD_BYTES
  )
    return undefined;
  const projected = projectRemotePageSnapshot(value.snapshot);
  if (!projected || projected.snapshot.session.id !== key.sessionId) return undefined;
  return projected.bytes <= recordBytes ? projected.snapshot : undefined;
}

export function planRemotePageCacheWrites(
  records: RemotePageCacheRecord[],
  incoming: RemotePageCacheRecord,
): RemotePageCacheRecord[] {
  const existing = records.find((record) => record.key === incoming.key);
  if (existing && !canReplace(metadataOf(existing), metadataOf(incoming))) return records;
  const sorted = [...records.filter((record) => record.key !== incoming.key), incoming].sort(
    (a, b) => a.savedAt - b.savedAt,
  );
  let bytes = sorted.reduce((sum, record) => sum + record.bytes, 0);
  while (sorted.length > REMOTE_PAGE_CACHE_MAX_ENTRIES || bytes > REMOTE_PAGE_CACHE_MAX_BYTES) {
    const removed = sorted.shift();
    if (!removed) break;
    bytes -= removed.bytes;
  }
  return sorted;
}

type PageMetadata = Omit<RemotePageCacheRecord, "snapshot"> & {
  revision: number;
  before: number;
  blocks: number;
};
function metadataOf(record: RemotePageCacheRecord): PageMetadata {
  const { snapshot, ...rest } = record;
  return {
    ...rest,
    revision: snapshot.revision,
    before: snapshot.history.before ?? 0,
    blocks: snapshot.session.blocks.length,
  };
}
function freshMetadata(value: unknown, now: number): value is PageMetadata {
  return (
    isObject(value) &&
    value.schema === REMOTE_PAGE_CACHE_SCHEMA &&
    typeof value.key === "string" &&
    finite(value.savedAt) &&
    value.savedAt <= now + 60_000 &&
    now - value.savedAt <= REMOTE_PAGE_CACHE_TTL_MS &&
    finite(value.bytes) &&
    value.bytes >= 0 &&
    value.bytes <= REMOTE_PAGE_CACHE_MAX_RECORD_BYTES &&
    nonNegativeInteger(value.revision) &&
    nonNegativeInteger(value.before) &&
    nonNegativeInteger(value.blocks)
  );
}
type PageWindow = Pick<PageMetadata, "revision" | "before" | "blocks">;
function windowOf(snapshot: RemotePageSnapshot | HostSession): PageWindow {
  return {
    revision: snapshot.revision,
    before: snapshot.history?.before ?? 0,
    blocks: snapshot.session.blocks.length,
  };
}
function canReplace(existing: PageWindow, incoming: PageWindow): boolean {
  if (existing.revision > incoming.revision) return false;
  // An older narrow response at the same revision must not discard a page the
  // owner already expanded. Equal windows may still publish updated metadata.
  return (
    existing.revision !== incoming.revision ||
    !(
      existing.before <= incoming.before &&
      existing.before + existing.blocks >= incoming.before + incoming.blocks &&
      (existing.before < incoming.before || existing.blocks > incoming.blocks)
    )
  );
}

let databasePromise: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (databasePromise) return databasePromise;
  const opening: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        const metadata = db.createObjectStore(META_STORE_NAME, { keyPath: "key" });
        // One upgrade pass, not a body clone on every later write. The old
        // cache is bounded to eight records; invalid legacy entries are disposable.
        const pages = request.transaction!.objectStore(STORE_NAME);
        const retained: PageMetadata[] = [];
        let retainedBytes = 0;
        const cursor = pages.openCursor();
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (!current) return;
          const record = current.value as RemotePageCacheRecord;
          try {
            const value = metadataOf(record);
            if (freshMetadata(value, Date.now())) {
              metadata.put(value);
              retained.push(value);
              retainedBytes += value.bytes;
              retained.sort((a, b) => a.savedAt - b.savedAt);
              while (
                retained.length > REMOTE_PAGE_CACHE_MAX_ENTRIES ||
                retainedBytes > REMOTE_PAGE_CACHE_MAX_BYTES
              ) {
                const removed = retained.shift()!;
                retainedBytes -= removed.bytes;
                pages.delete(removed.key);
                metadata.delete(removed.key);
              }
            } else current.delete();
          } catch {
            current.delete();
          }
          current.continue();
        };
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        databasePromise = undefined;
        written.clear();
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  }).catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  databasePromise = opening;
  return opening;
}

export async function readRemotePageCache(
  key: RemotePageCacheKey,
): Promise<RemotePageSnapshot | undefined> {
  if (!validKey(key)) return undefined;
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(storageKey(key));
      let snapshot: RemotePageSnapshot | undefined;
      request.onsuccess = () => {
        const parsed = parseRemotePageCacheRecord(request.result, key);
        if (parsed) snapshot = parsed;
        else if (request.result) {
          store.delete(storageKey(key));
          transaction.objectStore(META_STORE_NAME).delete(storageKey(key));
          written.delete(storageKey(key));
        }
      };
      transaction.oncomplete = () => resolve(snapshot);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    return undefined;
  }
}

type QueuedPageWrite = {
  key: RemotePageCacheKey;
  snapshot: RemotePageSnapshot | HostSession;
  readyAt: number;
  cancelled: boolean;
  promise: Promise<void>;
  resolve: () => void;
};
const pending = new Map<string, QueuedPageWrite>();
const written = new Map<string, { json: string; bytes: number; at: number; token: object }>();
const writtenSources = new WeakMap<object, { key: string; token: object }>();
let activeWrite: QueuedPageWrite | undefined;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let stopLifecycle: (() => void) | undefined;
const WRITE_COALESCE_MS = 250;

function rememberWritten(
  id: string,
  projected: { json: string; bytes: number },
  source: RemotePageSnapshot | HostSession,
) {
  written.delete(id);
  const token = {};
  written.set(id, { json: projected.json, bytes: projected.bytes, at: Date.now(), token });
  writtenSources.set(source, { key: id, token });
  let bytes = 0;
  for (const entry of written.values()) bytes += entry.bytes;
  while (written.size > REMOTE_PAGE_CACHE_MAX_ENTRIES || bytes > REMOTE_PAGE_CACHE_MAX_BYTES) {
    const first = written.keys().next().value!;
    bytes -= written.get(first)!.bytes;
    written.delete(first);
  }
}
function armWrites() {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  if (activeWrite) return;
  if (!pending.size) {
    stopLifecycle?.();
    stopLifecycle = undefined;
    return;
  }
  const next = Math.min(...[...pending.values()].map((entry) => entry.readyAt));
  writeTimer = setTimeout(
    () => {
      writeTimer = undefined;
      void drainWrites();
    },
    Math.max(0, next - Date.now()),
  );
}
async function drainWrites() {
  if (activeWrite) return;
  clearTimeout(writeTimer);
  writeTimer = undefined;
  try {
    while (true) {
      const pair = [...pending].find(([, entry]) => entry.readyAt <= Date.now());
      if (!pair) break;
      const [id, entry] = pair;
      pending.delete(id);
      activeWrite = entry;
      try {
        await persistRemotePage(entry);
      } finally {
        entry.resolve();
        activeWrite = undefined;
      }
    }
  } finally {
    armWrites();
  }
}
function watchLifecycle() {
  if (stopLifecycle || typeof window === "undefined") return;
  const flush = () => {
    void flushRemotePageCache();
  };
  const onVisibility = () => {
    if (document.hidden) flush();
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", onVisibility);
  stopLifecycle = () => {
    window.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Only disposable transcript previews are coalesced. This queue never owns
 * drafts, commands or outbox data; it retains at most eight latest bindings. */
export function writeRemotePageCache(
  key: RemotePageCacheKey,
  snapshot: RemotePageSnapshot | HostSession,
): Promise<void> {
  if (
    !validKey(key) ||
    typeof indexedDB === "undefined" ||
    !snapshot.history ||
    snapshot.session.id !== key.sessionId
  )
    return Promise.resolve();
  const id = storageKey(key);
  const previous = written.get(id);
  const source = writtenSources.get(snapshot);
  if (
    previous &&
    source?.key === id &&
    source.token === previous.token &&
    Date.now() - previous.at < REMOTE_PAGE_CACHE_TTL_MS
  )
    return Promise.resolve();
  const queued = pending.get(id);
  if (queued) {
    if (canReplace(windowOf(queued.snapshot), windowOf(snapshot))) queued.snapshot = snapshot;
    if (snapshot.status !== "running") {
      queued.readyAt = 0;
      void drainWrites();
    }
    return queued.promise;
  }
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  const entry: QueuedPageWrite = {
    key,
    snapshot,
    readyAt: snapshot.status === "running" ? Date.now() + WRITE_COALESCE_MS : 0,
    cancelled: false,
    promise,
    resolve,
  };
  pending.set(id, entry);
  while (pending.size > REMOTE_PAGE_CACHE_MAX_ENTRIES) {
    const first = pending.keys().next().value!;
    pending.get(first)!.resolve();
    pending.delete(first);
  }
  watchLifecycle();
  if (entry.readyAt === 0) void drainWrites();
  else armWrites();
  return promise;
}

export function flushRemotePageCache(key?: RemotePageCacheKey): Promise<void> {
  if (key !== undefined && !validKey(key)) return Promise.resolve();
  const id = key && validKey(key) ? storageKey(key) : undefined;
  const waits: Promise<void>[] = [];
  if (activeWrite && (id === undefined || storageKey(activeWrite.key) === id))
    waits.push(activeWrite.promise);
  for (const [binding, entry] of pending)
    if (id === undefined || binding === id) {
      entry.readyAt = 0;
      waits.push(entry.promise);
    }
  void drainWrites();
  return Promise.all(waits).then(() => undefined);
}

async function persistRemotePage(entry: QueuedPageWrite): Promise<void> {
  const { key, snapshot } = entry;
  const projected = projectRemotePageSnapshot(snapshot);
  if (!projected || projected.snapshot.session.id !== key.sessionId || entry.cancelled) return;
  const safe = projected.snapshot;
  const id = storageKey(key);
  const previous = written.get(id);
  if (previous?.json === projected.json && Date.now() - previous.at < REMOTE_PAGE_CACHE_TTL_MS) {
    writtenSources.set(snapshot, { key: id, token: previous.token });
    return;
  }
  const incoming: RemotePageCacheRecord = {
    schema: REMOTE_PAGE_CACHE_SCHEMA,
    key: id,
    savedAt: Date.now(),
    bytes: projected.bytes,
    snapshot: safe,
  };
  try {
    const db = await openDatabase();
    if (entry.cancelled) return;
    let persisted = false;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const metadata = transaction.objectStore(META_STORE_NAME);
      const request = metadata.getAll();
      request.onsuccess = () => {
        try {
          const now = Date.now();
          const fresh = (request.result as unknown[]).filter((value): value is PageMetadata =>
            freshMetadata(value, now),
          );
          const incomingMetadata = metadataOf(incoming);
          const existing = fresh.find((value) => value.key === id);
          if (entry.cancelled || (existing && !canReplace(existing, incomingMetadata))) return;
          const planned = [...fresh.filter((value) => value.key !== id), incomingMetadata].sort(
            (a, b) => a.savedAt - b.savedAt,
          );
          let bytes = planned.reduce((sum, value) => sum + value.bytes, 0);
          while (
            planned.length > REMOTE_PAGE_CACHE_MAX_ENTRIES ||
            bytes > REMOTE_PAGE_CACHE_MAX_BYTES
          )
            bytes -= planned.shift()!.bytes;
          const keys = new Set(planned.map((value) => value.key));
          for (const record of request.result as PageMetadata[])
            if (!keys.has(record.key)) {
              store.delete(record.key);
              metadata.delete(record.key);
              written.delete(record.key);
            }
          if (!keys.has(id)) return;
          store.put(incoming);
          metadata.put(incomingMetadata);
          persisted = true;
        } catch {
          persisted = false;
          try {
            transaction.abort();
          } catch {
            /* already completed/aborted */
          }
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    if (persisted && !entry.cancelled) rememberWritten(id, projected, snapshot);
  } catch {
    /* disposable cache failures must not affect session loading */
  }
}

export async function deleteRemotePageCache(key: RemotePageCacheKey): Promise<void> {
  if (!validKey(key)) return;
  const id = storageKey(key);
  const queued = pending.get(id);
  if (queued) {
    pending.delete(id);
    queued.cancelled = true;
    queued.resolve();
  }
  if (activeWrite && storageKey(activeWrite.key) === id) activeWrite.cancelled = true;
  written.delete(id);
  armWrites();
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.objectStore(META_STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    /* best-effort cleanup */
  }
}
