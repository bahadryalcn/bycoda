/**
 * Pasted-image payloads of queued messages. localStorage holds about 5 MB for the
 * whole origin, so one large paste would make every queue write fail. The saved
 * queue record keeps only a marker (`externalPayload`); the base64 bytes live here,
 * in IndexedDB, keyed by the queue record's storage key and the attachment id.
 */

export type QueuePayloadStore = {
  put(owner: string, id: string, data: string): Promise<void>;
  /** The payloads that exist; an id that is gone is absent from the result. */
  read(owner: string, ids: string[]): Promise<Map<string, string>>;
  /** Deletes every payload of the owner whose id is not in `keep`. */
  prune(owner: string, keep: ReadonlySet<string>): Promise<void>;
  owners(): Promise<string[]>;
};

const DB_NAME = "bycoda-queue-payloads";
const STORE = "payloads";
const SEPARATOR = "\u0000";
const keyOf = (owner: string, id: string) => owner + SEPARATOR + id;

const wrap = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Queue payload storage failed."));
  });

let opening: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined")
      return reject(new Error("Queue payload storage is unavailable."));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("owner", "owner");
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Cannot open queue payload storage."));
    request.onblocked = () => reject(new Error("Queue payload storage is blocked."));
    request.onsuccess = () => resolve(request.result);
  }).catch((error: unknown) => {
    opening = undefined;
    throw error;
  }));
}

async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, mode);
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Queue payload aborted."));
  });
  // Observed by the await below; this keeps an early failure of `work` from going unhandled.
  done.catch(() => {});
  const result = await work(transaction.objectStore(STORE));
  await done;
  return result;
}

const indexedStore: QueuePayloadStore = {
  put: (owner, id, data) =>
    transact("readwrite", async (store) => {
      await wrap(store.put({ key: keyOf(owner, id), owner, id, data }));
    }),
  read: (owner, ids) =>
    transact("readonly", async (store) => {
      const found = new Map<string, string>();
      for (const id of ids) {
        const record = (await wrap(store.get(keyOf(owner, id)))) as { data?: unknown } | undefined;
        if (typeof record?.data === "string") found.set(id, record.data);
      }
      return found;
    }),
  prune: (owner, keep) =>
    transact("readwrite", async (store) => {
      const keys = (await wrap(store.index("owner").getAllKeys(owner))) as string[];
      for (const key of keys)
        if (!keep.has(key.slice(owner.length + SEPARATOR.length))) await wrap(store.delete(key));
    }),
  owners: () =>
    transact("readonly", async (store) => {
      const owners: string[] = [];
      const cursor = store.index("owner").openKeyCursor(null, "nextunique");
      await new Promise<void>((resolve, reject) => {
        cursor.onerror = () => reject(cursor.error);
        cursor.onsuccess = () => {
          if (!cursor.result) return resolve();
          owners.push(String(cursor.result.key));
          cursor.result.continue();
        };
      });
      return owners;
    }),
};

let store: QueuePayloadStore = indexedStore;
/** Tests swap the backing store; pass nothing to restore IndexedDB. */
export function setQueuePayloadStore(next?: QueuePayloadStore): void {
  store = next ?? indexedStore;
}
export const queuePayloads = (): QueuePayloadStore => store;

/** The attachment ids a saved queue record keeps in the payload store. */
export function savedPayloadIds(raw: string | null): Set<string> {
  const ids = new Set<string>();
  if (raw === null) return ids;
  try {
    const record = JSON.parse(raw) as {
      desired?: { messages?: { attachments?: { id?: unknown; externalPayload?: unknown }[] }[] };
    };
    for (const row of record.desired?.messages ?? [])
      for (const file of row.attachments ?? [])
        if (file.externalPayload === true && typeof file.id === "string") ids.add(file.id);
  } catch {
    // An unreadable record keeps nothing: its payloads are orphans.
  }
  return ids;
}

/**
 * Deletes payloads no saved queue record refers to: records removed by the
 * storage sweep, rows deleted by a window that was closed before its own cleanup,
 * or a write that was interrupted. Bounded by the number of saved owners.
 */
export async function sweepOrphanQueuePayloads(): Promise<void> {
  for (const owner of await store.owners())
    await store.prune(owner, savedPayloadIds(localStorage.getItem(owner)));
}
