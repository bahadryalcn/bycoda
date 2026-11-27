import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// Gate the first read of an attachment so the test can observe the Host while it copies.
const copyGate = vi.hoisted(() => ({
  root: "",
  reached: undefined as undefined | (() => void),
  release: Promise.resolve(),
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const [path, flags] = args;
      if (copyGate.root && flags === "r" && resolve(String(path)).startsWith(copyGate.root)) {
        const reached = copyGate.reached;
        copyGate.reached = undefined;
        if (reached) {
          reached();
          await copyGate.release;
        }
      }
      return actual.open(...args);
    },
  };
});

import { HostStore } from "../store";
import { collectAttachmentGarbage } from "../attachments/attachments";
import { attachmentDeletionHeld, stageHostRestore } from "./snapshots";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  copyGate.root = "";
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("releases the database lane while copying attachments and holds their deletion until done", async () => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-snapshot-lane-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "profile"));
  const store = new HostStore(join(root, "profile", "host.db"));
  cleanups.push(() => store.close().catch(() => undefined));
  await store.ready;
  await mkdir(store.attachmentDir);
  const copied = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const collectable = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await writeFile(join(store.attachmentDir, copied), "copied first");
  await writeFile(join(store.attachmentDir, collectable), "unreferenced");

  let release!: () => void;
  copyGate.release = new Promise<void>((done) => (release = done));
  const reached = new Promise<void>((done) => (copyGate.reached = done));
  copyGate.root = resolve(store.attachmentDir);
  const backup = join(root, "backup");
  const capture = store.captureSnapshot(backup);
  await reached;

  // Other Host work is admitted while the snapshot is copying attachment files.
  expect(await store.db.scope(() => "admitted")).toBe("admitted");
  expect(attachmentDeletionHeld(store.attachmentDir)).toBe(true);
  const future = Date.now() + 8 * 24 * 60 * 60 * 1000;
  expect(await collectAttachmentGarbage(store, () => new Set(), future)).toEqual([]);
  expect(existsSync(join(store.attachmentDir, collectable))).toBe(true);

  release();
  const manifest = await capture;
  expect(manifest.files.map((file) => file.path)).toEqual([
    "host.db",
    `attachments/${copied}`,
    `attachments/${collectable}`,
  ]);
  expect(attachmentDeletionHeld(store.attachmentDir)).toBe(false);
  const staged = join(root, "staged");
  await stageHostRestore(backup, staged);
  expect(await readFile(join(staged, "attachments", collectable), "utf8")).toBe("unreferenced");
  expect(await collectAttachmentGarbage(store, () => new Set(), future)).toContain(collectable);
});

async function storeWithAttachments(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "profile"));
  const store = new HostStore(join(root, "profile", "host.db"));
  cleanups.push(() => store.close().catch(() => undefined));
  await store.ready;
  await mkdir(store.attachmentDir);
  return { root, store };
}

it("refuses past the file cap before copying any attachment and names the limit", async () => {
  const { root, store } = await storeWithAttachments("bycoda-snapshot-files-");
  // The database file counts toward the cap, so 10,000 attachments are one too many.
  for (let start = 0; start < 10_000; start += 500) {
    await Promise.all(
      Array.from({ length: 500 }, (_, index) =>
        writeFile(join(store.attachmentDir, `file-${start + index}`), ""),
      ),
    );
  }
  const backup = join(root, "backup");
  await expect(store.captureSnapshot(backup)).rejects.toThrow(
    /Snapshot file limit exceeded: .*at most 10000 files.*Delete unused attachments/,
  );
  expect(existsSync(join(backup, "attachments"))).toBe(false);
  expect(existsSync(join(backup, "manifest.json"))).toBe(false);
  expect(attachmentDeletionHeld(store.attachmentDir)).toBe(false);
}, 60_000);

it("refuses past the byte cap from sizes seen in the walk, before copying anything", async () => {
  const { root, store } = await storeWithAttachments("bycoda-snapshot-bytes-");
  const half = 1024 ** 3 + 1;
  // Sparse files: sizes count toward the cap without writing gigabytes.
  for (const name of ["first", "second"]) {
    const handle = await open(join(store.attachmentDir, name), "w");
    try {
      await handle.truncate(half);
    } finally {
      await handle.close();
    }
  }
  const backup = join(root, "backup");
  await expect(store.captureSnapshot(backup)).rejects.toThrow(
    /Snapshot size limit exceeded: .*at most 2 GiB.*Delete large attachments/,
  );
  expect(existsSync(join(backup, "attachments"))).toBe(false);
  expect(existsSync(join(backup, "manifest.json"))).toBe(false);
  expect(attachmentDeletionHeld(store.attachmentDir)).toBe(false);
});

it("captures many attachments under the caps with a linear running total", async () => {
  const { root, store } = await storeWithAttachments("bycoda-snapshot-many-");
  const names = Array.from({ length: 300 }, (_, index) => `file-${String(index).padStart(3, "0")}`);
  await Promise.all(
    names.map((name, index) => writeFile(join(store.attachmentDir, name), "x".repeat(index + 1))),
  );
  const backup = join(root, "backup");
  const manifest = await store.captureSnapshot(backup);
  expect(manifest.files).toHaveLength(301);
  expect(manifest.files.slice(1).reduce((total, file) => total + file.bytes, 0)).toBe(
    (300 * 301) / 2,
  );
  // Restore compatibility: the version 1 manifest still verifies and stages.
  const staged = join(root, "staged");
  expect((await stageHostRestore(backup, staged)).manifest.files).toHaveLength(301);
  expect(await readFile(join(staged, "attachments", "file-299"), "utf8")).toBe("x".repeat(300));
});

it("releases the deletion hold when capture fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-snapshot-fail-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "profile"));
  const store = new HostStore(join(root, "profile", "host.db"));
  cleanups.push(() => store.close().catch(() => undefined));
  await store.ready;
  await expect(store.captureSnapshot(join(root, "profile", "inside"))).rejects.toThrow(
    "outside the active profile",
  );
  expect(attachmentDeletionHeld(store.attachmentDir)).toBe(false);
});
