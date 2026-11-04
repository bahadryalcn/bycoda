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
import { blockDigest, conversationHead } from "../src/features/sync/model/conversationDigest";
import type { Block } from "../src/features/sessions/model/session";
import { SessionSyncSchema } from "../src/shared/model/host-contracts/session-reads";

// The Host answers these over real HTTP and SQLite; busy Windows CI runners need
// more than the 1 s default, while staying under DESKTOP_WRITER_TRANSFER_MS (12 s).
const WAIT_FOR_DESKTOP_JOB = { timeout: 10_000 };

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
  let signalProviderStarted!: () => void;
  const providerStarted = new Promise<void>((resolve) => {
    signalProviderStarted = resolve;
  });
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        signalProviderStarted();
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
  const server = await createHostServer(
    engine,
    ["codex"],
    undefined,
    undefined,
    undefined,
    new DesktopSessions(() => [dbPath], process.platform, new DesktopLive(() => clock.now)),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const device = await store.issueDevice("Laptop");
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
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    desktopDb.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    dbPath,
    desktopDb,
    seed,
    store,
    engine,
    project,
    call,
    bind,
    send,
    projectDir,
    clock,
    providerStarted,
  };
}

describe("desktop sessions on the host", () => {
  it.each([
    { partial: false, digests: false },
    { partial: false, digests: true },
    { partial: true, digests: false },
    { partial: true, digests: true },
  ])("keeps normalized desktop revisions out of wire deltas ($partial, $digests)", async ({ partial, digests }) => {
    const s = await setup();
    s.seed({ id: "normalized-delta", cwd: s.projectDir, updated: 100 });
    const blocks = [
      { id: "b1", role: "user", text: "hi" },
      { id: "b2", role: "assistant", text: "working" },
    ];
    s.desktopDb.exec(`
      CREATE TABLE session_block_state(session_id TEXT PRIMARY KEY, revision INTEGER, length INTEGER);
      CREATE TABLE session_blocks(session_id TEXT, block_id TEXT, ordinal INTEGER, revision INTEGER, block_json TEXT);
      CREATE VIEW session_transcripts AS SELECT * FROM sessions;
      INSERT INTO session_block_state VALUES ('normalized-delta', 1, 2);
    `);
    for (const [ordinal, block] of blocks.entries())
      s.desktopDb.prepare("INSERT INTO session_blocks VALUES (?, ?, ?, ?, ?)")
        .run("normalized-delta", block.id, ordinal, 1, JSON.stringify(block));
    s.desktopDb.prepare("UPDATE sessions SET blocks_json=? WHERE id='normalized-delta'")
      .run(JSON.stringify(blocks));
    s.desktopDb.prepare("INSERT INTO in_flight_sessions VALUES (?, ?, 0)")
      .run("normalized-delta", s.projectDir);

    const first = await s.call("sessions.sync", { sessionId: "normalized-delta", digests });
    expect(first.error).toBeUndefined();
    expect(first.result.kind).toBe("snapshot");
    expect(first.result.value.executionOwner).toBe("desktop");
    SessionSyncSchema.parse(first.result);

    blocks[1].text = "still working";
    s.desktopDb.prepare("UPDATE sessions SET blocks_json=?, updated_at=200 WHERE id='normalized-delta'")
      .run(JSON.stringify(blocks));
    s.desktopDb.prepare("UPDATE session_blocks SET revision=2, block_json=? WHERE block_id='b2'")
      .run(JSON.stringify(blocks[1]));
    s.desktopDb.exec("UPDATE session_block_state SET revision=2 WHERE session_id='normalized-delta'");

    const next = await s.call("sessions.sync", {
      sessionId: "normalized-delta", revision: first.result.value.revision,
      partial, digests, ...(partial ? { loadedBlockIds: ["b1", "b2"] } : {}),
    });
    expect(next.error).toBeUndefined();
    expect(next.result.kind).toBe("delta");
    expect(next.result.value).not.toHaveProperty("blockRevisions");
    expect(next.result.value.executionOwner).toBe("desktop");
    expect(next.result.blocks.map((block: Block) => block.id)).toEqual(["b2"]);
    expect(next.result.blocks[0].text).toBe("still working");
    SessionSyncSchema.parse(next.result);
    expect((await s.call("sessions.sync", {
      sessionId: "normalized-delta", revision: next.result.value.revision,
    })).result).toEqual({ kind: "unchanged", revision: next.result.value.revision });
  });

  it("uses the native list projection for activity, interruption and provider history", async () => {
    const s = await setup();
    s.seed({ id: "projection", cwd: s.projectDir, updated: 200 });
    s.desktopDb.exec(`CREATE TABLE session_list_summaries (
      session_id TEXT PRIMARY KEY, interrupted INTEGER NOT NULL, provider_history TEXT NOT NULL,
      activity_at INTEGER NOT NULL, management_json TEXT
    )`);
    const history = { providers: ["claude"], activeHarness: "claude" };
    s.desktopDb
      .prepare("INSERT INTO session_list_summaries VALUES (?, ?, ?, ?, ?)")
      .run("projection", 1, JSON.stringify(history), 123, null);
    const desktop = new DesktopSessions(() => [s.dbPath]);
    const prepared = vi.spyOn(DatabaseSync.prototype, "prepare");
    try {
      const row = desktop.list(s.projectDir, s.project.id, ["codex"])[0];
      expect(row.status).toBe("interrupted");
      expect(row.lastActivityAt).toBe(123);
      expect(row.providerHistory).toEqual(history);
      expect(
        prepared.mock.calls.some(([sql]) =>
          /json_each|SELECT block_json FROM session_blocks/i.test(sql),
        ),
      ).toBe(false);
      const oneRowCalls = prepared.mock.calls.length;
      desktop.close();
      for (let index = 0; index < 10; index++) {
        const id = `projection-${index}`;
        s.seed({ id, cwd: s.projectDir });
        s.desktopDb
          .prepare("INSERT INTO session_list_summaries VALUES (?, ?, ?, ?, ?)")
          .run(id, 0, JSON.stringify(history), 123, null);
      }
      prepared.mockClear();
      const many = new DesktopSessions(() => [s.dbPath]);
      try {
        expect(many.list(s.projectDir, s.project.id, ["codex"])).toHaveLength(11);
        expect(prepared.mock.calls.length).toBe(oneRowCalls);
      } finally {
        many.close();
      }
    } finally {
      prepared.mockRestore();
      desktop.close();
    }
  });

  it("keeps rows readable while native projection backfill is incomplete", async () => {
    const s = await setup();
    s.seed({ id: "missing", cwd: s.projectDir, updated: 200 });
    s.desktopDb.exec(`CREATE TABLE session_list_summaries (
      session_id TEXT PRIMARY KEY, interrupted INTEGER NOT NULL, provider_history TEXT NOT NULL,
      activity_at INTEGER NOT NULL, management_json TEXT
    )`);
    const desktop = new DesktopSessions(() => [s.dbPath]);
    try {
      const row = desktop.list(s.projectDir, s.project.id, ["codex"])[0];
      expect(row.id).toBe("missing");
      expect(row.providerHistory?.activeHarness).toBe("codex");
      expect(row.lastActivityAt).toBe(200);
    } finally {
      desktop.close();
    }
  });

  it.each(["legacy", "normalized"] as const)(
    "distinguishes owner stops from interruptions in %s desktop history",
    async (storage) => {
      const s = await setup();
      s.seed({ id: "stopped", cwd: s.projectDir });
      if (storage === "normalized") {
        s.desktopDb
          .exec(`CREATE TABLE session_block_state(session_id TEXT PRIMARY KEY, revision INTEGER, length INTEGER);
          CREATE TABLE session_blocks(session_id TEXT, ordinal INTEGER, block_json TEXT);
          CREATE INDEX session_blocks_roles ON session_blocks(session_id,json_extract(block_json,'$.role'),json_extract(block_json,'$.draft'));
          INSERT INTO session_block_state VALUES ('stopped',1,2);`);
      }
      const desktop = new DesktopSessions(() => [s.dbPath]);
      try {
        for (const [notice, text, status, previousStop] of [
          ["interrupt", "Stopped by you.", "idle"],
          ["interrupt", "  Stopped by you.\n", "idle"],
          ["info", "Stopped by you.", "idle"],
          ["interrupt", "Host restarted while this turn was running.", "interrupted"],
          ["interrupt", "Connection lost.", "interrupted"],
          [undefined, "Turn interrupted when bycoda quit.", "interrupted"],
          [undefined, "Turn interrupted when Bycoda quit.", "interrupted"],
          ["interrupt", "Turn interrupted when bycoda quit.", "idle", true],
          [undefined, "Turn interrupted when Bycoda quit.", "idle", true],
          ["interrupt", "Host restarted while this turn was running.", "interrupted", true],
        ] as const) {
          const blocks = [
            { id: "u", role: "user", text: "hello" },
            ...(previousStop
              ? [{ id: "owner-stop", role: "system", notice: "interrupt", text: "Stopped by you." }]
              : []),
            { id: "stop", role: "system", notice, text },
          ];
          if (storage === "normalized") {
            s.desktopDb.exec("DELETE FROM session_blocks WHERE session_id='stopped'");
            s.desktopDb
              .prepare("UPDATE session_block_state SET length=? WHERE session_id='stopped'")
              .run(blocks.length);
            for (const [ordinal, block] of blocks.entries()) {
              s.desktopDb
                .prepare("INSERT INTO session_blocks VALUES ('stopped',?,?)")
                .run(ordinal, JSON.stringify(block));
            }
          } else {
            s.desktopDb
              .prepare("UPDATE sessions SET blocks_json=? WHERE id='stopped'")
              .run(JSON.stringify(blocks));
          }
          expect(desktop.list(s.projectDir, s.project.id, ["codex"])[0].status, text).toBe(status);
        }
      } finally {
        desktop.close();
      }
    },
  );
  it("uses authoritative empty normalized history and falls back for legacy sentinel state", async () => {
    const s = await setup();
    s.seed({ id: "tail-authority", cwd: s.projectDir });
    s.desktopDb
      .exec(`CREATE TABLE session_block_state(session_id TEXT PRIMARY KEY, revision INTEGER, length INTEGER);
      CREATE TABLE session_blocks(session_id TEXT, ordinal INTEGER, block_json TEXT);
      CREATE INDEX session_blocks_roles ON session_blocks(session_id,json_extract(block_json,'$.role'),json_extract(block_json,'$.draft'));
      INSERT INTO session_block_state VALUES ('tail-authority',1,0);`);
    const stop = { id: "stop", role: "system", notice: "interrupt", text: "Stopped by you." };
    const quit = {
      id: "quit",
      role: "system",
      notice: "interrupt",
      text: "Turn interrupted when bycoda quit.",
    };
    s.desktopDb
      .prepare("UPDATE sessions SET blocks_json=? WHERE id='tail-authority'")
      .run(JSON.stringify([quit]));
    const desktop = new DesktopSessions(() => [s.dbPath]);
    try {
      // A normalized zero-length transcript owns its empty tail over an old blob.
      expect(desktop.list(s.projectDir, s.project.id, ["codex"])[0].status).toBe("idle");
      s.desktopDb.exec(
        "UPDATE session_block_state SET length=-1 WHERE session_id='tail-authority'",
      );
      s.desktopDb
        .prepare("INSERT INTO session_blocks VALUES ('tail-authority',0,?)")
        .run(JSON.stringify(stop));
      // Legacy sentinel invalidates normalized rows, including a stale owner Stop.
      expect(desktop.list(s.projectDir, s.project.id, ["codex"])[0].status).toBe("interrupted");
      s.desktopDb
        .prepare("UPDATE sessions SET blocks_json=? WHERE id='tail-authority'")
        .run(JSON.stringify([stop, quit]));
      s.desktopDb
        .prepare("UPDATE session_blocks SET block_json=? WHERE session_id='tail-authority'")
        .run(JSON.stringify(quit));
      expect(desktop.list(s.projectDir, s.project.id, ["codex"])[0].status).toBe("idle");
    } finally {
      desktop.close();
    }
  });
  it("projects the latest desktop interruption and its separate activity time", async () => {
    const s = await setup();
    s.seed({ id: "interrupted", cwd: s.projectDir, updated: 200 });
    s.desktopDb.exec("ALTER TABLE sessions ADD COLUMN last_activity_at INTEGER");
    const blocks = [
      { id: "u", role: "user", text: "hello" },
      { id: "i", role: "system", notice: "interrupt", text: "stopped" },
    ];
    s.desktopDb
      .prepare("UPDATE sessions SET blocks_json=?, last_activity_at=100 WHERE id='interrupted'")
      .run(JSON.stringify(blocks));
    const desktop = new DesktopSessions(() => [s.dbPath]);
    try {
      expect(desktop.list(s.projectDir, s.project.id, ["codex"])[0]).toMatchObject({
        status: "interrupted",
        updatedAt: 200,
        lastActivityAt: 100,
      });
      blocks.push({ id: "next", role: "user", text: "continue", notice: "" });
      s.desktopDb
        .prepare("UPDATE sessions SET blocks_json=?, updated_at=201 WHERE id='interrupted'")
        .run(JSON.stringify(blocks));
      expect(desktop.list(s.projectDir, s.project.id, ["codex"])[0].status).toBe("idle");
    } finally {
      desktop.close();
    }
  });
  it("lists provider history from legacy and authoritative normalized provenance", async () => {
    const s = await setup();
    s.seed({ id: "history", cwd: s.projectDir });
    const blocks = [
      {
        id: "u1",
        role: "user",
        text: "First",
        turnModel: { harness: "claude", id: "opus", name: "Opus" },
      },
      {
        id: "h",
        role: "handoff",
        text: "",
        handoff: { from: "claude", to: "codex", status: "ready" },
      },
      {
        id: "u2",
        role: "user",
        text: "Continue",
        turnModel: { harness: "codex", id: "gpt", name: "GPT" },
      },
    ];
    s.desktopDb
      .prepare("UPDATE sessions SET blocks_json=? WHERE id='history'")
      .run(JSON.stringify(blocks));
    const desktop = new DesktopSessions(() => [s.dbPath]);
    const expected = {
      providers: ["claude", "codex"],
      activeHarness: "codex",
      activeModel: "GPT",
      handedOffFrom: "claude",
    };
    try {
      expect(desktop.list(s.projectDir, s.project.id, ["codex"])[0].providerHistory).toEqual(
        expected,
      );
      s.desktopDb
        .exec(`CREATE TABLE session_block_state(session_id TEXT PRIMARY KEY, revision INTEGER, length INTEGER);
        CREATE TABLE session_blocks(session_id TEXT, ordinal INTEGER, block_json TEXT);
        CREATE INDEX session_blocks_roles ON session_blocks(session_id,json_extract(block_json,'$.role'),json_extract(block_json,'$.draft'));`);
      s.desktopDb.prepare("INSERT INTO session_block_state VALUES ('history',1,3)").run();
      blocks.forEach((block, index) =>
        s.desktopDb
          .prepare("INSERT INTO session_blocks VALUES ('history',?,?)")
          .run(index, JSON.stringify(block)),
      );
      s.desktopDb
        .prepare("UPDATE sessions SET blocks_json='[]',updated_at=updated_at+1 WHERE id='history'")
        .run();
      expect(desktop.list(s.projectDir, s.project.id, ["codex"])[0].providerHistory).toEqual(
        expected,
      );
    } finally {
      desktop.close();
    }
  });
  it.each(["job", "manual"])(
    "projects optional native %s assistant provenance into summaries and full snapshots",
    async (scope) => {
      const s = await setup();
      s.seed({ id: "managed", cwd: s.projectDir });
      const source = scope === "job" ? { jobId: "job" } : { supervisionId: "manual-grant" };
      const management = { assistant: true, ...source, managedAt: 123 };
      const author = {
        kind: scope === "job" ? "assistant" : "assistant-manual",
        name: "Owner Name",
        ...source,
        reason: "nudge",
        operationId: "operation",
      };
      s.desktopDb.exec("ALTER TABLE sessions ADD COLUMN assistant_management_json TEXT");
      s.desktopDb
        .prepare("UPDATE sessions SET assistant_management_json=?,blocks_json=? WHERE id='managed'")
        .run(
          JSON.stringify(management),
          JSON.stringify([{ id: "user", role: "user", text: "Continue", author }]),
        );
      const desktop = new DesktopSessions(() => [s.dbPath]);
      try {
        expect(desktop.list(s.projectDir, s.project.id, ["codex"])[0].managedBy).toEqual(
          management,
        );
        const snapshot = desktop.snapshot("managed", s.project.id)!;
        expect(snapshot.managedBy).toEqual(management);
        expect(snapshot.session.managedBy).toEqual(management);
        expect(snapshot.session.blocks[0].author).toEqual(author);
      } finally {
        desktop.close();
      }
    },
  );
  it("waits for desktop writer retirement before direct continuation and fences new local turns", async () => {
    const s = await setup();
    s.seed({ id: "warm", cwd: s.projectDir });
    const beat = (ids = ["warm"], acked: string[] = []) =>
      s.call("sessions.desktopLive", {
        clientId: "writer",
        sessions: [],
        writers: { version: 1, sessionIds: ids },
        acked,
      });
    await beat();
    const sending = s.call("commands.dispatch", {
      type: "send",
      commandId: "transfer-send",
      sessionId: "warm",
      text: "continue",
    });
    // A failed wait tears the server down first; keep that from becoming an unhandled rejection.
    void sending.catch(() => {});
    let job: { id: string } | undefined;
    await vi.waitFor(async () => {
      job = (await beat()).result.commands.find(
        (command: { type: string }) => command.type === "retire-writer",
      );
      expect(job).toBeDefined();
    }, WAIT_FOR_DESKTOP_JOB);
    expect(s.send).not.toHaveBeenCalled();
    expect(
      (
        await s.call("sessions.runLease", {
          sessionId: "warm",
          clientId: "desktop:new",
          action: "acquire",
        })
      ).error,
    ).toMatch(/^LEASE_HELD:/);
    await beat([], [job!.id]);
    expect((await sending).error).toBeUndefined();
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce(), WAIT_FOR_DESKTOP_JOB);
  });

  it("refuses continuation when the desktop still owns its writer and releases the transfer fence", async () => {
    const s = await setup();
    s.seed({ id: "warm", cwd: s.projectDir });
    const beat = (acked: string[] = []) =>
      s.call("sessions.desktopLive", {
        clientId: "writer",
        sessions: [],
        writers: { version: 1, sessionIds: ["warm"] },
        acked,
      });
    await beat();
    const sending = s.call("commands.dispatch", {
      type: "send",
      commandId: "failed-transfer",
      sessionId: "warm",
      text: "continue",
    });
    void sending.catch(() => {});
    let job: { id: string } | undefined;
    await vi.waitFor(async () => {
      job = (await beat()).result.commands.find(
        (command: { type: string }) => command.type === "retire-writer",
      );
      expect(job).toBeDefined();
    }, WAIT_FOR_DESKTOP_JOB);
    await beat([job!.id]);
    expect((await sending).error).toContain("still owns");
    expect(s.send).not.toHaveBeenCalled();
    expect(
      (
        await s.call("sessions.runLease", {
          sessionId: "warm",
          clientId: "desktop:new",
          action: "acquire",
        })
      ).result.lease.holder,
    ).toBe("desktop:new");
  });

  it("retires the desktop writer before the Host drains a queued continuation", async () => {
    const s = await setup();
    s.seed({ id: "warm", cwd: s.projectDir });
    // The Host queue resumes a desktop conversation previously adopted here.
    expect(
      (
        await s.call("sessions.update", {
          sessionId: "warm",
          projectId: s.project.id,
          title: "Warm",
        })
      ).error,
    ).toBeUndefined();
    const beat = (ids = ["warm"], acked: string[] = []) =>
      s.call("sessions.desktopLive", {
        clientId: "writer",
        sessions: [],
        writers: { version: 1, sessionIds: ids },
        acked,
      });
    await beat();
    const before = (
      await s.call("sessions.queue.get", {
        sessionId: "warm",
        clientId: "mobile:remote",
        leaseAware: true,
      })
    ).result;
    expect(
      (
        await s.call("sessions.queue.change", {
          sessionId: "warm",
          clientId: "mobile:remote",
          leaseAware: true,
          before,
          after: {
            ...before,
            status: "active",
            messages: [{ id: "queued", text: "queued continuation", attachments: [] }],
          },
        })
      ).error,
    ).toBeUndefined();
    let job: { id: string } | undefined;
    await vi.waitFor(async () => {
      job = (await beat()).result.commands.find(
        (command: { type: string }) => command.type === "retire-writer",
      );
      expect(job).toBeDefined();
    }, WAIT_FOR_DESKTOP_JOB);
    expect(s.send).not.toHaveBeenCalled();
    await beat([], [job!.id]);
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce(), WAIT_FOR_DESKTOP_JOB);
  });

  it("never caches an unreadable desktop database as an empty project", async () => {
    const s = await setup();
    s.seed({ id: "recovered-metadata", cwd: s.projectDir });
    const broken = join(s.projectDir, "broken-desktop.db");
    writeFileSync(broken, "not a sqlite database");
    const desktop = new DesktopSessions(() => [broken]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => desktop.listSnapshot(s.projectDir, s.project.id, ["codex"])).toThrow(
        "Desktop session metadata is temporarily unavailable",
      );
      writeFileSync(broken, readFileSync(s.dbPath));
      expect(
        desktop.listSnapshot(s.projectDir, s.project.id, ["codex"]).sessions.map((row) => row.id),
      ).toEqual(["recovered-metadata"]);
    } finally {
      desktop.close();
      errors.mockRestore();
    }
  });

  it("verifies legacy project aliases when listing and reading a running desktop session", async () => {
    const s = await setup();
    const cwd = s.project.cwd.replace(/\\/g, "/") + "/";
    await s.store.db
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
    expect(await s.store.projects()).toHaveLength(2);
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

  it("never serves an unreadable desktop transcript as an empty one", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    s.desktopDb.prepare("UPDATE sessions SET blocks_json = '[{\"id\":' WHERE id = 'a'").run();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const sync = await s.call("sessions.sync", { projectId: s.project.id, sessionId: "a" });
      expect(sync.result?.value?.session?.blocks).toBeUndefined();
      await expect((async () => await s.store.session("a"))()).rejects.toThrow("Session not found");
    } finally {
      warn.mockRestore();
    }
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
    expect((await s.store.session("a")).projectId).toBe(s.project.id);
    expect(s.bind).toHaveBeenCalledWith("a", "prov-a", s.project.cwd, undefined);
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1), { timeout: 5_000 });
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
    await expect((async () => await s.store.session("b"))()).rejects.toThrow();
    const updated = await s.call("sessions.update", {
      projectId: s.project.id,
      sessionId: "a",
      pinned: true,
    });
    expect(updated.error).toBeUndefined();
    expect((await s.store.session("a")).pinned).toBe(true);
  });

  it("deletes desktop and adopted history only after the owner app confirms", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    await s.engine.adoptSession((await s.call("sessions.sync", { sessionId: "a" })).result.value);
    const beat = async (replies: unknown[] = []) =>
      await s.call("sessions.desktopLive", {
        clientId: "desktop",
        sessions: [],
        deletions: { version: 1, replies },
      });
    await beat();
    const deleting = s.call("sessions.delete", {
      projectId: s.project.id,
      sessionId: "a",
    });
    void deleting.catch(() => {});
    let jobs: any[] = [];
    await vi.waitFor(async () => {
      jobs = (await beat()).result.deletions.jobs;
      expect(jobs).toHaveLength(1);
    }, WAIT_FOR_DESKTOP_JOB);
    expect(jobs[0]).toMatchObject({ sessionId: "a", cwd: s.project.cwd });
    expect(await s.store.session("a")).toBeDefined();
    s.desktopDb.prepare("DELETE FROM sessions WHERE id='a'").run();
    await beat([{ id: jobs[0].id }]);
    expect((await deleting).result).toEqual({ deleted: true });
    await expect((async () => await s.store.session("a"))()).rejects.toThrow();
    expect((await s.call("sessions.list", { projectId: s.project.id })).result).toEqual([]);
  });

  it("keeps desktop and Host-only sessions intact when writer retirement is unknown", async () => {
    const s = await setup();
    for (const id of ["desktop-held", "host-held"]) {
      s.seed({ id, cwd: s.project.cwd });
      await s.engine.adoptSession((await s.call("sessions.sync", { sessionId: id })).result.value);
    }
    s.desktopDb.prepare("DELETE FROM sessions WHERE id='host-held'").run();
    const retire = vi
      .spyOn(s.engine, "withRetiredProviderWriterForDeletion")
      .mockImplementation(async () => {
        throw new Error("HOST_WRITER_RETIREMENT_FAILED: unknown physical exit");
      });
    for (const id of ["desktop-held", "host-held"]) {
      const deleted = await s.call("sessions.delete", { projectId: s.project.id, sessionId: id });
      expect(deleted.error).toMatch(/HOST_WRITER_RETIREMENT_FAILED/);
      expect(await s.store.session(id)).toBeDefined();
    }
    expect(retire).toHaveBeenCalledTimes(2);
    expect(
      s.desktopDb.prepare("SELECT id FROM sessions WHERE id='desktop-held'").get(),
    ).toBeDefined();
    const beat = await s.call("sessions.desktopLive", {
      clientId: "desktop",
      sessions: [],
      deletions: { version: 1, replies: [] },
    });
    expect(beat.result.deletions.jobs).toEqual([]);
    retire.mockRestore();
  });

  it("refuses deletion when omitted authority generation changes while retirement waits", async () => {
    const s = await setup();
    s.seed({ id: "generation-held", cwd: s.project.cwd });
    await s.engine.adoptSession(
      (await s.call("sessions.sync", { sessionId: "generation-held" })).result.value,
    );
    s.desktopDb.prepare("DELETE FROM sessions WHERE id='generation-held'").run();
    const generation = vi
      .spyOn(s.store, "currentAuthorityGeneration")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(2);
    const deleted = await s.call("sessions.delete", {
      projectId: s.project.id,
      sessionId: "generation-held",
    });
    expect(deleted.error).toMatch(/Session authority changed/);
    expect(await s.store.session("generation-held")).toBeDefined();
    generation.mockRestore();
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
    await s.engine.adoptSession((await s.call("sessions.sync", { sessionId: "a" })).result.value);
    const beat = async (replies: unknown[] = []) =>
      await s.call("sessions.desktopLive", {
        clientId: "desktop",
        sessions: [],
        deletions: { version: 1, replies },
      });
    await beat();
    const deleting = s.call("sessions.delete", {
      projectId: s.project.id,
      sessionId: "a",
    });
    void deleting.catch(() => {});
    let jobs: any[] = [];
    await vi.waitFor(async () => {
      jobs = (await beat()).result.deletions.jobs;
      expect(jobs).toHaveLength(1);
    }, WAIT_FOR_DESKTOP_JOB);
    await beat([{ id: jobs[0].id, error: "Stop this session before deleting it" }]);
    expect((await deleting).error).toMatch(/Stop this session/);
    expect(await s.store.session("a")).toBeDefined();
    expect(s.desktopDb.prepare("SELECT id FROM sessions WHERE id='a'").get()).toBeDefined();
  });

  it("lists adopted sessions and catches up with later desktop turns", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd, updated: 100 });
    await s.engine.adoptSession((await s.call("sessions.sync", { sessionId: "a" })).result.value);
    const adopted = (await s.call("sessions.adopted")).result;
    expect(adopted).toMatchObject([{ id: "a", projectId: s.project.id, status: "idle" }]);
    expect((await s.store.session("a")).desktop).toEqual({
      updatedAt: 100,
      revision: 100,
      base: conversationHead([{ id: "b1", role: "user", text: "hi" }]),
    });

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
    expect(sync.value.desktop).toEqual({
      updatedAt: 300,
      revision: sync.value.revision,
      base: conversationHead(blocks as Block[]),
    });
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

  it("reads retained provider-switch context from the desktop snapshot", async () => {
    const s = await setup();
    s.desktopDb.exec("ALTER TABLE sessions ADD COLUMN pending_context_replay TEXT");
    s.seed({ id: "a", cwd: s.project.cwd });
    const replay = "USER: Earlier request\nASSISTANT: Earlier answer";
    s.desktopDb.prepare("UPDATE sessions SET pending_context_replay=? WHERE id='a'").run(replay);
    const desktop = new DesktopSessions(() => [s.dbPath]);
    try {
      expect(desktop.snapshot("a", s.project.id)?.session.pendingContextReplay).toBe(replay);
      expect((await desktop.snapshotAsync("a", s.project.id))?.session.pendingContextReplay).toBe(
        replay,
      );
    } finally {
      desktop.close();
    }
  });

  describe("digests", () => {
    const attached: Block = {
      id: "b2",
      role: "user",
      text: "[file1]",
      attachments: [
        {
          id: "f1",
          name: "clip.mkv",
          mimeType: "video/x-matroska",
          kind: "file",
          size: 9,
          path: "C:/files/clip.mkv",
        },
      ],
    };
    const blocks: Block[] = [
      { id: "b1", role: "user", text: "hi" },
      attached,
      { id: "b3", role: "assistant", text: "done" },
    ];
    /** What the host reads of the desktop copy, with the connection released. */
    const desktopSnapshot = (s: { dbPath: string; project: { id: string } }) => {
      const desktop = new DesktopSessions(() => [s.dbPath]);
      try {
        return desktop.snapshot("a", s.project.id)!;
      } finally {
        desktop.close();
      }
    };
    const seedBlocks = async () => {
      const s = await setup();
      s.seed({ id: "a", cwd: s.project.cwd, updated: 100 });
      s.desktopDb
        .prepare("UPDATE sessions SET blocks_json=? WHERE id='a'")
        .run(JSON.stringify(blocks));
      return s;
    };

    it("advertises the capability", async () => {
      const s = await setup();
      expect((await s.call("environment.describe")).result.capabilities).toContain(
        "sessions.digests",
      );
    });

    it("sends the head and the full block's digest on a shrunk block only when asked", async () => {
      const s = await seedBlocks();
      const plain = (await s.call("sessions.sync", { sessionId: "a" })).result;
      expect(plain.value).not.toHaveProperty("head");
      expect(plain.value.session.blocks[1].remoteContent).not.toHaveProperty("digest");

      const asked = (await s.call("sessions.sync", { sessionId: "a", digests: true })).result;
      expect(asked.value.head).toEqual(conversationHead(blocks));
      const shrunk = asked.value.session.blocks[1];
      // The wire block lost its path; its digest is still that of the full block.
      expect(shrunk.attachments[0]).not.toHaveProperty("path");
      expect(shrunk.remoteContent.digest).toBe(blockDigest(attached));
      expect(asked.value.session.blocks[0]).not.toHaveProperty("remoteContent");
      expect(conversationHead(asked.value.session.blocks)).toEqual(asked.value.head);
    });

    it("sends them on a page as well", async () => {
      const s = await seedBlocks();
      const page = (await s.call("sessions.page", { sessionId: "a", preview: true, digests: true }))
        .result;
      expect(page.sync.value.head).toEqual(conversationHead(blocks));
      expect(page.sync.value.session.blocks[1].remoteContent.digest).toBe(blockDigest(attached));
      const plain = (await s.call("sessions.page", { sessionId: "a", preview: true })).result;
      expect(plain.sync.value).not.toHaveProperty("head");
    });

    it("keeps the head of the whole transcript on a partial window", async () => {
      const s = await seedBlocks();
      const first = (await s.call("sessions.sync", { sessionId: "a", digests: true })).result;
      s.desktopDb
        .prepare("UPDATE sessions SET blocks_json=?, updated_at=200 WHERE id='a'")
        .run(JSON.stringify([...blocks, { id: "b4", role: "user", text: "more" }]));
      const partial = (
        await s.call("sessions.sync", {
          sessionId: "a",
          revision: first.value.revision,
          partial: true,
          loadedBlockIds: ["b3"],
          digests: true,
        })
      ).result;
      expect(partial.value.head).toEqual(
        conversationHead([...blocks, { id: "b4", role: "user", text: "more" }]),
      );
    });

    it("reads the base the desktop saved, and an older desktop has none", async () => {
      const s = await seedBlocks();
      await s.engine.adoptSession(desktopSnapshot(s));
      expect((await s.store.session("a")).desktop?.base).toEqual(conversationHead(blocks));
      s.desktopDb.exec("ALTER TABLE sessions ADD COLUMN adopted_base TEXT");
      const base = { count: 1, chain: "0123456789abcdef0123456789abcdef" };
      s.desktopDb
        .prepare("UPDATE sessions SET adopted_base=?, updated_at=200 WHERE id='a'")
        .run(JSON.stringify(base));
      expect(desktopSnapshot(s).session.adoptedBase).toEqual(base);
      s.desktopDb.prepare("UPDATE sessions SET adopted_base='not json' WHERE id='a'").run();
      expect(desktopSnapshot(s).session).not.toHaveProperty("adoptedBase");
    });

    it("tells the desktop's heartbeat which adopted sessions moved on the host", async () => {
      const s = await seedBlocks();
      await s.engine.adoptSession(desktopSnapshot(s));
      const beat = async (adoptedSeq?: number) =>
        (
          await s.call("sessions.desktopLive", {
            clientId: "window",
            sessions: [],
            ...(adoptedSeq === undefined ? {} : { adoptedSeq }),
          })
        ).result.adopted;
      const first = await beat();
      expect(first).toMatchObject({ ids: [], reset: true });
      expect(await beat(first.seq)).toEqual({ seq: first.seq, ids: [], boot: first.boot });
      // The host runs a turn for another computer: its revision moves.
      const hosted = await s.store.session("a");
      await s.store.save({ ...hosted, revision: hosted.revision + 1 }, { type: "test.remote" });
      const moved = await beat(first.seq);
      expect(moved.ids).toEqual(["a"]);
      expect(moved.reset).toBeUndefined();
      // Seen once, it is not reported again; a window that missed it still is.
      expect(await beat(moved.seq)).toEqual({ seq: moved.seq, ids: [], boot: moved.boot });
      expect((await beat(first.seq)).ids).toEqual(["a"]);
    });

    it("converges on the desktop's version when its saved base names the host transcript", async () => {
      const s = await seedBlocks();
      s.desktopDb.exec("ALTER TABLE sessions ADD COLUMN adopted_base TEXT");
      await s.engine.adoptSession(desktopSnapshot(s));
      // The host ran a turn for another computer.
      const hosted = await s.store.session("a");
      const withTurn = [...blocks, { id: "phone", role: "user" as const, text: "From the phone" }];
      await s.store.save(
        {
          ...hosted,
          revision: hosted.revision + 1,
          desktop: { ...hosted.desktop!, revision: 0 },
          session: { ...hosted.session, blocks: withTurn },
        },
        { type: "test.remote" },
      );
      // The desktop wrote a different turn, then kept its version of the divergence.
      const desktopBlocks = [...blocks, { id: "desk", role: "user", text: "From the desktop" }];
      s.desktopDb
        .prepare("UPDATE sessions SET blocks_json=?, updated_at=300, adopted_base=? WHERE id='a'")
        .run(JSON.stringify(desktopBlocks), JSON.stringify(conversationHead(withTurn as Block[])));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const sync = (await s.call("sessions.sync", { sessionId: "a" })).result;
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
      expect(sync.value.session.blocks.map((block: Block) => block.id)).toEqual([
        "b1",
        "b2",
        "b3",
        "desk",
      ]);
    });
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
      approval: { requestId: 7, occurrenceId: "7e1c4dc0-6f53-4a8c-b8d8-000000000001" },
    };
    const question = { requestId: 9, questions: [] };
    const pageToken = "7e1c4dc0-6f53-4a8c-b8d8-000000000010";
    const turnReceipt = {
      version: 1,
      sessionId: "a",
      turnId: "7e1c4dc0-6f53-4a8c-b8d8-000000000011",
    };
    const beat = async (body: { sessions?: Record<string, unknown>[]; acked?: string[] }) =>
      await s.call("sessions.desktopLive", {
        ...body,
        clientId: "desktop-window",
        pageToken,
        sessions: body.sessions?.map((session) => ({ ...session, turnReceipt })),
      });
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
    expect(first.value).toMatchObject({
      status: "running",
      runId: "desktop",
      executionOwner: "desktop",
    });
    expect(
      (await s.call("sessions.page", { sessionId: "a" })).result.sync.value.executionOwner,
    ).toBe("desktop");
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
        approvalOccurrenceId: "7e1c4dc0-6f53-4a8c-b8d8-000000000001",
        decision: "allow",
      },
      { type: "cancel", commandId: "k2", sessionId: "a", runId: "desktop" },
    ])
      expect((await s.call("commands.dispatch", command)).error).toBeUndefined();
    const accepted = await s.store.db
      .prepare("SELECT id,state FROM desktop_command_delivery ORDER BY id")
      .all();
    expect(accepted).toEqual([
      { id: "k1", state: "accepted" },
      { id: "k2", state: "accepted" },
    ]);
    const queued = (
      await beat({
        sessions: [
          { id: "a", busy: true, pending: [approval], patch: { pendingQuestion: question } },
        ],
      })
    ).result.commands;
    expect(queued).toMatchObject([
      {
        id: "k1",
        sessionId: "a",
        type: "approve",
        runId: "desktop",
        requestId: 7,
        approvalOccurrenceId: "7e1c4dc0-6f53-4a8c-b8d8-000000000001",
        decision: "allow",
        pageToken,
        turnReceipt,
      },
      { sessionId: "a", type: "cancel", pageToken, turnReceipt },
    ]);
    expect(s.send).not.toHaveBeenCalled();
    // A lost response is not offered again. Another page cannot acknowledge it.
    expect((await beat({ sessions: [{ id: "a", busy: true }] })).result.commands).toEqual([]);
    expect(
      (
        await s.call("sessions.desktopLive", {
          clientId: "desktop-window",
          pageToken: "7e1c4dc0-6f53-4a8c-b8d8-000000000012",
          sessions: [],
          acked: queued.map((c: any) => c.id),
        })
      ).result.commands,
    ).toEqual([]);
    expect(
      await s.store.db.prepare("SELECT state FROM desktop_command_delivery ORDER BY id").all(),
    ).toEqual([{ state: "offered_unknown" }, { state: "offered_unknown" }]);
    expect(
      (await beat({ sessions: [{ id: "a", busy: true }], acked: queued.map((c: any) => c.id) }))
        .result,
    ).toMatchObject({ commands: [] });
    expect(
      await s.store.db.prepare("SELECT state FROM desktop_command_delivery ORDER BY id").all(),
    ).toEqual([{ state: "acknowledged" }, { state: "acknowledged" }]);

    // The prompt is gone: only that changed, so only a delta goes out.
    const second = (
      await s.call("sessions.sync", { sessionId: "a", revision: first.value.revision })
    ).result;
    expect(second.kind).toBe("delta");
    expect(second.value.executionOwner).toBe("desktop");
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
    expect(stale.value.executionOwner).toBeUndefined();
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
        const all = identifiers.map((identifier) => join(home, ...base, identifier, database!));
        // An installed Host reads the release database only; a development Host
        // (or an explicit opt-in) also reads the dev app's database.
        const release = all.filter((path) => !path.includes("desktop.dev"));
        expect(desktopDatabasePaths({}, platform, home), platform).toEqual(release);
        for (const env of [{ BYCODA_DESKTOP_INCLUDE_DEV: "1" }, { BYCODA_DEV_PROFILE_ID: "run" }])
          expect(desktopDatabasePaths(env, platform, home).sort(), platform).toEqual(
            all.slice().sort(),
          );
        rmSync(release[0], { force: true });
        expect(desktopDatabasePaths({}, platform, home), platform).toEqual(
          all.filter((path) => path.includes("desktop.dev")),
        );
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
  });
});

