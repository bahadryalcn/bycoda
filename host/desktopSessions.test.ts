import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createHostServer } from "./server";
import { DesktopSessions, desktopDatabasePaths, normalizeProjectPath } from "./desktopSessions";
import { DesktopLive } from "./desktopLive";
import { verifyRemoteProjectAlias } from "../src/features/connections/model/remoteProjects";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

type Seed = {
  id: string;
  cwd: string;
  harness?: string;
  updated?: number;
  draft?: number;
  user?: number;
  worktree?: string;
};

async function setup() {
  const clock = { now: 1_000_000 };
  const directory = mkdtempSync(join(tmpdir(), "bycoda-desktop-test-"));
  const projectDir = join(directory, "project");
  mkdirSync(projectDir);
  const dbPath = join(directory, "bycoda.db");
  const desktopDb = new DatabaseSync(dbPath);
  desktopDb.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, harness TEXT NOT NULL, model TEXT, model_settings TEXT, runtime_mode TEXT, title TEXT, provider_session_id TEXT, blocks_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER, branch TEXT, archived INTEGER DEFAULT 0, worktree_cwd TEXT, has_user_message INTEGER DEFAULT 1, pinned INTEGER DEFAULT 0, linked_work_item_json TEXT, provider_account_id TEXT, is_draft INTEGER DEFAULT 0);
    CREATE TABLE in_flight_sessions (session_id TEXT PRIMARY KEY, cwd TEXT NOT NULL, sort_index INTEGER NOT NULL);`);
  const seed = (s: Seed) =>
    desktopDb
      .prepare(
        "INSERT INTO sessions (id, cwd, harness, model, model_settings, runtime_mode, title, provider_session_id, blocks_json, created_at, updated_at, is_draft, has_user_message, worktree_cwd) VALUES (?, ?, ?, 'codex:test', '{}', 'supervised', ?, ?, ?, 1, ?, ?, ?, ?)",
      )
      .run(
        s.id,
        s.cwd,
        s.harness ?? "codex",
        `Title ${s.id}`,
        `prov-${s.id}`,
        JSON.stringify([{ id: "b1", role: "user", text: "hi" }]),
        s.updated ?? 100,
        s.draft ?? 0,
        s.user ?? 1,
        s.worktree ?? null,
      );
  const store = new HostStore(join(directory, "host.db"));
  const bind = vi.fn();
  let finish = () => {};
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const engine = new HostEngine(store, {
    codex: {
      send,
      stop: async () => finish(),
      cancel: async () => finish(),
      bind,
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(projectDir);
  const server = createHostServer(
    engine,
    ["codex"],
    undefined,
    undefined,
    undefined,
    new DesktopSessions(() => [dbPath], process.platform, new DesktopLive(() => clock.now)),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const device = store.issueDevice("Laptop");
  const call = async (method: string, params: unknown = {}) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    return (await response.json()) as { result?: any; error?: string };
  };
  cleanups.push(async () => {
    finish();
    await engine.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    desktopDb.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { dbPath, desktopDb, seed, store, engine, project, call, bind, send, projectDir, clock };
}

describe("desktop sessions on the host", () => {
  it("verifies legacy project aliases when listing and reading a running desktop session", async () => {
    const s = await setup();
    const cwd = s.project.cwd.replace(/\\/g, "/") + "/";
    s.store.db
      .prepare("INSERT INTO projects VALUES (?, ?, ?)")
      .run("legacy-alias", cwd, s.project.name);
    s.seed({ id: "running-alias", cwd: s.project.cwd });
    s.desktopDb
      .prepare("INSERT INTO in_flight_sessions VALUES (?, ?, 0)")
      .run("running-alias", s.project.cwd);
    const list = (await s.call("sessions.list", { projectId: "legacy-alias" })).result;
    expect(list).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "running-alias", status: "running" })]),
    );
    const sync = (await s.call("sessions.sync", { sessionId: "running-alias" })).result;
    expect(sync.value.projectId).toBe(s.project.id);
    expect(sync.value.status).toBe("running");
    await verifyRemoteProjectAlias(
      async (method, params) => {
        const response = await s.call(method, params);
        if (response.error) throw new Error(response.error);
        return response.result;
      },
      {
        key: "remote://test/project",
        environmentId: s.store.environmentId,
        projectId: "legacy-alias",
        cwd,
      },
      sync.value.projectId,
    );
    expect((await s.call("projects.open", { cwd })).result.id).toBe(s.project.id);
    expect(s.store.projects()).toHaveLength(2);
    expect((await s.call("sessions.list", { projectId: "legacy-alias" })).result).toHaveLength(1);
  });

  it("lists only matching, started, supported desktop sessions", async () => {
    const s = await setup();
    s.seed({ id: "ok", cwd: s.project.cwd, updated: 200 });
    s.seed({ id: "draft", cwd: s.project.cwd, draft: 1 });
    s.seed({ id: "empty", cwd: s.project.cwd, user: 0 });
    s.seed({ id: "other", cwd: join(s.projectDir, "..", "elsewhere") });
    s.seed({ id: "claude", cwd: s.project.cwd, harness: "claude" });
    s.desktopDb.prepare("INSERT INTO in_flight_sessions VALUES ('ok', ?, 0)").run(s.project.cwd);
    const list = (await s.call("sessions.list", { projectId: s.project.id })).result;
    expect(list.map((x: any) => x.id)).toEqual(["ok"]);
    expect(list[0]).toMatchObject({
      origin: "desktop",
      status: "running",
      providerSessionId: "prov-ok",
      revision: 200,
    });
  });

  it("syncs a desktop snapshot", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd, worktree: join(s.projectDir, "wt") });
    const sync = (await s.call("sessions.sync", { projectId: s.project.id, sessionId: "a" }))
      .result;
    expect(sync.kind).toBe("snapshot");
    expect(sync.value).toMatchObject({ projectId: s.project.id, revision: 100, status: "idle" });
    expect(sync.value.session).toMatchObject({
      id: "a",
      cwd: join(s.projectDir, "wt"),
      providerSessionId: "prov-a",
    });
  });

  it("adopts on send, binds the provider and prefers the host copy", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    const sent = await s.call("commands.dispatch", {
      type: "send",
      commandId: "c1",
      sessionId: "a",
      text: "go",
    });
    expect(sent.error).toBeUndefined();
    expect(s.store.session("a").projectId).toBe(s.project.id);
    expect(s.bind).toHaveBeenCalledWith("a", "prov-a", s.project.cwd, undefined);
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
    const list = (await s.call("sessions.list", { projectId: s.project.id })).result;
    expect(list.map((x: any) => x.id)).toEqual(["a"]);
    expect(list[0].origin).toBeUndefined();
  });

  it("updates by adopting first and protects unavailable desktop deletion and in-flight sessions", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    s.seed({ id: "b", cwd: s.project.cwd });
    s.desktopDb.prepare("INSERT INTO in_flight_sessions VALUES ('b', ?, 0)").run(s.project.cwd);
    const deleted = await s.call("sessions.delete", { projectId: s.project.id, sessionId: "a" });
    expect(deleted.error).toMatch(/Open the updated bycoda app/);
    const watched = (await s.call("sessions.sync", { sessionId: "b" })).result;
    expect(watched.value).toMatchObject({ status: "running", session: { busy: true } });
    const idle = (await s.call("sessions.sync", { sessionId: "a" })).result;
    expect(idle.value.session.busy).toBeUndefined();
    const busy = await s.call("commands.dispatch", {
      type: "send",
      commandId: "c2",
      sessionId: "b",
      text: "go",
    });
    expect(busy.error).toMatch(/Wait for it to finish/);
    expect(() => s.store.session("b")).toThrow();
    const updated = await s.call("sessions.update", {
      projectId: s.project.id,
      sessionId: "a",
      pinned: true,
    });
    expect(updated.error).toBeUndefined();
    expect(s.store.session("a").pinned).toBe(true);
  });

  it("deletes desktop and adopted history only after the owner app confirms", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    s.engine.adoptSession((await s.call("sessions.sync", { sessionId: "a" })).result.value);
    const beat = (replies: unknown[] = []) =>
      s.call("sessions.desktopLive", {
        clientId: "desktop",
        sessions: [],
        deletions: { version: 1, replies },
      });
    await beat();
    const deleting = s.call("sessions.delete", {
      projectId: s.project.id,
      sessionId: "a",
    });
    let jobs: any[] = [];
    await vi.waitFor(async () => {
      jobs = (await beat()).result.deletions.jobs;
      expect(jobs).toHaveLength(1);
    });
    expect(jobs[0]).toMatchObject({ sessionId: "a", cwd: s.project.cwd });
    expect(s.store.session("a")).toBeDefined();
    s.desktopDb.prepare("DELETE FROM sessions WHERE id='a'").run();
    await beat([{ id: jobs[0].id }]);
    expect((await deleting).result).toEqual({ deleted: true });
    expect(() => s.store.session("a")).toThrow();
    expect((await s.call("sessions.list", { projectId: s.project.id })).result).toEqual([]);
  });

  it("rejects desktop deletion for the wrong project or a running session", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    expect((await s.call("sessions.delete", { projectId: "wrong", sessionId: "a" })).error).toMatch(
      /does not belong/,
    );
    s.desktopDb.prepare("INSERT INTO in_flight_sessions VALUES ('a', ?, 0)").run(s.project.cwd);
    expect(
      (
        await s.call("sessions.delete", {
          projectId: s.project.id,
          sessionId: "a",
        })
      ).error,
    ).toMatch(/Stop this session/);
    expect(s.desktopDb.prepare("SELECT id FROM sessions WHERE id='a'").get()).toBeDefined();
  });

  it("keeps adopted history when desktop deletion fails", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    s.engine.adoptSession((await s.call("sessions.sync", { sessionId: "a" })).result.value);
    const beat = (replies: unknown[] = []) =>
      s.call("sessions.desktopLive", {
        clientId: "desktop",
        sessions: [],
        deletions: { version: 1, replies },
      });
    await beat();
    const deleting = s.call("sessions.delete", {
      projectId: s.project.id,
      sessionId: "a",
    });
    let jobs: any[] = [];
    await vi.waitFor(async () => {
      jobs = (await beat()).result.deletions.jobs;
      expect(jobs).toHaveLength(1);
    });
    await beat([{ id: jobs[0].id, error: "Stop this session before deleting it" }]);
    expect((await deleting).error).toMatch(/Stop this session/);
    expect(s.store.session("a")).toBeDefined();
    expect(s.desktopDb.prepare("SELECT id FROM sessions WHERE id='a'").get()).toBeDefined();
  });

  it("lists adopted sessions and catches up with later desktop turns", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd, updated: 100 });
    s.engine.adoptSession((await s.call("sessions.sync", { sessionId: "a" })).result.value);
    const adopted = (await s.call("sessions.adopted")).result;
    expect(adopted).toMatchObject([{ id: "a", projectId: s.project.id, status: "idle" }]);
    expect(s.store.session("a").desktop).toEqual({ updatedAt: 100, revision: 100 });

    // The desktop app on this machine ran another turn in the same session.
    const blocks = [
      { id: "b1", role: "user", text: "hi" },
      { id: "b2", role: "assistant", text: "done locally" },
    ];
    s.desktopDb
      .prepare(
        "UPDATE sessions SET blocks_json=?, updated_at=300, provider_session_id='prov-a2' WHERE id='a'",
      )
      .run(JSON.stringify(blocks));
    const sync = (await s.call("sessions.sync", { sessionId: "a" })).result;
    expect(sync.kind).toBe("snapshot");
    expect(sync.value.session.blocks).toEqual(blocks);
    expect(sync.value.desktop).toEqual({ updatedAt: 300, revision: sync.value.revision });
    expect(s.bind).toHaveBeenLastCalledWith("a", "prov-a2", s.project.cwd, undefined);
    const revision = sync.value.revision;

    // Seen once: polling again doesn't bump the revision.
    const again = (await s.call("sessions.sync", { sessionId: "a", revision })).result;
    expect(again.kind).toBe("unchanged");

    // A desktop turn in progress blocks sending from here.
    s.desktopDb.prepare("INSERT INTO in_flight_sessions VALUES ('a', ?, 0)").run(s.project.cwd);
    s.desktopDb.prepare("UPDATE sessions SET updated_at=400 WHERE id='a'").run();
    const busy = await s.call("commands.dispatch", {
      type: "send",
      commandId: "c3",
      sessionId: "a",
      text: "go",
    });
    expect(busy.error).toMatch(/Wait for it to finish/);
    expect(s.send).not.toHaveBeenCalled();
  });

  it("follows the app's heartbeat: running, live prompts, remote control", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd, updated: 100 });
    // A crashed app's in-flight mark counts only until a heartbeat arrives.
    s.desktopDb.prepare("INSERT INTO in_flight_sessions VALUES ('a', ?, 0)").run(s.project.cwd);
    const approval = {
      id: "ap1",
      role: "approval",
      text: "Run tests?",
      approval: { requestId: 7 },
    };
    const question = { requestId: 9, questions: [] };
    const beat = (body: unknown) => s.call("sessions.desktopLive", body);
    expect(
      (
        await beat({
          sessions: [
            { id: "a", busy: true, pending: [approval], patch: { pendingQuestion: question } },
          ],
        })
      ).result,
    ).toMatchObject({ commands: [], inbox: { jobs: [], acked: [] } });

    const first = (await s.call("sessions.sync", { sessionId: "a" })).result;
    expect(first.kind).toBe("snapshot");
    expect(first.value).toMatchObject({ status: "running", runId: "desktop" });
    expect(first.value.session).toMatchObject({ busy: true, pendingQuestion: question });
    expect(first.value.session.blocks.map((b: any) => b.id)).toEqual(["b1", "ap1"]);
    expect((await s.call("sessions.list", { projectId: s.project.id })).result[0].status).toBe(
      "running",
    );

    // Stop and approve from here wait for the app; it acks them.
    for (const command of [
      {
        type: "approve",
        commandId: "k1",
        sessionId: "a",
        runId: "desktop",
        requestId: 7,
        decision: "allow",
      },
      { type: "cancel", commandId: "k2", sessionId: "a", runId: "desktop" },
    ])
      expect((await s.call("commands.dispatch", command)).error).toBeUndefined();
    const queued = (await beat({ sessions: [{ id: "a", busy: true }] })).result.commands;
    expect(queued).toMatchObject([
      { sessionId: "a", type: "approve", requestId: 7, decision: "allow" },
      { sessionId: "a", type: "cancel" },
    ]);
    expect(s.send).not.toHaveBeenCalled();
    expect(
      (await beat({ sessions: [{ id: "a", busy: true }], acked: queued.map((c: any) => c.id) }))
        .result,
    ).toMatchObject({ commands: [] });

    // The prompt is gone: only that changed, so only a delta goes out.
    const second = (
      await s.call("sessions.sync", { sessionId: "a", revision: first.value.revision })
    ).result;
    expect(second.kind).toBe("delta");
    expect(second.blockIds).toEqual(["b1"]);
    expect(second.blocks).toEqual([]);
    const third = (
      await s.call("sessions.sync", { sessionId: "a", revision: second.value.revision })
    ).result;
    expect(third.kind).toBe("unchanged");

    // No heartbeat for a while: the app is gone, nothing is running.
    s.clock.now += 60_000;
    const stale = (await s.call("sessions.sync", { sessionId: "a" })).result;
    expect(stale.value.status).toBe("idle");
    expect(stale.value.session.busy).toBeUndefined();
    const refused = await s.call("commands.dispatch", {
      type: "cancel",
      commandId: "k3",
      sessionId: "a",
      runId: "desktop",
    });
    expect(refused.error).toBeDefined();
  });

  it("lists a session once when the same database is configured twice", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd, updated: 100 });
    const desktop = new DesktopSessions(
      () => [s.dbPath, s.dbPath],
      process.platform,
      new DesktopLive(),
    );
    expect(desktop.list(s.project.cwd, s.project.id, ["codex"])).toHaveLength(1);
    desktop.close();
  });

  it("reads the owning app's copy, not a newer mirror kept by a second app", async () => {
    const s = await setup();
    // The release app started the session and holds the full transcript.
    s.seed({ id: "a", cwd: s.project.cwd, updated: 100 });
    const owner = [
      { id: "b1", role: "user", text: "hi" },
      { id: "t1", role: "tool", text: "Agent", tool: { callId: "c", status: "completed" } },
    ];
    s.desktopDb
      .prepare("UPDATE sessions SET blocks_json=?, created_at=1 WHERE id='a'")
      .run(JSON.stringify(owner));
    // A development app mirrored an earlier state and saved it later.
    const mirrorPath = join(s.projectDir, "..", "dev.db");
    const mirror = new DatabaseSync(mirrorPath);
    mirror.exec(`CREATE TABLE in_flight_sessions (session_id TEXT PRIMARY KEY, cwd TEXT NOT NULL, sort_index INTEGER NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, harness TEXT NOT NULL, model TEXT, model_settings TEXT, runtime_mode TEXT, title TEXT, provider_session_id TEXT, blocks_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER, branch TEXT, archived INTEGER DEFAULT 0, worktree_cwd TEXT, has_user_message INTEGER DEFAULT 1, pinned INTEGER DEFAULT 0, linked_work_item_json TEXT, provider_account_id TEXT, is_draft INTEGER DEFAULT 0)`);
    mirror
      .prepare(
        "INSERT INTO sessions (id, cwd, harness, model, model_settings, runtime_mode, title, provider_session_id, blocks_json, created_at, updated_at) VALUES ('a', ?, 'codex', 'codex:test', '{}', 'supervised', 'Title a', 'prov-a', ?, 50, 900)",
      )
      .run(
        s.project.cwd,
        JSON.stringify([
          { id: "b1", role: "user", text: "hi" },
          { id: "t1", role: "tool", text: "Agent" },
        ]),
      );
    const desktop = new DesktopSessions(
      () => [s.dbPath, mirrorPath],
      process.platform,
      new DesktopLive(),
    );
    cleanups.unshift(async () => {
      desktop.close();
      mirror.close();
    });
    expect(desktop.stamp("a")).toEqual({ updatedAt: 100, running: false });
    expect(desktop.snapshot("a", s.project.id)?.session.blocks).toEqual(owner);
    expect(desktop.list(s.project.cwd, s.project.id, ["codex"])[0].revision).toBe(100);
    // A turn running in either app still blocks another writer.
    mirror.prepare("INSERT INTO in_flight_sessions VALUES ('a', ?, 0)").run(s.project.cwd);
    expect(desktop.stamp("a")).toEqual({ updatedAt: 100, running: true });
    expect(desktop.list(s.project.cwd, s.project.id, ["codex"])[0].status).toBe("running");
  });

  it("reuses one read-only connection across calls and releases it on close", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd, updated: 100 });
    const desktop = new DesktopSessions(() => [s.dbPath], process.platform, new DesktopLive());
    cleanups.unshift(async () => desktop.close());
    expect(desktop.stamp("a")?.updatedAt).toBe(100);
    s.desktopDb.prepare("UPDATE sessions SET updated_at=250 WHERE id='a'").run();
    // Data written by the desktop meanwhile is visible through the same handle.
    expect(desktop.stamp("a")?.updatedAt).toBe(250);
    desktop.list(s.project.cwd, s.project.id, ["codex"]);
    desktop.snapshot("a", s.project.id);
    expect(desktop.opened).toBe(1);
    desktop.close();
    desktop.stamp("a");
    expect(desktop.opened).toBe(2);
    desktop.close();
  });

  it("checks queue metadata without parsing a large transcript and still excludes drafts", async () => {
    const s = await setup();
    s.seed({ id: "large", cwd: s.project.cwd });
    s.seed({ id: "draft", cwd: s.project.cwd, draft: 1 });
    const blocks = JSON.stringify([{ id: "user", role: "user", text: "x".repeat(1_000_000) }]);
    s.desktopDb.prepare("UPDATE sessions SET blocks_json=? WHERE id='large'").run(blocks);
    const desktop = new DesktopSessions(() => [s.dbPath], process.platform, new DesktopLive());
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(desktop.metadata("large")).toEqual({
        cwd: s.project.cwd,
        harness: "codex",
        running: false,
      });
      expect(desktop.metadata("draft")).toBeUndefined();
      expect(desktop.metadata("missing")).toBeUndefined();
      expect(parse.mock.calls.some(([value]) => value === blocks)).toBe(false);
    } finally {
      parse.mockRestore();
      desktop.close();
    }
  });

  it("reuses a database stamp read for a short while", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd, updated: 100 });
    const desktop = new DesktopSessions(() => [s.dbPath], process.platform, new DesktopLive());
    cleanups.unshift(async () => desktop.close());
    expect(desktop.stamp("a", 60_000)?.updatedAt).toBe(100);
    s.desktopDb.prepare("UPDATE sessions SET updated_at=250 WHERE id='a'").run();
    expect(desktop.stamp("a", 60_000)?.updatedAt).toBe(100);
    // Callers that do not opt in always see the database's current state.
    expect(desktop.stamp("a")?.updatedAt).toBe(250);
    desktop.close();
  });

  it("drops an idle connection so the desktop can replace the file", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    const desktop = new DesktopSessions(() => [s.dbPath], process.platform, new DesktopLive(), 20);
    cleanups.unshift(async () => desktop.close());
    desktop.stamp("a");
    await new Promise((resolve) => setTimeout(resolve, 150));
    desktop.stamp("a");
    expect(desktop.opened).toBe(2);
    desktop.close();
  });

  it.skipIf(process.platform === "win32")(
    "reopens after the database file is replaced",
    async () => {
      const s = await setup();
      s.seed({ id: "a", cwd: s.project.cwd, updated: 100 });
      const desktop = new DesktopSessions(() => [s.dbPath], process.platform, new DesktopLive());
      cleanups.unshift(async () => desktop.close());
      expect(desktop.stamp("a")?.updatedAt).toBe(100);
      const next = join(s.projectDir, "..", "replacement.db");
      const replacement = new DatabaseSync(next);
      replacement.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, harness TEXT NOT NULL, blocks_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER);
      INSERT INTO sessions VALUES ('a', 'x', 'codex', '[]', 1, 777);`);
      replacement.close();
      renameSync(next, s.dbPath);
      expect(desktop.stamp("a")?.updatedAt).toBe(777);
      expect(desktop.opened).toBe(2);
      desktop.close();
    },
  );

  it("re-reads the schema when a newer desktop migrates it", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    const desktop = new DesktopSessions(() => [s.dbPath], process.platform, new DesktopLive());
    cleanups.unshift(async () => desktop.close());
    expect(desktop.snapshot("a", s.project.id)).toBeDefined();
    // inbox_ask hides a row; the cached column list must learn the new column.
    s.desktopDb.exec(
      "ALTER TABLE sessions ADD COLUMN inbox_ask TEXT; UPDATE sessions SET inbox_ask='x'",
    );
    expect(desktop.snapshot("a", s.project.id)).toBeUndefined();
    expect(desktop.opened).toBe(1);
    desktop.close();
  });

  it("projectCwd returns the project folder, not the worktree, and skips unlisted rows", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd, worktree: join(s.projectDir, "wt") });
    s.seed({ id: "draft", cwd: s.project.cwd, draft: 1 });
    const desktop = new DesktopSessions(() => [s.dbPath], process.platform, new DesktopLive());
    cleanups.unshift(async () => desktop.close());
    expect(desktop.projectCwd("a")).toBe(s.project.cwd);
    expect(desktop.projectCwd("draft")).toBeUndefined();
    expect(desktop.projectCwd("missing")).toBeUndefined();
    desktop.close();
  });
});

