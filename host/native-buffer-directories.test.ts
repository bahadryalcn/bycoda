import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createNativeBufferCatalog,
  type NativeBufferDirectory,
  type NativeBufferDirectoryEntry,
} from "./native-buffer-catalog";
import { createNativeBufferDirectories } from "./native-buffer-directories";
import { createNativeBufferPersistenceStore } from "./native-buffer-persistence-store";
import type { NativeBufferPersistence } from "./ports/native-buffer-persistence";
import { HostStore } from "./store";

const base = resolve("temp/verification/2026-10-29-buffer-sql-catalog/fixtures");
const roots: string[] = [];
const stores: HostStore[] = [];
const readers: NativeBufferDirectory[] = [];
const catalogs: { close(): Promise<void> }[] = [];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const filename = (value: number) => `${value.toString(16).padStart(64, "0")}.json`;
const activeKey = (name: string) => `native-activity/buffers/${name}`;

afterEach(async () => {
  for (const catalog of catalogs.splice(0)) await catalog.close();
  for (const reader of readers.splice(0)) await reader.close();
  for (const store of stores.splice(0)) await store.close();
  const canonicalBase = await realpath(base);
  for (const root of roots.splice(0)) {
    const target = await realpath(root);
    const inside = relative(canonicalBase, target);
    if (
      !inside ||
      isAbsolute(inside) ||
      inside === ".." ||
      inside.startsWith("../") ||
      inside.startsWith("..\\")
    ) {
      throw new Error("Fixture cleanup target escaped its owned directory");
    }
    await rm(target, { recursive: true, force: true });
  }
});

async function fixture() {
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "directory-"));
  roots.push(root);
  const path = join(root, "host.db");
  const store = new HostStore(path);
  stores.push(store);
  return { root, path, store, persistence: createNativeBufferPersistenceStore(store) };
}

function metadataPort(overrides: Partial<NativeBufferPersistence> = {}) {
  const body = vi.fn(async (): Promise<never> => {
    throw new Error("Directory enumeration read or mutated a body");
  });
  const persistence: NativeBufferPersistence = {
    directoryView: vi.fn(async () => Number.MAX_SAFE_INTEGER),
    entries: vi.fn(async () => ({ entries: [], nextAfter: null })),
    hasEntry: vi.fn(async () => false),
    read: body,
    readCertificate: body,
    readClock: body,
    initializeClock: body,
    advanceClock: body,
    complete: body,
    ...overrides,
  };
  return { persistence, body };
}

async function collect(reader: NativeBufferDirectory | null) {
  if (!reader) return [];
  readers.push(reader);
  const result: { name: string; directory: boolean }[] = [];
  for (let item = await reader.read(); item; item = await reader.read()) {
    if (!item.ignored) result.push({ name: item.name, directory: item.isDirectory() });
  }
  return result;
}

it("discovers SQL-only current and nested history after reopening without filesystem caches", async () => {
  const f = await fixture();
  const report = hash("sql report"),
    name = `0000000000000001-${hash("snapshot")}.json`;
  await f.persistence.complete({
    writes: [
      { key: activeKey(filename(1)), bytes: Buffer.from("current"), immutable: false },
      {
        key: `native-activity/buffer-history/reports/${report}/${name}`,
        bytes: Buffer.from("archive"),
        immutable: true,
      },
    ],
    certificates: [],
    authorize: async () => {},
  });
  await f.store.close();
  stores.splice(stores.indexOf(f.store), 1);
  const reopened = new HostStore(f.path);
  stores.push(reopened);
  const directories = createNativeBufferDirectories({
    root: f.root,
    persistence: createNativeBufferPersistenceStore(reopened),
  });
  expect(await directories.names(join(f.root, "native-activity", "buffers"))).toEqual([
    filename(1),
  ]);
  expect(
    await collect(
      await directories.open(join(f.root, "native-activity", "buffer-history", "reports")),
    ),
  ).toEqual([{ name: report, directory: true }]);
  expect(
    await directories.names(join(f.root, "native-activity", "buffer-history", "reports", report)),
  ).toEqual([name]);
});

