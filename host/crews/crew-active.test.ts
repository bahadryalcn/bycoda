import { forEachAsync } from "../async-collections";
import { afterEach, describe, expect, it } from "vitest";
import { HostStore } from "../store";
import {
  initializeCrewSchedulerProjection,
  readCrewState,
  writeCrewState,
} from "./crew-scheduler-projection";
import { listActiveCrewMembers } from "./crew-active";
import {
  defaultCrewPolicy,
  type CrewAgent,
  type CrewRun,
} from "../../src/features/crews/model/crew";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { CrewsActiveListResultSchema } from "../../src/shared/model/host-contracts/crews";

const stores: HostStore[] = [];
afterEach(async () => {
  await forEachAsync(stores.splice(0), async (store) => await store.close());
});

const agent = (id: string, role: CrewAgent["role"], extra: Partial<CrewAgent> = {}): CrewAgent => ({
  id,
  name: `Name ${id}`,
  role,
  instructions: "SECRET INSTRUCTIONS",
  selection: "fixed",
  candidates: [],
  ...extra,
});
const run = (id: string, projectId: string, extra: Partial<CrewRun> = {}): CrewRun => ({
  id,
  projectId,
  definition: {
    id: `def-${id}`,
    name: `Crew ${id}`,
    projectId,
    agents: [
      agent("lead", "coordinator"),
      agent("dev", "specialist", {
        avatar: { glasses: true },
        handle: "dev",
        source: { id: "lib-dev", updatedAt: 1 },
      }),
      agent("rev", "reviewer"),
    ],
    policy: defaultCrewPolicy,
    updatedAt: 1,
  },
  status: "active",
  coordinatorSessionId: `${id}-coordinator`,
  launch: { candidate: {} as never, runtimeMode: "supervised", prompt: "SECRET PROMPT" },
  assignments: [],
  messages: [],
  notifications: {},
  pendingDelivery: { commandId: "c", text: "SECRET DELIVERY", notifications: {} },
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});
const task = (id: string, runId: string, projectId: string, extra: Partial<HostTask> = {}) =>
  ({
    id,
    title: `Task ${id}`,
    prompt: "SECRET TASK PROMPT",
    projectId,
    crewRunId: runId,
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    startedAt: 50,
    sessionId: `${id}-session`,
    ...extra,
  }) as unknown as HostTask;
const assign = (taskId: string, memberId = "dev") => ({
  id: `a-${taskId}`,
  memberId,
  taskId,
  title: taskId,
  candidate: {} as never,
  reason: "",
});

async function setup(runs: CrewRun[], tasks: HostTask[]) {
  const store = new HostStore(":memory:");
  stores.push(store);
  await initializeCrewSchedulerProjection(store);
  const state = await readCrewState(store);
  await store.transaction(() => writeCrewState(store, { ...state, runs }));
  const index = new Map(tasks.map((t) => [t.id, t]));
  const ports = {
    store,
    tasks: {
      taskIndex: async (ids?: readonly string[]) =>
        ids
          ? new Map(ids.flatMap((id) => (index.has(id) ? [[id, index.get(id)!] as const] : [])))
          : index,
    },
  };
  return {
    store,
    ports,
    writeRuns: (next: CrewRun[]) =>
      store.transaction(async () =>
        writeCrewState(store, { ...(await readCrewState(store)), runs: next }),
      ),
  };
}

