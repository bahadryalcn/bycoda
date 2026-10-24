import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CommandReceipt, HostSession } from "../src/features/connections/model/protocol";
import { HostStore, summary } from "./store";
import { sessionIssue } from "../src/features/sessions/model/sessionIssue";
import { sessionNeedsInput, type Block } from "../src/features/sessions/model/session";
import { registerBlockChanges } from "../src/features/sessions/model/blockChanges";
import { HostEngine } from "./engine";

const cleanups: Array<() => void> = [];

describe("project filesystem identity", () => {
  it("reuses a project for equivalent folder spellings without emitting changes", () => {
    const directory = open();
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(() => store.close());
    const project = store.addProject(directory, "Original");
    const notify = vi.spyOn(store.changes, "notify");
    const variant =
      process.platform === "win32"
        ? directory.replace(/\\/g, "/").toUpperCase() + "/"
        : directory + "/./";
    expect(store.addProject(variant, "Alias")).toEqual(project);
    expect(store.projects()).toEqual([project]);
    expect(notify).not.toHaveBeenCalled();
    expect(store.addProject(join(directory, "another"), "Another").id).not.toBe(project.id);
  });

  it("preserves legacy project IDs and their sessions when opening an alias", () => {
    const directory = open();
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(() => store.close());
    const project = store.addProject(directory, "Original");
    store.db
      .prepare("INSERT INTO projects VALUES (?, ?, ?)")
      .run("legacy", directory + "/", "Original");
    store.save(session("legacy-session", "legacy"), {});
    expect(store.addProject(directory + "/./", "Reopened").id).toBe(project.id);
    expect(store.project("legacy").id).toBe("legacy");
    expect(store.session("legacy-session").projectId).toBe("legacy");
    expect(store.projects()).toHaveLength(2);
  });
});

