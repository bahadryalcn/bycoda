import { afterEach, describe, expect, it } from "vitest";
import { HostStore } from "./store";
import { HostSprints } from "./sprints";
import {
  sprintProjectKey,
  type SprintCreateInput,
  type SprintTaskSnapshot,
} from "../src/features/tasks/model/hostSprints";

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});
async function setup() {
  const store = new HostStore(":memory:");
  stores.push(store);
  let time = 1000;
  const sprints = new HostSprints(store, () => time);
  const projects = [
    { environmentId: "pc", projectId: "a", cwd: "/a", name: "A" },
    { environmentId: "mac", projectId: "b", cwd: "/b", name: "B" },
  ];
  const input: SprintCreateInput = {
    id: "one",
    requestId: "create",
    name: "Sprint 1",
    projects,
    capacityPoints: 20,
    projectCapacities: { [sprintProjectKey(projects[0])]: 10 },
  };
  const task = (
    id: string,
    projectId: string,
    status: SprintTaskSnapshot["status"] = "todo",
  ): SprintTaskSnapshot => ({ id, projectId, title: id, status, updatedAt: time });
  await sprints.ingest({
    environmentId: "pc",
    cursor: 0,
    snapshot: { cursor: 0, tasks: [task("same", "a")] },
  });
  await sprints.ingest({
    environmentId: "mac",
    cursor: 0,
    snapshot: { cursor: 0, tasks: [task("same", "b")] },
  });
  return {
    store,
    sprints,
    input,
    task,
    advance: (value: number) => {
      time = value;
    },
  };
}

