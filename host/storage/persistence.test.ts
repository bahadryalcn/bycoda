import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../store";
import { StoreDatabase } from "../store-db";
import { stageHostRestore } from "./snapshots";
import { storageFailure } from "./persistence-health";
import type { HostSession } from "../../src/features/connections/model/protocol";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-persistence-"));
  await mkdir(join(root, "profile"));
  const path = join(root, "profile", "host.db");
  const store = new HostStore(path);
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  cleanups.push(() => store.close().catch(() => undefined));
  await store.ready;
  const project = await store.addProject(root, "Fixture");
  const session: HostSession = {
    projectId: project.id,
    revision: 1,
    status: "idle",
    updatedAt: 1,
    session: {
      id: "session",
      cwd: root,
      title: "Initial",
      harness: "codex",
      model: "fixture",
      modelSettings: {},
      runtimeMode: "auto",
      blocks: [],
    },
  };
  await store.save(session, {});
  return { root, store, path, session };
}
async function synchronous(database: StoreDatabase) {
  return Number(Object.values((await database.prepare("PRAGMA synchronous").get())!)[0]);
}

it("selects FULL before command BEGIN, commits receipt/domain atomically, restores NORMAL", async () => {
  const { store, session, path } = await fixture();
  expect(await synchronous(store.db)).toBe(1);
  await store.transaction(async () => {
    expect(await synchronous(store.db)).toBe(2);
    await store.save(
      { ...session, revision: 2, session: { ...session.session, title: "Accepted" } },
      {},
    );
    await store.recordReceipt("payload", {
      commandId: "accepted",
      sessionId: "session",
      revision: 2,
    });
  });
  expect(await synchronous(store.db)).toBe(1);
  const reader = new DatabaseSync(path);
  try {
    expect(reader.prepare("SELECT id FROM receipts WHERE id='accepted'").get()).toBeDefined();
    expect(reader.prepare("SELECT revision FROM sessions WHERE id='session'").get()?.revision).toBe(
      2,
    );
  } finally {
    reader.close();
  }
});

it("keeps stream journal transactions NORMAL and forbids receipt escalation within them", async () => {
  const { store, session } = await fixture();
  const modes: number[] = [];
  const original = store.db.exec.bind(store.db);
  vi.spyOn(store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "BEGIN IMMEDIATE") modes.push(await synchronous(store.db));
    return original(sql);
  });
  await store.save({ ...session, revision: 2, updatedAt: 2 }, {}, { journal: true });
  expect(modes).toEqual([1]);
  await expect(
    store.transaction(async () => {
      await store.recordReceipt("payload", {
        commandId: "wrong-class",
        sessionId: "session",
        revision: 3,
      });
    }, "checkpoint"),
  ).rejects.toThrow("critical storage transaction");
  expect(await store.receiptStatus("wrong-class")).toBeUndefined();
  expect(await synchronous(store.db)).toBe(1);
});

it("critical outer command retains FULL even when a nested save uses journal options", async () => {
  const { store, session } = await fixture();
  await store.transaction(async () => {
    await store.save({ ...session, revision: 2 }, {}, { journal: true });
    expect(await synchronous(store.db)).toBe(2);
    await store.recordReceipt("payload", {
      commandId: "nested",
      sessionId: "session",
      revision: 2,
    });
  });
  expect(await store.receiptStatus("nested")).toBeDefined();
});

it("does not silently upgrade a raw existing NORMAL transaction", async () => {
  const { store } = await fixture();
  await store.db.scope(async () => {
    await store.db.exec("BEGIN IMMEDIATE");
    await expect(store.db.durableScope(() => undefined)).rejects.toThrow(
      "before a transaction starts",
    );
    await store.db.exec("ROLLBACK");
  });
});

it("rollback publishes no commit wake or receipt and resets the durability class", async () => {
  const { store, session } = await fixture();
  const wake = vi.fn();
  store.subscribeChanges(wake);
  await expect(
    store.transaction(async () => {
      await store.save({ ...session, revision: 2 }, {});
      await store.recordReceipt("payload", {
        commandId: "rollback",
        sessionId: "session",
        revision: 2,
      });
      throw new Error("rollback fixture");
    }),
  ).rejects.toThrow("rollback fixture");
  expect(wake).not.toHaveBeenCalled();
  expect(await store.receiptStatus("rollback")).toBeUndefined();
  expect(await synchronous(store.db)).toBe(1);
});

