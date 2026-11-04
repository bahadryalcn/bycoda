/** Durable exact-identity seen history. No provider page is an eviction authority. */
const DATABASE = "bycoda-inbox-seen-v1";
const ITEMS = "items";
const META = "meta";
const SEEDS = "seedItems";
const validSeed = (value: unknown) =>
  value === undefined ||
  value === true ||
  (typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value));

export type InboxSeenSnapshot = { seeded: boolean; items: Record<string, number> };

let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(new Error("Inbox storage is unavailable."));
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    let rejected = false;
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ITEMS)) request.result.createObjectStore(ITEMS);
      if (!request.result.objectStoreNames.contains(META)) request.result.createObjectStore(META);
      if (!request.result.objectStoreNames.contains(SEEDS)) request.result.createObjectStore(SEEDS);
    };
    request.onblocked = () => {
      rejected = true;
      reject(new Error("Inbox storage is blocked by another window."));
    };
    request.onerror = () => {
      rejected = true;
      reject(request.error ?? new Error("Inbox storage could not be opened."));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (rejected) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
  }).catch((error) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

/** All reads and writes in one readwrite transaction, so windows merge instead of overwriting. */
export async function mergeInboxSeenStorage(snapshot: InboxSeenSnapshot): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([ITEMS, META], "readwrite");
    const items = transaction.objectStore(ITEMS);
    const meta = transaction.objectStore(META);
    for (const [key, timestamp] of Object.entries(snapshot.items)) {
      const get = items.get(key);
      get.onsuccess = () => {
        const previous = get.result;
        if (
          previous !== undefined &&
          (typeof previous !== "number" || !Number.isFinite(previous))
        ) {
          transaction.abort();
          return;
        }
        items.put(Math.max(previous ?? 0, timestamp), key);
      };
    }
    if (snapshot.seeded) {
      const seeded = meta.get("seeded");
      seeded.onsuccess = () => {
        if (!validSeed(seeded.result)) transaction.abort();
        else if (seeded.result === undefined) meta.put(true, "seeded");
      };
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Inbox storage write failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Inbox storage write was cancelled."));
  });
}

/** The first complete provider snapshot wins atomically across windows. */
export async function seedInboxSeenStorage(items: Record<string, number>): Promise<void> {
  const db = await database();
  const entries = Object.entries(items);
  if (entries.length > 512) {
    if (typeof navigator === "undefined" || !navigator.locks)
      throw new Error("Inbox history initialization requires a cross-window storage lock.");
    await navigator.locks.request("bycoda-inbox-seen-seed-v1", async () => {
      const active = await currentSeed(db);
      await cleanSeedStaging(db, typeof active === "string" ? active : undefined);
      if (active !== undefined) return;
      const generation = crypto.randomUUID();
      for (let index = 0; index < entries.length; index += 512) {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(SEEDS, "readwrite");
          const store = transaction.objectStore(SEEDS);
          for (const [key, timestamp] of entries.slice(index, index + 512))
            store.put(timestamp, [generation, key]);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () =>
            reject(transaction.error ?? new Error("Inbox history initialization failed."));
          transaction.onabort = () =>
            reject(transaction.error ?? new Error("Inbox history initialization was cancelled."));
        });
      }
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(META, "readwrite");
        const meta = transaction.objectStore(META);
        const seeded = meta.get("seeded");
        seeded.onsuccess = () => {
          if (!validSeed(seeded.result)) transaction.abort();
          else if (seeded.result === undefined) meta.put(generation, "seeded");
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("Inbox history initialization failed."));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("Inbox history initialization was cancelled."));
      });
      const winner = await currentSeed(db);
      if (winner !== generation)
        await cleanSeedStaging(db, typeof winner === "string" ? winner : undefined);
    });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([ITEMS, META], "readwrite");
    const store = transaction.objectStore(ITEMS);
    const meta = transaction.objectStore(META);
    const seeded = meta.get("seeded");
    seeded.onsuccess = () => {
      if (seeded.result === true || (typeof seeded.result === "string" && validSeed(seeded.result)))
        return;
      if (seeded.result !== undefined) {
        transaction.abort();
        return;
      }
      for (const [key, timestamp] of Object.entries(items)) {
        const previous = store.get(key);
        previous.onsuccess = () => {
          if (
            previous.result !== undefined &&
            (typeof previous.result !== "number" || !Number.isFinite(previous.result))
          ) {
            transaction.abort();
            return;
          }
          store.put(Math.max(previous.result ?? 0, timestamp), key);
        };
      }
      meta.put(true, "seeded");
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Inbox storage seed failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Inbox storage seed was cancelled."));
  });
}

