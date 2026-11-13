import { expect, it, vi } from "vitest";
import type { ServerBindings } from "./bindings";
import { createRuntimeSlot } from "./runtime-slot";
import { createTasksRuntime } from "./tasks";

const controls = vi.hoisted(() => {
  let releaseSprints!: () => void;
  const sprintsReady = new Promise<void>((resolve) => {
    releaseSprints = resolve;
  });
  return { sprintsReady, releaseSprints };
});
vi.mock("../automations/automations", () => ({ HostAutomations: class {} }));
vi.mock("../tasks/tasks", () => ({ HostTasks: class {} }));
vi.mock("../goals/goals", () => ({ HostGoals: class {} }));
vi.mock("../sprints/sprints", () => ({
  HostSprints: class {
    ready = controls.sprintsReady;
  },
}));

it("publishes original task locals before each readiness wait", async () => {
  let releaseAutomations!: () => void;
  let releaseTasks!: () => void;
  let releaseGoals!: () => void;
  const automations = {
    bindTasks: vi.fn(),
    ready: new Promise<void>((resolve) => {
      releaseAutomations = resolve;
    }),
  } as ServerBindings["automations"];
  const tasks = {
    ready: new Promise<void>((resolve) => {
      releaseTasks = resolve;
    }),
  } as ServerBindings["tasks"];
  const goals = {
    ready: new Promise<void>((resolve) => {
      releaseGoals = resolve;
    }),
  } as ServerBindings["goals"];
  const slot = createRuntimeSlot<Awaited<ReturnType<typeof createTasksRuntime>>>();
  let settled = false;
  const ready = createTasksRuntime(
    {
      executeBackgroundEffect: vi.fn(async () => {
        throw new Error("Unexpected native effect");
      }),
      automationsOverride: automations,
      tasksOverride: tasks,
      goalsOverride: goals,
      engine: { store: {} } as ServerBindings["engine"],
      managed: {} as ServerBindings["managed"],
    },
    slot.publish,
  ).then(() => {
    settled = true;
  });

  expect(slot.current.automations).toBe(automations);
  expect(() => slot.current.tasks).toThrow(ReferenceError);
  releaseAutomations();
  await Promise.resolve();
  expect(slot.current.tasks).toBe(tasks);
  expect(settled).toBe(false);
  expect(() => slot.current.sprints).toThrow(ReferenceError);

  releaseTasks();
  await Promise.resolve();
  expect(slot.current.sprints.ready).toBe(controls.sprintsReady);
  expect(() => slot.current.goals).toThrow(ReferenceError);
  controls.releaseSprints();
  await Promise.resolve();
  expect(slot.current.goals).toBe(goals);
  expect(settled).toBe(false);

  releaseGoals();
  await ready;
  expect(settled).toBe(true);
});

it("does not replace a published runtime with a different owner", () => {
  const slot = createRuntimeSlot<{ id: string }>();
  expect(() => slot.current).toThrow(ReferenceError);
  const original = { id: "original" };
  slot.publish(original);
  expect(() => slot.publish({ id: "replacement" })).toThrow("already published");
  expect(slot.current).toBe(original);
});
