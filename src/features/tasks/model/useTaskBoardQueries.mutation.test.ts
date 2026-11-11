// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/support/queryTest";
import type { RemoteMachine } from "../../connections/model/protocol";
import type { MachineResult } from "../../automations/model/machineResults";
import type { BoardGoal } from "./goalClient";
import type { MachineLimits } from "./settingsClient";
import type { BoardSteward } from "./stewardClient";
import type { BoardTask } from "./taskClient";
import { HOST_GOALS } from "./hostGoals";
import { HOST_SETTINGS } from "./hostSettings";
import { HOST_STEWARDS } from "./hostStewards";
import { HOST_TASKS, HOST_TASKS_TODO } from "./hostTasks";
import { HOST_SPRINTS } from "./hostSprints";
import { planningCoordinator } from "./sprintClient";
import { useTaskBoardQueries } from "./useTaskBoardQueries";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  capabilities: vi.fn(),
  projects: vi.fn(),
  listTasks: vi.fn(),
  rememberTasks: vi.fn(),
  listGoals: vi.fn(),
  rememberGoal: vi.fn(),
  listStewards: vi.fn(),
  rememberSteward: vi.fn(),
  listLimits: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../automations/model/machineSnapshot", () => ({
  machineCapabilities: mocks.capabilities,
  machineProjects: mocks.projects,
  invalidateMachineSnapshot: vi.fn(),
}));
vi.mock("./taskClient", async (original) => ({
  ...(await original<typeof import("./taskClient")>()),
  listBoardTaskResults: mocks.listTasks,
  rememberBoardTasks: mocks.rememberTasks,
  subscribeBoardTaskChanges: () => () => {},
}));
vi.mock("./goalClient", async (original) => ({
  ...(await original<typeof import("./goalClient")>()),
  listBoardGoalResults: mocks.listGoals,
  rememberBoardGoal: mocks.rememberGoal,
}));
vi.mock("./stewardClient", async (original) => ({
  ...(await original<typeof import("./stewardClient")>()),
  listBoardStewardResults: mocks.listStewards,
  rememberBoardSteward: mocks.rememberSteward,
}));
vi.mock("./settingsClient", async (original) => ({
  ...(await original<typeof import("./settingsClient")>()),
  listMachineLimits: mocks.listLimits,
}));

type Hook = ReturnType<typeof useTaskBoardQueries>;
let latest: Hook;
function Probe({ scope = "all" }: { scope?: string }) {
  const probed = useTaskBoardQueries(scope);
  // Publish the committed value to the test after render, not during it.
  useLayoutEffect(() => {
    latest = probed;
  });
  return null;
}
const Harness = withQueryClient(Probe);
function PlanningProbe({ scope }: { scope: string }) {
  const scoped = useTaskBoardQueries(scope, { planningCatalog: true });
  useLayoutEffect(() => {
    latest = scoped;
  });
  return null;
}
const PlanningHarness = withQueryClient(PlanningProbe);

let container: HTMLDivElement;
let root: Root;

const machine = (id: string): RemoteMachine =>
  ({
    id,
    name: `Host ${id}`,
    endpoint: `https://${id}.test`,
    environmentId: `env-${id}`,
  }) as RemoteMachine;

const task = (id: string, machineId: string, title = id): BoardTask =>
  ({
    id,
    title,
    projectId: "project",
    status: "queued",
    machineId,
    machineName: `Host ${machineId}`,
    cwd: "/project",
  }) as BoardTask;
const goal = (id: string, machineId: string, title = id): BoardGoal =>
  ({ id, title, machineId, machineName: `Host ${machineId}` }) as BoardGoal;
const steward = (id: string, machineId: string, title = id): BoardSteward =>
  ({ id, title, machineId, machineName: `Host ${machineId}` }) as BoardSteward;
const limits = (machineId: string, dailyMinutes: number): MachineLimits =>
  ({
    machineId,
    machineName: `Host ${machineId}`,
    dailyMinutes,
    usedMinutes: 0,
  }) as unknown as MachineLimits;

const result = <T>(machineId: string, data: T[]): MachineResult<T> => ({
  machineId,
  machineName: `Host ${machineId}`,
  status: "ok",
  data,
  stale: false,
});

