/** Durable remote-command evidence. No entry is evicted on capacity pressure. */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { canonicalJson } from "../../sync/model/canonicalJson";
import { newRequestId } from "../../../shared/lib/id/requestId";

const DATABASE = "bycoda-remote-outbox";
const ENTRIES = "entries";
const SETTLEMENTS = "settlements";
const META = "meta";
const QUARANTINE = "quarantine";

type StoredValue = { key: string; raw: string; modern?: boolean };
type OversizedRecord = { key: string; version: number; bytes: number; revision: number };
export type OutboxDatabasePage = {
  values: StoredValue[];
  next?: string;
  revision: number;
  oversized?: OversizedRecord;
};

const NATIVE_SCOPE = "remote-outbox.v2";
const NATIVE_MARKER = "migration:complete";
const LEGACY_PREFIXES = ["bycoda.remote-command.v1:", "bycoda.remote-command-quarantine.v1:"];
const nativeKey = (kind: string, key: string) => `${kind}:${key}`;
type NativeEntry = { key: string; version: number; value: unknown };
type NativeSnapshot = {
  entries: NativeEntry[];
  revision: number;
  hasMore?: boolean;
  oversized?: { key: string; version: number; bytes: number } | null;
};
type NativeOutcome = { applied: boolean; entries: NativeEntry[]; compacted?: boolean };
let nativeMigration: Promise<void> | undefined;
let nativeMigrationClaimId: string | undefined;
let pageToken: Promise<string> | undefined;
function nativePageToken(): Promise<string> {
  return (pageToken ??= invoke<string>("canonical_store_page_token").catch((error: unknown) => {
    pageToken = undefined;
    throw error;
  }));
}

/**
 * A compare-and-set lost a race with another writer (another window, tab or queue drain).
 * Callers may re-read and re-apply their change; a real change to the same entry is reported
 * as a plain error by the re-read instead.
 */
export class OutboxConflictError extends Error {}

export class OversizedOutboxRecordError extends Error {
  constructor(readonly record: { key: string; version: number; bytes: number; revision: number }) {
    super(
      "A saved request is too large to read safely. Its original bytes are preserved and sending is held.",
    );
  }
}

export async function exportOversizedOutboxRecord(record: {
  key: string;
  version: number;
  revision: number;
}): Promise<{ cancelled: boolean }> {
  return invoke("outbox_export_oversize", {
    pageToken: await nativePageToken(),
    key: record.key,
    version: record.version,
    expectedRevision: record.revision,
  });
}

async function nativeRead(keys: string[]): Promise<NativeSnapshot> {
  return invoke("canonical_store_read", { scope: NATIVE_SCOPE, keys });
}

async function nativeChange(
  checks: Array<{ key: string; version: number | null }>,
  writes: Array<{ key: string; value: unknown }>,
  expectedRevision?: number,
  legacy: Array<{ key: string; raw: string }> = [],
): Promise<void> {
  const outcome = await invoke<NativeOutcome>("canonical_store_transaction", {
    scope: NATIVE_SCOPE,
    operationId: newRequestId(),
    pageToken: await nativePageToken(),
    checks,
    writes,
    legacy,
    expectedRevision: expectedRevision ?? null,
    claim: null,
  });
  if (!outcome.applied) throw new OutboxConflictError("The pending request changed.");
  if (outcome.compacted && writes.length) {
    let current: NativeSnapshot;
    try {
      current = await nativeRead(writes.map((write) => write.key));
    } catch {
      throw new Error(
        "The request was saved, but its current state could not be verified. Check it before continuing.",
      );
    }
    for (const write of writes) {
      const proof = outcome.entries.find((entry) => entry.key === write.key);
      const row = current.entries.find((entry) => entry.key === write.key);
      if (
        !proof ||
        !row ||
        row.version !== proof.version ||
        canonicalJson(row.value) !== canonicalJson(write.value)
      )
        throw new Error("The pending request changed.");
    }
  }
}

