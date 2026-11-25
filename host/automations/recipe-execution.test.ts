import { afterEach, expect, it } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { HostTasks } from "../tasks/service";
import { HostAutomations } from "./automations";
import { recipeFromTask } from "../../src/features/automations/model/automationRecipe";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Fixture = Awaited<ReturnType<typeof setup>>;

const steps = [
  { id: "plan", kind: "task" as const, title: "Plan", request: "Write the plan" },
  { id: "ok", kind: "decision" as const, title: "Approve plan", question: "Go ahead?" },
  { id: "build", kind: "task" as const, title: "Build", request: "Build it" },
];

function recipeInput(f: Fixture, over: Record<string, unknown> = {}) {
  return {
    id: "recipe",
    name: "Ship it",
    projectId: f.project.id,
    prompt: "",
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    isolate: false,
    enabled: false,
    recipe: { version: 1, steps },
    ...over,
  };
}

function boot(f: Fixture, now = () => Date.now()) {
  const tasks = new HostTasks(f.store, f.engine);
  const automations = new HostAutomations(f.store, f.engine, now);
  automations.bindTasks(tasks);
  return { tasks, automations };
}

const markDone = (f: Fixture, id: string) =>
  f.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.status','done') WHERE id=?").run(id);

async function instance(automations: HostAutomations, id = "recipe") {
  return (await automations.runs(id))[0]!;
}

it("turns a finished task into a recipe with its request and settings", () => {
  const task = {
    title: "Fix login",
    request: "Fix the login bug",
    prompt: "Fix the login bug\n\nContext:\nx",
    projectId: "p1",
    harness: "codex",
    model: "codex:test",
    modelSettings: { a: "b" },
    runtimeMode: "supervised",
    modelChoice: { kind: "default" },
    executor: { kind: "crew", crewDefinitionId: "crew-1" },
    helpers: { mode: "off" },
    isolate: true,
    maxRunMinutes: 30,
  } as unknown as HostTask;
  const { name, recipe, config } = recipeFromTask(task);
  expect(name).toBe("Fix login");
  expect(recipe.version).toBe(1);
  expect(recipe.steps).toMatchObject([
    { kind: "task", title: "Fix login", request: "Fix the login bug" },
  ]);
  expect(config).toMatchObject({
    projectId: "p1",
    executor: { kind: "crew", crewDefinitionId: "crew-1" },
    helpers: { mode: "off" },
    isolate: true,
    maxRunMinutes: 30,
  });
});

it("creates one task per step exactly once and survives repeated ticks and a restart", async () => {
  const f = await setup();
  let { tasks, automations } = boot(f);
  await automations.save(recipeInput(f));
  const first = await automations.runNow("recipe");
  expect(first.status).toBe("running");
  expect(first.recipe?.results).toMatchObject([{ stepId: "plan", status: "running" }]);
  const planId = first.recipe!.results[0]!.taskId!;
  for (let i = 0; i < 3; i++) await automations.tick();
  expect((await instance(automations)).recipe?.results).toHaveLength(1);
  // The Host restarts: the saved results still mean the first step is not created again.
  await automations.close();
  ({ tasks, automations } = boot(f));
  await automations.tick();
  expect((await instance(automations)).recipe?.results).toHaveLength(1);
  await markDone(f, planId);
  await automations.tick();
  await automations.tick();
  const waiting = await instance(automations);
  expect(waiting).toMatchObject({ status: "running", needsInput: true });
  expect(waiting.recipe?.results.map((entry) => entry.status)).toEqual(["succeeded", "awaiting"]);
  expect((await tasks.list()).filter((task) => task.id.startsWith("recipe-"))).toHaveLength(1);
  await automations.close();
});

it("pauses on an owner decision, then continues on approve", async () => {
  const f = await setup();
  const { tasks, automations } = boot(f);
  await automations.save(recipeInput(f));
  const run = await automations.runNow("recipe");
  await markDone(f, run.recipe!.results[0]!.taskId!);
  await automations.tick();
  const approved = await automations.decide("recipe", run.id, true);
  expect(approved.recipe?.results.map((entry) => entry.status)).toEqual([
    "succeeded",
    "succeeded",
    "running",
  ]);
  expect(approved.needsInput).toBeFalsy();
  await expect(automations.decide("recipe", run.id, true)).rejects.toThrow(
    "waiting for a decision",
  );
  await markDone(f, approved.recipe!.results[2]!.taskId!);
  await automations.tick();
  const finished = await instance(automations);
  expect(finished.status).toBe("succeeded");
  expect(finished.recipe?.results[2]?.summary).toBe("Build");
  expect(await tasks.get(approved.recipe!.results[2]!.taskId!)).toMatchObject({
    request: "Build it",
    source: "automation",
    automationRunId: run.id,
  });
  await automations.close();
});

