import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { HostCrews } from "./crews";
import type { HostTasks } from "./tasks";
import type { HostEngine } from "./engine";
import { defaultCrewPolicy, type CrewRun } from "../src/features/crews/model/crew";

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
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "crew-scheduler-cache-"));
  const path = join(directory, "host.db");
  const store = new HostStore(path);
  await store.ready;
  const writer = new HostStore(path);
  await writer.ready;
  let now = 1000;
  const tasks = { ready: Promise.resolve(), list: vi.fn(async () => []), tick: vi.fn() };
  const engine = { command: vi.fn(), updateSession: vi.fn() };
  const session = vi
    .spyOn(store, "session")
    .mockResolvedValue({ status: "running" } as Awaited<ReturnType<HostStore["session"]>>);
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
    writer,
    session,
    get service() {
      return service;
    },
    advance: (delta: number) => {
      now += delta;
    },
    write: async (raw: string, owner = writer) => {
      await owner.db
        .prepare(
          "INSERT INTO metadata(key,value) VALUES('crews.v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(raw);
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

it("rechecks each active tick but parses full history only while warming the cache", async () => {
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
  expect(parse.mock.calls.filter(([value]) => value === raw)).toHaveLength(2);
  expect(
    prepare.mock.calls.filter(([sql]) => sql === "SELECT value FROM metadata WHERE key=?"),
  ).toHaveLength(6);
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
  await f.writer.db.prepare("DELETE FROM metadata WHERE key='crews.v1'").run();
  await f.service.tick();
  await f.write(raw);
  await f.service.tick();
  expect(f.session).toHaveBeenCalledOnce();
  await f.restart();
  f.session.mockClear();
  await f.service.tick();
  expect(f.session).toHaveBeenCalledExactlyOnceWith("session-external");
});

it("returns mutable active snapshots without exposing the private cached graph", async () => {
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
  expect(
    (await f.store.db.prepare("SELECT value FROM metadata WHERE key='crews.v1'").get())!.value,
  ).toBe(raw);
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
  expect(parse.mock.calls.filter(([value]) => value === changed)).toHaveLength(4);
  expect(f.session).toHaveBeenLastCalledWith("session-changed");
});

it("does not retain oversized history in the scheduler cache", async () => {
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
  expect(parse.mock.calls.filter(([value]) => value === raw)).toHaveLength(3);
});