async function currentSeed(db: IDBDatabase): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const transaction = db.transaction(META, "readonly");
    const request = transaction.objectStore(META).get("seeded");
    transaction.oncomplete = () =>
      validSeed(request.result)
        ? resolve(request.result)
        : reject(new Error("Inbox storage metadata is invalid."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Inbox storage read failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Inbox storage read was cancelled."));
  });
}

/** Only uncommitted stages are removed, under the exclusive cross-window seed lock. */
async function cleanSeedStaging(db: IDBDatabase, active?: string): Promise<void> {
  let after: IDBValidKey | undefined;
  for (;;) {
    const page = await new Promise<{ last?: IDBValidKey; done: boolean }>((resolve, reject) => {
      const transaction = db.transaction(SEEDS, "readwrite");
      const request = transaction
        .objectStore(SEEDS)
        .openCursor(after === undefined ? undefined : IDBKeyRange.lowerBound(after, true));
      let visited = 0,
        last: IDBValidKey | undefined,
        done = false;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          done = true;
          return;
        }
        last = cursor.key;
        visited++;
        if (!Array.isArray(cursor.key) || cursor.key[0] !== active) cursor.delete();
        if (visited < 512) cursor.continue();
      };
      transaction.oncomplete = () => resolve({ last, done });
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Inbox storage cleanup failed."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Inbox storage cleanup was cancelled."));
    });
    if (page.done || page.last === undefined) return;
    after = page.last;
  }
}

export async function readInboxSeenStorage(
  keys: readonly string[],
): Promise<{ seeded: boolean; items: Map<string, number | undefined> }> {
  const db = await database();
  return await new Promise((resolve, reject) => {
    const transaction = db.transaction([ITEMS, META, SEEDS], "readonly");
    const items = transaction.objectStore(ITEMS);
    const seeds = transaction.objectStore(SEEDS);
    const values = new Map<string, number | undefined>();
    const seeded = transaction.objectStore(META).get("seeded");
    seeded.onsuccess = () => {
      if (!validSeed(seeded.result)) {
        transaction.abort();
        return;
      }
      for (const key of new Set(keys)) {
        const request = items.get(key);
        const initial =
          typeof seeded.result === "string" ? seeds.get([seeded.result, key]) : undefined;
        let regular: unknown,
          staged: unknown,
          regularReady = false,
          stagedReady = !initial;
        const update = () => {
          if (!regularReady || !stagedReady) return;
          const valuesToMerge = [regular, staged].filter((value) => value !== undefined);
          if (valuesToMerge.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
            transaction.abort();
            return;
          }
          const numbers = valuesToMerge.filter(
            (value): value is number => typeof value === "number",
          );
          values.set(key, numbers.length ? Math.max(...numbers) : undefined);
        };
        request.onsuccess = () => {
          regular = request.result;
          regularReady = true;
          update();
        };
        if (initial)
          initial.onsuccess = () => {
            staged = initial.result;
            stagedReady = true;
            update();
          };
      }
    };
    transaction.oncomplete = () => {
      if (!validSeed(seeded.result)) reject(new Error("Inbox storage metadata is invalid."));
      else resolve({ seeded: seeded.result !== undefined, items: values });
    };
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Inbox storage read failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Inbox storage read was cancelled."));
  });
}
