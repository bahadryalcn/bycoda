import { invoke, isTauri } from "@tauri-apps/api/core";

/** Canonical owner evidence. Legacy source bytes remain available for recovery. */
export type StoredBindingEvidence = { shellId: string; raw: string; legacyRaw: string | null; version?: number };
const NATIVE_SCOPE = "host-session-bindings.v2";
type NativeEntry = { key: string; version: number; value: StoredBindingEvidence | null };
type NativeResult = { applied: boolean; entries: NativeEntry[]; compacted?: boolean };
const nativeOperation = () => crypto.randomUUID();
let pageToken: Promise<string> | undefined;
function nativePageToken(): Promise<string> {
  return pageToken ??= invoke<string>("canonical_store_page_token").catch((error: unknown) => {
    pageToken = undefined;
    throw error;
  });
}
let nativeImport: Promise<void> | undefined;
let nativeLegacyImported = false;
/** A durable migration marker was read from native authority. */
export function skipImportedNativeBindingLegacy(): void { nativeLegacyImported = true; }
const nativeCursors = new Map<string, number>();

async function importNativeBindings(): Promise<void> {
  if (nativeLegacyImported) return;
  if (!nativeImport) nativeImport = (async () => {
    let after: string | undefined;
    for (;;) {
      const page = await readIndexedBindingEvidencePage(after);
      for (const row of page) {
        const current = await invoke<NativeEntry | null>("canonical_store_get", { scope: NATIVE_SCOPE, key: row.shellId });
        const result = await invoke<NativeResult>("canonical_store_transaction", {
          scope: NATIVE_SCOPE, operationId: nativeOperation(), pageToken: await nativePageToken(), claim: null, expectedRevision: null,
          checks: [{ key: row.shellId, version: current?.version ?? null }],
          writes: current ? [] : [{ key: row.shellId, value: row }],
          legacy: [{ key: row.shellId, raw: JSON.stringify(row) }],
        });
        if (!result.applied) throw new Error("Session owner migration changed in another window. Retry loading.");
      }
      if (page.length < 128) break;
      after = page[page.length - 1].shellId;
    }
  })().catch((error: unknown) => { nativeImport = undefined; throw error; });
  return nativeImport;
}
let opening: Promise<IDBDatabase> | undefined;
async function database(): Promise<IDBDatabase> {
  if (!opening)
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined")
        return reject(new Error("Session owner storage is unavailable."));
      const request = indexedDB.open("bycoda-host-session-bindings", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("owners", { keyPath: "shellId" });
        request.result.createObjectStore("sources", { keyPath: ["shellId", "raw"] });
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Cannot open session owner storage."));
      let blocked = false;
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Session owner storage is blocked."));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          opening = undefined;
        };
        resolve(db);
      };
    }).catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
  return opening;
}

export async function readBindingEvidencePage(after?: string): Promise<StoredBindingEvidence[]> {
  if (isTauri()) {
    await importNativeBindings();
    const expectedRevision = after === undefined ? null : nativeCursors.get(after);
    if (expectedRevision === undefined) throw new Error("Session owner cursor expired. Retry loading.");
    const page = await invoke<{ entries: NativeEntry[]; revision: number }>("canonical_store_list", {
      scope: NATIVE_SCOPE, after: after ?? null, limit: 128, expectedRevision,
    });
    if (page.entries.length) nativeCursors.set(page.entries[page.entries.length - 1].key, page.revision);
    return page.entries.map((entry) => {
      const value = entry.value;
      if (!value || value.shellId !== entry.key || typeof value.raw !== "string" ||
          (value.legacyRaw !== null && typeof value.legacyRaw !== "string"))
        throw new Error("Invalid session owner evidence.");
      return { ...value, version: entry.version };
    });
  }
  return readIndexedBindingEvidencePage(after);
}

async function readIndexedBindingEvidencePage(after?: string): Promise<StoredBindingEvidence[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("owners", "readonly");
    const rows: StoredBindingEvidence[] = [];
    const request = transaction
      .objectStore("owners")
      .openCursor(after === undefined ? undefined : IDBKeyRange.lowerBound(after, true));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || rows.length === 128) return;
      const value = cursor.value as StoredBindingEvidence;
      if (
        typeof value?.shellId !== "string" ||
        value.shellId !== cursor.key ||
        typeof value.raw !== "string" ||
        (value.legacyRaw !== null && typeof value.legacyRaw !== "string")
      ) {
        transaction.abort();
        return;
      }
      rows.push(value);
      cursor.continue();
    };
    transaction.oncomplete = () => resolve(rows);
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("Session owner evidence cannot be read."));
  });
}

export async function readBindingEvidence(shellId: string): Promise<StoredBindingEvidence | undefined> {
  if (isTauri()) {
    await importNativeBindings();
    const row = await invoke<NativeEntry | null>("canonical_store_get", { scope: NATIVE_SCOPE, key: shellId });
    if (!row) return undefined;
    const value = row.value;
    if (!value || value.shellId !== shellId || typeof value.raw !== "string" ||
        (value.legacyRaw !== null && typeof value.legacyRaw !== "string"))
      throw new Error("Invalid session owner evidence.");
    return { ...value, version: row.version };
  }
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("owners", "readonly");
    const request = tx.objectStore("owners").get(shellId);
    tx.oncomplete = () => {
      const value = request.result as StoredBindingEvidence | undefined;
      if (value && (value.shellId !== shellId || typeof value.raw !== "string" ||
          (value.legacyRaw !== null && typeof value.legacyRaw !== "string"))) {
        reject(new Error("Invalid session owner evidence."));
        return;
      }
      resolve(value);
    };
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Cannot read session owner."));
  });
}