/** Import existing IDB evidence before any new native writer is admitted. */
async function ensureNativeOutbox(): Promise<void> {
  if (!nativeMigration)
    nativeMigration = (async () => {
      const initial = await nativeRead([NATIVE_MARKER]);
      const priorMarker = initial.entries.find((entry) => entry.key === NATIVE_MARKER);
      if (priorMarker?.value === true) return;
      if (priorMarker) throw new Error("Remote request migration marker is invalid.");
      const claimId = (nativeMigrationClaimId ??= crypto.randomUUID());
      let claim = await invoke<{ owned: boolean; operationId: string }>("canonical_store_claim", {
        scope: NATIVE_SCOPE,
        key: NATIVE_MARKER,
        operationId: claimId,
        pageToken: await nativePageToken(),
      });
      if (!claim.owned) {
        const recovered = await invoke<boolean>("canonical_store_recover", {
          scope: NATIVE_SCOPE,
          key: NATIVE_MARKER,
          operationId: claim.operationId,
          pageToken: await nativePageToken(),
        });
        if (recovered)
          claim = await invoke("canonical_store_claim", {
            scope: NATIVE_SCOPE,
            key: NATIVE_MARKER,
            operationId: claimId,
            pageToken: await nativePageToken(),
          });
      }
      if (!claim.owned) throw new Error("Remote request migration is held by another window.");
      const database = await openDatabase();
      for (const kind of [ENTRIES, SETTLEMENTS, QUARANTINE] as const) {
        let after: IDBValidKey | undefined;
        for (;;) {
          const page = await new Promise<Array<{ key: IDBValidKey; value: unknown }>>(
            (resolve, reject) => {
              const transaction = database.transaction(kind, "readonly");
              const rows: Array<{ key: IDBValidKey; value: unknown }> = [];
              const request = transaction
                .objectStore(kind)
                .openCursor(after === undefined ? undefined : IDBKeyRange.lowerBound(after, true));
              request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor || rows.length === 128) return;
                rows.push({ key: cursor.key, value: cursor.value });
                cursor.continue();
              };
              transaction.oncomplete = () => resolve(rows);
              transaction.onabort = transaction.onerror = () =>
                reject(
                  transaction.error ?? new Error("Cannot read remote request migration source."),
                );
            },
          );
          for (const row of page) {
            if (typeof row.key !== "string")
              throw new Error("Invalid remote request migration key.");
            const key = nativeKey(kind, row.key);
            const snapshot = await nativeRead([key]);
            const existing = snapshot.entries.find((entry) => entry.key === key);
            await nativeChange(
              [{ key, version: existing?.version ?? null }],
              existing ? [] : [{ key, value: row.value }],
              undefined,
              [{ key, raw: JSON.stringify(row.value) }],
            );
          }
          if (page.length < 128) break;
          after = page[page.length - 1].key;
        }
      }
      // Updated writers never modify these sources. Keep both active and archived
      // bytes in native recovery evidence before recording migration completion.
      for (let index = 0; index < localStorage.length; index++) {
        const sourceKey = localStorage.key(index);
        if (!sourceKey || !LEGACY_PREFIXES.some((prefix) => sourceKey.startsWith(prefix))) continue;
        const raw = localStorage.getItem(sourceKey);
        if (raw === null) throw new Error("Remote request migration source changed.");
        const key = nativeKey("legacy", sourceKey);
        const snapshot = await nativeRead([key]);
        const existing = snapshot.entries.find((entry) => entry.key === key);
        if (existing && (existing.value as StoredValue | null)?.raw !== raw)
          throw new Error("Remote request migration source changed.");
        await nativeChange(
          [{ key, version: existing?.version ?? null }],
          existing ? [] : [{ key, value: { key: sourceKey, raw } }],
          undefined,
          [{ key, raw }],
        );
        if (localStorage.getItem(sourceKey) !== raw)
          throw new Error("Remote request migration source changed.");
      }
      const marker = await nativeRead([NATIVE_MARKER]);
      const current = marker.entries.find((entry) => entry.key === NATIVE_MARKER);
      const result = await invoke<NativeOutcome>("canonical_store_transaction", {
        scope: NATIVE_SCOPE,
        operationId: newRequestId(),
        pageToken: await nativePageToken(),
        checks: [{ key: NATIVE_MARKER, version: current?.version ?? null }],
        writes: [{ key: NATIVE_MARKER, value: true }],
        legacy: [],
        expectedRevision: null,
        claim: { key: NATIVE_MARKER, operationId: claimId, mode: "require" },
      });
      if (!result.applied) throw new Error("Remote request migration changed.");
      if (
        !(await invoke<boolean>("canonical_store_settle", {
          scope: NATIVE_SCOPE,
          key: NATIVE_MARKER,
          operationId: claimId,
          pageToken: await nativePageToken(),
        }))
      )
        throw new Error("Remote request migration settlement was not confirmed.");
      nativeMigrationClaimId = undefined;
    })().catch((error: unknown) => {
      nativeMigration = undefined;
      throw error;
    });
  return nativeMigration;
}