describe("DesktopSessions project filter", () => {
  function database(rows: Array<[string, string, string, string | null]>) {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-desktop-filter-"));
    const dbPath = join(directory, "bycoda.db");
    const db = new DatabaseSync(dbPath);
    db.exec(
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, harness TEXT NOT NULL, model TEXT, model_settings TEXT, runtime_mode TEXT, title TEXT, provider_session_id TEXT, blocks_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER, worktree_cwd TEXT, has_user_message INTEGER DEFAULT 1, is_draft INTEGER DEFAULT 0);`,
    );
    const insert = db.prepare(
      "INSERT INTO sessions (id, cwd, harness, title, blocks_json, created_at, updated_at, worktree_cwd) VALUES (?, ?, ?, 't', '[]', 1, 10, ?)",
    );
    for (const row of rows) insert.run(...row);
    db.close();
    cleanups.push(async () => rmSync(directory, { recursive: true, force: true }));
    return dbPath;
  }

  // The reference: every row through the per-row JS predicate the SQL replaced.
  const reference = (
    rows: Array<[string, string, string, string | null]>,
    platform: NodeJS.Platform,
    project: string,
    providers: string[],
  ) =>
    rows
      .filter(
        ([, cwd, harness]) =>
          providers.includes(harness) &&
          normalizeProjectPath(cwd, platform) === normalizeProjectPath(project, platform),
      )
      .map(([id]) => id)
      .sort();

  it("returns the same sessions as the JS predicate for worktree and case variants", () => {
    const rows: Array<[string, string, string, string | null]> = [
      ["exact", "C:\\Work\\Proj", "codex", null],
      ["case", "c:/WORK/proj/", "codex", null],
      ["worktree", "C:/Work/Proj", "codex", "C:/Work/Proj-wt/feature"],
      ["in-worktree-cwd", "C:/Work/Proj-wt/feature", "codex", null],
      ["other", "C:/Work/Other", "codex", null],
      ["wrong-harness", "C:/Work/Proj", "grok", null],
    ];
    for (const platform of ["win32", "linux"] as const) {
      const desktop = new DesktopSessions(() => [database(rows)], platform);
      cleanups.push(async () => desktop.close());
      const got = desktop
        .list("C:/Work/Proj", "p", ["codex"])
        .map((s) => s.id)
        .sort();
      expect(got).toEqual(reference(rows, platform, "C:/Work/Proj", ["codex"]));
      desktop.close();
    }
    const desktop = new DesktopSessions(() => [database(rows)], "win32");
    cleanups.push(async () => desktop.close());
    expect(
      desktop
        .list("C:/Work/Proj", "p", ["codex"])
        .map((s) => s.id)
        .sort(),
    ).toEqual(["case", "exact", "worktree"]);
    expect(desktop.list("C:/Work/Proj", "p", [])).toEqual([]);
    desktop.close();
  });
});

describe("finding the desktop app's session database", () => {
  it("reads the identifiers and database file the desktop app actually uses", () => {
    const identifiers = ["tauri.fork.conf.json", "tauri.conf.json"].map(
      (file) => JSON.parse(readFileSync(join("src-tauri", file), "utf8")).identifier as string,
    );
    const store = readFileSync("src-tauri/src/session_store.rs", "utf8");
    const database = /data_dir\(\)\?\.join\("([^"]+)"\)/.exec(store)?.[1];
    expect(database).toBeTruthy();
    for (const [platform, base] of [
      ["win32", ["AppData", "Roaming"]],
      ["darwin", ["Library", "Application Support"]],
      ["linux", [".local", "share"]],
    ] as const) {
      const home = mkdtempSync(join(tmpdir(), "bycoda-desktop-db-"));
      try {
        for (const identifier of identifiers) {
          mkdirSync(join(home, ...base, identifier), { recursive: true });
          writeFileSync(join(home, ...base, identifier, database!), "");
        }
        const found = desktopDatabasePaths({}, platform, home);
        expect(found.sort(), platform).toEqual(
          identifiers.map((identifier) => join(home, ...base, identifier, database!)).sort(),
        );
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
  });
});