it("merges SQL precedence and filesystem-only legacy entries without duplicate names or body reads", async () => {
  const f = await fixture();
  await f.persistence.complete({
    writes: [{ key: activeKey(filename(1)), bytes: Buffer.from("SQL"), immutable: false }],
    certificates: [],
    authorize: async () => {},
  });
  const directory = join(f.root, "native-activity", "buffers");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename(1)), "stale cache");
  await writeFile(join(directory, filename(2)), "legacy");
  await writeFile(join(directory, "eski-文件.txt"), "legacy non-artifact metadata");
  const read = vi.spyOn(f.persistence, "read"),
    certificate = vi.spyOn(f.persistence, "readCertificate");
  const directories = createNativeBufferDirectories({ root: f.root, persistence: f.persistence });
  expect(await directories.names(directory)).toEqual(
    [filename(1), filename(2), "eski-文件.txt"].sort(),
  );
  expect(read).not.toHaveBeenCalled();
  expect(certificate).not.toHaveBeenCalled();
});

it("does not hide an existing legacy name imported after the SQL phase, including an empty SQL view", async () => {
  for (const initialized of [false, true]) {
    const f = await fixture();
    if (initialized) {
      await f.persistence.complete({
        writes: [
          { key: activeKey(filename(1)), bytes: Buffer.from("earlier SQL"), immutable: false },
        ],
        certificates: [],
        authorize: async () => {},
      });
    }
    const directory = join(f.root, "native-activity", "buffers");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, filename(2)), "legacy source");
    const hasEntry = vi.spyOn(f.persistence, "hasEntry");
    const entries = vi.spyOn(f.persistence, "entries");
    const reader = await createNativeBufferDirectories({
      root: f.root,
      persistence: f.persistence,
    }).open(directory);
    expect(reader).not.toBeNull();
    readers.push(reader!);
    const view = entries.mock.calls[0][3];
    expect(view).toBe(initialized ? 1 : 0);
    if (initialized) expect((await reader!.read())?.name).toBe(filename(1));
    await f.persistence.complete({
      writes: [
        { key: activeKey(filename(2)), bytes: Buffer.from("now retained SQL"), immutable: false },
      ],
      certificates: [],
      authorize: async () => {},
    });
    const legacy = await reader!.read();
    expect(legacy?.name).toBe(filename(2));
    expect(legacy?.ignored).toBeUndefined();
    expect(hasEntry).toHaveBeenLastCalledWith("native-activity/buffers", filename(2), view);
    expect(await reader!.read()).toBeNull();
    expect(
      await createNativeBufferDirectories({ root: f.root, persistence: f.persistence }).names(
        directory,
      ),
    ).toEqual(initialized ? [filename(1), filename(2)] : [filename(2)]);
  }
});

it("pages SQL metadata lazily and closes without scanning remaining archive names", async () => {
  const f = await fixture();
  const entries = vi.fn(async (_directory: string, after: string | null, limit: number) => {
    const first = after === null ? 0 : Number(after.slice("directory-rowid:".length));
    const end = Math.min(first + limit, 5000);
    return {
      entries: Array.from({ length: end - first }, (_, offset) => ({
        name: filename(first + offset),
        isDirectory: false,
      })),
      nextAfter: end < 5000 ? `directory-rowid:${end}` : null,
    };
  });
  const { persistence, body } = metadataPort({ entries });
  const reader = await createNativeBufferDirectories({ root: f.root, persistence }).open(
    join(f.root, "native-activity", "buffers"),
  );
  expect(reader).not.toBeNull();
  readers.push(reader!);
  expect(entries).toHaveBeenCalledTimes(1);
  for (let index = 0; index < 33; index++)
    expect((await reader!.read())?.name).toBe(filename(index));
  expect(entries).toHaveBeenCalledTimes(2);
  expect(entries.mock.calls.every((call) => call[2] === 32)).toBe(true);
  await reader!.close();
  expect(await reader!.read()).toBeNull();
  expect(entries).toHaveBeenCalledTimes(2);
  expect(body).not.toHaveBeenCalled();
});

it("accepts actual rowid-ordered SQL names and preserves the sorted full-list helper", async () => {
  const f = await fixture();
  for (const value of [9, 2, 8]) {
    await f.persistence.complete({
      writes: [
        {
          key: activeKey(filename(value)),
          bytes: Buffer.from(`source ${value}`),
          immutable: false,
        },
      ],
      certificates: [],
      authorize: async () => {},
    });
  }
  const directory = join(f.root, "native-activity", "buffers");
  const directories = createNativeBufferDirectories({ root: f.root, persistence: f.persistence });
  expect((await collect(await directories.open(directory))).map((value) => value.name)).toEqual([
    filename(9),
    filename(2),
    filename(8),
  ]);
  expect(await directories.names(directory)).toEqual([filename(2), filename(8), filename(9)]);
});