export async function readOutboxLegacyPage(
  after?: string,
  expectedRevision?: number,
): Promise<{
  values: StoredValue[];
  next?: string;
  revision?: number;
  oversized?: OversizedRecord;
}> {
  if (after !== undefined && !after.startsWith(LEGACY_PREFIXES[0]))
    throw new Error("Invalid remote request cursor.");
  if (!isTauri()) {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(LEGACY_PREFIXES[0]) && (after === undefined || key > after))
        keys.push(key);
    }
    keys.sort();
    const values: StoredValue[] = [];
    let bytes = 0;
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw === null) throw new Error("Pending requests changed; try again.");
      if (values.length && (values.length === 128 || bytes + raw.length * 2 > 2 * 1024 * 1024))
        return { values, next: values[values.length - 1].key };
      values.push({ key, raw });
      bytes += raw.length * 2;
    }
    return { values };
  }
  await ensureNativeOutbox();
  const prefix = nativeKey("legacy", LEGACY_PREFIXES[0]);
  const page = await invoke<NativeSnapshot>("canonical_store_list_bounded", {
    scope: NATIVE_SCOPE,
    prefix,
    after: after === undefined ? null : nativeKey("legacy", after),
    limit: 128,
    maxBytes: 2 * 1024 * 1024,
    expectedRevision: expectedRevision ?? null,
  });
  if (page.oversized)
    return {
      values: [],
      revision: page.revision,
      oversized: { ...page.oversized, revision: page.revision },
    };
  const values = page.entries.map((row) => {
    const value = row.value as StoredValue | null;
    if (!value || value.key !== row.key.slice("legacy:".length) || typeof value.raw !== "string")
      throw new Error("Invalid remote request legacy evidence.");
    return value;
  });
  if (page.hasMore && !values.length) throw new Error("Invalid remote request cursor.");
  return {
    values,
    revision: page.revision,
    ...(page.hasMore ? { next: values[values.length - 1].key } : {}),
  };
}

export async function readOutboxLegacyValue(key: string): Promise<string | null> {
  if (!isTauri()) return localStorage.getItem(key);
  await ensureNativeOutbox();
  const native = nativeKey("legacy", key);
  const row = (await nativeRead([native])).entries.find((entry) => entry.key === native);
  if (!row) return null;
  const value = row.value as StoredValue | null;
  if (!value || value.key !== key || typeof value.raw !== "string")
    throw new Error("Invalid remote request legacy evidence.");
  return value.raw;
}

let opening: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Remote request storage is unavailable."));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ENTRIES, { keyPath: "key" });
      request.result.createObjectStore(SETTLEMENTS, { keyPath: "key" });
      request.result.createObjectStore(META).put(0, "revision");
      request.result.createObjectStore(QUARANTINE, { keyPath: "id" });
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Cannot open remote request storage."));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Remote request storage is blocked."));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) {
        database.close();
        return;
      }
      database.onversionchange = () => {
        database.close();
        opening = undefined;
      };
      resolve(database);
    };
  }).catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

