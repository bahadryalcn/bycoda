import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../store";
import { HostCrews } from "./crews";
import {
  initializeCrewSchedulerProjection,
  readCrewState,
  writeCrewState,
} from "./crew-scheduler-projection";
import type { HostTasks } from "../tasks/tasks";
import type { HostEngine } from "../engine";
import { defaultCrewPolicy, type CrewRun } from "../../src/features/crews/model/crew";
import { wireCrewWorkEngine } from "./crew-source-task.fixture";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
function run(id: string, status: CrewRun["status"] = "active"): CrewRun {
  return {
    id,
    projectId: "project",
    definition: { id: "crew", name: "Crew", agents: [], policy: defaultCrewPolicy, updatedAt: 1 },
    status,
    coordinatorSessionId: `session-${id}`,
    assignments: [],
    messages: [],
    notifications: {},
    createdAt: 1,
    updatedAt: 1,
  };
}
const state = (...runs: CrewRun[]) => JSON.stringify({ definitions: [], runs });
// Fixture ingestion is not scheduler decoding; spies below measure reads only.
const decodeFixture = JSON.parse;
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "crew-scheduler-cache-"));
  const path = join(directory, "host.db");
  const store = new HostStore(path);
  await store.ready;
  const writer = new HostStore(path);
  await writer.ready;
  let now = 1000;
  const tasks = { ready: Promise.resolve(), list: vi.fn(async () => []), tick: vi.fn() };
  const current = {
    revision: 1,
    updatedAt: 1000,
    projectId: "project",
    status: "idle",
    runId: undefined as string | undefined,
    session: {
      id: "session-live",
      cwd: directory,
      harness: "codex",
      model: "fixture",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Coordinator",
      blocks: [],
    },
  };
  const engine = {
    command: vi.fn(async (raw: unknown) => {
      const command = raw as { sessionId: string; commandId: string };
      current.runId = `${command.commandId}-run`;
      return { commandId: command.commandId, sessionId: command.sessionId, revision: 1 };
    }),
    updateSession: vi.fn(),
  };
  wireCrewWorkEngine(store, engine as unknown as HostEngine);
  const session = vi
    .spyOn(store, "session")
    .mockResolvedValue({ projectId: "project", status: "running" } as Awaited<
      ReturnType<HostStore["session"]>
    >);
  const create = () =>
    new HostCrews(
      store,
      engine as unknown as HostEngine,
      tasks as unknown as HostTasks,
      async () => ({ models: {}, errors: {} }),
      () => now,
    );
  let service = create();
  await service.ready;
  cleanups.push(async () => {
    await service.close();
    await writer.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    store,
    current,
    writer,
    engine,
    session,
    get service() {
      return service;
    },
    advance: (delta: number) => {
      now += delta;
    },
    write: async (raw: string, owner = writer) => {
      await owner.transaction(() => writeCrewState(owner, decodeFixture(raw)));
    },
    restart: async () => {
      await service.close();
      service = create();
      await service.ready;
    },
  };
}
function activeReader(service: HostCrews) {
  return service as unknown as { readActiveRuns(): Promise<CrewRun[]> };
}

it("reads only projected active payloads on every tick without parsing canonical history", async () => {
  const f = await fixture();
  const raw = state(
    ...Array.from({ length: 500 }, (_, index) => run(`finished-${index}`, "finished")),
    run("live"),
  );
  await f.write(raw);
  const parse = vi.spyOn(JSON, "parse");
  const prepare = vi.spyOn(f.store.db, "prepare");
  for (let index = 0; index < 6; index++) {
    f.advance(1500);
    await f.service.tick();
  }
  expect(parse.mock.calls.filter(([value]) => value === raw)).toHaveLength(0);
  expect(prepare.mock.calls.filter(([sql]) => sql.includes("FROM crew_runs_v2"))).toHaveLength(6);
  expect(f.session).toHaveBeenCalledTimes(6);
});

it("observes cross-writer activation after idle, replacement, removal, ABA and restart without a clock delay", async () => {
  const f = await fixture();
  await f.write(state());
  await f.service.tick();
  const raw = state(run("external"));
  await f.write(raw);
  f.advance(-10000);
  await f.service.tick();
  expect(f.session).toHaveBeenLastCalledWith("session-external");
  await f.write(state(run("external", "finished")));
  f.session.mockClear();
  await f.service.tick();
  expect(f.session).not.toHaveBeenCalled();
  await f.write(state());
  await f.service.tick();
  await f.write(raw);
  await f.service.tick();
  expect(f.session).toHaveBeenCalledOnce();
  await f.restart();
  f.session.mockClear();
  await f.service.tick();
  expect(f.session).toHaveBeenCalledExactlyOnceWith("session-external");
});