/** What the fake hosts currently hold, per machine. */
const world = {
  machines: [] as RemoteMachine[],
  tasks: {} as Record<string, BoardTask[]>,
  goals: {} as Record<string, BoardGoal[]>,
  stewards: {} as Record<string, BoardSteward[]>,
  limits: {} as Record<string, MachineLimits>,
};
/** A read that is held in flight until the test releases it with an (older) answer. */
type Hold = { promise: Promise<unknown>; resolve: (value: unknown) => void };
const holds: Partial<Record<"tasks" | "goals" | "stewards" | "limits", Hold>> = {};
function hold(kind: keyof typeof holds): Hold {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => (resolve = done));
  return (holds[kind] = { promise, resolve });
}
const take = (kind: keyof typeof holds) => {
  const held = holds[kind];
  delete holds[kind];
  return held?.promise;
};

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));
async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 40 && !condition(); attempt++) await settle();
  expect(condition()).toBe(true);
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(world, {
    machines: [machine("a")],
    tasks: { a: [task("t1", "a", "Old title")] },
    goals: { a: [goal("g1", "a", "Old goal")] },
    stewards: { a: [steward("s1", "a", "Old steward")] },
    limits: { a: limits("a", 60) },
  });
  for (const key of Object.keys(holds)) delete holds[key as keyof typeof holds];
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "remote_machines" ? world.machines : null,
  );
  mocks.projects.mockResolvedValue([]);
  mocks.capabilities.mockResolvedValue([
    HOST_TASKS,
    HOST_TASKS_TODO,
    HOST_GOALS,
    HOST_STEWARDS,
    HOST_SETTINGS,
  ]);
  const pick =
    <T>(store: Record<string, T[]>, kind: keyof typeof holds) =>
    async (machines: RemoteMachine[]) =>
      (take(kind) as Promise<MachineResult<T>[]> | undefined) ??
      machines.map((entry) => result(entry.id, store[entry.id] ?? []));
  mocks.listTasks.mockImplementation((machines) => pick(world.tasks, "tasks")(machines));
  mocks.listGoals.mockImplementation((machines) => pick(world.goals, "goals")(machines));
  mocks.listStewards.mockImplementation((machines) => pick(world.stewards, "stewards")(machines));
  mocks.listLimits.mockImplementation(
    async (machines: RemoteMachine[]) =>
      (take("limits") as Promise<MachineLimits[]> | undefined) ??
      machines.flatMap((entry) => (world.limits[entry.id] ? [world.limits[entry.id]] : [])),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => root.render(createElement(Harness)));
  await until(() => !latest.board.pending && latest.board.tasks.length > 0);
}

/** Starts a board refresh whose read of `kind` stays in flight. */
async function refreshWithHeldRead(kind: keyof typeof holds) {
  const held = hold(kind);
  let refreshed: Promise<void> | undefined;
  await act(async () => {
    refreshed = latest.refresh();
  });
  await until(() => holds[kind] === undefined);
  return {
    release: async (older: unknown) => {
      await act(async () => {
        held.resolve(older);
        await refreshed;
      });
      await settle();
    },
  };
}

const titles = (items: { title?: string }[]) => items.map((item) => item.title).sort();

