import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Rows = Record<string, Map<string, unknown>>;

/** Minimal IndexedDB double: serialized transactions, `get`/`put`, abort. Rows are keyed by JSON. */
function installFakeIndexedDb(initial: {
  items?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}) {
  const keyed = (values: Record<string, unknown> = {}) =>
    new Map(Object.entries(values).map(([key, value]) => [JSON.stringify(key), value]));
  const rows: Rows = {
    items: keyed(initial.items),
    meta: keyed(initial.meta),
    seedItems: new Map(),
  };
  const bulkKeys = vi.fn();
  const bulkValues = vi.fn();
  const get = vi.fn();
  vi.stubGlobal("IDBKeyRange", { bound: (lower: string, upper: string) => ({ lower, upper }) });
  let tail: Promise<void> = Promise.resolve();
  const database = {
    onversionchange: null as null | (() => void),
    close() {},
    transaction(_names: string | string[], _mode: string) {
      let pending = 0;
      let aborted = false;
      let settled = false;
      let finish!: () => void;
      const done = new Promise<void>((resolve) => (finish = resolve));
      const previous = tail;
      tail = done;
      const transaction = {
        error: null as unknown,
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        abort() {
          if (aborted || settled) return;
          aborted = true;
          settled = true;
          finish();
          queueMicrotask(() => transaction.onabort?.());
        },
        objectStore(name: string) {
          const store = rows[name]!;
          const request = (run: () => unknown) => {
            const result = { result: undefined as unknown, onsuccess: null as null | (() => void) };
            pending++;
            void previous.then(() => {
              if (aborted) return;
              result.result = run();
              result.onsuccess?.();
              pending--;
              if (pending === 0) queueMicrotask(complete);
            });
            return result;
          };
          const rangeRows = (range: { lower: string; upper: string }, limit: number) =>
            [...store]
              .map(([raw, value]) => [JSON.parse(raw) as string, value] as const)
              .filter(([key]) => key >= range.lower && key <= range.upper)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .slice(0, limit);
          return {
            get: (key: string) => {
              get(name);
              return request(() => store.get(JSON.stringify(key)));
            },
            getAllKeys: (range: { lower: string; upper: string }, limit: number) => {
              bulkKeys(limit);
              return request(() => rangeRows(range, limit).map(([key]) => key));
            },
            getAll: (range: { lower: string; upper: string }, limit: number) => {
              bulkValues(limit);
              return request(() => rangeRows(range, limit).map(([, value]) => value));
            },
            put: (value: unknown, key: string) =>
              request(() => {
                store.set(JSON.stringify(key), value);
              }),
          };
        },
      };
      function complete() {
        if (settled || pending > 0) return;
        settled = true;
        finish();
        transaction.oncomplete?.();
      }
      queueMicrotask(() => {
        if (pending === 0) complete();
      });
      return transaction;
    },
  };
  const names = new Set<string>();
  vi.stubGlobal("indexedDB", {
    open() {
      const request = {
        result: {
          ...database,
          objectStoreNames: { contains: (name: string) => names.has(name) },
          createObjectStore: (name: string) => void names.add(name),
        },
        onupgradeneeded: null as null | (() => void),
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onblocked: null as null | (() => void),
        error: null,
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  });
  return {
    get,
    bulkKeys,
    bulkValues,
    items: () =>
      Object.fromEntries([...rows.items!].map(([key, value]) => [JSON.parse(key), value])),
    meta: (key: string) => rows.meta!.get(JSON.stringify(key)),
  };
}

const load = async () => {
  vi.resetModules();
  return await import("./inboxSeenStorage");
};

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("malformed Inbox seen rows", () => {
  it("overwrites a malformed row on merge and keeps valid rows", async () => {
    const db = installFakeIndexedDb({
      items: { bad: "oops", nan: null, good: 500, newer: 900 },
    });
    const { mergeInboxSeenStorage } = await load();
    await mergeInboxSeenStorage({
      seeded: false,
      items: { bad: 100, nan: 200, good: 300, newer: 800, fresh: 400 },
    });
    expect(db.items()).toEqual({ bad: 100, nan: 200, good: 500, newer: 900, fresh: 400 });
  });

  it("reads a malformed row as absent without failing the other keys", async () => {
    installFakeIndexedDb({ items: { bad: "oops", inf: null, good: 42 }, meta: { seeded: true } });
    const { readInboxSeenStorage } = await load();
    const result = await readInboxSeenStorage(["bad", "inf", "good", "missing"]);
    expect(result.seeded).toBe(true);
    expect(result.items.get("good")).toBe(42);
    expect(result.items.get("bad")).toBeUndefined();
    expect(result.items.get("inf")).toBeUndefined();
    expect(result.items.get("missing")).toBeUndefined();
  });

  it("seeds over a malformed row and marks the store seeded", async () => {
    const db = installFakeIndexedDb({ items: { bad: { not: "a number" }, good: 700 } });
    const { seedInboxSeenStorage, readInboxSeenStorage } = await load();
    await seedInboxSeenStorage({ bad: 10, good: 20, other: 30 });
    expect(db.items()).toEqual({ bad: 10, good: 700, other: 30 });
    expect(db.meta("seeded")).toBe(true);
    expect((await readInboxSeenStorage(["bad"])).seeded).toBe(true);
  });

  it("keeps the highest timestamp when writes race on one key, including over a malformed row", async () => {
    const db = installFakeIndexedDb({ items: { shared: "oops" } });
    const { mergeInboxSeenStorage } = await load();
    await Promise.all([
      mergeInboxSeenStorage({ seeded: false, items: { shared: 900 } }),
      mergeInboxSeenStorage({ seeded: false, items: { shared: 300 } }),
      mergeInboxSeenStorage({ seeded: false, items: { shared: 600 } }),
    ]);
    expect(db.items()).toEqual({ shared: 900 });
  });

  it("still rejects when the seeded marker itself is invalid", async () => {
    installFakeIndexedDb({ meta: { seeded: "not-a-seed" } });
    const { mergeInboxSeenStorage, readInboxSeenStorage } = await load();
    await expect(mergeInboxSeenStorage({ seeded: true, items: {} })).rejects.toThrow();
    await expect(readInboxSeenStorage(["a"])).rejects.toThrow();
  });
});

it.each([false, true])(
  "reads only requested identities, including missing and malformed rows (sparse=%s)",
  async (sparse) => {
    const keys = Array.from({ length: 40 }, (_, i) => "key" + String(i).padStart(2, "0"));
    const items: Record<string, unknown> = Object.fromEntries(
      keys.slice(1, -1).map((key, i) => [key, i]),
    );
    items[keys[2]!] = "invalid";
    items["key01-extra"] = 99;
    if (sparse) for (const key of keys) items[key + "-other"] = 100;
    const db = installFakeIndexedDb({ items, meta: { seeded: true } });
    const { readInboxSeenStorage } = await load();
    const result = await readInboxSeenStorage([...keys].reverse());
    expect(result.items.size).toBe(keys.length);
    for (const key of keys)
      expect(result.items.get(key)).toBe(typeof items[key] === "number" ? items[key] : undefined);
    expect(db.bulkKeys).toHaveBeenCalledWith(keys.length + 1);
    expect(db.bulkValues).toHaveBeenCalledTimes(sparse ? 0 : 1);
    expect(db.get).toHaveBeenCalledTimes(sparse ? keys.length + 1 : 1);
  },
);