it("returns fresh mutable active snapshots without exposing persisted projection", async () => {
  const f = await fixture();
  const raw = state(
    ...Array.from({ length: 8 }, (_, index) => run(`history-${index}`, "finished")),
    run("live"),
  );
  await f.write(raw);
  await activeReader(f.service).readActiveRuns();
  const first = await activeReader(f.service).readActiveRuns();
  first[0].status = "finished";
  first[0].definition.name = "Changed outside cache";
  first[0].messages.push({ id: "foreign", from: "owner", text: "unsaved", createdAt: 1 });
  const second = await activeReader(f.service).readActiveRuns();
  expect(second[0]).toEqual(run("live"));
  expect(second[0]).not.toBe(first[0]);
  await f.service.tick();
  expect(f.session).toHaveBeenCalledExactlyOnceWith("session-live");
  expect(await readCrewState(f.store)).toEqual(JSON.parse(raw));
});

it("does not publish uncommitted decoded state and rereads identical bytes after rollback", async () => {
  const f = await fixture();
  const history = Array.from({ length: 8 }, (_, index) => run(`history-${index}`, "finished"));
  const committed = state(...history, run("committed"));
  const changed = state(...history, run("changed"));
  await f.write(committed);
  await f.service.tick();
  const parse = vi.spyOn(JSON, "parse");
  await expect(
    f.store.transaction(async () => {
      await f.write(changed, f.store);
      expect((await activeReader(f.service).readActiveRuns())[0].id).toBe("changed");
      expect((await activeReader(f.service).readActiveRuns())[0].id).toBe("changed");
      expect((await activeReader(f.service).readActiveRuns())[0].id).toBe("changed");
      throw new Error("rollback fixture");
    }),
  ).rejects.toThrow("rollback fixture");
  f.session.mockClear();
  await f.service.tick();
  expect(f.session).toHaveBeenCalledExactlyOnceWith("session-committed");
  await f.write(changed);
  await f.service.tick();
  expect(parse.mock.calls.filter(([value]) => value === changed)).toHaveLength(0);
  expect(f.session).toHaveBeenLastCalledWith("session-changed");
});

it("does not transfer or decode oversized settled history on scheduler reads", async () => {
  const f = await fixture();
  const historical = run("large", "finished");
  historical.messages = Array.from({ length: 500 }, (_, index) => ({
    id: String(index),
    from: "owner",
    text: "x".repeat(6000),
    createdAt: 1,
  }));
  const raw = state(
    historical,
    { ...historical, id: "large-two" },
    { ...historical, id: "large-three" },
    run("live"),
  );
  await f.write(raw);
  const parse = vi.spyOn(JSON, "parse");
  await f.service.tick();
  await f.service.tick();
  await f.service.tick();
  expect(parse.mock.calls.filter(([value]) => value === raw)).toHaveLength(0);
});

it("keeps changing delivery ticks off canonical history while retaining all saved data", async () => {
  const f = await fixture();
  f.session.mockResolvedValue(f.current as Awaited<ReturnType<HostStore["session"]>>);
  const history = Array.from({ length: 40 }, (_, index) =>
    run(`settled-history-${index}`, "finished"),
  );
  const parse = vi.spyOn(JSON, "parse");
  const prepare = vi.spyOn(f.store.db, "prepare");
  for (let index = 0; index < 3; index++) {
    const live = run("live");
    live.messages = [
      { id: `notice-${index}`, from: "owner", text: "Changed notice", createdAt: index + 1 },
    ];
    await f.write(state(...history, live));
    f.advance(1500);
    await f.service.tick();
  }
  expect(f.engine.command).toHaveBeenCalledTimes(3);
  expect(
    prepare.mock.calls.filter(
      ([sql]) => sql === "SELECT payload FROM crew_runs_v2 ORDER BY ordinal",
    ),
  ).toHaveLength(0);
  expect(
    parse.mock.calls.filter(
      ([value]) => typeof value === "string" && value.includes("settled-history-"),
    ),
  ).toHaveLength(0);
  parse.mockRestore();
  const saved = await readCrewState(f.writer);
  expect(saved.runs.slice(0, 40)).toEqual(history);
  expect(saved.runs[40].pendingDelivery).toBeUndefined();
  expect(saved.runs[40].notifications["request:notice-2"]).toBe("sent");
});

it("fails closed on malformed canonical state and retains run rows across restart", async () => {
  const f = await fixture();
  await f.write(state(run("recovered")));
  await f.writer.db
    .prepare("UPDATE metadata SET value=? WHERE key='crews.v2.state'")
    .run("{invalid");
  await expect(f.service.tick()).rejects.toThrow("Crew storage is invalid or unavailable");
  await f.restart();
  await expect(f.service.tick()).rejects.toThrow("Crew storage is invalid or unavailable");
  await f.write(state(run("recovered")));
  await f.service.tick();
  expect(f.session).toHaveBeenLastCalledWith("session-recovered");
  await f.restart();
  f.session.mockClear();
  await f.service.tick();
  expect(f.session).toHaveBeenCalledExactlyOnceWith("session-recovered");
});

