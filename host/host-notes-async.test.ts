import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { performance } from "node:perf_hooks";
import { AsyncHostNotes } from "./host-notes-async";
import { HostStore } from "./store";

const resources: { folder: string; notes: AsyncHostNotes }[] = [];
afterEach(async () => {
  for (const { folder, notes } of resources.splice(0)) {
    await notes.close();
    const target = resolve(folder);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-notes-worker-")
    )
      throw new Error("Unexpected owned fixture directory");
    rmSync(target, { recursive: true, force: true });
  }
});
function fixture(bundled = false) {
  const folder = mkdtempSync(join(tmpdir(), "bycoda-notes-worker-")),
    path = join(folder, "desktop.db");
  const db = new DatabaseSync(path);
  db.exec(
    `PRAGMA journal_mode=WAL; CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,content_updated_at INTEGER NOT NULL DEFAULT 0);`,
  );
  db.close();
  const workerPath = join(folder, "host-notes-worker.mjs");
  const notes = new AsyncHostNotes(() => [path], bundled ? pathToFileURL(workerPath) : undefined);
  resources.push({ folder, notes });
  return { notes, path, workerPath };
}
const input = {
  id: "note",
  title: "Worker note",
  body: "original",
  tags: ["work"],
  sourceCwd: "/project",
};

it("awaits asynchronous authority and preserves an awaited actor transaction during worker rechecks", async () => {
  const { notes, path } = fixture();
  const store = new HostStore(join(path, "..", "host.db"));
  try {
    const owner = await store.issueDevice("Notes owner");
    // Warm the worker outside the actor: its message callback must use the call's
    // owner, rather than the context in which the worker was originally created.
    await notes.list();
    const saved = await store.transaction(async () =>
      notes.save(input, 0, "/project", async () => {
        return await store.authenticated(owner.token);
      }),
    );
    expect(saved.body).toBe("original");
    await expect(
      notes.save({ ...saved, body: "denied" }, saved.updatedAt, "/project", async () => false),
    ).rejects.toThrow("authority revoked");
    expect((await notes.get(saved.id))?.body).toBe("original");
  } finally {
    await notes.close();
    await store.close();
  }
});

it("preserves transactional versions, project boundaries and accepted input order", async () => {
  const { notes } = fixture();
  const created = await notes.save(input, 0, "/project", () => true);
  const updated = await notes.save(
    { ...created, body: "changed" },
    created.updatedAt,
    "/project",
    () => true,
  );
  expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
  expect(notes.revision).toBeGreaterThan(0);
  expect((await notes.list("/project")).notes[0].body).toBe("changed");
  await expect(notes.get("note", "/another")).rejects.toThrow("another project");
  await expect(notes.save(created, created.updatedAt, "/project", () => true)).rejects.toThrow(
    "changed on the computer",
  );
  expect((await notes.get("note"))?.body).toBe("changed");
  await notes.delete("note", updated.updatedAt, "/project", () => true);
  expect(await notes.get("note")).toBeNull();
});

it("keeps an unrelated 20ms timer responsive during a 1500ms SQLite write lock", async () => {
  const { notes, path } = fixture();
  const original = await notes.save(input, 0);
  const writer = new DatabaseSync(path);
  writer.exec("BEGIN IMMEDIATE");
  const started = performance.now();
  let settled = false,
    released = false;
  const release = setTimeout(() => {
    writer.exec("COMMIT");
    released = true;
  }, 1500);
  const pending = notes
    .save({ ...original, body: "after lock" }, original.updatedAt, "/project", () => true)
    .then((value) => {
      settled = true;
      return value;
    });
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const timerMs = performance.now() - started;
    expect(settled).toBe(false);
    expect(released).toBe(false);
    expect(timerMs).toBeLessThan(750);
    const saved = await pending;
    expect(performance.now() - started).toBeGreaterThanOrEqual(1400);
    expect(saved.body).toBe("after lock");
    expect((await notes.get("note"))?.updatedAt).toBe(saved.updatedAt);
    console.info(
      JSON.stringify({
        kind: "async notes SQLite lock",
        holdMs: 1500,
        scheduledTimerMs: 20,
        timerMs,
        totalMs: performance.now() - started,
        committed: true,
      }),
    );
  } finally {
    clearTimeout(release);
    if (!released) writer.exec("ROLLBACK");
    writer.close();
    await pending.catch(() => {});
  }
});

it("rechecks authorization after acquiring a contended lock and never commits revoked content", async () => {
  const { notes, path } = fixture();
  const original = await notes.save(input, 0);
  const writer = new DatabaseSync(path);
  writer.exec("BEGIN IMMEDIATE");
  let allowed = true;
  const checks: boolean[] = [];
  const pending = notes.save(
    { ...original, body: "revoked" },
    original.updatedAt,
    "/project",
    () => {
      checks.push(allowed);
      return allowed;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(checks).toEqual([true]);
  allowed = false;
  writer.exec("COMMIT");
  writer.close();
  await expect(pending).rejects.toThrow("authority revoked");
  expect(checks).toEqual([true, false]);
  expect((await notes.get("note"))?.body).toBe("original");
});

it("runs the same guarded storage API from the production JavaScript worker bundle", async () => {
  const { notes, workerPath } = fixture(true);
  await build({
    entryPoints: [fileURLToPath(new URL("./host-notes-worker.mjs", import.meta.url))],
    outfile: workerPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    loader: { ".ps1": "text", ".md": "text" },
    define: { "import.meta.hot": "undefined" },
  });
  expect(readFileSync(workerPath, "utf8")).not.toMatch(/import\(["'][^"']+\.ts["']\)/);
  const saved = await notes.save(input, 0, "/project", () => true);
  expect((await notes.get(saved.id, "/project"))?.body).toBe("original");
  await expect(notes.delete(saved.id, saved.updatedAt, "/project", () => false)).rejects.toThrow(
    "authority revoked",
  );
  expect((await notes.list("/project")).total).toBe(1);
  const metadata = await notes.desktopList("/project", "P", ["codex"], process.platform);
  expect("sessions" in metadata && metadata.sessions).toEqual([]);
  const unchanged = await notes.desktopList(
    "/project",
    "P",
    ["codex"],
    process.platform,
    metadata.fingerprint,
  );
  expect("unchanged" in unchanged && unchanged.unchanged).toBe(true);
  expect(Object.hasOwn(unchanged, "sessions")).toBe(false);
});

it("drains an accepted mutation on close and refuses new operations", async () => {
  const { notes, path } = fixture();
  const original = await notes.save(input, 0);
  const pending = notes.save(
    { ...original, body: "accepted before close" },
    original.updatedAt,
    "/project",
    () => true,
  );
  const closing = notes.close();
  expect(notes.close()).toBe(closing);
  await expect(notes.get("note")).rejects.toThrow("closing");
  await Promise.all([pending, closing]);
  const reader = new DatabaseSync(path, { readOnly: true });
  try {
    expect(reader.prepare("SELECT body FROM notes WHERE id='note'").get()?.body).toBe(
      "accepted before close",
    );
  } finally {
    reader.close();
  }
});