/** Read a bounded key-prefix page without retaining unrelated request bodies. */
export async function readOutboxDatabasePage(
  kind: "entries" | "settlements",
  prefix: string,
  after?: string,
): Promise<OutboxDatabasePage> {
  if (isTauri()) {
    await ensureNativeOutbox();
    if (after !== undefined && !after.startsWith(prefix))
      throw new Error("Invalid remote request cursor.");
    const start = nativeKey(kind, prefix);
    const page = await invoke<NativeSnapshot>("canonical_store_list_bounded", {
      scope: NATIVE_SCOPE,
      prefix: start,
      after: after === undefined ? null : nativeKey(kind, after),
      limit: 128,
      maxBytes: 2 * 1024 * 1024,
      expectedRevision: null,
    });
    if (page.oversized)
      return {
        values: [],
        revision: page.revision,
        oversized: { ...page.oversized, revision: page.revision },
      };
    const values: StoredValue[] = [];
    for (const entry of page.entries) {
      if (entry.value === null) continue;
      const value = entry.value as StoredValue;
      if (value?.key !== entry.key.slice(kind.length + 1) || typeof value.raw !== "string")
        throw new Error("Invalid remote request storage record.");
      values.push(value);
    }
    const lastKey = page.entries[page.entries.length - 1]?.key.slice(kind.length + 1);
    if (page.hasMore && !lastKey) throw new Error("Invalid remote request cursor.");
    return { values, revision: page.revision, ...(page.hasMore ? { next: lastKey } : {}) };
  }
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([kind, META], "readonly");
    const revision = transaction.objectStore(META).get("revision");
    const values: StoredValue[] = [];
    let bytes = 0;
    let next: string | undefined;
    if (after !== undefined && !after.startsWith(prefix)) {
      reject(new Error("Invalid remote request cursor."));
      transaction.abort();
      return;
    }
    const range = IDBKeyRange.lowerBound(after ?? prefix, after !== undefined);
    const request = transaction.objectStore(kind).openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (typeof cursor.key === "string" && !cursor.key.startsWith(prefix)) return;
      const value = cursor.value as StoredValue;
      if (
        typeof value?.key !== "string" ||
        typeof value.raw !== "string" ||
        value.key !== cursor.key
      ) {
        transaction.abort();
        return;
      }
      if (
        values.length > 0 &&
        (values.length === 128 || bytes + value.raw.length * 2 > 2 * 1024 * 1024)
      ) {
        next = values[values.length - 1].key;
        return;
      }
      values.push(value);
      bytes += value.raw.length * 2;
      cursor.continue();
    };
    transaction.oncomplete = () => {
      const value = revision.result;
      if (!Number.isSafeInteger(value) || value < 0) {
        reject(new Error("Invalid remote request storage revision."));
        return;
      }
      resolve({ values, next, revision: value });
    };
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Cannot read remote requests."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Cannot read remote requests."));
  });
}

/** Read both kinds with one revision, for an exact legacy key comparison. */
export async function readOutboxDatabaseRecord(key: string): Promise<{
  entry?: string;
  settlement?: string;
  resolved: boolean;
  revision: number;
}> {
  if (isTauri()) {
    await ensureNativeOutbox();
    const entryKey = nativeKey(ENTRIES, key);
    const settlementKey = nativeKey(SETTLEMENTS, key);
    const snapshot = await nativeRead([entryKey, settlementKey]);
    const entry = snapshot.entries.find((row) => row.key === entryKey)?.value as
      | StoredValue
      | null
      | undefined;
    const settlement = snapshot.entries.find((row) => row.key === settlementKey)?.value as
      | StoredValue
      | null
      | undefined;
    const valid = (value: StoredValue | null | undefined) =>
      !value ||
      (value.key === key &&
        typeof value.raw === "string" &&
        (value.modern === undefined || value.modern === true));
    if (!valid(entry) || !valid(settlement))
      throw new Error("Invalid remote request storage record.");
    return {
      entry: entry?.raw,
      settlement: settlement?.modern ? undefined : settlement?.raw,
      resolved: !!settlement,
      revision: snapshot.revision,
    };
  }
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ENTRIES, SETTLEMENTS, META], "readonly");
    const entry = transaction.objectStore(ENTRIES).get(key);
    const settlement = transaction.objectStore(SETTLEMENTS).get(key);
    const revision = transaction.objectStore(META).get("revision");
    transaction.oncomplete = () => {
      const valid = (value: unknown): value is StoredValue => {
        if (!value || typeof value !== "object") return false;
        const candidate = value as StoredValue;
        return (
          candidate.key === key &&
          typeof candidate.raw === "string" &&
          (candidate.modern === undefined || candidate.modern === true)
        );
      };
      if (
        (entry.result !== undefined && !valid(entry.result)) ||
        (settlement.result !== undefined && !valid(settlement.result)) ||
        !Number.isSafeInteger(revision.result) ||
        revision.result < 0
      ) {
        reject(new Error("Invalid remote request storage record."));
        return;
      }
      resolve({
        entry: entry.result?.raw,
        settlement: settlement.result?.modern === true ? undefined : settlement.result?.raw,
        resolved: settlement.result !== undefined,
        revision: revision.result,
      });
    };
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Cannot read remote request."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Cannot read remote request."));
  });
}

function incrementRevision(transaction: IDBTransaction) {
  const metadata = transaction.objectStore(META);
  const request = metadata.get("revision");
  request.onsuccess = () => {
    const revision = request.result;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
      transaction.abort();
      return;
    }
    metadata.put(revision + 1, "revision");
  };
}