export type NativeSessionClaim = Readonly<{ shellId: string; operationId: string; pageToken: string }>;

/** Caller hydrates and flushes this shell before atomically claiming absent ownership. */
export async function acquireNativeSessionClaim(shellId: string): Promise<NativeSessionClaim | null> {
  if (!isTauri()) return null;
  const capability = Object.freeze({ shellId, operationId: nativeOperation(), pageToken: await nativePageToken() });
  const result = await invoke<NativeResult>("canonical_store_transaction", {
    scope: NATIVE_SCOPE, operationId: nativeOperation(), pageToken: capability.pageToken,
    checks: [{ key: shellId, version: null }], writes: [], legacy: [], expectedRevision: null,
    claim: { key: shellId, operationId: capability.operationId, mode: "acquire" },
  });
  if (!result.applied) throw new Error("This conversation has a durable Host owner.");
  return capability;
}

export async function markNativeSessionClaim(capability: NativeSessionClaim | null): Promise<void> {
  if (!capability) return;
  await invoke("canonical_store_mark_submitted", {
    scope: NATIVE_SCOPE, key: capability.shellId, operationId: capability.operationId, pageToken: capability.pageToken,
  });
}

/** Caller must first prove retirement of the original physical writer cohort. */
export async function settleNativeSessionClaim(capability: NativeSessionClaim | null): Promise<void> {
  if (!capability) return;
  const settled = await invoke<boolean>("canonical_store_settle", {
    scope: NATIVE_SCOPE, key: capability.shellId, operationId: capability.operationId, pageToken: capability.pageToken,
  });
  if (!settled) throw new Error("Native session writer retirement was not confirmed.");
}

export async function preserveBindingSource(shellId: string, raw: string): Promise<void> {
  if (isTauri()) {
    const current = await invoke<NativeEntry | null>("canonical_store_get", { scope: NATIVE_SCOPE, key: shellId });
    const result = await invoke<NativeResult>("canonical_store_transaction", {
      scope: NATIVE_SCOPE, operationId: nativeOperation(), pageToken: await nativePageToken(), claim: null, expectedRevision: null,
      checks: [{ key: shellId, version: current?.version ?? null }], writes: [],
      legacy: [{ key: shellId, raw }],
    });
    if (!result.applied) throw new Error("Session owner source changed. Retry loading.");
    return;
  }
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sources", "readwrite", { durability: "strict" });
    transaction.objectStore("sources").put({ shellId, raw });
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("Session owner source was not preserved."));
  });
}

/** Cross-window compare-and-swap; a stale owner cannot replace newer evidence. */
export async function writeBindingEvidence(
  expected: StoredBindingEvidence | undefined,
  next: StoredBindingEvidence,
): Promise<void> {
  if (isTauri()) {
    const result = await invoke<NativeResult>("canonical_store_transaction", {
      scope: NATIVE_SCOPE, operationId: nativeOperation(), pageToken: await nativePageToken(), claim: null, expectedRevision: null,
      checks: [{ key: next.shellId, version: expected?.version ?? null }],
      writes: [{ key: next.shellId, value: { shellId: next.shellId, raw: next.raw, legacyRaw: next.legacyRaw } }],
      legacy: next.legacyRaw === null ? [] : [{ key: next.shellId, raw: next.legacyRaw }],
    });
    if (!result.applied) throw new Error("The session owner changed in another window. Reload before continuing.");
    const entry = result.entries.find((row) => row.key === next.shellId);
    if (!entry) throw new Error("Session owner publication was not confirmed.");
    if (result.compacted) {
      let current: NativeEntry | null;
      try { current = await invoke<NativeEntry | null>("canonical_store_get", { scope: NATIVE_SCOPE, key: next.shellId }); }
      catch { throw new Error("The session owner was saved, but its current state could not be verified."); }
      if (!current || current.version !== entry.version || current.value?.raw !== next.raw || current.value?.legacyRaw !== next.legacyRaw)
        throw new Error("The session owner changed in another window. Reload before continuing.");
    }
    next.version = entry.version;
    return;
  }
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["owners", "sources"], "readwrite", {
      durability: "strict",
    });
    let reason: Error | undefined;
    const store = transaction.objectStore("owners");
    const request = store.get(next.shellId);
    request.onsuccess = () => {
      const current = request.result as StoredBindingEvidence | undefined;
      if (current?.raw === next.raw && current?.legacyRaw === next.legacyRaw) return;
      if (current?.raw !== expected?.raw || current?.legacyRaw !== expected?.legacyRaw) {
        reason = new Error(
          "The session owner changed in another window. Reload before continuing.",
        );
        transaction.abort();
        return;
      }
      const sources = transaction.objectStore("sources");
      if (current?.legacyRaw !== null && current?.legacyRaw !== undefined)
        sources.put({ shellId: next.shellId, raw: current.legacyRaw });
      if (next.legacyRaw !== null) sources.put({ shellId: next.shellId, raw: next.legacyRaw });
      store.put(next);
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(reason ?? transaction.error ?? new Error("Session owner evidence was not saved."));
  });
}