describe("HostSprints", () => {
  it("marks delayed effective times as incomplete history instead of inventing exact earlier totals", async () => {
    const { sprints, input, advance } = await setup();
    await sprints.create(input);
    await sprints.plan({
      environmentId: "pc",
      projectId: "a",
      taskId: "same",
      sprintId: "one",
      storyPoints: 5,
      expectedRevision: 0,
      requestId: "plan",
    });
    advance(2000);
    await sprints.start("one", { expectedRevision: 1, requestId: "start" });
    await sprints.ingest({
      environmentId: "pc",
      cursor: 1,
      events: [
        {
          sequence: 1,
          projectId: "a",
          taskId: "same",
          status: "done",
          effectiveAt: 1500,
          deleted: false,
        },
      ],
    });
    const report = await sprints.report("one"),
      event = report.ledger.at(-1)!;
    expect(event).toMatchObject({ at: 2000, effectiveAt: 1500 });
    expect(
      report.sources.find((source) => source.environmentId === "pc")?.historyAvailableFrom,
    ).toBe(2000);
    expect(report.totals.completedPoints).toBe(5);
  });
  it("blocks lifecycle and planning until paged sources catch up inside the sprint's project scope", async () => {
    const { sprints, input, task } = await setup();
    await sprints.create(input);
    await sprints.ingest({ environmentId: "pc", cursor: 0, events: [], caughtUp: false });
    await expect(
      sprints.start("one", { expectedRevision: 1, requestId: "pending-start" }),
    ).rejects.toThrow("Refresh all");
    await expect(
      sprints.plan({
        environmentId: "pc",
        projectId: "a",
        taskId: "same",
        sprintId: "one",
        expectedRevision: 0,
        requestId: "pending-plan",
      }),
    ).rejects.toThrow("Refresh the task");
    await sprints.ingest({
      environmentId: "pc",
      cursor: 0,
      visibleProjectIds: [],
      snapshot: { cursor: 0, tasks: [] },
      caughtUp: true,
    });
    await expect(
      sprints.start("one", { expectedRevision: 1, requestId: "wrong-scope" }),
    ).rejects.toThrow("Refresh all");
    await sprints.ingest({
      environmentId: "pc",
      cursor: 0,
      visibleProjectIds: ["a"],
      snapshot: { cursor: 0, tasks: [task("same", "a")] },
      caughtUp: true,
    });
    expect(
      (await sprints.start("one", { expectedRevision: 1, requestId: "ready-start" })).state,
    ).toBe("active");
  });
  it("preserves omitted optional fields and explicitly clears goal and dates over JSON", async () => {
    const { sprints, input } = await setup();
    await sprints.create({ ...input, goal: "Original goal", startsAt: 1000, endsAt: 5000 });
    const retained = await sprints.update("one", {
      expectedRevision: 1,
      requestId: "rename",
      name: "Renamed",
    });
    expect(retained).toMatchObject({ goal: "Original goal", startsAt: 1000, endsAt: 5000 });
    const cleared = await sprints.update(
      "one",
      JSON.parse(
        JSON.stringify({
          expectedRevision: 2,
          requestId: "clear",
          goal: null,
          startsAt: null,
          endsAt: null,
        }),
      ),
    );
    expect(cleared.goal).toBeUndefined();
    expect(cleared.startsAt).toBeUndefined();
    expect(cleared.endsAt).toBeUndefined();
    expect((await sprints.get("one"))?.name).toBe("Renamed");
  });
  it("keeps cross-machine identities separate and replays commands without double changes", async () => {
    const { sprints, input } = await setup();
    const created = await sprints.create(input);
    expect(await sprints.create(input)).toEqual(created);
    await expect(sprints.create({ ...input, name: "Different" })).rejects.toThrow(
      "different sprint changes",
    );
    const a = {
      environmentId: "pc",
      projectId: "a",
      taskId: "same",
      sprintId: "one",
      expectedRevision: 0,
      requestId: "plan-a",
      storyPoints: 3,
    };
    await sprints.plan(a);
    await sprints.plan(a);
    await sprints.plan({
      ...a,
      environmentId: "mac",
      projectId: "b",
      requestId: "plan-b",
      storyPoints: 5,
    });
    expect((await sprints.report("one")).totals).toMatchObject({
      tasks: 2,
      points: 8,
      remainingPoints: 8,
    });
    await expect(sprints.plan({ ...a, requestId: "stale" })).rejects.toThrow("planning changed");
    await expect(
      sprints.update("one", { expectedRevision: 0, requestId: "stale-sprint", name: "No" }),
    ).rejects.toThrow("Sprint changed");
  });
  it("journals completion, reopening, deletion and duplicate source delivery exactly once", async () => {
    const { sprints, input, task } = await setup();
    await sprints.create(input);
    await sprints.plan({
      environmentId: "pc",
      projectId: "a",
      taskId: "same",
      sprintId: "one",
      storyPoints: 8,
      expectedRevision: 0,
      requestId: "plan",
    });
    await sprints.start("one", { expectedRevision: 1, requestId: "start" });
    const event = {
      sequence: 1,
      projectId: "a",
      taskId: "same",
      status: "done" as const,
      effectiveAt: 1100,
      deleted: false,
      task: task("same", "a", "done"),
    };
    await sprints.ingest({ environmentId: "pc", cursor: 1, events: [event] });
    const report = await sprints.report("one");
    expect(report.totals.completedPoints).toBe(8);
    await sprints.ingest({ environmentId: "pc", cursor: 1, events: [event] });
    expect((await sprints.report("one")).ledger).toHaveLength(report.ledger.length);
    await sprints.ingest({
      environmentId: "pc",
      cursor: 2,
      events: [{ ...event, sequence: 2, status: "review", effectiveAt: 1200 }],
    });
    expect((await sprints.report("one")).totals.remainingPoints).toBe(8);
    await sprints.ingest({
      environmentId: "pc",
      cursor: 3,
      events: [{ ...event, sequence: 3, deleted: true, effectiveAt: 1300 }],
    });
    expect((await sprints.report("one")).totals).toMatchObject({
      points: 0,
      completedPoints: 0,
      deleted: 1,
    });
  });
  it("rolls back cursor gaps and freezes completed reports after future source changes", async () => {
    const { sprints, input, task } = await setup();
    await sprints.create(input);
    await sprints.plan({
      environmentId: "pc",
      projectId: "a",
      taskId: "same",
      sprintId: "one",
      storyPoints: 5,
      expectedRevision: 0,
      requestId: "plan",
    });
    await expect(
      sprints.ingest({
        environmentId: "pc",
        cursor: 2,
        events: [
          {
            sequence: 2,
            projectId: "a",
            taskId: "same",
            status: "done",
            effectiveAt: 1200,
            deleted: false,
          },
        ],
      }),
    ).rejects.toThrow("cursor gap");
    expect(
      (await sprints.list()).sources.find((source) => source.environmentId === "pc")?.cursor,
    ).toBe(0);
    await sprints.start("one", { expectedRevision: 1, requestId: "start" });
    await sprints.complete("one", { expectedRevision: 2, requestId: "finish" });
    const frozen = await sprints.report("one");
    await sprints.ingest({
      environmentId: "pc",
      cursor: 1,
      events: [
        {
          sequence: 1,
          projectId: "a",
          taskId: "same",
          status: "done",
          effectiveAt: 2000,
          deleted: false,
          task: task("same", "a", "done"),
        },
      ],
    });
    expect(await sprints.report("one")).toEqual(frozen);
    expect(frozen.frozen).toBe(true);
  });
  it("refuses stale source lifecycle and task planning without mutating execution tables", async () => {
    const { store, sprints, input, advance } = await setup();
    await sprints.create(input);
    advance(62000);
    await expect(sprints.start("one", { expectedRevision: 1, requestId: "start" })).rejects.toThrow(
      "Refresh all",
    );
    await expect(
      sprints.plan({
        environmentId: "pc",
        projectId: "a",
        taskId: "same",
        sprintId: "one",
        expectedRevision: 0,
        requestId: "plan",
      }),
    ).rejects.toThrow("Refresh the task");
    expect(
      await store.db.prepare("SELECT name FROM sqlite_master WHERE name='tasks'").get(),
    ).toBeUndefined();
    expect((await sprints.get("one"))?.state).toBe("planned");
  });
  it("atomically carries unfinished selected work to backlog and preserves frozen membership", async () => {
    const { sprints, input } = await setup();
    await sprints.create(input);
    const planned = await sprints.plan({
      environmentId: "pc",
      projectId: "a",
      taskId: "same",
      sprintId: "one",
      storyPoints: 3,
      expectedRevision: 0,
      requestId: "plan",
    });
    await sprints.start("one", { expectedRevision: 1, requestId: "start" });
    const { sprintTaskKey } = await import("../src/features/tasks/model/hostSprints");
    await expect(
      sprints.complete("one", {
        expectedRevision: 2,
        requestId: "bad-finish",
        rollover: { taskKeys: ["missing"], targetSprintId: null },
      }),
    ).rejects.toThrow("unfinished");
    expect((await sprints.get("one"))?.state).toBe("active");
    await sprints.complete("one", {
      expectedRevision: 2,
      requestId: "finish",
      rollover: { taskKeys: [sprintTaskKey(planned)], targetSprintId: null },
    });
    expect((await sprints.list()).planning[0]).toMatchObject({ sprintId: null, revision: 2 });
    expect((await sprints.report("one")).tasks[0].sprintId).toBe("one");
  });
  it("advances filtered source pages while requiring explicit scope snapshots", async () => {
    const { sprints, task } = await setup();
    await sprints.ingest({
      environmentId: "pc",
      cursor: 3,
      visibleProjectIds: ["a"],
      snapshot: { cursor: 3, tasks: [task("same", "a")] },
    });
    await sprints.ingest({
      environmentId: "pc",
      fromCursor: 3,
      cursor: 6,
      visibleProjectIds: ["a"],
      events: [
        {
          sequence: 5,
          projectId: "a",
          taskId: "same",
          status: "done",
          effectiveAt: 2000,
          deleted: false,
        },
      ],
    });
    expect(
      (await sprints.list()).sources.find((source) => source.environmentId === "pc")?.cursor,
    ).toBe(6);
    await expect(
      sprints.ingest({
        environmentId: "pc",
        fromCursor: 6,
        cursor: 9,
        visibleProjectIds: ["a"],
        events: [
          {
            sequence: 8,
            projectId: "a",
            taskId: "same",
            status: "done",
            effectiveAt: 2000,
            deleted: false,
          },
          {
            sequence: 7,
            projectId: "a",
            taskId: "same",
            status: "review",
            effectiveAt: 2000,
            deleted: false,
          },
        ],
      }),
    ).rejects.toThrow("strictly ordered");
    await expect(
      sprints.ingest({
        environmentId: "pc",
        fromCursor: 5,
        cursor: 7,
        visibleProjectIds: ["a"],
        events: [],
      }),
    ).rejects.toThrow("cursor gap");
    await expect(
      sprints.ingest({
        environmentId: "pc",
        fromCursor: 6,
        cursor: 7,
        visibleProjectIds: ["a", "b"],
        events: [],
      }),
    ).rejects.toThrow("scoped snapshot");
  });
  it("inherits goal context only for newly discovered tasks inside sprint project scope", async () => {
    const { sprints, input, task } = await setup();
    await sprints.create(input);
    await sprints.setGoalContext({
      environmentId: "pc",
      goalId: "goal",
      sprintId: "one",
      requestId: "context",
      expectedRevision: 0,
    });
    await sprints.ingest({
      environmentId: "pc",
      cursor: 1,
      events: [
        {
          sequence: 1,
          projectId: "a",
          taskId: "generated",
          status: "todo",
          deleted: false,
          effectiveAt: 1100,
          task: { ...task("generated", "a"), goalId: "goal" },
        },
      ],
    });
    expect((await sprints.list()).planning).toMatchObject([
      { taskId: "generated", sprintId: "one", storyPoints: null },
    ]);
    await expect(
      sprints.plan({
        environmentId: "pc",
        projectId: "a",
        taskId: "generated",
        sprintId: "one",
        expectedRevision: 1,
        requestId: "points",
        storyPoints: 4,
      }),
    ).rejects.toThrow("supported story point");
  });
  it("reconciles goal context creation races without overriding explicit backlog decisions", async () => {
    const { sprints, input, task } = await setup();
    await sprints.create(input);
    await sprints.ingest({
      environmentId: "pc",
      cursor: 1,
      events: [
        {
          sequence: 1,
          projectId: "a",
          taskId: "race",
          status: "todo",
          effectiveAt: 1000,
          deleted: false,
          task: { ...task("race", "a"), goalId: "late-context" },
        },
      ],
    });
    await sprints.setGoalContext({
      environmentId: "pc",
      goalId: "late-context",
      sprintId: "one",
      requestId: "late",
      expectedRevision: 0,
    });
    expect((await sprints.list()).planning.find((item) => item.taskId === "race")?.sprintId).toBe(
      "one",
    );
    await sprints.plan({
      environmentId: "pc",
      projectId: "a",
      taskId: "race",
      sprintId: null,
      requestId: "explicit-backlog",
      expectedRevision: 1,
    });
    await sprints.setGoalContext({
      environmentId: "pc",
      goalId: "late-context",
      sprintId: "one",
      requestId: "again",
      expectedRevision: 1,
    });
    expect(
      (await sprints.list()).planning.find((item) => item.taskId === "race")?.sprintId,
    ).toBeNull();
  });
  it("tombstones absent tasks only inside a rehydrated visible project scope", async () => {
    const { sprints, input, task, advance } = await setup();
    await sprints.create(input);
    await sprints.plan({
      environmentId: "pc",
      projectId: "a",
      taskId: "same",
      sprintId: "one",
      storyPoints: 5,
      expectedRevision: 0,
      requestId: "plan",
    });
    await sprints.ingest({
      environmentId: "pc",
      cursor: 1,
      visibleProjectIds: [],
      snapshot: { cursor: 1, tasks: [] },
    });
    expect((await sprints.report("one")).totals.points).toBe(5);
    advance(2000);
    await sprints.ingest({
      environmentId: "pc",
      cursor: 3,
      visibleProjectIds: ["a"],
      snapshot: { cursor: 3, tasks: [] },
    });
    const report = await sprints.report("one");
    expect(report.totals).toMatchObject({ points: 0, completedPoints: 0, deleted: 1 });
    expect(
      report.sources.find((source) => source.environmentId === "pc")?.historyAvailableFrom,
    ).toBe(2000);
    expect(report.tasks[0]).toMatchObject({ title: task("same", "a").title, deleted: true });
  });
});
