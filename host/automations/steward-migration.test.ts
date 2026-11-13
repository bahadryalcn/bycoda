import { afterEach, expect, it } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { HostTasks } from "../tasks/service";
import { HostStewards } from "../stewards/stewards";
import { HostAutomations } from "./automations";
import { projectScanAutomationId } from "./steward-migration";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("migrates steward schedule once without deleting definitions or proposals", async () => {
  const f = await setup();
  const tasks = new HostTasks(f.store, f.engine);
  const automations = new HostAutomations(f.store, f.engine);
  automations.bindTasks(tasks);
  const stewards = new HostStewards(f.store, f.engine, tasks);
  const original = await stewards.save({
    id: "scan",
    projectId: f.project.id,
    enabled: false,
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    focus: "Preserve this focus",
    maxProposals: 2,
    maxOpen: 5,
    autoStart: false,
    isolate: false,
    scheduleKind: "weekly",
    minute: 3,
    time: "09:00",
    dayOfWeek: 2,
  });
  await stewards.bindAutomations(automations);
  const migrated = (await automations.list()).find(
    (item) => item.id === projectScanAutomationId(original.id),
  )!;
  expect(migrated).toMatchObject({
    template: { kind: "project-scan", sourceStewardId: original.id },
    nextRunAt: original.nextRunAt,
    enabled: original.enabled,
    scheduleKind: original.scheduleKind,
    time: original.time,
  });
  await stewards.bindAutomations(automations);
  expect(await automations.list()).toHaveLength(1);
  const archived = await f.store.db
    .prepare("SELECT original_value FROM steward_automation_migrations WHERE steward_id=?")
    .get(original.id);
  expect(JSON.parse(String(archived?.original_value))).toEqual(original);
  expect(
    await f.store.db.prepare("SELECT value FROM stewards WHERE id=?").get(original.id),
  ).toBeTruthy();
  await stewards.runNow(original.id);
  const runs = await automations.runs(migrated.id);
  expect(runs).toHaveLength(1);
  expect(runs[0].taskId).toBeTruthy();
  expect((await tasks.get(runs[0].taskId!))?.prompt).toContain("Preserve this focus");
  expect(f.turns).toHaveLength(0);
  await stewards.close();
  await automations.close();
});

it("creates and edits a Project scan through its canonical steward", async () => {
  const f = await setup();
  const tasks = new HostTasks(f.store, f.engine);
  const automations = new HostAutomations(f.store, f.engine);
  automations.bindTasks(tasks);
  const stewards = new HostStewards(f.store, f.engine, tasks);
  await stewards.bindAutomations(automations);
  const created = await automations.save({
    id: "new-scan",
    template: { kind: "project-scan", sourceStewardId: "new" },
    name: "Project scan",
    prompt: "Find missing tests",
    projectId: f.project.id,
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    scheduleKind: "weekly",
    minute: 3,
    time: "09:00",
    dayOfWeek: 2,
    maxRunMinutes: 20,
    maxRunsPerDay: 0,
    enabled: false,
  });
  expect(created.id).toBe(projectScanAutomationId("new-scan"));
  expect(created.template?.sourceStewardId).toBe("new-scan");
  expect((await stewards.list())[0]).toMatchObject({ focus: "Find missing tests", time: "09:00" });
  const updated = await automations.save({
    ...created,
    prompt: "Find security gaps",
    time: "10:00",
    expectedConfiguration: created,
  });
  expect(updated).toMatchObject({ id: created.id, prompt: "Find security gaps", time: "10:00" });
  expect((await stewards.list())[0]).toMatchObject({ focus: "Find security gaps", time: "10:00" });
  expect(await automations.projectScan!.prepare("new-scan")).toContain("Find security gaps");
  await expect(
    automations.save({ ...created, prompt: "Stale edit", expectedConfiguration: created }),
  ).rejects.toThrow("Configuration changed");
  expect((await stewards.list())[0].focus).toBe("Find security gaps");
  await stewards.close();
  await automations.close();
});
