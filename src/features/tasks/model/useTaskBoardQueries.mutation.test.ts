// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
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
import { useTaskBoardQueries } from "./useTaskBoardQueries";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  capabilities: vi.fn(),
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
function Probe() {
  const probed = useTaskBoardQueries();
  // Publish the committed value to the test after render, not during it.
  useLayoutEffect(() => {
    latest = probed;
  });
  return null;
}
const Harness = withQueryClient(Probe);

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
  ({ machineId, machineName: `Host ${machineId}`, dailyMinutes, usedMinutes: 0 }) as unknown as MachineLimits;

const result = <T,>(machineId: string, data: T[]): MachineResult<T> => ({
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
  mocks.capabilities.mockResolvedValue([
    HOST_TASKS,
    HOST_TASKS_TODO,
    HOST_GOALS,
    HOST_STEWARDS,
    HOST_SETTINGS,
  ]);
  const pick =
    <T,>(store: Record<string, T[]>, kind: keyof typeof holds) =>
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
    expect(mocks.rememberGoal).toHaveBeenLastCalledWith(expect.objectContaining({ id: "g1" }), true);
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
