import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import type { HostSession } from "../../src/features/connections/model/protocol";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-host-write-floor-")),
    path = join(root, "host.db");
  const store = new HostStore(path);
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  cleanups.push(() => store.close().catch(() => undefined));
  await store.ready;
  const project = await store.addProject(root, "Fixture");
  const value: HostSession = {
    projectId: project.id,
    revision: 1,
    status: "idle",
    updatedAt: 1,
    session: {
      id: "fenced",
      cwd: root,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
      modelSettings: {},
      title: "Protected",
      blocks: [],
    },
  };
  await store.save({ ...value, revision: 0 }, {});
  await store.transaction(async () => {
    await store.db
      .prepare("INSERT INTO host_authority_heads VALUES(?,?,?,?,?)")
      .run(store.environmentId, "fenced", 2, "fixture-migration", "host-active");
    await store.withAuthorityGeneration("fenced", 2, () => store.save(value, {}));
  });
  return { root, path, store, value: await store.session("fenced") };
}

it("durable SQL triggers reject old connection writes across all authoritative session tables", async () => {
  const { path, store, value } = await fixture();
  const old = new DatabaseSync(path);
  try {
    for (const sql of [
      "UPDATE sessions SET revision=99 WHERE id='fenced'",
      "DELETE FROM sessions WHERE id='fenced'",
      "UPDATE sessions SET id='renamed' WHERE id='fenced'",
      "UPDATE session_state SET revision=99 WHERE id='fenced'",
      "DELETE FROM session_state WHERE id='fenced'",
      "INSERT INTO events VALUES('fenced',99,'{}')",
      "DELETE FROM events WHERE session_id='fenced'",
      "INSERT INTO session_journal VALUES('fenced',99,'{}','[]')",
      "INSERT INTO session_journal_blocks VALUES('fenced','block',99,'{}')",
    ])
      expect(() => old.exec(sql)).toThrow("fenced");
    expect(
      old.prepare("SELECT COUNT(*) AS count FROM host_authority_write_permits").get()?.count,
    ).toBe(0);
  } finally {
    old.close();
  }
  expect((await store.session("fenced")).revision).toBe(value.revision);
});

it("untouched legacy IDs stay writable for old raw SQL and ordinary Store APIs", async () => {
  const { store, path, value } = await fixture();
  await store.save(
    { ...value, authorityGeneration: undefined, session: { ...value.session, id: "legacy" } },
    {},
  );
  const old = new DatabaseSync(path);
  try {
    old.exec("UPDATE sessions SET revision=12 WHERE id='legacy'");
  } finally {
    old.close();
  }
  expect(
    (await store.db.prepare("SELECT revision FROM sessions WHERE id='legacy'").get())?.revision,
  ).toBe(12);
  await store.updateSession("legacy", { title: "Still editable" });
  expect((await store.session("legacy")).session.title).toBe("Still editable");
});

it("requires exact generation for direct/deferred saves, update and delete without inventing caller authority", async () => {
  const { store, value } = await fixture();
  const wake = vi.fn();
  store.subscribeChanges(wake);
  for (const authorityGeneration of [undefined, 1, 3]) {
    await expect(store.save({ ...value, authorityGeneration, revision: 2 }, {})).rejects.toThrow(
      "current generation",
    );
    await expect(
      store.save({ ...value, authorityGeneration, revision: 2 }, {}, { deferred: true }),
    ).rejects.toThrow("current generation");
  }
  await expect(store.updateSession("fenced", { title: "No implicit authority" })).rejects.toThrow(
    "current generation",
  );
  await expect(store.deleteSession("fenced")).rejects.toThrow("current generation");
  expect(wake).not.toHaveBeenCalled();
  await store.updateSession("fenced", { title: "Exact generation" }, 2);
  expect((await store.session("fenced")).authorityGeneration).toBe(2);
  expect((await store.summaries(value.projectId))[0].authorityGeneration).toBe(2);
});

it("keeps permits transaction-local and invisible to another connection, including rollback", async () => {
  const { store, path, value } = await fixture();
  const observer = new DatabaseSync(path);
  try {
    await expect(
      store.withAuthorityGeneration("fenced", 2, async () => {
        expect(
          (
            await store.db
              .prepare("SELECT COUNT(*) AS count FROM host_authority_write_permits")
              .get()
          )?.count,
        ).toBe(1);
        expect(
          observer.prepare("SELECT COUNT(*) AS count FROM host_authority_write_permits").get()
            ?.count,
        ).toBe(0);
        await store.save({ ...value, revision: 2 }, {});
        throw new Error("rollback permit");
      }),
    ).rejects.toThrow("rollback permit");
    expect(
      observer.prepare("SELECT COUNT(*) AS count FROM host_authority_write_permits").get()?.count,
    ).toBe(0);
    expect(() => observer.exec("UPDATE sessions SET revision=3 WHERE id='fenced'")).toThrow(
      "fenced",
    );
  } finally {
    observer.close();
  }
  expect((await store.session("fenced")).revision).toBe(1);
});

it("rejects stale deferred flush/read publication and retains evidence without a checkpoint retry storm", async () => {
  const { store, value } = await fixture();
  const wake = vi.fn();
  store.subscribeChanges(wake);
  await store.save(
    { ...value, revision: 2, session: { ...value.session, title: "Uncommitted stream" } },
    {},
    { deferred: true },
  );
  expect(wake).not.toHaveBeenCalled();
  await store.db
    .prepare("UPDATE host_authority_heads SET generation=3 WHERE session_id='fenced'")
    .run();
  await expect(store.flushAll()).rejects.toThrow("current generation");
  await expect(store.session("fenced")).rejects.toThrow("current generation");
  expect(wake).not.toHaveBeenCalled();
  expect(
    (await store.db.prepare("SELECT revision FROM sessions WHERE id='fenced'").get())?.revision,
  ).toBe(1);
});

it("persists the floor before any journal is constructed and clears defective committed permits on restart", async () => {
  const { store, path } = await fixture();
  // Simulate a historic defective writer, not an authority grant.
  await store.db
    .prepare("INSERT INTO host_authority_write_permits VALUES('fenced',2,'bad-old-permit')")
    .run();
  await store.close();
  const reopened = new HostStore(path);
  cleanups.push(() => reopened.close().catch(() => undefined));
  await reopened.ready;
  expect(
    (await reopened.db.prepare("SELECT COUNT(*) AS count FROM host_authority_write_permits").get())
      ?.count,
  ).toBe(0);
  await expect(
    reopened.db.prepare("UPDATE sessions SET revision=9 WHERE id='fenced'").run(),
  ).rejects.toThrow("fenced");
});