it("rejects malformed, non-advancing and out-of-view opaque directory cursors", async () => {
  const f = await fixture();
  const directory = join(f.root, "native-activity", "buffers");
  for (const cursor of [
    filename(1),
    "directory-rowid:0",
    "directory-rowid:01",
    "directory-rowid:+1",
    "directory-rowid:1.0",
    "directory-rowid:1e1",
    "directory-rowid:9007199254740992",
    "directory-rowid:3",
  ]) {
    const { persistence } = metadataPort({
      directoryView: async () => 2,
      entries: async () => ({
        entries: [{ name: filename(1), isDirectory: false }],
        nextAfter: cursor,
      }),
    });
    await expect(
      createNativeBufferDirectories({ root: f.root, persistence }).open(directory),
    ).rejects.toThrow("invalid");
  }
  for (const next of ["directory-rowid:2", "directory-rowid:1"]) {
    let calls = 0;
    const { persistence } = metadataPort({
      directoryView: async () => 3,
      entries: async () => ({
        entries: [{ name: filename(++calls), isDirectory: false }],
        nextAfter: calls === 1 ? "directory-rowid:2" : next,
      }),
    });
    const reader = await createNativeBufferDirectories({ root: f.root, persistence }).open(
      directory,
    );
    readers.push(reader!);
    expect((await reader!.read())?.name).toBe(filename(1));
    await expect(reader!.read()).rejects.toThrow("invalid");
    expect(await reader!.read()).toBeNull();
    expect(calls).toBe(2);
  }
});

it("performs at most one filesystem membership query per read even for duplicate runs", async () => {
  const f = await fixture();
  const directory = join(f.root, "native-activity", "buffers");
  await mkdir(directory, { recursive: true });
  for (let index = 0; index < 20; index++)
    await writeFile(join(directory, filename(index)), "cache");
  const hasEntry = vi.fn(async () => true);
  const { persistence, body } = metadataPort({
    entries: async () => ({
      entries: [{ name: filename(100), isDirectory: false }],
      nextAfter: null,
    }),
    hasEntry,
  });
  const reader = await createNativeBufferDirectories({ root: f.root, persistence }).open(directory);
  readers.push(reader!);
  expect((await reader!.read())?.name).toBe(filename(100));
  for (let index = 0; index < 20; index++) {
    const before = hasEntry.mock.calls.length;
    const value = await reader!.read();
    expect(value?.ignored).toBe(true);
    expect(hasEntry.mock.calls.length - before).toBe(1);
  }
  expect(await reader!.read()).toBeNull();
  expect(body).not.toHaveBeenCalled();
});

it("keeps missing-schema legacy enumeration read-only and rejects escaped or clock namespaces", async () => {
  const f = await fixture();
  const tables = () =>
    f.store.db
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'native_buffer_%' ORDER BY name")
      .all();
  expect(await tables()).toEqual([]);
  const directory = join(f.root, "native-activity", "buffers");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename(1)), "legacy");
  const directories = createNativeBufferDirectories({ root: f.root, persistence: f.persistence });
  expect(await directories.names(directory)).toEqual([filename(1)]);
  expect(await tables()).toEqual([]);
  await expect(
    directories.open(join(f.root, "..", "other", "native-activity", "buffers")),
  ).rejects.toThrow("outside");
  await expect(
    directories.open(join(f.root, "native-activity", "buffer-history", "clocks")),
  ).rejects.toThrow("outside");
  expect(await tables()).toEqual([]);
});