describe("the run lease of a conversation", () => {
  it("projects the host executor despite desktop sync provenance across snapshot, delta and pages", async () => {
    const s = await setup();
    const created = (
      await s.call("commands.dispatch", {
        type: "create",
        workspaceMode: "current",
        commandId: "owner-create",
        projectId: s.project.id,
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
      })
    ).result;
    const sessionId = created.sessionId;
    const idle = (await s.call("sessions.sync", { sessionId })).result.value;
    expect(idle.desktop).toBeDefined();
    expect(idle.executionOwner).toBeUndefined();
    expect(
      (
        await s.call("commands.dispatch", {
          type: "send",
          commandId: "owner-send",
          sessionId,
          text: "hello",
        })
      ).error,
    ).toBeUndefined();
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce(), { timeout: 5_000 });
    const active = (await s.call("sessions.sync", { sessionId })).result.value;
    expect(active.desktop).toBeDefined();
    expect(active.executionOwner).toBe("host");
    expect((await s.call("sessions.get", { sessionId })).result.executionOwner).toBe("host");
    const delta = (await s.call("sessions.sync", { sessionId, revision: idle.revision })).result;
    expect(delta.value.executionOwner).toBe("host");
    const page = (await s.call("sessions.page", { sessionId })).result;
    expect(page.sync.value.executionOwner).toBe("host");
    const partial = (
      await s.call("sessions.sync", { sessionId, partial: true, loadedBlockIds: [] })
    ).result;
    expect(partial.value.executionOwner).toBe("host");
    const hello = (await s.call("environment.describe")).result;
    expect(hello.capabilities).toContain("sessions.executionOwner");
  });

  const lease = async (s: Awaited<ReturnType<typeof setup>>, action: string, extra: object = {}) =>
    await s.call("sessions.runLease", {
      sessionId: "a",
      clientId: "desktop:win",
      action,
      ...extra,
    });
  const mac = async (s: Awaited<ReturnType<typeof setup>>, commandId: string) =>
    await s.call("commands.dispatch", {
      type: "send",
      commandId,
      sessionId: "a",
      text: "from the mac",
    });

  it("makes a Mac send wait with LEASE_HELD while a desktop window runs a turn, and never adopts", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    const granted = (await lease(s, "acquire")).result.lease;
    expect(granted).toMatchObject({ holder: "desktop:win" });
    const refused = await mac(s, "c1");
    expect(refused.error).toMatch(/^LEASE_HELD: /);
    expect(refused.error).toMatch(/Wait for it to finish/);
    // Nothing started, nothing was copied to the host.
    expect(s.send).not.toHaveBeenCalled();
    await expect((async () => await s.store.session("a"))()).rejects.toThrow();
    // The turn ends: the window gives the lease back and the same send goes through.
    expect((await lease(s, "release", { epoch: granted.epoch })).result).toEqual({
      released: true,
    });
    expect((await mac(s, "c1")).error).toBeUndefined();
    // Acceptance precedes asynchronous checkpoint/runtime preparation. Observe
    // the real provider boundary without imposing a startup latency contract.
    await s.providerStarted;
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("keeps the host lease during original preparation and observes the actual provider onset", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    let continuePreparation!: () => void;
    const preparation = new Promise<void>((resolve) => {
      continuePreparation = resolve;
    });
    let signalPreparing!: () => void;
    const preparing = new Promise<void>((resolve) => {
      signalPreparing = resolve;
    });
    const originalBegin = s.engine.checkpoints.beginFilesTurn.bind(s.engine.checkpoints);
    const begin = vi.spyOn(s.engine.checkpoints, "beginFilesTurn").mockImplementation((...args) => {
      signalPreparing();
      return preparation.then(() => originalBegin(...args));
    });
    try {
      expect((await mac(s, "prepared-onset")).error).toBeUndefined();
      await preparing;
      expect(s.send).not.toHaveBeenCalled();
      expect((await s.call("sessions.get", { sessionId: "a" })).result.status).toBe("running");
      expect((await lease(s, "acquire")).error).toMatch(/^LEASE_HELD:/);

      continuePreparation();
      await s.providerStarted;
      expect(begin).toHaveBeenCalledTimes(1);
      expect(s.send).toHaveBeenCalledTimes(1);
      expect((await lease(s, "acquire")).error).toMatch(/^LEASE_HELD:/);
      expect((await lease(s, "release", { epoch: 7 })).result).toEqual({ released: false });
    } finally {
      continuePreparation();
      begin.mockRestore();
    }
  });

  it("refuses a queued send and a compact the same way", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    await lease(s, "acquire");
    const compact = await s.call("commands.dispatch", {
      type: "compact",
      commandId: "c2",
      sessionId: "a",
    });
    expect(compact.error).toMatch(/^LEASE_HELD: /);
  });

  it("follows the heartbeat: busy keeps it, the beat that reports idle ends it", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    await lease(s, "acquire");
    const beat = async (busy: boolean) =>
      await s.call("sessions.desktopLive", {
        clientId: "win",
        sessions: busy ? [{ id: "a", busy: true }] : [],
      });
    await beat(true);
    expect((await mac(s, "c3")).error).toMatch(/^LEASE_HELD: /);
    await beat(false);
    expect((await mac(s, "c3")).error).toBeUndefined();
  });

  it("lets only one window take it, and refuses an older app that is busy without one", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    expect((await lease(s, "acquire")).result.lease.holder).toBe("desktop:win");
    expect((await lease(s, "acquire", { clientId: "desktop:other" })).error).toMatch(
      /^LEASE_HELD: /,
    );
    expect((await lease(s, "acquire")).result.lease.holder).toBe("desktop:win");
    // A bad request is not a lease.
    expect((await lease(s, "acquire", { clientId: "remote:mac" })).error).toMatch(/Invalid/);
    expect((await lease(s, "borrow")).error).toMatch(/Invalid/);
    // A busy app that never asked (database mark only) still holds the conversation.
    s.seed({ id: "legacy", cwd: s.project.cwd });
    s.desktopDb
      .prepare("INSERT INTO in_flight_sessions VALUES ('legacy', ?, 0)")
      .run(s.project.cwd);
    const legacy = await s.call("commands.dispatch", {
      type: "send",
      commandId: "c4",
      sessionId: "legacy",
      text: "go",
    });
    expect(legacy.error).toMatch(/^LEASE_HELD: /);
  });

  it("is refused to a desktop while the host runs a turn (desktop types during a Mac turn)", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    expect((await mac(s, "c5")).error).toBeUndefined();
    await s.providerStarted;
    expect(s.send).toHaveBeenCalledTimes(1);
    const held = await lease(s, "acquire");
    expect(held.error).toMatch(/^LEASE_HELD: /);
    // Fencing: a window that lost it is told so instead of writing.
    expect((await lease(s, "release", { epoch: 7 })).result).toEqual({ released: false });
  });

  it("treats a window whose heartbeat reports the conversation busy as its holder, even if it never asked", async () => {
    // Every clock read advances: the asynchronous implicit grant is later than
    // receipt of the beat, so idle must release that grant rather than fence it.
    let now = Date.now();
    const time = vi.spyOn(Date, "now").mockImplementation(() => now++);
    try {
      const s = await setup();
      s.seed({ id: "a", cwd: s.project.cwd });
      const beat = async (busy: boolean) =>
        await s.call("sessions.desktopLive", {
          clientId: "older-app",
          sessions: busy ? [{ id: "a", busy: true }] : [],
        });
      await beat(true);
      expect((await mac(s, "c6")).error).toMatch(/^LEASE_HELD: /);
      // It cannot be taken by another window meanwhile.
      expect((await lease(s, "acquire")).error).toMatch(/^LEASE_HELD: /);
      await beat(false);
      expect((await lease(s, "acquire")).result.lease.holder).toBe("desktop:win");
    } finally {
      time.mockRestore();
    }
  });

  it("fences a window whose lease is not its own", async () => {
    const s = await setup();
    s.seed({ id: "a", cwd: s.project.cwd });
    const first = (await lease(s, "acquire")).result.lease;
    const stale = await lease(s, "release", { clientId: "desktop:other", epoch: first.epoch });
    expect(stale.error).toMatch(/^LEASE_LOST: /);
    // The holder keeps it.
    expect((await lease(s, "release", { epoch: first.epoch + 1 })).error).toMatch(/LEASE_LOST/);
    expect((await lease(s, "release", { epoch: first.epoch })).result).toEqual({ released: true });
  });
});