/** Compare and commit the original raw bytes in one readwrite transaction. */
export async function changeOutboxDatabase(
  key: string,
  expected: string | null,
  next: string | null,
  settledLegacyRaw?: string,
  expectedRevision?: number,
): Promise<void> {
  if (isTauri()) {
    await ensureNativeOutbox();
    const entryKey = nativeKey(ENTRIES, key);
    const settlementKey = nativeKey(SETTLEMENTS, key);
    const keys = settledLegacyRaw === undefined ? [entryKey] : [entryKey, settlementKey];
    const snapshot = await nativeRead(keys);
    const row = snapshot.entries.find((entry) => entry.key === entryKey);
    const current = row?.value as StoredValue | null | undefined;
    if (
      (current?.raw ?? null) !== expected ||
      (expectedRevision !== undefined && snapshot.revision !== expectedRevision)
    )
      throw new OutboxConflictError("The pending request changed.");
    const checks = keys.map((item) => ({
      key: item,
      version: snapshot.entries.find((entry) => entry.key === item)?.version ?? null,
    }));
    const writes: Array<{ key: string; value: unknown }> = [
      { key: entryKey, value: next === null ? null : { key, raw: next } },
    ];
    if (settledLegacyRaw !== undefined)
      writes.push({ key: settlementKey, value: { key, raw: settledLegacyRaw } });
    await nativeChange(checks, writes, expectedRevision);
    return;
  }
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ENTRIES, SETTLEMENTS, META], "readwrite");
    const entries = transaction.objectStore(ENTRIES);
    const existing = entries.get(key);
    const revision = transaction.objectStore(META).get("revision");
    let conflict = false;
    let checked = 0;
    const validate = () => {
      if (++checked !== 2) return;
      const current = existing.result as StoredValue | undefined;
      if (
        (current?.raw ?? null) !== expected ||
        (expectedRevision !== undefined && revision.result !== expectedRevision)
      ) {
        conflict = true;
        transaction.abort();
        return;
      }
      if (next === null) entries.delete(key);
      else entries.put({ key, raw: next } satisfies StoredValue);
      if (settledLegacyRaw !== undefined)
        transaction
          .objectStore(SETTLEMENTS)
          .put({ key, raw: settledLegacyRaw } satisfies StoredValue);
      incrementRevision(transaction);
    };
    existing.onsuccess = validate;
    revision.onsuccess = validate;
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        conflict
          ? new OutboxConflictError("The pending request changed.")
          : new Error("Cannot save remote requests."),
      );
    transaction.onerror = () => reject(new Error("Cannot save remote requests."));
  });
}

/** Replace an acknowledged create with its exact follow-up without a loss window. */
export async function settleOutboxDatabase(
  key: string,
  expected: string,
  legacyRaw: string | undefined,
  followup?: { key: string; raw: string },
  expectedRevision?: number,
): Promise<void> {
  if (isTauri()) {
    await ensureNativeOutbox();
    const entryKey = nativeKey(ENTRIES, key);
    const settlementKey = nativeKey(SETTLEMENTS, key);
    const followupKey = followup && nativeKey(ENTRIES, followup.key);
    if (followupKey === entryKey) throw new Error("The pending request changed.");
    const keys = [entryKey, settlementKey, ...(followupKey ? [followupKey] : [])];
    const snapshot = await nativeRead(keys);
    const original = snapshot.entries.find((entry) => entry.key === entryKey)?.value as
      | StoredValue
      | null
      | undefined;
    const next = followupKey
      ? (snapshot.entries.find((entry) => entry.key === followupKey)?.value as
          | StoredValue
          | null
          | undefined)
      : undefined;
    if (
      original?.raw !== expected ||
      (expectedRevision !== undefined && snapshot.revision !== expectedRevision) ||
      (followup && next && next.raw !== followup.raw)
    )
      throw new Error("The pending request changed.");
    const checks = keys.map((item) => ({
      key: item,
      version: snapshot.entries.find((entry) => entry.key === item)?.version ?? null,
    }));
    const writes: Array<{ key: string; value: unknown }> = [
      { key: entryKey, value: null },
      {
        key: settlementKey,
        value: legacyRaw === undefined ? { key, raw: "", modern: true } : { key, raw: legacyRaw },
      },
    ];
    if (followup && followupKey) writes.push({ key: followupKey, value: followup });
    await nativeChange(checks, writes, expectedRevision);
    return;
  }
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ENTRIES, SETTLEMENTS, META], "readwrite");
    const entries = transaction.objectStore(ENTRIES);
    const current = entries.get(key);
    const next = followup ? entries.get(followup.key) : undefined;
    const revision = transaction.objectStore(META).get("revision");
    let conflict = false;
    let checked = 0;
    const validate = () => {
      if (++checked !== (next ? 3 : 2)) return;
      const original = current.result as StoredValue | undefined;
      const existingFollowup = next?.result as StoredValue | undefined;
      if (
        original?.raw !== expected ||
        (expectedRevision !== undefined && revision.result !== expectedRevision) ||
        (followup &&
          (followup.key === key || (existingFollowup && existingFollowup.raw !== followup.raw)))
      ) {
        conflict = true;
        transaction.abort();
        return;
      }
      entries.delete(key);
      if (followup) entries.put(followup);
      transaction
        .objectStore(SETTLEMENTS)
        .put(legacyRaw === undefined ? { key, raw: "", modern: true } : { key, raw: legacyRaw });
      incrementRevision(transaction);
    };
    current.onsuccess = validate;
    revision.onsuccess = validate;
    if (next) next.onsuccess = validate;
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        new Error(conflict ? "The pending request changed." : "Cannot settle remote requests."),
      );
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Cannot settle remote requests."));
  });
}

