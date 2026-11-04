/** Canonical owner evidence. Legacy bytes remain a compatibility routing fence. */
export type StoredBindingEvidence = { shellId: string; raw: string; legacyRaw: string | null };
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

export async function preserveBindingSource(shellId: string, raw: string): Promise<void> {
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