it("isolates subscriber errors, unsubscribes, and emits no unpersisted deferred wake", async () => {
  const { store, session } = await fixture();
  vi.spyOn(console, "error").mockImplementation(() => {});
  store.subscribeChanges(() => {
    throw new Error("listener");
  });
  const wake = vi.fn();
  const unsubscribe = store.subscribeChanges(wake);
  await store.save({ ...session, revision: 2 }, {}, { deferred: true });
  expect(wake).not.toHaveBeenCalled();
  await store.save({ ...session, revision: 3 }, {});
  expect(wake).toHaveBeenCalledTimes(1);
  unsubscribe();
  await store.save({ ...session, revision: 4 }, {});
  expect(wake).toHaveBeenCalledTimes(1);
});

it("holds write admission after real SQLITE_FULL, keeps reads, and explicitly probes recovery", async () => {
  const { store } = await fixture();
  await store.db.exec("CREATE TABLE full_fixture (value BLOB)");
  const pages = Number(Object.values((await store.db.prepare("PRAGMA page_count").get())!)[0]);
  await store.db.exec(`PRAGMA max_page_count=${pages}`);
  await expect(
    store.db.prepare("INSERT INTO full_fixture VALUES (zeroblob(1048576))").run(),
  ).rejects.toThrow();
  expect(store.db.persistenceHealth()).toEqual({ state: "temporarily-blocked", reason: "full" });
  expect(await store.projects()).toHaveLength(1);
  await expect(
    store.recordReceipt("x", { commandId: "full", sessionId: "session", revision: 1 }),
  ).rejects.toThrow("persistence is unavailable");
  await store.db.exec("PRAGMA max_page_count=2147483646");
  await store.db.recoverPersistence();
  expect(store.db.persistenceHealth()).toEqual({ state: "ready" });
  await store.recordReceipt("x", { commandId: "recovered", sessionId: "session", revision: 1 });
});

it("classifies SQLite extended busy/corruption codes without retaining sensitive errors", () => {
  expect(storageFailure({ errcode: 517, message: "private path" })).toEqual({
    state: "temporarily-blocked",
    reason: "busy",
  });
  expect(storageFailure({ errcode: 11 })).toEqual({
    state: "recovery-required",
    reason: "corrupt",
  });
  expect(storageFailure({ errcode: 10 })).toEqual({ state: "recovery-required", reason: "io" });
  expect(storageFailure(new Error("constraint violation"))).toBeUndefined();
});

it("backs up WAL state and attachments, stages a blocked restore and refuses Host startup", async () => {
  const { store, root } = await fixture();
  await mkdir(store.attachmentDir);
  await writeFile(join(store.attachmentDir, "blob"), "attachment fixture");
  await store.recordReceipt("payload", {
    commandId: "before-backup",
    sessionId: "session",
    revision: 1,
  });
  const backup = join(root, "backup");
  const manifest = await store.captureSnapshot(backup);
  expect(manifest.coherence).toBe("host-only");
  expect(manifest.files.map((file) => file.path)).toEqual(["host.db", "attachments/blob"]);
  const staged = join(root, "staged");
  const result = await stageHostRestore(backup, staged);
  expect(result.state).toBe("recovery-required");
  expect(result.restoreEpoch).not.toBe(manifest.snapshotId);
  expect(await readFile(join(staged, "attachments", "blob"), "utf8")).toBe("attachment fixture");
  const reader = new DatabaseSync(join(staged, "host.db"), { readOnly: true });
  try {
    expect(reader.prepare("SELECT id FROM receipts WHERE id='before-backup'").get()).toBeDefined();
  } finally {
    reader.close();
  }
  const restored = new HostStore(join(staged, "host.db"));
  cleanups.push(() => restored.close().catch(() => undefined));
  await expect(restored.ready).rejects.toThrow("reconciliation before admission");
});

it("rejects changed blobs and never overwrites an existing backup or staging profile", async () => {
  const { store, root } = await fixture();
  await mkdir(store.attachmentDir);
  await writeFile(join(store.attachmentDir, "blob"), "original");
  const backup = join(root, "backup");
  await store.captureSnapshot(backup);
  await expect(store.captureSnapshot(backup)).rejects.toThrow();
  const existing = join(root, "existing");
  await mkdir(existing);
  await writeFile(join(existing, "sentinel"), "keep");
  await expect(stageHostRestore(backup, existing)).rejects.toThrow();
  expect(await readFile(join(existing, "sentinel"), "utf8")).toBe("keep");
  await writeFile(join(backup, "attachments", "blob"), "tampered");
  await expect(stageHostRestore(backup, join(root, "damaged"))).rejects.toThrow(
    "verification failed",
  );
});

it("refuses path traversal in a manifest before creating restore staging", async () => {
  const { store, root } = await fixture();
  const backup = join(root, "backup");
  const manifest = await store.captureSnapshot(backup);
  manifest.files[0].path = "attachments/../../outside";
  await writeFile(join(backup, "manifest.json"), JSON.stringify(manifest));
  await expect(stageHostRestore(backup, join(root, "staged"))).rejects.toThrow(
    "Invalid snapshot file entry",
  );
});
