import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, linkSync, realpathSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { loadPhysicalStoreAdmission } from "../index.mjs";

const artifact = process.env.BYCODA_PHYSICAL_ADMISSION_ADDON;
const legacy = process.env.BYCODA_PHYSICAL_ADMISSION_API1_ADDON;
assert.ok(
  artifact && path.isAbsolute(artifact),
  "Supply the actual new API2 absolute addon artifact",
);
assert.ok(
  legacy && path.isAbsolute(legacy),
  "Supply preserved actual API1 artifact for strict rejection test",
);
const native = loadPhysicalStoreAdmission(artifact),
  entry = native.sqliteExtensionEntryPoint();
const evidence = path.resolve(
  "temp/verification/2026-10-30-host-notes-writer/node-port",
);
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(path.join(evidence, "sqlite-api2-"));
function fixture(name) {
  const folder = path.join(root, name);
  mkdirSync(folder);
  const file = path.join(folder, "store.db");
  const initial = new DatabaseSync(file);
  initial.exec("CREATE TABLE effects(value TEXT)");
  initial.close();
  const canonical = realpathSync(file),
    registry = native.openRegistry(native.registryRootForDatabase(canonical)),
    store = registry.bindFile(canonical);
  return { folder, file: canonical, registry, store };
}
function open(file, readOnly = false) {
  const database = new DatabaseSync(file, { allowExtension: true, readOnly });
  database.loadExtension(artifact, entry);
  database.enableLoadExtension(false);
  return database;
}
function identity(database) {
  return JSON.parse(
    database.prepare("SELECT bycoda_connection_identity() AS value").get()
      .value,
  );
}
function windowsOnly() {
  return native.connectionAttestationSupported();
}

test("API2 rejects actual old ABI1 and derives registry location through the shared Core", () => {
  assert.throws(
    () => loadPhysicalStoreAdmission(legacy),
    /Unsupported physical admission mechanical ABI/,
  );
  assert.equal(native.mechanicalAbiVersion(), 2);
  assert.equal(entry, "sqlite3_bycodaphysical_init");
  const f = fixture("registry");
  assert.equal(
    native.registryRootForDatabase(f.file),
    path.join(path.dirname(f.file), ".bycoda-physical-admission-v1"),
  );
  assert.throws(() => native.registryRootForDatabase("relative.db"));
  assert.equal(windowsOnly(), process.platform === "win32");
});

test("same trusted Node image attests actual main connection without SQL mutation or writer allocation", () => {
  const f = fixture("actual");
  if (!windowsOnly()) {
    const db = new DatabaseSync(f.file, { allowExtension: true });
    try {
      assert.throws(() => db.loadExtension(artifact, entry), /UNSUPPORTED/);
    } finally {
      db.close();
    }
    return;
  }
  const db = open(f.file);
  try {
    const result = identity(db);
    assert.deepEqual(Object.keys(result).sort(), [
      "links",
      "physicalFileId",
      "version",
    ]);
    assert.equal(result.version, 1);
    assert.equal(result.physicalFileId, f.store.identity().nativeFormat);
    assert.equal(BigInt(result.links), f.store.identity().links);
    assert.equal(f.registry.statistics().ownerActive, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM effects").get().n, 0);
    assert.equal(db.prepare("SELECT total_changes() AS n").get().n, 0);
    assert.throws(() => db.loadExtension(artifact, entry));
    assert.throws(() =>
      db.prepare("SELECT load_extension(?,?)").get(artifact, entry),
    );
    assert.equal(identity(db).physicalFileId, result.physicalFileId);
  } finally {
    db.close();
  }
});

test("two real connections and close/destructor preserve independent actual identities", () => {
  if (!windowsOnly()) return;
  const a = fixture("a"),
    b = fixture("b"),
    first = open(a.file),
    second = open(b.file);
  try {
    const prepared = first.prepare(
      "SELECT bycoda_connection_identity() AS value",
    );
    assert.equal(
      identity(second).physicalFileId,
      b.store.identity().nativeFormat,
    );
    assert.notEqual(
      identity(second).physicalFileId,
      a.store.identity().nativeFormat,
    );
    second.close();
    assert.equal(
      JSON.parse(prepared.get().value).physicalFileId,
      a.store.identity().nativeFormat,
    );
    assert.equal(first.prepare("SELECT count(*) AS n FROM effects").get().n, 0);
  } finally {
    first.close();
    if (second.isOpen) second.close();
  }
});

test("readonly identity remains available under mechanical closure while fresh writer stays refused", () => {
  if (!windowsOnly()) return;
  const f = fixture("readonly");
  const db = open(f.file, true),
    closing = f.store.tryBeginClose();
  assert.ok(closing);
  try {
    const closed = f.store.tryUpgrade(closing);
    assert.ok(closed);
    try {
      assert.equal(f.store.tryWriter(), null);
      assert.equal(
        identity(db).physicalFileId,
        f.store.identity().nativeFormat,
      );
      assert.throws(() =>
        db.exec("INSERT INTO effects VALUES('blocked readonly write')"),
      );
      assert.equal(db.prepare("SELECT count(*) AS n FROM effects").get().n, 0);
    } finally {
      f.store.releaseClosed(closed);
    }
  } finally {
    db.close();
  }
});

test("actual hardlink count remains data and mismatched database cannot impersonate its target", () => {
  if (!windowsOnly()) return;
  const f = fixture("links"),
    other = fixture("wrong"),
    alias = path.join(f.folder, "alias.db");
  linkSync(f.file, alias);
  const db = open(f.file);
  try {
    const result = identity(db);
    assert.equal(result.links, 2);
    assert.equal(result.physicalFileId, f.store.identity().nativeFormat);
    assert.notEqual(result.physicalFileId, other.store.identity().nativeFormat);
    assert.equal(db.prepare("SELECT count(*) AS n FROM effects").get().n, 0);
  } finally {
    db.close();
  }
});

test("memory database fails closed and a closed connection cannot execute its identity callback", () => {
  if (!windowsOnly()) return;
  const memory = new DatabaseSync(":memory:", { allowExtension: true });
  memory.loadExtension(artifact, entry);
  memory.enableLoadExtension(false);
  try {
    assert.throws(() => identity(memory), /HANDLE_UNAVAILABLE/);
  } finally {
    memory.close();
  }
  const f = fixture("closed"),
    db = open(f.file),
    statement = db.prepare("SELECT bycoda_connection_identity() AS value");
  db.close();
  assert.throws(() => statement.get());
});

test("fresh real Worker SQL registration/close survives its environment exit without corrupting another connection", async () => {
  if (!windowsOnly()) return;
  const f = fixture("worker"),
    db = open(f.file);
  try {
    const worker = new Worker(
      new URL("./support/sqlite-worker.mjs", import.meta.url),
      {
        execArgv: [],
        workerData: { file: f.file, artifact, entryPoint: entry },
      },
    );
    const exited = once(worker, "exit"),
      [value] = await once(worker, "message");
    assert.equal(value.physicalFileId, f.store.identity().nativeFormat);
    assert.equal((await exited)[0], 0);
    assert.equal(identity(db).physicalFileId, value.physicalFileId);
    assert.equal(db.prepare("SELECT total_changes() AS n").get().n, 0);
  } finally {
    db.close();
  }
});