describe("useTaskBoardQueries confirmed writers", () => {
  it("putTask cancels a machine read in flight so the stale read cannot overwrite it", async () => {
    await mount();
    const inFlight = await refreshWithHeldRead("tasks");

    await act(async () => latest.putTask(task("t1", "a", "Confirmed title")));
    // The board shows the put at once, before the host read settles.
    expect(titles(latest.board.tasks)).toEqual(["Confirmed title"]);
    expect(mocks.rememberTasks).toHaveBeenCalledWith([expect.objectContaining({ id: "t1" })]);

    await inFlight.release([result("a", [task("t1", "a", "Old title")])]);
    expect(titles(latest.board.tasks)).toEqual(["Confirmed title"]);
  });

  it("putTask adds a new task beside the existing ones and keeps other machines untouched", async () => {
    world.machines = [machine("a"), machine("b")];
    world.tasks.b = [task("b1", "b", "On b")];
    await mount();
    await until(() => latest.board.tasks.length === 2);

    await act(async () => latest.putTask(task("t2", "a", "Brand new")));
    expect(titles(latest.board.tasks)).toEqual(["Brand new", "Old title", "On b"]);
  });

  it("putTask for a machine the board does not know changes nothing", async () => {
    await mount();
    await act(async () => latest.putTask(task("zz", "unknown", "Elsewhere")));
    expect(titles(latest.board.tasks)).toEqual(["Old title"]);
  });

  it("putGoal and removeGoal win over a goals read that started earlier", async () => {
    await mount();
    await until(() => latest.board.goals.length === 1);

    const saving = await refreshWithHeldRead("goals");
    await act(async () => latest.putGoal(goal("g1", "a", "Confirmed goal")));
    expect(titles(latest.board.goals)).toEqual(["Confirmed goal"]);
    expect(mocks.rememberGoal).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }));
    await saving.release([result("a", [goal("g1", "a", "Old goal")])]);
    expect(titles(latest.board.goals)).toEqual(["Confirmed goal"]);

    const removing = await refreshWithHeldRead("goals");
    await act(async () => latest.removeGoal(goal("g1", "a")));
    expect(latest.board.goals).toEqual([]);
    expect(mocks.rememberGoal).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "g1" }),
      true,
    );
    await removing.release([result("a", [goal("g1", "a", "Confirmed goal")])]);
    expect(latest.board.goals).toEqual([]);
  });

  it("putSteward wins over a stewards read that started earlier", async () => {
    await mount();
    await until(() => latest.board.stewards.length === 1);
    const inFlight = await refreshWithHeldRead("stewards");

    await act(async () => latest.putSteward(steward("s1", "a", "Confirmed steward")));
    expect(titles(latest.board.stewards)).toEqual(["Confirmed steward"]);
    await inFlight.release([result("a", [steward("s1", "a", "Old steward")])]);
    expect(titles(latest.board.stewards)).toEqual(["Confirmed steward"]);
  });

  it("putLimits replaces only the saved machine's limits and survives an older read", async () => {
    world.machines = [machine("a"), machine("b")];
    world.limits.b = limits("b", 30);
    await mount();
    await until(() => latest.board.limits.length === 2);

    const inFlight = await refreshWithHeldRead("limits");
    await act(async () => latest.putLimits(limits("a", 120)));
    const minutes = () =>
      Object.fromEntries(
        latest.board.limits.map((entry) => [entry.machineId, (entry as any).dailyMinutes]),
      );
    expect(minutes()).toEqual({ a: 120, b: 30 });
    await inFlight.release([limits("a", 60)]);
    expect(minutes()).toEqual({ a: 120, b: 30 });
  });

  it("lets the next read replace a confirmed write once the host reports it", async () => {
    await mount();
    await act(async () => latest.putTask(task("t1", "a", "Confirmed title")));
    world.tasks.a = [task("t1", "a", "Confirmed title"), task("t9", "a", "From host")];
    await act(async () => latest.refresh(true));
    await until(() => latest.board.tasks.length === 2);
    expect(titles(latest.board.tasks)).toEqual(["Confirmed title", "From host"]);
  });
});

it("does not probe an unrelated machine until All projects is requested", async () => {
  world.machines.push(machine("b"));
  await act(async () =>
    root.render(createElement(Harness, { scope: JSON.stringify(["env-a", "project"]) })),
  );
  await until(() => latest.board.hasTaskAnswer && !latest.board.pending);
  expect(mocks.capabilities.mock.calls.map(([entry]) => entry.id)).toEqual(["a"]);
  await act(async () => latest.refresh(true));
  expect(mocks.capabilities.mock.calls.every(([entry]) => entry.id === "a")).toBe(true);
  await act(async () => root.render(createElement(Harness, { scope: "all" })));
  await until(() => mocks.capabilities.mock.calls.some(([entry]) => entry.id === "b"));
});

