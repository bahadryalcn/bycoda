import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { initializeCrewSchedulerProjection } from "../../crews/crew-scheduler-projection";
import { HostAssistantQuickAutomations } from "./assistant-quick-automations";
import { assistantProfileDefaults } from "../profile-defaults";
import {
  assistantOwnedGoalAllowed,
  assistantOwnedSessionAllowed,
  assistantOwnedTaskAllowed,
  recordAssistantCrewTaskOrigin,
  stopAssistantOwnedWork,
} from "./assistant-owned-work";
import type { HostTask } from "../../../src/features/tasks/model/hostTasks";
import { HostTasks } from "../../tasks/tasks";
import type { HostGoals } from "../../goals/goals";
import type { HostAutomations } from "../../automations/automations";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

it("seeks existing worker, reviewer, crew and receipt rows through ownership indexes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-owned-indexes-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {});
  let tasks: HostTasks | undefined;
  cleanups.push(async () => {
    await tasks?.close();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  await store.ready;
  await store.db.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
  const task = {
    id: "legacy-task",
    projectId: "p",
    createdAt: 5,
    updatedAt: 5,
    status: "queued",
    title: "Legacy task",
    sessionId: "legacy-worker",
    reviewer: { sessionId: "legacy-reviewer" },
  };
  await store.db.prepare("INSERT INTO tasks VALUES(?,?)").run(task.id, JSON.stringify(task));
  await store.db.prepare("INSERT INTO metadata VALUES(?,?)").run(
    "voice-work:legacy-receipt",
    JSON.stringify({
      ownership: {
        kind: "task",
        id: task.id,
        projectId: task.projectId,
        threadId: "room",
        state: "completed",
        entityCreatedAt: task.createdAt,
      },
    }),
  );
  tasks = new HostTasks(store, engine);
  const quick = new HostAssistantQuickAutomations(store, {
    automations: () => {
      throw new Error("No automation writes expected");
    },
    authorized: async () => false,
  });
  await Promise.all([tasks.ready, quick.ready, initializeCrewSchedulerProjection(store)]);
  await store.db.exec(`
    CREATE TABLE assistant_jobs(id TEXT PRIMARY KEY,value TEXT NOT NULL,deleted_at INTEGER);
    CREATE TABLE automations(id TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE automation_runs(id TEXT PRIMARY KEY,automation_id TEXT,value TEXT NOT NULL);
    INSERT INTO assistant_jobs VALUES('quick','{"id":"quick","projectId":"p"}',NULL);
    INSERT INTO assistant_quick_automations VALUES('quick','{"state":"completed","automationId":"schedule","automationCreatedAt":7}');
    INSERT INTO automations VALUES('schedule','{"createdAt":7}');
    INSERT INTO automation_runs VALUES('attempt','schedule','{"taskId":"automated-task"}');
  `);
  const automationTask = {
    id: "automated-task",
    source: "automation",
    projectId: "p",
    automationId: "schedule",
    automationRunId: "attempt",
  } as HostTask;
  const profile = {
    ...assistantProfileDefaults,
    enabled: true,
    setupComplete: true,
    permissionLevel: "everything" as const,
  };
  const prepare = vi.spyOn(store.db, "prepare");
  expect(await assistantOwnedSessionAllowed(store, "manual", profile, true)).toBe(true);
  expect(prepare.mock.calls.some(([sql]) => sql.includes("voice-work:%"))).toBe(false);
  expect(
    await assistantOwnedSessionAllowed(store, "legacy-worker", assistantProfileDefaults, true),
  ).toBe(false);
  expect(
    await assistantOwnedSessionAllowed(store, "legacy-reviewer", assistantProfileDefaults, true),
  ).toBe(false);
  expect(await assistantOwnedTaskAllowed(store, automationTask, profile, true)).toBe(false);
  expect(await assistantOwnedTaskAllowed(store, automationTask, profile, false)).toBe(true);
  expect(
    await assistantOwnedTaskAllowed(
      store,
      { ...automationTask, automationRunId: "unlinked" },
      profile,
      false,
    ),
  ).toBe(false);
  const statements = prepare.mock.calls.map(([sql]) => sql);
  prepare.mockRestore();
  const queries = [
    ["$.reviewer.sessionId", ["tasks_owner_session", "tasks_owner_reviewer_session"]],
    ["coordinator_session_id=?", ["crew_runs_v2_owner_coordinator"]],
    ["voice-work:%", ["metadata_voice_work_owner"]],
    ["FROM assistant_quick_automations q", ["assistant_quick_automations_owner"]],
  ] as const;
  for (const [fragment, indexes] of queries) {
    const query = statements.find((sql) => sql.includes(fragment))!;
    expect(query).toBeDefined();
    const parameters = Array.from(query.matchAll(/\?/g), () => "lookup");
    const plan = await store.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...parameters);
    const details = plan.map((row) => String(row.detail)).join("\n");
    for (const index of indexes) expect(details).toContain(`USING INDEX ${index}`);
  }
});
it("scoped ownership lookups keep the full-scan match set and receipt order", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-owned-scope-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await store.ready;
  await store.db.exec(`
    CREATE TABLE goals(id TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO goals VALUES('goal-1','{"createdAt":3,"projectIds":["p"]}');
    INSERT INTO goals VALUES('goal-2','{"createdAt":4,"projectIds":["p"]}');
  `);
  const receipt = (key: string, ownership: Record<string, unknown>) =>
    store.db
      .prepare("INSERT INTO metadata(key,value) VALUES(?,?)")
      .run(`voice-work:${key}`, JSON.stringify({ ownership }));
  // Written first under a key that sorts last: the task receipt must still win over the goal one.
  await receipt("z-task", {
    kind: "task",
    id: "owned",
    projectId: "p",
    threadId: "room",
    state: "pending",
    entityCreatedAt: 5,
  });
  await receipt("a-goal", {
    kind: "goal",
    id: "goal-1",
    projectId: "p",
    threadId: "room",
    state: "completed",
    entityCreatedAt: 3,
  });
  await receipt("b-goal", {
    kind: "goal",
    id: "goal-2",
    projectId: "p",
    threadId: "room",
    state: "pending",
    entityCreatedAt: 4,
  });
  // An automation receipt only applies to tasks an automation started.
  await receipt("c-automation", {
    kind: "automation",
    id: "schedule",
    projectId: "p",
    threadId: "room",
    state: "pending",
    entityCreatedAt: 7,
  });
  const profile = {
    ...assistantProfileDefaults,
    enabled: true,
    setupComplete: true,
    permissionLevel: "everything" as const,
  };
  const task = (patch: Partial<HostTask>) =>
    ({ id: "other", projectId: "p", createdAt: 9, status: "queued", ...patch }) as HostTask;

  expect(
    await assistantOwnedTaskAllowed(
      store,
      task({ id: "owned", goalId: "goal-1", createdAt: 5 }),
      profile,
      false,
    ),
  ).toBe(false);
  expect(await assistantOwnedTaskAllowed(store, task({ goalId: "goal-1" }), profile, false)).toBe(
    true,
  );
  expect(await assistantOwnedTaskAllowed(store, task({ goalId: "goal-1" }), profile, true)).toBe(
    false,
  );
  expect(await assistantOwnedTaskAllowed(store, task({ goalId: "goal-2" }), profile, false)).toBe(
    false,
  );
  expect(await assistantOwnedTaskAllowed(store, task({ goalId: "unowned" }), profile, true)).toBe(
    true,
  );
  expect(
    await assistantOwnedTaskAllowed(
      store,
      task({ source: "manual", automationId: "schedule" } as Partial<HostTask>),
      profile,
      true,
    ),
  ).toBe(true);
  expect(
    await assistantOwnedTaskAllowed(
      store,
      task({ source: "automation", automationId: "schedule" } as Partial<HostTask>),
      profile,
      false,
    ),
  ).toBe(false);
  expect(await assistantOwnedGoalAllowed(store, "goal-1", profile, false)).toBe(true);
  expect(await assistantOwnedGoalAllowed(store, "goal-1", profile, true)).toBe(false);
  expect(await assistantOwnedGoalAllowed(store, "goal-2", profile, false)).toBe(false);
  expect(await assistantOwnedGoalAllowed(store, "owned", profile, true)).toBe(true);
});
it("binds a Room Crew coordinator and members to the actual linked Task creation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-owned-crew-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await store.ready;
  await store.db.exec(
    "CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE crew_runs_v2(run_id TEXT,project_id TEXT,status TEXT,coordinator_session_id TEXT,payload TEXT);",
  );
  const root = {
    id: "root",
    projectId: "p",
    createdAt: 5,
    crewExecutionId: "crew",
    status: "queued",
  } as HostTask;
  const member = {
    id: "member",
    projectId: "p",
    createdAt: 6,
    crewRunId: "crew",
    status: "queued",
  } as HostTask;
  await store.db.prepare("INSERT INTO tasks VALUES(?,?)").run(root.id, JSON.stringify(root));
  await store.db.prepare("INSERT INTO tasks VALUES(?,?)").run(member.id, JSON.stringify(member));
  await store.db
    .prepare("INSERT INTO crew_runs_v2 VALUES('crew','p','active','coordinator',?)")
    .run(
      JSON.stringify({
        id: "crew",
        projectId: "p",
        sourceTaskId: root.id,
        assignments: [{ taskId: member.id }],
      }),
    );
  const origin = { kind: "task" as const, id: root.id, projectId: "p", threadId: "thread" };
  const profile = {
    ...assistantProfileDefaults,
    enabled: true,
    setupComplete: true,
    permissionLevel: "everything" as const,
  };
  await recordAssistantCrewTaskOrigin(store, { ...origin, state: "pending" });
  expect(await assistantOwnedTaskAllowed(store, member, profile, false)).toBe(false);
  await recordAssistantCrewTaskOrigin(store, { ...origin, state: "completed", entityCreatedAt: 5 });
  expect(await assistantOwnedTaskAllowed(store, member, profile, false)).toBe(true);
  expect(await assistantOwnedSessionAllowed(store, "coordinator", profile, true)).toBe(false);
  expect(
    await assistantOwnedSessionAllowed(
      store,
      "coordinator",
      { ...profile, permissionLevel: "watch" },
      false,
    ),
  ).toBe(false);
  expect(await assistantOwnedSessionAllowed(store, "foreign", profile, true)).toBe(true);
});
it("holds pending or downgraded assistant work without restricting foreign tasks, and Stop checks creation identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-owned-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await store.ready;
  const task = { id: "owned", projectId: "p", createdAt: 5, status: "queued" } as HostTask;
  const foreign = { ...task, id: "foreign" };
  const profile = {
    ...assistantProfileDefaults,
    enabled: true,
    setupComplete: true,
    permissionLevel: "watch" as const,
  };
  const save = (state: "pending" | "completed", entityCreatedAt = 5) =>
    store.db
      .prepare(
        "INSERT INTO metadata(key,value) VALUES('voice-work:receipt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(
        JSON.stringify({
          ownership: {
            kind: "task",
            id: task.id,
            projectId: "p",
            threadId: "thread",
            state,
            entityCreatedAt,
          },
        }),
      );
  await save("pending");
  expect(await assistantOwnedTaskAllowed(store, task, profile, false)).toBe(false);
  expect(await assistantOwnedTaskAllowed(store, foreign, profile, true)).toBe(true);
  await save("completed");
  expect(
    await assistantOwnedTaskAllowed(
      store,
      task,
      { ...profile, permissionLevel: "projects", permissionProjectIds: ["p"] },
      false,
    ),
  ).toBe(true);
  expect(
    await assistantOwnedTaskAllowed(
      store,
      task,
      { ...profile, permissionLevel: "projects", permissionProjectIds: [] },
      false,
    ),
  ).toBe(false);
  expect(
    await assistantOwnedTaskAllowed(
      store,
      task,
      { ...profile, permissionLevel: "everything" },
      true,
    ),
  ).toBe(false);
  const move = vi.fn(async () => task);
  const tasks = { get: async () => task, move } as unknown as HostTasks;
  const goals = { list: async () => [] } as unknown as HostGoals;
  const automations = { list: async () => [] } as unknown as HostAutomations;
  await stopAssistantOwnedWork(store, tasks, goals, automations);
  expect(move).toHaveBeenCalledWith("owned", "blocked");
  move.mockClear();
  await save("completed", 4);
  await stopAssistantOwnedWork(store, tasks, goals, automations);
  expect(move).not.toHaveBeenCalled();
});
