import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../store";
import { HostCrews } from "./crews";
import { writeCrewState } from "./crew-scheduler-projection";
import type { HostTasks } from "../tasks/tasks";
import type { HostEngine } from "../engine";
import { defaultCrewPolicy, type CrewRun } from "../../src/features/crews/model/crew";
import { wireCrewWorkEngine } from "./crew-source-task.fixture";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});

function run(id: string, projectId: string): CrewRun {
  return {
    id,
    projectId,
    definition: { id: "crew", name: "Crew", agents: [], policy: defaultCrewPolicy, updatedAt: 1 },
    status: "finished",
    assignments: [],
    messages: [],
    notifications: {},
    createdAt: 1,
    updatedAt: 1,
  };
}
const task = (id: string, projectId: string, crewRunId: string | undefined, createdAt: number) => ({
  id,
  projectId,
  crewRunId,
  title: id,
  status: "done",
  createdAt,
  updatedAt: createdAt,
});

it("lists run tasks through the indexed per-run read, never a project scan per run", async () => {
  const directory = mkdtempSync(join(tmpdir(), "crew-list-reads-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const all = [
    task("b", "p1", "r1", 20),
    task("a", "p1", "r1", 10),
    task("c", "p1", "r2", 5),
    task("history", "p1", undefined, 1),
    task("foreign", "p2", "r1", 1),
    task("d", "p2", "r3", 7),
  ];
  const listProject = vi.fn(async (projectId?: string) =>
    all
      .filter((t) => !projectId || t.projectId === projectId)
      .sort((x, y) => x.createdAt - y.createdAt),
  );
  const listCrewRun = vi.fn(async (runId: string, projectId: string) =>
    all
      .filter((t) => t.crewRunId === runId && t.projectId === projectId)
      .sort((x, y) => x.createdAt - y.createdAt),
  );
  const tasks = { ready: Promise.resolve(), list: listProject, listCrewRun, tick: vi.fn() };
  const engine = {
    command: vi.fn(async (raw: unknown) => {
      const command = raw as { sessionId: string; commandId: string };
      return { commandId: command.commandId, sessionId: command.sessionId, revision: 1 };
    }),
    updateSession: vi.fn(),
  };
  wireCrewWorkEngine(store, engine as unknown as HostEngine);
  const service = new HostCrews(
    store,
    engine as unknown as HostEngine,
    tasks as unknown as HostTasks,
    async () => ({ models: {}, errors: {} }),
    () => 1000,
  );
  await service.ready;
  cleanups.push(async () => {
    await service.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  vi.spyOn(store, "project").mockResolvedValue({} as Awaited<ReturnType<HostStore["project"]>>);
  await store.transaction(() =>
    writeCrewState(store, {
      definitions: [],
      runs: [run("r1", "p1"), run("r2", "p1"), run("r4", "p1"), run("r3", "p2")],
    }),
  );

  const p1 = await service.list("p1");
  const p2 = await service.list("p2");

  // Parity with the former per-run `tasks.list(project).filter(crewRunId)` result.
  const ids = (view: typeof p1) =>
    Object.fromEntries(view.runs.map((r) => [r.id, r.tasks.map((t) => t.id)]));
  expect(ids(p1)).toEqual({ r1: ["a", "b"], r2: ["c"], r4: [] });
  expect(ids(p2)).toEqual({ r3: ["d"] });
  // Reads: one indexed lookup per run, zero full project scans.
  expect(listProject).not.toHaveBeenCalled();
  expect(listCrewRun).toHaveBeenCalledTimes(4);
});