it("stops with a structured reason when the owner declines", async () => {
  const f = await setup();
  const { tasks, automations } = boot(f);
  await automations.save(recipeInput(f));
  const run = await automations.runNow("recipe");
  await markDone(f, run.recipe!.results[0]!.taskId!);
  await automations.tick();
  const declined = await automations.decide("recipe", run.id, false);
  expect(declined.status).toBe("cancelled");
  expect(declined.recipe?.stop).toMatchObject({
    code: "decision_declined",
    stepIndex: 1,
    nextAction: "run_again",
  });
  expect(declined.recipe?.results.at(-1)?.status).toBe("declined");
  await automations.tick();
  expect((await tasks.list()).filter((task) => task.id.startsWith("recipe-"))).toHaveLength(1);
  await automations.close();
});

it("stops, without repeating the step, when a step's task cannot be read after a restart", async () => {
  const f = await setup();
  let { tasks, automations } = boot(f);
  await automations.save(recipeInput(f));
  const run = await automations.runNow("recipe");
  const planId = run.recipe!.results[0]!.taskId!;
  await automations.close();
  await f.store.db.prepare("DELETE FROM tasks WHERE id=?").run(planId);
  ({ tasks, automations } = boot(f));
  await automations.tick();
  const stopped = await instance(automations);
  expect(stopped.status).toBe("failed");
  expect(stopped.recipe?.stop).toMatchObject({ code: "step_uncertain", stepIndex: 0 });
  await automations.tick();
  expect(await tasks.get(planId)).toBeUndefined();
  expect((await tasks.list()).filter((task) => task.id.startsWith("recipe-"))).toHaveLength(0);
  await automations.close();
});

it("stops when a step's task is blocked and names the task as the next action", async () => {
  const f = await setup();
  const { automations } = boot(f);
  await automations.save(recipeInput(f));
  const run = await automations.runNow("recipe");
  await f.store.db
    .prepare(
      'UPDATE tasks SET value=json_set(value,\'$.status\',\'blocked\',\'$.stop\',json(\'{"code":"repair_exhausted","phase":"review","attempt":1,"message":"Checks failed","actor":"owner","nextAction":"open","at":1}\')) WHERE id=?',
    )
    .run(run.recipe!.results[0]!.taskId!);
  await automations.tick();
  const stopped = await instance(automations);
  expect(stopped.status).toBe("failed");
  expect(stopped.recipe?.stop).toMatchObject({ code: "step_stopped", nextAction: "open_task" });
  await automations.close();
});

it("keeps a running instance on the version it started with when the recipe is edited", async () => {
  const f = await setup();
  const { automations } = boot(f);
  const saved = await automations.save(recipeInput(f));
  expect(saved.recipe?.version).toBe(1);
  const same = await automations.save(recipeInput(f, { enabled: true }));
  expect(same.recipe?.version).toBe(1);
  const run = await automations.runNow("recipe");
  expect(run.recipe?.version).toBe(1);
  const edited = await automations.save(
    recipeInput(f, {
      recipe: { version: 1, steps: [{ ...steps[0], request: "Write a different plan" }] },
    }),
  );
  expect(edited.recipe?.version).toBe(2);
  await automations.tick();
  const running = await instance(automations);
  expect(running.recipe?.version).toBe(1);
  expect(running.recipe?.steps).toHaveLength(3);
  expect(running.recipe?.steps[0]).toMatchObject({ request: "Write the plan" });
  await automations.close();
});

it("starts one instance per scheduled occurrence", async () => {
  const f = await setup();
  let clock = Date.parse("2026-11-25T08:00:00");
  const { tasks, automations } = boot(f, () => clock);
  await automations.save(recipeInput(f, { enabled: true }));
  clock = Date.parse("2026-11-25T09:00:30");
  await automations.tick();
  await automations.tick();
  const runs = await automations.runs("recipe");
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ trigger: "scheduled", status: "running" });
  expect((await tasks.list()).filter((task) => task.id.startsWith("recipe-"))).toHaveLength(1);
  await automations.close();
});

it("stopping an instance stops its current step and records who stopped it", async () => {
  const f = await setup();
  const { tasks, automations } = boot(f);
  await automations.save(recipeInput(f));
  const run = await automations.runNow("recipe");
  const { run: stopped } = await automations.stopRun("recipe", run.id);
  expect(stopped.status).toBe("cancelled");
  expect(stopped.recipe?.stop).toMatchObject({ code: "owner_stopped", stepIndex: 0 });
  expect(await tasks.get(run.recipe!.results[0]!.taskId!)).toMatchObject({ status: "blocked" });
  await automations.close();
});
