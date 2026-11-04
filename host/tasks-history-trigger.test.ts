import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostTasks } from "./tasks";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-task-history-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const store = new HostStore(join(root, "host.db"));
  cleanups.push(() => store.close());
  const effect = vi.fn();
  const open = async () => {
    const tasks = new HostTasks(store, { command: effect, updateSession: effect }, () => 100);
    cleanups.push(() => tasks.close());
    await tasks.ready;
    return tasks;
  };
  const tasks = await open();
  const project = await store.addProject(root, "Fixture");
  await tasks.save({
    id: "task",
    title: "Original",
    prompt: "p",
    projectId: project.id,
    harness: "claude",
    model: "m",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    isolate: false,
    review: false,
  });
  const count = async () =>
    Number(
      (await store.db
        .prepare("SELECT count(*) AS count FROM task_history WHERE task_id='task'")
        .get())!.count,
    );
  const patch = (path: string, value: unknown) =>
    store.db.prepare("UPDATE tasks SET value=json_set(value,?,?) WHERE id='task'").run(path, value);
  return { store, open, count, patch };
}

it("journals only history-relevant task changes", async () => {
  const f = await fixture();
  const before = await f.count();
  await f.patch("$.updatedAt", 999);
  await f.patch("$.needsInput", 1);
  await f.patch("$.budgetUsage", JSON.stringify({ measuredAt: 5 }));
  expect(await f.count()).toBe(before);
  await f.patch("$.status", "running");
  expect(await f.count()).toBe(before + 1);
  await f.patch("$.title", "Renamed");
  expect(await f.count()).toBe(before + 2);
});

it("migrates a database that holds the unconditional trigger", async () => {
  const f = await fixture();
  await f.store.db.exec(`DROP TRIGGER task_history_update;
    CREATE TRIGGER task_history_update AFTER UPDATE ON tasks BEGIN
      INSERT INTO task_history(project_id,task_id,status,effective_at,deleted,task) VALUES ('p',NEW.id,'todo',0,0,'{}');
    END;`);
  const before = await f.count();
  await f.patch("$.needsInput", 1);
  expect(await f.count()).toBe(before + 1);
  await f.open();
  const after = await f.count();
  await f.patch("$.needsInput", 0);
  expect(await f.count()).toBe(after);
});
