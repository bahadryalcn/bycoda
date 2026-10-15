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
const encoder = new TextEncoder();
const validKey = (key: RemotePageCacheKey) =>
  !!key &&
  typeof key.environmentId === "string" &&
  key.environmentId.length > 0 &&
  typeof key.sessionId === "string" &&
  key.sessionId.length > 0;
const storageKey = (key: RemotePageCacheKey) => JSON.stringify([key.environmentId, key.sessionId]);
const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;

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
export function sanitizeRemotePageSnapshot(value: unknown): RemotePageSnapshot | undefined {
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
      if (jsonBytes(snapshot) > REMOTE_PAGE_CACHE_MAX_RECORD_BYTES) return undefined;
      // Ensure the projected value is JSON-safe (no cycles, bigint, or custom serialization).
      JSON.parse(JSON.stringify(snapshot));
    } catch {
      return undefined;
    }
    return snapshot;
  } catch {
    return undefined;
  }
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
  const snapshot = sanitizeRemotePageSnapshot(value.snapshot);
  if (!snapshot || snapshot.session.id !== key.sessionId) return undefined;
  return jsonBytes(snapshot) <= recordBytes ? snapshot : undefined;
}

export function planRemotePageCacheWrites(
  records: RemotePageCacheRecord[],
  incoming: RemotePageCacheRecord,
): RemotePageCacheRecord[] {
  const existing = records.find((record) => record.key === incoming.key);
  if (existing && existing.snapshot.revision > incoming.snapshot.revision) return records;
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

let databasePromise: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (databasePromise) return databasePromise;
  const opening: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, REMOTE_PAGE_CACHE_SCHEMA);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
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
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(storageKey(key));
      let snapshot: RemotePageSnapshot | undefined;
      request.onsuccess = () => {
        const parsed = parseRemotePageCacheRecord(request.result, key);
        if (parsed) snapshot = parsed;
        else if (request.result) store.delete(storageKey(key));
      };
      transaction.oncomplete = () => resolve(snapshot);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    return undefined;
  }
}

export async function writeRemotePageCache(
  key: RemotePageCacheKey,
  snapshot: RemotePageSnapshot | HostSession,
): Promise<void> {
  if (!validKey(key)) return;
  const safe = sanitizeRemotePageSnapshot(snapshot);
  if (!safe || safe.session.id !== key.sessionId) return;
  const incoming: RemotePageCacheRecord = {
    schema: REMOTE_PAGE_CACHE_SCHEMA,
    key: storageKey(key),
    savedAt: Date.now(),
    bytes: jsonBytes(safe),
    snapshot: safe,
  };
  if (incoming.bytes > REMOTE_PAGE_CACHE_MAX_RECORD_BYTES) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const now = Date.now();
        const fresh = (request.result as RemotePageCacheRecord[]).filter(
          (record) =>
            record.schema === REMOTE_PAGE_CACHE_SCHEMA &&
            finite(record.savedAt) &&
            now - record.savedAt <= REMOTE_PAGE_CACHE_TTL_MS &&
            finite(record.bytes) &&
            record.bytes <= REMOTE_PAGE_CACHE_MAX_RECORD_BYTES,
        );
        const planned = planRemotePageCacheWrites(fresh, incoming);
        const keys = new Set(planned.map((record) => record.key));
        for (const record of request.result as RemotePageCacheRecord[])
          if (!keys.has(record.key)) store.delete(record.key);
        store.put(incoming);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    /* disposable cache failures must not affect session loading */
  }
}

export async function deleteRemotePageCache(key: RemotePageCacheKey): Promise<void> {
  if (!validKey(key)) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(storageKey(key));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    /* best-effort cleanup */
  }
}