describe("listActiveCrewMembers", () => {
  it("lists working members across projects, includes paused runs, skips finished runs", async () => {
    const f = await setup(
      [
        run("r1", "p1", { assignments: [assign("t1")] }),
        run("r2", "p2", { status: "paused", assignments: [assign("t2")] }),
        run("r3", "p3", { status: "finished", assignments: [assign("t3")] }),
      ],
      [task("t1", "r1", "p1"), task("t2", "r2", "p2"), task("t3", "r3", "p3")],
    );
    const result = await listActiveCrewMembers(f.ports);
    expect(result.items.map((i) => [i.runId, i.kind, i.runStatus, i.taskId])).toEqual([
      ["r1", "worker", "active", "t1"],
      ["r2", "worker", "paused", "t2"],
    ]);
    expect(result.items[0]).toMatchObject({
      memberId: "dev",
      memberName: "Name dev",
      memberRole: "specialist",
      handle: "dev",
      avatar: { glasses: true },
      memberSource: { id: "lib-dev" },
      definitionName: "Crew r1",
      startedAt: 50,
      sessionId: "t1-session",
    });
    expect(result.truncated).toBeUndefined();
    expect(CrewsActiveListResultSchema.parse(result)).toEqual(result);
  });

  it("redacts prompts, instructions, launch and pending delivery", async () => {
    const f = await setup(
      [run("r1", "p1", { assignments: [assign("t1")] })],
      [task("t1", "r1", "p1")],
    );
    const text = JSON.stringify(await listActiveCrewMembers(f.ports));
    expect(text).not.toMatch(/SECRET|launch|pendingDelivery|instructions|prompt/);
  });

  it("maps attention and review rows", async () => {
    const f = await setup(
      [
        run("r1", "p1", {
          assignments: [assign("t1"), assign("t2"), assign("t3"), assign("t4"), assign("t5")],
          messages: [{ id: "m1", from: "dev", text: "need input", createdAt: 1 }],
        }),
      ],
      [
        task("t1", "r1", "p1", { status: "review" }),
        task("t2", "r1", "p1", { status: "blocked" }),
        task("t3", "r1", "p1", {
          status: "verifying",
          reviewer: { sessionId: "rv", startedAt: 70 },
        } as Partial<HostTask>),
        task("t4", "r1", "p1", { status: "done" }),
        task("t5", "r1", "p1", { status: "todo" }),
      ],
    );
    const items = (await listActiveCrewMembers(f.ports)).items;
    expect(items.map((i) => [i.kind, i.taskId, i.attention])).toEqual([
      ["coordinator", undefined, "decision"],
      ["worker", "t1", "review"],
      ["worker", "t2", "blocked"],
      ["review", "t3", undefined],
    ]);
    expect(items[3]).toMatchObject({ memberId: "rev", sessionId: "rv", startedAt: 70 });
  });

  it("scopes to one project when asked", async () => {
    const f = await setup(
      [
        run("r1", "p1", { assignments: [assign("t1")] }),
        run("r2", "p2", { assignments: [assign("t2")] }),
      ],
      [task("t1", "r1", "p1"), task("t2", "r2", "p2")],
    );
    const own = await listActiveCrewMembers(f.ports, undefined, "p2");
    expect(own.items.map((i) => [i.projectId, i.runId])).toEqual([["p2", "r2"]]);
    expect((await listActiveCrewMembers(f.ports, undefined, "none")).items).toEqual([]);
  });

  it("bounds output with limit and reports truncated", async () => {
    const ids = ["t1", "t2", "t3"];
    const f = await setup(
      [run("r1", "p1", { assignments: ids.map((id) => assign(id)) })],
      ids.map((id) => task(id, "r1", "p1")),
    );
    const result = await listActiveCrewMembers(f.ports, 2);
    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect((await listActiveCrewMembers(f.ports, 3)).truncated).toBeUndefined();
  });

  it("uses the run snapshot identity after the definition is edited", async () => {
    const f = await setup(
      [run("r1", "p1", { assignments: [assign("t1")] })],
      [task("t1", "r1", "p1")],
    );
    const state = await readCrewState(f.store);
    await f.store.transaction(() =>
      writeCrewState(f.store, {
        ...state,
        definitions: [
          {
            ...run("r1", "p1").definition,
            id: "def-r1",
            name: "Renamed",
            agents: [agent("dev", "specialist", { name: "Edited" })],
          },
        ],
      }),
    );
    expect((await listActiveCrewMembers(f.ports)).items[0]).toMatchObject({
      memberName: "Name dev",
      definitionName: "Crew r1",
    });
  });
});
