import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { HostStore, summary } from "../store";
import { HostEngine } from "../engine";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  vi.restoreAllMocks();
});
function open() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-store-startup-test-"));
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
describe("HostStore startup columns", () => {
  const legacy = async (path: string) => {
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
    await old.close();
  };
  it("backfills the startup columns from an old-schema database", async () => {
    const directory = open();
    const path = join(directory, "host.db");
    await legacy(path);
    const store = new HostStore(path);
    cleanups.push(async () => await store.close());
    const states = Object.fromEntries(
      (await store.startupStates()).map((state) => [state.id, state]),
    );
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
  it("starts up with the same effects as parsing every snapshot, loading only what it rewrites", async () => {
    const directory = open();
    const path = join(directory, "host.db");
    await legacy(path);
    // A valid persisted summary proves the idle row's workspace identity.
    // Missing/corrupt summaries must instead inspect the original snapshot.
    const prepared = new DatabaseSync(path);
    try {
      const row = prepared.prepare("SELECT snapshot FROM sessions WHERE id='bound'").get()!;
      prepared
        .prepare("UPDATE sessions SET summary=? WHERE id='bound'")
        .run(JSON.stringify(summary(JSON.parse(String(row.snapshot)))));
    } finally {
      prepared.close();
    }
    const store = new HostStore(path);
    cleanups.push(async () => await store.close());
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
    await engine.ready;
    cleanups.push(async () => await engine.close());
    // Provider bindings are restored for every bound session.
    expect(bind).toHaveBeenCalledWith("bound", "prov-1", "/work");
    expect(bind).toHaveBeenCalledWith("running", "prov-2", "/tmp", undefined);
    expect(bind).toHaveBeenCalledTimes(2);
    // The idle, already-shared session was never loaded for startup.
    expect(find.mock.calls.map(([id]) => id)).not.toContain("bound");
    // Legacy rows are still shared with the desktop app; running turns are interrupted.
    expect((await store.session("local")).desktop).toBeDefined();
    expect((await store.session("running")).status).toBe("interrupted");
    expect((await store.session("shell")).session.blocks[0].shell?.running).toBeFalsy();
    // The columns follow the rewrites.
    const states = Object.fromEntries(
      (await store.startupStates()).map((state) => [state.id, state]),
    );
    expect(states.local.hasDesktop).toBe(true);
    expect(states.running.running).toBe(false);
    expect(states.shell.shellRunning).toBe(false);
  });
  it("starts up with the same effects while inspecting legacy rows with missing ownership summaries", async () => {
    const directory = open();
    const path = join(directory, "host.db");
    await legacy(path);
    const store = new HostStore(path);
    cleanups.push(async () => await store.close());
    const find = vi.spyOn(store, "session");
    const bind = vi.fn();
    const engine = new HostEngine(store, {
      codex: {
        send: vi.fn(),
        stop: async () => {},
        cancel: async () => {},
        bind,
        approve: () => {},
        answer: () => {},
      },
    });
    await engine.ready;
    cleanups.push(async () => await engine.close());
    expect(find.mock.calls.map(([id]) => id)).toContain("bound");
    expect(bind).toHaveBeenCalledWith("bound", "prov-1", "/work");
    expect(bind).toHaveBeenCalledTimes(2);
    expect((await store.session("running")).status).toBe("interrupted");
  });
});
