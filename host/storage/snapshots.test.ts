import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