it("legacy replace and key moves cannot change migrated canonical authority", async () => {
  const f = await fixture();
  await f.write(state(run("canonical")));
  await f.writer.db
    .prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES('crews.v1',?)")
    .run(state(run("replace")));
  await f.service.tick();
  expect(f.session).toHaveBeenLastCalledWith("session-canonical");
  await f.writer.db.prepare("UPDATE metadata SET key='crews.moved' WHERE key='crews.v1'").run();
  f.session.mockClear();
  await f.service.tick();
  expect(f.session).toHaveBeenCalledExactlyOnceWith("session-canonical");
  await f.writer.db.prepare("UPDATE metadata SET key='crews.v1' WHERE key='crews.moved'").run();
  await f.service.tick();
  expect(f.session).toHaveBeenCalledTimes(2);
  expect(f.session).toHaveBeenLastCalledWith("session-canonical");
});

it("late delivery cannot overwrite another coordinator or another pending command", async () => {
  const f = await fixture();
  const original = run("live");
  original.pendingDelivery = {
    commandId: "original",
    text: "Original notice",
    notifications: { original: "sent" },
  };
  const writer = f.service as unknown as {
    updateDelivery(
      run: CrewRun,
      requireActive: boolean,
      settledCommandId?: string,
    ): Promise<boolean>;
  };
  const replacement = { ...original, coordinatorSessionId: "new-coordinator" };
  await f.write(state(replacement));
  expect(await writer.updateDelivery(original, true)).toBe(false);
  const different = {
    ...original,
    pendingDelivery: { ...original.pendingDelivery, commandId: "new-command" },
  };
  await f.write(state(different));
  const settled = { ...original, pendingDelivery: undefined, notifications: { original: "sent" } };
  expect(await writer.updateDelivery(settled, false, "original")).toBe(false);
  expect((await readCrewState(f.writer)).runs[0]).toEqual(different);
});

it("invalid run arrays cannot overwrite canonical active rows", async () => {
  const f = await fixture();
  await f.write(state(run("retained")));
  for (const raw of [
    state(null as unknown as CrewRun),
    '{"runs":{}}',
    '{"runs":[{"status":"active","coordinatorSessionId":false}]}',
  ]) {
    await expect(f.write(raw)).rejects.toThrow();
    expect((await readCrewState(f.writer)).runs).toEqual([run("retained")]);
  }
  expect(f.session).not.toHaveBeenCalled();
});

it("retains the exact persisted delivery across uncertain send failure and restart", async () => {
  const f = await fixture();
  f.session.mockResolvedValue(f.current as Awaited<ReturnType<HostStore["session"]>>);
  const live = run("live");
  live.messages = [{ id: "request", from: "owner", text: "Notice", createdAt: 1 }];
  await f.write(state(run("history", "finished"), live));
  f.engine.command.mockRejectedValueOnce(new Error("unknown send outcome"));
  await f.service.tick();
  await f.restart();
  await f.service.tick();
  expect(f.engine.command).toHaveBeenCalledTimes(1);
  const saved = await readCrewState(f.writer);
  expect(saved.runs[0]).toEqual(run("history", "finished"));
  expect(saved.runs[1].pendingDelivery).toMatchObject({ text: expect.stringContaining("Notice") });
});

it("legacy conflict clauses cannot replace migrated active rows or poison canonical state", async () => {
  const f = await fixture();
  await f.write(state(run("canonical")));
  await f.writer.db
    .prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES('crews.v1',?)")
    .run("invalid");
  await f.writer.db
    .prepare("UPDATE OR IGNORE metadata SET value=? WHERE key='crews.v1'")
    .run(state(run("ignore")));
  await f.service.tick();
  expect(f.session).toHaveBeenLastCalledWith("session-canonical");
  await f.writer.db
    .prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES('crews.v1',?)")
    .run("invalid again");
  await f.service.tick();
  expect(f.session).toHaveBeenLastCalledWith("session-canonical");
  await f.writer.db
    .prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES('crews.v1',?)")
    .run(state(run("replace-recovered")));
  await f.service.tick();
  expect(f.session).toHaveBeenLastCalledWith("session-canonical");
});

it("rolls back interrupted startup backfill without publishing partial schema or altering history", async () => {
  const store = new HostStore(":memory:");
  await store.ready;
  cleanups.push(() => store.close());
  const raw = state(run("history", "finished"), run("live"));
  await store.db.prepare("INSERT INTO metadata(key,value) VALUES('crews.v1',?)").run(raw);
  const exec = store.db.exec.bind(store.db);
  const fault = vi.spyOn(store.db, "exec").mockImplementation(async (sql) => {
    await exec(sql);
    if (sql.includes("CREATE TABLE IF NOT EXISTS crew_runs_v2"))
      throw new Error("interrupted backfill");
  });
  await expect(initializeCrewSchedulerProjection(store)).rejects.toThrow("interrupted backfill");
  fault.mockRestore();
  const schema = await store.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE name LIKE 'crew_runs_v2%' OR name='crew_finish_sequence'",
    )
    .all();
  expect(schema).toEqual([]);
  const saved = await store.db.prepare("SELECT value FROM metadata WHERE key='crews.v1'").get();
  expect(saved!.value).toBe(raw);
  await initializeCrewSchedulerProjection(store);
  const projected = await store.db
    .prepare("SELECT payload FROM crew_runs_v2 WHERE status='active'")
    .all();
  expect(projected.map((row) => JSON.parse(String(row.payload)))).toEqual([run("live")]);
});
