import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { assistantProfileDefaults } from "../profile-defaults";
import {
  assistantOwnedSessionAllowed,
  assistantOwnedTaskAllowed,
  recordAssistantCrewTaskOrigin,
  stopAssistantOwnedWork,
} from "./assistant-owned-work";
import type { HostTask } from "../../../src/features/tasks/model/hostTasks";
import type { HostTasks } from "../../tasks/tasks";
import type { HostGoals } from "../../goals/goals";
import type { HostAutomations } from "../../automations/automations";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
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
