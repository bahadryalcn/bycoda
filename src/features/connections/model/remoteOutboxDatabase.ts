/** Durable remote-command evidence. No entry is evicted on capacity pressure. */
const DATABASE = "bycoda-remote-outbox";
const ENTRIES = "entries";
const SETTLEMENTS = "settlements";
const META = "meta";
const QUARANTINE = "quarantine";

type StoredValue = { key: string; raw: string; modern?: boolean };
export type OutboxDatabasePage = { values: StoredValue[]; next?: string; revision: number };

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
      reject(new Error(conflict ? "The pending request changed." : "Cannot save remote requests."));
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