describe("sparse journal checkpoints", () => {
  function setup(blocks: Block[]) {
    const path = join(open(), "sparse.db");
    const store = new HostStore(path);
    cleanups.push(() => store.close());
    const project = store.addProject("/sparse", "Sparse");
    const input = session("sparse", project.id, { status: "running" });
    const base = store.save({ ...input, session: { ...input.session, blocks } }, {});
    return { store, base, path };
  }
  function edit(store: HostStore, previous: HostSession, updates: Block[]) {
    const changes = new Map(updates.map((block) => [block.id, block]));
    return store.save(
      {
        ...previous,
        revision: previous.revision + 1,
        session: {
          ...previous.session,
          blocks: previous.session.blocks.map((block) => changes.get(block.id) ?? block),
        },
      },
      { edited: updates.map((block) => block.id) },
      { deferred: true, blockChanges: changes },
    );
  }
  function flush(store: HostStore) {
    (store as unknown as { flushPending(id: string): void }).flushPending("sparse");
  }

  it("coalesces edits across saves and reuses ordered IDs without visiting unchanged blocks", () => {
    const { store, base } = setup([
      { id: "user", role: "reasoning", text: "unchanged prefix" },
      { id: "a", role: "assistant", text: "first" },
      { id: "b", role: "assistant", text: "second" },
    ]);
    let next = edit(store, base, [{ ...base.session.blocks[1], text: "first edit" }]);
    flush(store); // The first journal has to seed block_ids.
    const ids = store.db.prepare("SELECT block_ids FROM session_journal").get()!.block_ids;
    const prepare = vi.spyOn(store.db, "prepare");
    next = edit(store, next, [{ ...next.session.blocks[1], text: "older" }]);
    next = edit(store, next, [{ ...next.session.blocks[2], text: "second edit" }]);
    next = edit(store, next, [{ ...next.session.blocks[1], text: "latest" }]);
    // A full scan or ID serialization would touch this unchanged block.
    Object.defineProperty(next.session.blocks[0], "id", { configurable: true, get: () => "user" });
    const getter = vi.spyOn(next.session.blocks[0], "id", "get");
    flush(store);
    expect(getter).not.toHaveBeenCalled();
    getter.mockRestore();
    expect(
      prepare.mock.calls.some(([sql]) =>
        sql.startsWith("UPDATE session_journal SET revision=?,metadata=?"),
      ),
    ).toBe(true);
    prepare.mockRestore();
    expect(store.db.prepare("SELECT block_ids FROM session_journal").get()!.block_ids).toBe(ids);
    expect(
      store.db
        .prepare("SELECT revision FROM events ORDER BY revision")
        .all()
        .map((row) => row.revision),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(
      store.db
        .prepare("SELECT payload FROM session_journal_blocks ORDER BY block_id")
        .all()
        .map((row) => JSON.parse(String(row.payload)).text),
    ).toEqual(["latest", "second edit"]);
  });

  it("restores all pending changes after an enclosing transaction rolls back", () => {
    const { store, base } = setup([{ id: "a", role: "assistant", text: "before" }]);
    let next = edit(store, base, [{ ...base.session.blocks[0], text: "checkpoint" }]);
    flush(store);
    next = edit(store, next, [{ ...next.session.blocks[0], text: "pending" }]);
    expect(() =>
      store.transaction(() => {
        flush(store);
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(store.db.prepare("SELECT revision FROM session_journal").get()!.revision).toBe(2);
    expect(store.session("sparse").revision).toBe(3);
    next = edit(store, next, [{ ...next.session.blocks[0], text: "retried" }]);
    flush(store);
    expect(
      JSON.parse(
        String(store.db.prepare("SELECT payload FROM session_journal_blocks").get()!.payload),
      ).text,
    ).toBe("retried");
    expect(
      store.db
        .prepare("SELECT revision FROM events ORDER BY revision")
        .all()
        .map((row) => row.revision),
    ).toEqual([1, 2, 3, 4]);
  });

  it("keeps the full journal path for additions, removals and reordered known blocks", () => {
    const { store, base } = setup([
      { id: "a", role: "assistant", text: "A" },
      { id: "b", role: "user", text: "B" },
    ]);
    let next = edit(store, base, [{ ...base.session.blocks[0], text: "edited" }]);
    flush(store);
    const added: Block = { id: "c", role: "assistant", text: "C" };
    for (const blocks of [
      [...next.session.blocks, added],
      [added, next.session.blocks[1], next.session.blocks[0]],
      [added],
    ]) {
      next = store.save(
        { ...next, revision: next.revision + 1, session: { ...next.session, blocks } },
        {},
        { deferred: true, blockChanges: new Map(blocks.map((block) => [block.id, block])) },
      );
      flush(store);
      expect(
        JSON.parse(
          String(store.db.prepare("SELECT block_ids FROM session_journal").get()!.block_ids),
        ),
      ).toEqual(blocks.map((block) => block.id));
    }
  });

  it("detects reordering even when producer payload changes are empty", () => {
    const { store, base } = setup([
      { id: "a", role: "assistant", text: "A" },
      { id: "b", role: "user", text: "B" },
      { id: "c", role: "assistant", text: "C" },
    ]);
    let next = edit(store, base, [{ ...base.session.blocks[0], text: "edited" }]);
    flush(store);
    const blocks = [next.session.blocks[2], next.session.blocks[1], next.session.blocks[0]];
    registerBlockChanges(next.session.blocks, blocks, []);
    next = store.save(
      { ...next, revision: 3, session: { ...next.session, blocks } },
      {},
      { deferred: true },
    );
    flush(store);
    expect(store.db.prepare("SELECT block_ids FROM session_journal").get()!.block_ids).toBe(
      '["c","b","a"]',
    );
    expect(summary(next).issueTurnId).toBeUndefined();
  });

  it("durably journals hard provider events without rewriting unchanged history", () => {
    const history: Block[] = Array.from({ length: 100 }, (_, index) => ({
      id: `history-${index}`, role: "assistant", text: "x".repeat(64 * 1024),
    }));
    const exercise = (journal: boolean) => {
      const { store, base, path } = setup(history);
      let current = base;
      const writes = store.snapshotWrites;
      for (let index = 0; index < 10; index++) {
        const block = { ...current.session.blocks.at(-1)!, text: `tool event ${index}` };
        current = store.transaction(() => store.save({
          ...current, revision: current.revision + 1,
          session: { ...current.session, providerSessionId: "provider-current", blocks: [...current.session.blocks.slice(0, -1), block] },
        }, { type: "tool.updated", index }, { journal, blockChanges: new Map([[block.id, block]]) }));
      }
      return { store, current, path, writes: store.snapshotWrites - writes };
    };
    const control = exercise(false);
    const sparse = exercise(true);
    expect(control.writes).toBe(10);
    expect(sparse.writes).toBe(0);
    // The hard event is durable before any timer, settlement, or close.
    expect(sparse.store.db.prepare("SELECT revision FROM session_journal").get()!.revision).toBe(11);
    expect(sparse.store.db.prepare("SELECT count(*) AS n FROM session_journal_blocks").get()!.n).toBe(1);
    expect(sparse.store.db.prepare("SELECT provider_session_id FROM session_state").get()!.provider_session_id).toBe("provider-current");
    const reader = new HostStore(sparse.path);
    try {
      expect(reader.session("sparse").session.blocks).toEqual(sparse.current.session.blocks);
      expect(reader.session("sparse").session.providerSessionId).toBe("provider-current");
      expect(reader.events("sparse", 1).events).toHaveLength(10);
    } finally { reader.close(); }
  });

  it("commits pending content and the receipt atomically with a hard save", () => {
    const { store, base } = setup([{ id: "a", role: "assistant", text: "base" }]);
    let next = edit(store, base, [{ ...base.session.blocks[0], text: "checkpoint" }]);
    flush(store);
    next = edit(store, next, [{ ...next.session.blocks[0], text: "pending" }]);
    const accepted = { commandId: "settle" } as CommandReceipt;
    const save = () => {
      store.save({ ...next, revision: 4, status: "idle" }, {});
      store.recordReceipt("signature", accepted);
    };
    expect(() =>
      store.transaction(() => {
        save();
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(store.receiptStatus("settle")).toBeUndefined();
    expect(store.db.prepare("SELECT revision FROM sessions").get()!.revision).toBe(1);
    expect(store.session("sparse").revision).toBe(3);
    store.transaction(save);
    expect(store.receipt("settle", "signature")).toEqual(accepted);
    expect(store.db.prepare("SELECT * FROM session_journal").all()).toEqual([]);
    const snapshot = JSON.parse(
      String(store.db.prepare("SELECT snapshot FROM sessions").get()!.snapshot),
    );
    expect(snapshot.revision).toBe(4);
    expect(snapshot.session.blocks[0].text).toBe("pending");
    expect(
      store.db
        .prepare("SELECT revision FROM events ORDER BY revision")
        .all()
        .map((row) => row.revision),
    ).toEqual([1, 2, 3, 4]);
  });

  it("reads an old snapshot and preexisting journal, then extends and compacts the same format", () => {
    const { store, base, path } = setup([{ id: "a", role: "assistant", text: "snapshot" }]);
    const {
      blockRevisions: _revisions,
      session: { blocks: _blocks, ...metadata },
      ...rest
    } = base;
    store.db
      .prepare("INSERT INTO session_journal VALUES (?, ?, ?, ?)")
      .run("sparse", 2, JSON.stringify({ ...rest, revision: 2, session: metadata }), '["a"]');
    store.db
      .prepare("INSERT INTO session_journal_blocks VALUES (?, ?, ?, ?)")
      .run("sparse", "a", 2, JSON.stringify({ id: "a", role: "assistant", text: "old journal" }));
    // Simulate a previous process: no new in-memory index or writer state.
    const reopened = new HostStore(path);
    cleanups.push(() => reopened.close());
    const old = reopened.session("sparse");
    expect(old.revision).toBe(2);
    expect(old.session.blocks[0].text).toBe("old journal");
    const next = edit(reopened, old, [{ ...old.session.blocks[0], text: "new checkpoint" }]);
    flush(reopened);
    expect(reopened.db.prepare("SELECT block_ids FROM session_journal").get()!.block_ids).toBe(
      '["a"]',
    );
    reopened.save({ ...next, revision: 4, status: "idle" }, {});
    expect(reopened.db.prepare("SELECT * FROM session_journal").all()).toEqual([]);
    expect(
      JSON.parse(String(reopened.db.prepare("SELECT snapshot FROM sessions").get()!.snapshot))
        .session.blocks[0].text,
    ).toBe("new checkpoint");
  });

  it("matches full summary semantics while sparse edits change turns, errors, drafts and approvals", () => {
    const { store, base } = setup([
      { id: "old-error", role: "system", notice: "error", text: "old failure" },
      { id: "user", role: "user", text: "question" },
      { id: "answer", role: "assistant", text: "answer" },
      { id: "error", role: "system", text: "thread abc already has an active writer" },
      { id: "draft", role: "user", draft: true, text: "draft" },
      { id: "approval", role: "assistant", text: "", approval: { requestId: 1 } },
    ]);
    let next = base;
    const check = (value: HostSession) => {
      const actual = summary(value);
      const issue = sessionIssue({ ...value.session, busy: value.status === "running" });
      expect(actual.issue).toBe(issue);
      expect(actual.issueTurnId).toBe(
        issue
          ? value.session.blocks.findLast((block) => block.role === "user" && !block.draft)?.id
          : undefined,
      );
      expect(actual.issueMessage).toBe(
        issue
          ? (
              value.session.retryMessage ||
              value.session.blocks.findLast((block) => block.notice === "error")?.text ||
              ""
            ).slice(0, 500)
          : undefined,
      );
      expect(actual.draft).toBe(
        value.session.blocks.some((block) => block.role === "user" && block.draft),
      );
      expect(actual.needsInput).toBe(sessionNeedsInput(value.session));
    };
    check(next);
    for (const updates of [
      [{ ...next.session.blocks[3], text: "recovered" }],
      [{ ...next.session.blocks[2], text: "" }],
      [{ ...next.session.blocks[4], draft: false }],
      [{ ...next.session.blocks[5], approval: { requestId: 1, decided: "allow" as const } }],
      [
        {
          ...next.session.blocks[4],
          role: "system" as const,
          notice: "error" as const,
          text: "new failure",
        },
      ],
    ]) {
      next = edit(store, next, updates);
      check(next);
      check({ ...next, status: "idle" });
      check({
        ...next,
        session: { ...next.session, retryMessage: "retry", continuingElsewhere: true },
      });
      check({ ...next, session: { ...next.session, worktreeRemoved: true } });
      flush(store);
      expect(
        JSON.parse(String(store.db.prepare("SELECT summary FROM session_state").get()!.summary)),
      ).toEqual(JSON.parse(JSON.stringify(summary(next))));
    }
  });
});

it("keeps both session ownership indexes consistent when moving projects", () => {
  const directory = open();
  const store = new HostStore(join(directory, "ownership.db"));
  cleanups.push(() => store.close());
  const first = store.addProject(join(directory, "first"), "First");
  const second = store.addProject(join(directory, "second"), "Second");
  const saved = store.save(session("moved", first.id), {});
  store.save({ ...saved, projectId: second.id, revision: 2 }, {});
  for (const table of ["sessions", "session_state"])
    expect(store.db.prepare(`SELECT project_id FROM ${table} WHERE id=?`).get("moved")).toEqual({
      project_id: second.id,
    });
  expect(store.sessions(first.id)).toEqual([]);
  expect(store.sessions(second.id).map((value) => value.session.id)).toEqual(["moved"]);
});

it("recovers reordered, deleted and updated blocks from the incremental journal", () => {
  vi.useFakeTimers();
  try {
    const path = join(open(), "journal.db");
    const store = new HostStore(path);
    const project = store.addProject("/tmp", "Journal");
    const base = store.save(
      session("journal", project.id, {
        session: {
          ...session("journal", project.id).session,
          blocks: [
            { id: "a", role: "assistant", text: "large prefix" },
            { id: "b", role: "assistant", text: "tail" },
          ],
        },
      }),
      {},
    );
    const next = store.save(
      {
        ...base,
        revision: 2,
        session: {
          ...base.session,
          title: "Changed",
          blocks: [{ ...base.session.blocks[1]!, text: "new tail" }, base.session.blocks[0]!],
        },
      },
      {},
      { deferred: true },
    );
    vi.advanceTimersByTime(1_000);
    store.save(
      {
        ...next,
        revision: 3,
        session: { ...next.session, blocks: [next.session.blocks[0]!] },
      },
      {},
      { deferred: true },
    );
    vi.advanceTimersByTime(1_000);
    expect(
      JSON.parse(
        String(
          store.db.prepare("SELECT snapshot FROM sessions WHERE id='journal'").get()!.snapshot,
        ),
      ).revision,
    ).toBe(1);
    store.db.close();
    const reopened = new HostStore(path);
    cleanups.push(() => reopened.close());
    expect(reopened.session("journal").session.blocks.map((b) => [b.id, b.text])).toEqual([
      ["b", "new tail"],
    ]);
    expect(reopened.session("journal").session.title).toBe("Changed");
    expect(reopened.session("journal").revision).toBe(3);
  } finally {
    vi.useRealTimers();
  }
});

it("rolls back a journal and its events when an enclosing transaction fails", () => {
  const store = new HostStore(join(open(), "rollback.db"));
  cleanups.push(() => store.close());
  const project = store.addProject("/tmp", "Rollback");
  const base = store.save(session("rollback", project.id), {});
  expect(() =>
    store.transaction(() => {
      store.save({ ...base, revision: 2 }, { changed: true });
      throw new Error("rollback");
    }),
  ).toThrow("rollback");
  expect(store.session("rollback").revision).toBe(1);
  expect(store.events("rollback", 1).events).toEqual([]);
});

it("keeps session revisions in bounded metadata memory after the first indexed read", () => {
  const path = join(open(), "metadata.db");
  const initial = new HostStore(path);
  const project = initial.addProject("/tmp", "Metadata");
  const saved = initial.save(session("metadata", project.id), {});
  initial.close();

  const reopened = new HostStore(path);
  cleanups.push(() => reopened.close());
  const prepare = vi.spyOn(reopened.db, "prepare");
  expect(reopened.sessionStateMetadata("metadata")).toEqual({
    revision: saved.revision,
    status: "idle",
    desktop: false,
  });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(reopened.sessionRevision("metadata")).toBe(saved.revision);
  expect(reopened.sessionStateMetadata("metadata")?.status).toBe("idle");
  expect(prepare).toHaveBeenCalledTimes(1);
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function open() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-store-test-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function session(id: string, projectId: string, extra: Partial<HostSession> = {}): HostSession {
  return {
    projectId,
    revision: 1,
    status: "idle",
    updatedAt: 100,
    session: {
      id,
      cwd: "/tmp",
      title: id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
      blocks: [],
    },
    ...extra,
  } as unknown as HostSession;
}

describe("HostStore.adopted", () => {
  it("lists only desktop-shared sessions and tracks updates", () => {
    const directory = open();
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(() => store.close());
    const project = store.addProject(directory, "Test");
    store.save(session("plain", project.id), { type: "t" });
    store.save(session("shared", project.id, { desktop: { updatedAt: 5 } }), {
      type: "t",
    });
    expect(store.adopted()).toEqual([
      {
        id: "shared",
        projectId: project.id,
        revision: 1,
        updatedAt: 100,
        status: "idle",
        desktopUpdatedAt: 5,
      },
    ]);

    store.save(
      session("shared", project.id, {
        desktop: { updatedAt: 9 },
        revision: 2,
        updatedAt: 200,
        status: "running",
      }),
      { type: "t" },
    );
    store.save(
      session("plain", project.id, {
        desktop: { updatedAt: 0 },
        revision: 3,
        updatedAt: 300,
      }),
      { type: "t" },
    );
    expect(store.adopted().sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      {
        id: "plain",
        projectId: project.id,
        revision: 3,
        updatedAt: 300,
        status: "idle",
        desktopUpdatedAt: 0,
      },
      {
        id: "shared",
        projectId: project.id,
        revision: 2,
        updatedAt: 200,
        status: "running",
        desktopUpdatedAt: 9,
      },
    ]);
  });

  it("migrates and backfills a database created with the old schema", () => {
    const directory = open();
    const path = join(directory, "host.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, cwd TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), snapshot TEXT NOT NULL, summary TEXT);
      INSERT INTO projects VALUES ('p', '/x', 'X');`);
    const insert = old.prepare(
      "INSERT INTO sessions (id, project_id, snapshot) VALUES (?, 'p', ?)",
    );
    insert.run(
      "a",
      JSON.stringify(
        session("a", "p", {
          desktop: { updatedAt: 1 },
          revision: 7,
          updatedAt: 42,
          status: "running",
        }),
      ),
    );
    insert.run("b", JSON.stringify(session("b", "p")));
    old.close();

    const store = new HostStore(path);
    expect(store.adopted()).toEqual([
      {
        id: "a",
        projectId: "p",
        revision: 7,
        updatedAt: 42,
        status: "running",
        desktopUpdatedAt: 1,
      },
    ]);
    expect(
      store
        .summaries("p")
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(store.hasRunning("p")).toBe(true);
    // Reopening must not re-run the backfill or fail on existing columns.
    store.close();
    const again = new HostStore(path);
    cleanups.push(() => again.close());
    expect(again.adopted()).toHaveLength(1);
  });

  it("creates the session_state side table on a fresh database and writes both rows on hard saves", () => {
    const directory = open();
    const path = join(directory, "host.db");
    const store = new HostStore(path);
    cleanups.push(() => store.close());
    const project = store.addProject(directory, "Test");
    store.save(session("s", project.id, { revision: 4, updatedAt: 44 }), {
      type: "t",
    });
    const raw = new DatabaseSync(path);
    try {
      expect(
        raw.prepare("SELECT revision, updated_at, project_id FROM session_state").all(),
      ).toEqual([{ revision: 4, updated_at: 44, project_id: project.id }]);
      expect(raw.prepare("SELECT revision FROM sessions WHERE id='s'").get()).toEqual({
        revision: 4,
      });
      const indexes = raw
        .prepare("PRAGMA index_list(session_state)")
        .all()
        .map((index) => index.name);
      expect(indexes).toContain("session_state_project");
      expect(
        raw
          .prepare("PRAGMA index_list(sync_records)")
          .all()
          .map((index) => index.name),
      ).toContain("sync_records_rev");
    } finally {
      raw.close();
    }
    expect(store.hasRunning(project.id)).toBe(false);
  });

  it("mirrors writes an older host binary makes to sessions after a rollback", () => {
    const directory = open();
    const path = join(directory, "host.db");
    const first = new HostStore(path);
    const project = first.addProject(directory, "Test");
    first.save(session("a", project.id, { desktop: { updatedAt: 3 } }), {
      type: "t",
    });
    first.save(session("b", project.id, { status: "running" }), { type: "t" });
    first.close();

    // What the previous binary does: it only knows the sessions table.
    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA foreign_keys=ON");
    raw
      .prepare(
        "INSERT INTO sessions (id, project_id, snapshot, summary, has_desktop, revision, updated_at, status) VALUES ('late', ?, ?, NULL, 0, 9, 90, 'running')",
      )
      .run(
        project.id,
        JSON.stringify(
          session("late", project.id, {
            revision: 9,
            updatedAt: 90,
            status: "running",
          }),
        ),
      );
    raw
      .prepare(
        "UPDATE sessions SET summary=NULL, revision=5, updated_at=500, status='idle' WHERE id='b'",
      )
      .run();
    raw.close();

    const store = new HostStore(path);
    cleanups.push(() => store.close());
    expect(
      store
        .summaries(project.id)
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(["a", "b", "late"]);
    expect(
      store.db.prepare("SELECT revision, status FROM session_state WHERE id='b'").get(),
    ).toMatchObject({ revision: 5, status: "idle" });
    expect(store.hasRunning(project.id)).toBe(true);
    expect(store.adopted().map((entry) => entry.id)).toEqual(["a"]);
    expect(
      store
        .startupStates()
        .map((state) => state.id)
        .sort(),
    ).toEqual(["a", "b", "late"]);
    store.deleteSession("a");
    expect(store.db.prepare("SELECT id FROM session_state WHERE id='a'").get()).toBeUndefined();
  });

  it("adopts sessions rows that exist without a session_state row", () => {
    const directory = open();
    const path = join(directory, "host.db");
    const first = new HostStore(path);
    const project = first.addProject(directory, "Test");
    first.save(session("a", project.id, { desktop: { updatedAt: 3 } }), {
      type: "t",
    });
    first.close();
    const raw = new DatabaseSync(path);
    raw.exec("DROP TRIGGER session_state_insert; DELETE FROM session_state");
    raw.close();
    const store = new HostStore(path);
    cleanups.push(() => store.close());
    expect(store.adopted()).toMatchObject([{ id: "a", desktopUpdatedAt: 3 }]);
  });
});

describe("HostStore device credentials", () => {
  it("drops a remembered credential the moment it is revoked", () => {
    const directory = open();
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(() => store.close());
    const first = store.issueDevice("one");
    const second = store.issueDevice("two");
    expect(store.authenticated(first.token)).toBe(true);
    // Served from memory now; revocation must still win at once.
    expect(store.authenticated(first.token)).toBe(true);
    expect(store.authenticated(second.token)).toBe(true);
    expect(store.revokeDevice(first.id)).toBe(true);
    expect(store.authenticated(first.token)).toBe(false);
    expect(store.authenticated(second.token)).toBe(true);
    expect(store.revokeToken(second.token)).toBe(true);
    expect(store.authenticated(second.token)).toBe(false);
    expect(store.authenticated("unknown")).toBe(false);
  });

  it("sees a revocation committed by another connection on the next check", () => {
    const directory = open();
    const path = join(directory, "host.db");
    const store = new HostStore(path);
    cleanups.push(() => store.close());
    const device = store.issueDevice("cli-revoked");
    expect(store.authenticated(device.token)).toBe(true);
    expect(store.authenticated(device.token)).toBe(true);
    const other = new DatabaseSync(path);
    try {
      other.prepare("DELETE FROM devices WHERE id=?").run(device.id);
    } finally {
      other.close();
    }
    expect(store.authenticated(device.token)).toBe(false);
  });
});

describe("HostStore receipts", () => {
  const receipt = (commandId: string) => ({ commandId }) as unknown as CommandReceipt;

  it("prunes old receipts but keeps recent ones deduplicating retries", () => {
    const directory = open();
    const path = join(directory, "host.db");
    const store = new HostStore(path);
    store.recordReceipt("sig", receipt("recent"));
    store.recordReceipt("sig", receipt("old"));
    store.db
      .prepare("UPDATE receipts SET created_at=? WHERE id='old'")
      .run(Date.now() - 8 * 24 * 3600_000);
    store.pruneReceipts();
    expect(store.receipt("old", "sig")).toBeUndefined();
    expect(store.receipt("recent", "sig")).toEqual(receipt("recent"));
    expect(() => store.receipt("recent", "other")).toThrow(/different payload/);
    store.close();
  });

  it("migrates a receipts table without timestamps and gives old rows a full window", () => {
    const directory = open();
    const path = join(directory, "host.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE receipts (id TEXT PRIMARY KEY, signature TEXT NOT NULL, receipt TEXT NOT NULL);
      INSERT INTO receipts VALUES ('legacy', 'sig', '{"commandId":"legacy"}');`);
    old.close();
    const store = new HostStore(path);
    cleanups.push(() => store.close());
    expect(store.receipt("legacy", "sig")).toEqual(receipt("legacy"));
  });

  it("reads a durable command status receipt without requiring a retry signature", () => {
    const directory = open();
    const path = join(directory, "host.db");
    const store = new HostStore(path);
    store.recordReceipt("sig", receipt("durable"));
    store.close();
    const reopened = new HostStore(path);
    cleanups.push(() => reopened.close());
    expect(reopened.receiptStatus("durable")).toEqual(receipt("durable"));
    expect(reopened.receiptStatus("missing")).toBeUndefined();
  });
});

describe("HostStore startup columns", () => {
  const legacy = (path: string) => {
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, cwd TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), snapshot TEXT NOT NULL, summary TEXT);
      CREATE TABLE events (session_id TEXT NOT NULL REFERENCES sessions(id), revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id, revision));
      INSERT INTO projects VALUES ('p', '/x', 'X');`);
    const insert = old.prepare(
      "INSERT INTO sessions (id, project_id, snapshot) VALUES (?, 'p', ?)",
    );
    const withSession = (
      id: string,
      patch: Record<string, unknown>,
      extra: Partial<HostSession> = {},
    ) => {
      const base = session(id, "p", extra);
      insert.run(id, JSON.stringify({ ...base, session: { ...base.session, ...patch } }));
    };
    // idle + desktop-shared + provider binding: needs no rewrite
    withSession(
      "bound",
      { providerSessionId: "prov-1", cwd: "/work" },
      { desktop: { updatedAt: 1 } },
    );
    // started here, never shared with the desktop app
    withSession("local", {});
    // a turn that was running when the host stopped
    withSession(
      "running",
      { providerSessionId: "prov-2" },
      { desktop: { updatedAt: 1 }, status: "running", revision: 4 },
    );
    // a `!command` that cannot outlive the host
    withSession(
      "shell",
      {
        blocks: [{ id: "b", role: "assistant", text: "", shell: { running: true } }],
      },
      { desktop: { updatedAt: 1 } },
    );
    old.close();
  };

  it("backfills the startup columns from an old-schema database", () => {
    const directory = open();
    const path = join(directory, "host.db");
    legacy(path);
    const store = new HostStore(path);
    cleanups.push(() => store.close());
    const states = Object.fromEntries(store.startupStates().map((state) => [state.id, state]));
    expect(states.bound).toMatchObject({
      hasDesktop: true,
      running: false,
      shellRunning: false,
      providerSessionId: "prov-1",
      harness: "codex",
      cwd: "/work",
    });
    expect(states.local).toMatchObject({
      hasDesktop: false,
      providerSessionId: null,
    });
    expect(states.running).toMatchObject({
      running: true,
      providerSessionId: "prov-2",
    });
    expect(states.shell.shellRunning).toBe(true);
  });

  it("starts up with the same effects as parsing every snapshot, loading only what it rewrites", () => {
    const directory = open();
    const path = join(directory, "host.db");
    legacy(path);
    const store = new HostStore(path);
    cleanups.push(() => store.close());
    const find = vi.spyOn(store, "session");
    const bind = vi.fn();
    const provider = {
      send: vi.fn(),
      stop: async () => {},
      cancel: async () => {},
      bind,
      approve: () => {},
      answer: () => {},
    };
    const engine = new HostEngine(store, { codex: provider });
    cleanups.push(() => engine.close());

    // Provider bindings are restored for every bound session.
    expect(bind).toHaveBeenCalledWith("bound", "prov-1", "/work");
    expect(bind).toHaveBeenCalledWith("running", "prov-2", "/tmp", undefined);
    expect(bind).toHaveBeenCalledTimes(2);
    // The idle, already-shared session was never loaded for startup.
    expect(find.mock.calls.map(([id]) => id)).not.toContain("bound");
    // Legacy rows are still shared with the desktop app; running turns are interrupted.
    expect(store.session("local").desktop).toBeDefined();
    expect(store.session("running").status).toBe("interrupted");
    expect(store.session("shell").session.blocks[0].shell?.running).toBeFalsy();
    // The columns follow the rewrites.
    const states = Object.fromEntries(store.startupStates().map((state) => [state.id, state]));
    expect(states.local.hasDesktop).toBe(true);
    expect(states.running.running).toBe(false);
    expect(states.shell.shellRunning).toBe(false);
  });
});

describe("HostStore checkpointed streaming saves", () => {
  const withText = (base: HostSession, revision: number, text: string): HostSession =>
    ({
      ...base,
      revision,
      updatedAt: 100 + revision,
      session: {
        ...base.session,
        blocks: [{ id: "b", role: "assistant", text, streaming: true }],
      },
    }) as unknown as HostSession;
  const stored = (path: string, id: string) => {
    const db = new DatabaseSync(path);
    try {
      const row = db.prepare("SELECT snapshot, revision, status FROM sessions WHERE id=?").get(id);
      const events = db
        .prepare("SELECT revision FROM events WHERE session_id=? ORDER BY revision")
        .all(id);
      const state = db.prepare("SELECT revision, status FROM session_state WHERE id=?").get(id);
      return {
        row,
        state,
        events: events.map((event) => Number(event.revision)),
      };
    } finally {
      db.close();
    }
  };
  function setup() {
    const directory = open();
    const path = join(directory, "host.db");
    const store = new HostStore(path);
    const project = store.addProject(directory, "Test");
    const base = session("s", project.id, {
      status: "running",
      desktop: { updatedAt: 1 },
    });
    store.save(base, { type: "turn" });
    return { store, path, project, base };
  }

  it("writes incremental journals per checkpoint while reads see every soft save", () => {
    vi.useFakeTimers();
    try {
      const { store, path, base } = setup();
      cleanups.push(() => store.close());
      const writes = store.snapshotWrites;
      for (let revision = 2; revision <= 6; revision++) {
        store.save(
          withText(base, revision, "x".repeat(revision)),
          { type: "events" },
          { deferred: true },
        );
        expect(store.session("s").revision).toBe(revision);
        expect(store.session("s").session.blocks[0].text).toBe("x".repeat(revision));
        expect(store.summaries(base.projectId)[0].revision).toBe(revision);
        expect(store.adopted()[0].revision).toBe(revision);
        expect(store.sessions(base.projectId)[0].revision).toBe(revision);
      }
      expect(store.snapshotWrites).toBe(writes);
      expect(stored(path, "s").state?.revision).toBe(1);

      vi.advanceTimersByTime(1_000);
      expect(store.snapshotWrites).toBe(writes);
      const after = stored(path, "s");
      expect(after.state?.revision).toBe(6);
      // Checkpoints never rewrite the row that holds the snapshot.
      expect(after.row?.revision).toBe(1);
      expect(after.events).toEqual([1, 2, 3, 4, 5, 6]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves a client the same events and revisions as unbatched saves", () => {
    vi.useFakeTimers();
    try {
      const { store, base } = setup();
      cleanups.push(() => store.close());
      for (let revision = 2; revision <= 4; revision++)
        store.save(
          withText(base, revision, "t"),
          { type: "events", n: revision },
          { deferred: true },
        );
      const pending = store.events("s", 1);
      vi.advanceTimersByTime(1_000);
      expect(store.events("s", 1)).toEqual(pending);
      expect(pending.events).toEqual([
        { revision: 2, event: { type: "events", n: 2 } },
        { revision: 3, event: { type: "events", n: 3 } },
        { revision: 4, event: { type: "events", n: 4 } },
      ]);
      expect(pending.revision).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a hard save flushes pending state at once and the row equals memory", () => {
    vi.useFakeTimers();
    try {
      const { store, path, base } = setup();
      cleanups.push(() => store.close());
      store.save(withText(base, 2, "partial"), { type: "events" }, { deferred: true });
      const settled = store.save(
        { ...withText(base, 3, "partial done"), status: "idle" },
        { type: "settled" },
      );
      const { row, events } = stored(path, "s");
      expect(JSON.parse(String(row?.snapshot))).toEqual(settled);
      expect(row?.status).toBe("idle");
      expect(stored(path, "s").state).toMatchObject({ revision: 3, status: "idle" });
      expect(events).toEqual([1, 2, 3]);
      // No stale checkpoint timer rewrites anything afterwards.
      const writes = store.snapshotWrites;
      vi.advanceTimersByTime(5_000);
      expect(store.snapshotWrites).toBe(writes);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps pending state when the LRU cache evicts the session", () => {
    vi.useFakeTimers();
    try {
      const { store, path, project, base } = setup();
      cleanups.push(() => store.close());
      store.save(withText(base, 2, "streamed"), { type: "events" }, { deferred: true });
      for (let index = 0; index < 40; index++) {
        store.save(session(`other-${index}`, project.id), { type: "t" });
        store.session(`other-${index}`);
      }
      expect(store.session("s").session.blocks[0].text).toBe("streamed");
      expect(stored(path, "s").state?.revision).toBe(1);
      vi.advanceTimersByTime(1_000);
      expect(stored(path, "s").state?.revision).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("close flushes pending state", () => {
    vi.useFakeTimers();
    try {
      const { store, path, base } = setup();
      store.save(withText(base, 2, "last words"), { type: "events" }, { deferred: true });
      store.close();
      const { row, events } = stored(path, "s");
      expect(row?.revision).toBe(2);
      expect(String(row?.snapshot)).toContain("last words");
      expect(events).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("after a crash the last checkpoint survives and startup interrupts the turn", () => {
    vi.useFakeTimers();
    try {
      const { store, path, base } = setup();
      store.save(withText(base, 2, "checkpointed"), { type: "events" }, { deferred: true });
      vi.advanceTimersByTime(1_000);
      store.save(withText(base, 3, "lost tail"), { type: "events" }, { deferred: true });
      // Crash: drop the checkpoint timer and close the raw handle without flushing,
      // so the pending state is lost and no file handle stays open.
      vi.clearAllTimers();
      store.db.close();
      const reopened = new HostStore(path);
      cleanups.push(() => reopened.close());
      expect(reopened.session("s").session.blocks[0].text).toBe("checkpointed");
      const provider = {
        send: vi.fn(),
        stop: async () => {},
        cancel: async () => {},
        bind: vi.fn(),
        approve: () => {},
        answer: () => {},
      };
      const engine = new HostEngine(reopened, { codex: provider });
      cleanups.push(() => void engine.close());
      expect(reopened.session("s").status).toBe("interrupted");
      expect(reopened.session("s").session.blocks[0].text).toBe("checkpointed");
      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });
});
