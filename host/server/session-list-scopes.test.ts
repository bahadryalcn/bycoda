import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { createSessionListRuntime } from "./session-list";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanups.length) await cleanups.pop()!();
});

async function setup(projects: number, sessions: unknown[] = [], catchUp = vi.fn()) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-session-list-scopes-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const ids: string[] = [];
  for (let index = 0; index < projects; index++)
    ids.push((await store.addProject(`/scopes-${index}`, `P${index}`)).id);
  let runtime!: Awaited<ReturnType<typeof createSessionListRuntime>>;
  await createSessionListRuntime(
    {
      engine: { store },
      desktop: {
        listSnapshotAsync: async () => ({ sessions, fingerprint: "fixed" }),
        samePath: (x: string, y: string) => x === y,
        pathKey: (path: string) => path,
      },
      desktopWatch: async () => false,
      catchUp,
      tasks: { changeEtag: async () => "tasks" },
      providers: [],
      pullRequestWatch: { wakeSources: () => new Map() },
    } as never,
    (value) => {
      runtime = value;
    },
  );
  // Polls are sequential, so a depth counter tells top-level read admissions from nested ones.
  const counter = { writer: 0, reads: 0, depth: 0 };
  const writerScope = store.db.storeScope.bind(store.db) as typeof store.db.storeScope;
  vi.spyOn(store.db, "storeScope").mockImplementation(((work: () => unknown, options?: never) => {
    counter.writer++;
    return writerScope(work as never, options);
  }) as never);
  const readScope = store.db.readScope.bind(store.db) as typeof store.db.readScope;
  vi.spyOn(store.db, "readScope").mockImplementation(((work: () => unknown, signal?: never) => {
    if (counter.depth === 0) counter.reads++;
    counter.depth++;
    return readScope(async () => {
      try {
        return await work();
      } finally {
        counter.depth--;
      }
    }, signal);
  }) as never);
  return { store, runtime, ids, counter, catchUp };
}

it("serves a warm round of 100 projects with one verification read each", async () => {
  const { store, runtime, ids, counter } = await setup(100);
  for (const id of ids) await runtime.projectSessionList(id);
  const projects = vi.spyOn(store, "projects");
  counter.reads = counter.writer = 0;
  for (const id of ids) await runtime.projectSessionList(id);
  // Cache hits read nothing but the final project-identity check, and never queue a writer.
  expect(counter.reads).toBe(ids.length);
  expect(counter.writer).toBe(0);
  expect(projects).not.toHaveBeenCalled();
});

it("rebuilds a project's list on read connections without entering the writer queue", async () => {
  const { store, runtime, ids, counter } = await setup(2);
  await runtime.projectSessionList(ids[1]!); // loads the registry rows
  const summaries = vi.spyOn(store, "summaries");
  const adopted = vi.spyOn(store, "adopted");
  counter.reads = counter.writer = 0;
  await runtime.projectSessionList(ids[0]!);
  expect(counter.reads).toBeGreaterThan(0);
  expect(counter.writer).toBe(0);
  expect(summaries).toHaveBeenCalled();
  // Nothing local means nothing to catch up, so the adopted rows are not read.
  expect(adopted).not.toHaveBeenCalled();
});

it("catches up a newer desktop copy and reads the list after it", async () => {
  const session = { id: "s1", status: "idle", updatedAt: 5, cwd: "/scopes-0" };
  const catchUp = vi.fn();
  const { store, runtime, ids, counter } = await setup(2, [session], catchUp);
  await runtime.projectSessionList(ids[1]!); // loads the registry rows
  vi.spyOn(store, "adopted").mockResolvedValue([
    {
      id: "s1",
      projectId: ids[0]!,
      revision: 1,
      updatedAt: 1,
      status: "idle",
      desktopUpdatedAt: 1,
    },
  ]);
  const summaries = vi.spyOn(store, "summaries");
  summaries.mockImplementation(async () => {
    expect(catchUp).toHaveBeenCalledTimes(1);
    return [];
  });
  counter.reads = counter.writer = 0;
  await runtime.projectSessionList(ids[0]!);
  expect(catchUp).toHaveBeenCalledWith("s1", { updatedAt: 5, running: false });
  expect(counter.writer).toBe(0);
});

it("reloads the registry rows after the folder changed under a poll", async () => {
  const { store, runtime, ids } = await setup(1);
  await runtime.projectSessionList(ids[0]!);
  await store.db.prepare("UPDATE projects SET cwd=? WHERE id=?").run("/scopes-moved", ids[0]!);
  await expect(runtime.projectSessionList(ids[0]!)).rejects.toThrow(/Project changed/);
  await expect(runtime.projectSessionList(ids[0]!)).resolves.toBeDefined();
});

it("reloads the registry rows after a rename under a poll", async () => {
  const { store, runtime, ids } = await setup(1);
  await runtime.projectSessionList(ids[0]!);
  await store.db.prepare("UPDATE projects SET name=? WHERE id=?").run("Renamed", ids[0]!);
  await expect(runtime.projectSessionList(ids[0]!)).rejects.toThrow(/Project changed/);
  await expect(runtime.projectSessionList(ids[0]!)).resolves.toBeDefined();
});
