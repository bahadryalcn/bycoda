import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { AsyncHostNotes } from "./host-notes-async";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const turn = () => new Promise<void>((done) => setImmediate(done));
const resources: { folder: string; notes: AsyncHostNotes; workers: Set<Worker> }[] = [];
afterEach(async () => {
  for (const { folder, notes, workers } of resources.splice(0)) {
    // Only this test's real, isolated workers; do not leave a deliberately
    // faulted observer keeping teardown or a SQL transaction alive.
    await Promise.all([...workers].map((worker) => worker.terminate()));
    await notes.close();
    const target = resolve(folder);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-notes-lifetime-")
    )
      throw new Error("Unexpected owned worker fixture directory");
    rmSync(target, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});
function fixture(workerUrl?: (folder: string) => URL) {
  const folder = mkdtempSync(join(tmpdir(), "bycoda-notes-lifetime-"));
  const path = join(folder, "desktop.db");
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,content_updated_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE actual_writes(sequence INTEGER PRIMARY KEY,body TEXT NOT NULL);
    CREATE TRIGGER track_insert AFTER INSERT ON notes BEGIN INSERT INTO actual_writes(body) VALUES(new.body); END;
    CREATE TRIGGER track_update AFTER UPDATE ON notes BEGIN INSERT INTO actual_writes(body) VALUES(new.body); END;`);
  db.close();
  const notes = new AsyncHostNotes(() => [path], workerUrl?.(folder));
  const resource = { folder, notes, workers: new Set<Worker>() };
  resources.push(resource);
  function worker() {
    // Inspect the actual Worker owned by the adapter, without adding a public
    // test/factory port. The owner wrapper is the implementation's private state.
    const current = (notes as unknown as { worker: Worker | { worker: Worker } }).worker;
    const value = "worker" in current ? current.worker : current;
    resource.workers.add(value);
    return value;
  }
  function writes() {
    const reader = new DatabaseSync(path, { readOnly: true });
    try {
      return reader
        .prepare("SELECT body FROM actual_writes ORDER BY sequence")
        .all()
        .map((row) => row.body);
    } finally {
      reader.close();
    }
  }
  return { notes, folder, path, worker, writes };
}
const input = { id: "note", title: "Original", body: "original", tags: [], sourceCwd: "/project" };

it("keeps the real SQL predecessor, accepted successor and close owned after an error observation until actual worker exit", async () => {
  const f = fixture();
  const original = await f.notes.save(input, 0);
  const worker = f.worker();
  const authorizing = deferred<void>();
  const authorize = deferred<boolean>();
  const order: string[] = [];
  worker.once("exit", () => order.push("exit"));
  let checks = 0;
  const pending = f.notes.save(
    { ...original, body: "original completed after error" },
    original.updatedAt,
    "/project",
    () => {
      if (++checks === 1) return true;
      authorizing.resolve();
      return authorize.promise;
    },
  );
  await authorizing.promise;
  // Fault only the observation on a REAL production Worker while its actual
  // SQLite BEGIN is held by the post-lock authorization latch.
  worker.emit("error", new Error("isolated error-before-exit observation"));
  await expect(pending).rejects.toThrow("A write may have completed");
  const successor = f.notes.save(
    { ...input, id: "next", title: "Next", body: "successor" },
    0,
    "/project",
    () => {
      order.push("successor authorization");
      return true;
    },
  );
  let closed = false;
  const closing = f.notes.close().then(() => {
    closed = true;
  });
  try {
    await turn();
    expect(order).toEqual([]);
    expect(closed).toBe(false);
    expect(f.worker()).toBe(worker);
    expect(f.writes()).toEqual(["original"]);
    authorize.resolve(true);
    await vi.waitFor(() =>
      expect(f.writes()).toEqual(["original", "original completed after error"]),
    );
    await turn();
    expect(order).toEqual([]);
    expect(closed).toBe(false);
    // The original SQL has now committed/closed. End only this fixture's
    // deliberately still-live worker and observe the actual EXIT barrier.
    await worker.terminate();
    expect((await successor).body).toBe("successor");
    await closing;
    expect(order[0]).toBe("exit");
    expect(order.slice(1)).toEqual(["successor authorization", "successor authorization"]);
    expect(f.writes()).toEqual(["original", "original completed after error", "successor"]);
    expect(closed).toBe(true);
  } finally {
    authorize.resolve(true);
    await worker.terminate();
    await Promise.allSettled([successor, closing]);
  }
});

it("retains a really delivered request after postMessage throws, without replaying it or releasing the serial close", async () => {
  const f = fixture();
  const original = await f.notes.save(input, 0);
  const worker = f.worker();
  const authorizing = deferred<void>();
  const authorize = deferred<boolean>();
  const delivered = new Error("Unknown delivery after actual postMessage");
  const actualPost = worker.postMessage.bind(worker);
  vi.spyOn(worker, "postMessage").mockImplementationOnce((...args) => {
    actualPost(...args);
    throw delivered;
  });
  let checks = 0;
  const pending = f.notes.save(
    { ...original, body: "delivered once" },
    original.updatedAt,
    "/project",
    () => {
      if (++checks === 1) return true;
      authorizing.resolve();
      return authorize.promise;
    },
  );
  await expect(pending).rejects.toBe(delivered);
  let nextFinished = false;
  const next = f.notes.get("note").then((value) => {
    nextFinished = true;
    return value;
  });
  let closed = false;
  const closing = f.notes.close().then(() => {
    closed = true;
  });
  try {
    await authorizing.promise;
    await turn();
    expect(nextFinished).toBe(false);
    expect(closed).toBe(false);
    expect(f.writes()).toEqual(["original"]);
    authorize.resolve(true);
    expect((await next)?.body).toBe("delivered once");
    await closing;
    expect(checks).toBe(2);
    expect(f.writes()).toEqual(["original", "delivered once"]);
  } finally {
    authorize.resolve(true);
    await worker.terminate();
    await Promise.allSettled([next, closing]);
  }
});

it("drains a dropped caller's original SQL job before close and refuses fresh ingress", async () => {
  const f = fixture();
  const original = await f.notes.save(input, 0);
  const authorizing = deferred<void>();
  const authorize = deferred<boolean>();
  let checks = 0;
  // Observe rejection for test hygiene, then discard the public waiter.
  void f.notes
    .save({ ...original, body: "dropped caller completed" }, original.updatedAt, "/project", () => {
      if (++checks === 1) return true;
      authorizing.resolve();
      return authorize.promise;
    })
    .catch(() => {});
  await authorizing.promise;
  f.worker();
  let closed = false;
  const closing = f.notes.close().then(() => {
    closed = true;
  });
  try {
    await expect(f.notes.get("note")).rejects.toThrow("closing");
    await turn();
    expect(closed).toBe(false);
    authorize.resolve(true);
    await closing;
    expect(f.writes()).toEqual(["original", "dropped caller completed"]);
  } finally {
    authorize.resolve(true);
  }
});

it("conserves a real COMMIT with a lost reply and an uncaught Worker error before allowing the queued successor", async () => {
  const f = fixture((folder) => pathToFileURL(join(folder, "lost-reply-worker.mjs")));
  const actualWorker = join(f.folder, "actual-worker.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./host-notes-worker.mjs", import.meta.url))],
    outfile: actualWorker,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    loader: { ".ps1": "text", ".md": "text" },
    define: { "import.meta.hot": "undefined" },
  });
  writeFileSync(
    join(f.folder, "lost-reply-worker.mjs"),
    `import { parentPort } from "node:worker_threads";
const post = parentPort.postMessage.bind(parentPort);
parentPort.postMessage = (reply, ...rest) => {
  if (reply.value?.body === "committed without reply") {
    process.nextTick(() => { throw new Error("isolated lost reply AFTER actual COMMIT"); });
    return;
  }
  return post(reply, ...rest);
};
await import("./actual-worker.mjs");
`,
  );
  await f.notes.list();
  const worker = f.worker();
  let exited = false;
  worker.once("exit", () => {
    exited = true;
  });
  const pending = f.notes.save({ ...input, body: "committed without reply" }, 0);
  const order: boolean[] = [];
  const successor = f.notes.save(
    { ...input, id: "next", title: "Next", body: "after unknown" },
    0,
    "/project",
    () => {
      order.push(exited);
      return true;
    },
  );
  await expect(pending).rejects.toThrow("A write may have completed");
  expect((await successor).body).toBe("after unknown");
  await f.notes.close();
  expect(order).toEqual([true, true]);
  expect(f.writes()).toEqual(["committed without reply", "after unknown"]);
});