it("does not traverse legacy directory links while retaining SQL virtual directories", async () => {
  const f = await fixture();
  const outside = await mkdtemp(join(base, "outside-"));
  roots.push(outside);
  const directory = join(f.root, "native-activity", "buffers");
  await mkdir(join(f.root, "native-activity"), { recursive: true });
  await writeFile(join(outside, filename(9)), "must not be enumerated");
  await symlink(outside, directory, process.platform === "win32" ? "junction" : "dir");
  await f.persistence.complete({
    writes: [{ key: activeKey(filename(1)), bytes: Buffer.from("SQL"), immutable: false }],
    certificates: [],
    authorize: async () => {},
  });
  const directories = createNativeBufferDirectories({ root: f.root, persistence: f.persistence });
  expect(await directories.names(directory)).toEqual([filename(1)]);
  expect(await directories.open(join(f.root, "native-activity", "buffers", "child"))).toBeNull();
});

it("lists the legacy clock cache name without passing its forbidden namespace to SQL membership", async () => {
  const f = await fixture();
  const history = join(f.root, "native-activity", "buffer-history");
  await mkdir(join(history, "clocks"), { recursive: true });
  const membership = vi.spyOn(f.persistence, "hasEntry");
  const directories = createNativeBufferDirectories({ root: f.root, persistence: f.persistence });
  expect(await directories.names(history)).toEqual(["clocks"]);
  expect(membership).not.toHaveBeenCalled();
  await expect(directories.open(join(history, "clocks"))).rejects.toThrow("outside");
});

it("injects directory cursors into the catalog and charges ignored scans against its existing budget", async () => {
  const f = await fixture();
  const loaded: string[] = [];
  let closed = 0;
  const values: NativeBufferDirectoryEntry[] = [
    ...Array.from({ length: 16 }, (_, index) => ({
      name: filename(index),
      isFile: () => true,
      isDirectory: () => false,
    })),
    ...Array.from({ length: 16 }, (_, index) => ({
      name: filename(index),
      ignored: true as const,
      isFile: () => false,
      isDirectory: () => false,
    })),
    { name: filename(100), isFile: () => true, isDirectory: () => false },
  ];
  const catalog = createNativeBufferCatalog({
    activeDirectory: join(f.root, "native-activity", "buffers"),
    historyDirectory: join(f.root, "native-activity", "buffer-history", "reports"),
    openDirectory: async (path) =>
      path.endsWith("buffers")
        ? {
            read: async () => values.shift() ?? null,
            close: async () => {
              closed++;
            },
          }
        : null,
    activeReadBound: 1,
    historyReadBound: 1,
    key: (row: { id: string }) => row.id,
    active: async (id) => {
      loaded.push(id);
      return { bytes: 1, records: [{ id }] };
    },
    history: async () => ({ bytes: 0, records: [] }),
  });
  catalogs.push(catalog);
  const first = await catalog.page({ limit: 100 }, "device");
  expect(first.records).toHaveLength(16);
  expect(first.next).not.toBeNull();
  expect(loaded).not.toContain(filename(100).slice(0, -5));
  const replay = await catalog.page({ after: { ...first.next!, page: 0 }, limit: 100 }, "device");
  expect(replay).toEqual(first);
  expect(loaded).toHaveLength(16);
  const last = await catalog.page({ after: first.next, limit: 100 }, "device");
  expect(last.records).toEqual([{ id: filename(100).slice(0, -5) }]);
  expect(last.next).toBeNull();
  expect(closed).toBe(1);
});

it("closes injected iteration on the catalog deadline and rejects malformed SQL pagination", async () => {
  const f = await fixture();
  let now = 1,
    closed = 0;
  const catalog = createNativeBufferCatalog({
    activeDirectory: "active",
    historyDirectory: "history",
    now: () => now,
    openDirectory: async () => ({
      read: async () => ({ name: filename(1), isFile: () => true, isDirectory: () => false }),
      close: async () => {
        closed++;
      },
    }),
    activeReadBound: 1,
    historyReadBound: 1,
    key: (row: { id: string }) => row.id,
    active: async (id) => {
      now = 60_001;
      return { bytes: 1, records: [{ id }] };
    },
    history: async () => ({ bytes: 0, records: [] }),
  });
  catalogs.push(catalog);
  await expect(catalog.page({}, "device")).rejects.toThrow("expired");
  expect(closed).toBe(1);
  const { persistence } = metadataPort({
    entries: async () => ({ entries: [{ name: "../escape", isDirectory: true }], nextAfter: null }),
  });
  await expect(
    createNativeBufferDirectories({ root: f.root, persistence }).open(
      join(f.root, "native-activity", "buffers"),
    ),
  ).rejects.toThrow("invalid");
});