/** Preserve unreadable evidence before releasing only the exact reviewed bytes. */
export async function quarantineOutboxDatabase(
  key: string,
  expected: string | null,
  legacy: string | null,
  expectedRevision: number,
) {
  if (isTauri()) {
    await ensureNativeOutbox();
    const entryKey = nativeKey(ENTRIES, key);
    const settlementKey = nativeKey(SETTLEMENTS, key);
    const snapshot = await nativeRead([entryKey, settlementKey]);
    const current = snapshot.entries.find((entry) => entry.key === entryKey)?.value as
      | StoredValue
      | null
      | undefined;
    if ((current?.raw ?? null) !== expected || snapshot.revision !== expectedRevision)
      throw new Error("The pending request changed.");
    const checks = [entryKey, settlementKey].map((item) => ({
      key: item,
      version: snapshot.entries.find((entry) => entry.key === item)?.version ?? null,
    }));
    const writes: Array<{ key: string; value: unknown }> = [{ key: entryKey, value: null }];
    for (const raw of [expected, legacy !== expected ? legacy : null]) {
      if (raw === null) continue;
      const id = crypto.randomUUID();
      const quarantineKey = nativeKey(QUARANTINE, id);
      checks.push({ key: quarantineKey, version: null });
      writes.push({ key: quarantineKey, value: { id, key, raw } });
    }
    if (legacy !== null || expected !== null)
      writes.push({
        key: settlementKey,
        value: legacy === null ? { key, raw: "", modern: true } : { key, raw: legacy },
      });
    await nativeChange(checks, writes, expectedRevision);
    return;
  }
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([ENTRIES, SETTLEMENTS, META, QUARANTINE], "readwrite");
    const entries = transaction.objectStore(ENTRIES);
    const existing = entries.get(key);
    const revision = transaction.objectStore(META).get("revision");
    let checked = 0;
    let conflict = false;
    const validate = () => {
      if (++checked !== 2) return;
      const current = existing.result as StoredValue | undefined;
      if ((current?.raw ?? null) !== expected || revision.result !== expectedRevision) {
        conflict = true;
        transaction.abort();
        return;
      }
      const quarantine = transaction.objectStore(QUARANTINE);
      if (expected !== null) quarantine.add({ id: crypto.randomUUID(), key, raw: expected });
      if (legacy !== null && legacy !== expected)
        quarantine.add({ id: crypto.randomUUID(), key, raw: legacy });
      if (legacy !== null || expected !== null)
        transaction
          .objectStore(SETTLEMENTS)
          .put(legacy === null ? { key, raw: "", modern: true } : { key, raw: legacy });
      entries.delete(key);
      incrementRevision(transaction);
    };
    existing.onsuccess = validate;
    revision.onsuccess = validate;
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        new Error(
          conflict ? "The pending request changed." : "Cannot preserve the unreadable request.",
        ),
      );
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Cannot preserve the unreadable request."));
  });
}