it("keeps a saved local planning authority for an initially selected legacy remote source without reading unrelated collections", async () => {
  world.machines.push(machine("b"));
  mocks.capabilities.mockImplementation(async (entry: RemoteMachine) => [
    HOST_TASKS,
    HOST_TASKS_TODO,
    HOST_GOALS,
    HOST_STEWARDS,
    HOST_SETTINGS,
    ...(entry.id === "a" ? [HOST_SPRINTS] : []),
  ]);
  mocks.projects.mockImplementation(async (entry: RemoteMachine) => [
    { id: "project", cwd: `/${entry.id}`, name: `Project ${entry.id}` },
  ]);
  await act(async () =>
    root.render(createElement(PlanningHarness, { scope: JSON.stringify(["env-b", "project"]) })),
  );
  await until(() => latest.board.hasTaskAnswer && latest.board.projects.length === 2);
  expect(latest.board.planningMachines.map((entry) => entry.id)).toEqual(["a", "b"]);
  expect(planningCoordinator(latest.board.planningMachines, "env-a")?.id).toBe("a");
  for (const mock of [mocks.listTasks, mocks.listGoals, mocks.listStewards, mocks.listLimits])
    expect(
      mock.mock.calls.every(([entries]) =>
        entries.every((entry: RemoteMachine) => entry.id === "b"),
      ),
    ).toBe(true);
  const collectionCalls = [
    mocks.listTasks,
    mocks.listGoals,
    mocks.listStewards,
    mocks.listLimits,
  ].map((mock) => mock.mock.calls.length);
  mocks.projects.mockImplementation(async (entry: RemoteMachine) => [
    { id: "project", cwd: `/${entry.id}`, name: `Refreshed ${entry.id}` },
  ]);
  await act(async () => latest.refresh(true, "a"));
  expect(latest.board.projects.find((entry) => entry.environmentId === "env-a")?.name).toBe(
    "Refreshed a",
  );
  expect(
    mocks.capabilities.mock.calls.some(([entry, fresh]) => entry.id === "a" && fresh === true),
  ).toBe(true);
  expect(
    [mocks.listTasks, mocks.listGoals, mocks.listStewards, mocks.listLimits].map(
      (mock) => mock.mock.calls.length,
    ),
  ).toEqual(collectionCalls);
  await act(async () =>
    root.render(createElement(PlanningHarness, { scope: JSON.stringify(["env-a", "project"]) })),
  );
  await until(() => latest.board.hasTaskAnswer && latest.board.machines[0]?.id === "a");
  expect(latest.board.planningMachines.find((entry) => entry.environmentId === "env-a")?.id).toBe(
    "a",
  );
  expect(latest.board.projects.map((entry) => entry.environmentId)).toEqual(["env-a", "env-b"]);
});

it("does not use another host's answer to finish a newly selected host's loading state", async () => {
  world.machines.push(machine("b"));
  await act(async () =>
    root.render(createElement(Harness, { scope: JSON.stringify(["env-a", "project"]) })),
  );
  await until(() => latest.board.hasTaskAnswer && !latest.board.pending);
  const held = hold("tasks");
  await act(async () =>
    root.render(createElement(Harness, { scope: JSON.stringify(["env-b", "project"]) })),
  );
  await settle();
  expect(latest.board.hasTaskAnswer).toBe(false);
  expect(latest.board.pending).toBe(true);
  expect(latest.board.tasks).toEqual([]);
  await act(async () => held.resolve([result("b", [])]));
  await until(() => latest.board.hasTaskAnswer);
});

it("publishes project discovery independently and retains last-known projects after failure", async () => {
  world.machines.push(machine("b"));
  let release!: (value: unknown) => void;
  const remote = new Promise((resolve) => {
    release = resolve;
  });
  mocks.projects.mockImplementation(async (entry: RemoteMachine) =>
    entry.id === "b" ? remote : [{ id: "project", cwd: "/a", name: "Local project" }],
  );
  await act(async () => root.render(createElement(Harness)));
  await until(() => latest.board.projects.length === 1);
  expect(latest.board.projects[0].name).toBe("Local project");
  await act(async () => release([{ id: "remote", cwd: "/b", name: "Remote project" }]));
  await until(() => latest.board.projects.length === 2);
  mocks.projects.mockRejectedValue(new Error("Project discovery unavailable"));
  await act(async () => latest.refresh(true));
  expect(latest.board.projects).toHaveLength(2);
  expect(latest.board.error).toContain("Project discovery unavailable");
});

it("retains limits as stale after failure and retries only their host", async () => {
  world.machines.push(machine("b"));
  world.limits.b = limits("b", 30);
  await mount();
  mocks.listLimits.mockImplementation(async (entries: RemoteMachine[]) => {
    if (entries[0].id === "a") throw new Error("Limits unavailable");
    return [world.limits.b];
  });
  await act(async () => latest.refresh(true, "a"));
  expect(latest.board.limits.find((entry) => entry.machineId === "a")).toMatchObject({
    stale: true,
    dailyMinutes: 60,
  });
  expect(latest.board.limitErrors).toEqual([
    { machineId: "a", machineName: "Host a", error: "Limits unavailable" },
  ]);
  expect(latest.board.taskError).toBeFalsy();
  mocks.listLimits.mockClear();
  mocks.listLimits.mockResolvedValue([world.limits.a]);
  await act(async () => latest.refresh(true, "a"));
  expect(
    mocks.listLimits.mock.calls.map(([entries]) => entries.map((entry: RemoteMachine) => entry.id)),
  ).toEqual([["a"]]);
  expect(latest.board.limitErrors).toEqual([]);
  expect(latest.board.limits.find((entry) => entry.machineId === "a")?.stale).toBe(false);
});
