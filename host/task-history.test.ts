import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { HostTasks } from "./tasks";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(legacy = false) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-task-history-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5 }));
  cleanups.push(() => store.close());
  await store.ready;
  const value = {
    id: "task-a",
    projectId: "project-a",
    title: "First",
    status: "todo",
    createdAt: 100,
    updatedAt: 100,
    prompt: "private prompt",
  };
  if (legacy) {
    await store.db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    await store.db.prepare("INSERT INTO tasks VALUES (?,?)").run(value.id, JSON.stringify(value));
  }
  const engine = new HostEngine(store, {});
  cleanups.push(() => engine.close());
  const tasks = new HostTasks(store, engine, () => 200);
  await tasks.ready;
  return { store, tasks, value };
}

it("journals every writer and deletion atomically, without task prompts", async () => {
  const { store, tasks, value } = await fixture();
  await store.db.prepare("INSERT INTO tasks VALUES (?,?)").run(value.id, JSON.stringify(value));
  const snapshot = await tasks.snapshotWithCursor();
  expect(snapshot).toEqual({
    tasks: [
      { id: value.id, projectId: value.projectId, title: "First", status: "todo", updatedAt: 100 },
    ],
    cursor: 1,
    historyAvailableFrom: 200,
  });
  await store.db
    .prepare("UPDATE tasks SET value=json_set(value, '$.status', 'done', '$.updatedAt', 300)")
    .run();
  await store.db.prepare("DELETE FROM tasks WHERE id=?").run(value.id);
  const page = await tasks.events(1, 1);
  expect(page.cursor).toBe(2);
  expect(page.hasMore).toBe(true);
  expect(page.events[0]).toMatchObject({
    sequence: 2,
    status: "done",
    effectiveAt: 300,
    deleted: false,
  });
  const rest = await tasks.events(page.cursor);
  expect(rest.events[0]).toMatchObject({
    sequence: 3,
    taskId: value.id,
    status: "done",
    deleted: true,
  });
  expect(JSON.stringify(rest)).not.toContain("private prompt");
  expect(rest.hasMore).toBe(false);
  expect((await tasks.snapshotWithCursor()).tasks).toEqual([]);
});

it("rolls journal entries back with task mutations and rejects invalid cursors", async () => {
  const { store, tasks, value } = await fixture();
  await expect(
    store.transaction(async () => {
      await store.db.prepare("INSERT INTO tasks VALUES (?,?)").run(value.id, JSON.stringify(value));
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(await tasks.events(0)).toMatchObject({ cursor: 0, events: [] });
  await expect(tasks.events(-1)).rejects.toThrow("Invalid");
  await expect(tasks.events(1)).rejects.toThrow("ahead");
  await expect(tasks.events(0, 1001)).rejects.toThrow("page size");
});

it("tombstones the old project identity on a task transfer and retains optional goal context", async () => {
  const { store, tasks, value } = await fixture();
  await store.db
    .prepare("INSERT INTO tasks VALUES (?,?)")
    .run(value.id, JSON.stringify({ ...value, goalId: "goal-a" }));
  expect((await tasks.snapshotWithCursor()).tasks[0]?.goalId).toBe("goal-a");
  await store.db
    .prepare(
      "UPDATE tasks SET value=json_set(value, '$.projectId', 'project-b', '$.updatedAt', 300)",
    )
    .run();
  const page = await tasks.events(1);
  expect(page.events).toEqual([
    expect.objectContaining({
      sequence: 2,
      projectId: "project-a",
      deleted: true,
      task: expect.objectContaining({ goalId: "goal-a" }),
    }),
    expect.objectContaining({ sequence: 3, projectId: "project-b", deleted: false }),
  ]);
});

it("baselines legacy tasks without inventing historical events and keeps initialization idempotent", async () => {
  const { store, tasks, value } = await fixture(true);
  expect(await tasks.events(0)).toMatchObject({ events: [], cursor: 0, historyAvailableFrom: 200 });
  expect((await tasks.snapshotWithCursor()).tasks[0]?.id).toBe(value.id);
  const engine = new HostEngine(store, {});
  cleanups.push(() => engine.close());
  const second = new HostTasks(store, engine, () => 999);
  await second.ready;
  await store.db
    .prepare("UPDATE tasks SET value=json_set(value, '$.title', 'Edited', '$.updatedAt', 400)")
    .run();
  expect(await second.events(0)).toMatchObject({
    cursor: 1,
    historyAvailableFrom: 200,
    events: [{ sequence: 1, task: { title: "Edited" } }],
  });
});
