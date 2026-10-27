import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostTasks } from "./tasks";
import type { TaskWorkspaceServices } from "./task-workspace-runtime";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-task-delete-cas-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const store = new HostStore(join(root, "host.db"));
  cleanups.push(() => store.close());
  const entered = gate(),
    release = gate();
  const apply = vi.fn(async () => {
    entered.resolve();
    await release.promise;
  });
  const managed = {
    registry: {
      get: async () => ({ id: "workspace", revision: 1 }),
      close: async () => ({ id: "workspace", revision: 2 }),
    },
    removal: { plan: async () => ({ token: "fixture-plan", blockers: [], dirty: false }), apply },
  } as unknown as TaskWorkspaceServices;
  const effect = vi.fn(async () => {
    throw new Error("Unexpected provider effect");
  });
  const tasks = new HostTasks(
    store,
    { command: effect, updateSession: effect },
    () => 100,
    undefined,
    managed,
  );
  cleanups.push(() => tasks.close());
  await tasks.ready;
  const project = await store.addProject(root, "Fixture");
  const saved = await tasks.save({
    id: "task",
    title: "Original",
    prompt: "Preserve",
    projectId: project.id,
    harness: "claude",
    model: "original-model",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    isolate: false,
    review: false,
  });
  const changed = vi.fn();
  tasks.onChange = changed;
  return { store, tasks, saved, entered, release, apply, effect, changed };
}
it.each(["title", "model"])(
  "retains a concurrent same-millisecond %s edit after accepted cleanup",
  async (field) => {
    const f = await fixture();
    await f.store.db
      .prepare(
        "UPDATE tasks SET value=json_set(value,'$.status','review','$.branch','fixture','$.workspaceId','workspace') WHERE id='task'",
      )
      .run();
    await f.tasks.list(); // Exercise a previously populated list cache.
    const deletion = f.tasks.delete("task", true, f.saved.updatedAt);
    const rejection = expect(deletion).rejects.toMatchObject({
      code: "TASK_REVISION_CONFLICT",
      taskId: "task",
      workspaceCleanupCompleted: true,
    });
    await f.entered.promise;
    await f.store.db
      .prepare("UPDATE tasks SET value=json_set(value,?,?) WHERE id='task'")
      .run(`$.${field}`, "Concurrent edit");
    const edited = await f.tasks.get("task");
    expect(edited?.updatedAt).toBe(f.saved.updatedAt);
    f.release.resolve();
    await rejection;
    expect(await f.tasks.get("task")).toEqual(edited);
    expect((await f.tasks.list())[0][field]).toBe("Concurrent edit");
    expect(f.apply).toHaveBeenCalledTimes(1);
    expect(f.effect).not.toHaveBeenCalled();
    expect(f.changed).not.toHaveBeenCalled();
    expect(
      (
        await f.store.db
          .prepare("SELECT count(*) AS count FROM task_history WHERE task_id='task' AND deleted=1")
          .get()
      )?.count,
    ).toBe(0);
  },
);
it("deletes an unchanged captured value exactly once with one history tombstone", async () => {
  const f = await fixture();
  await f.tasks.delete("task", false, f.saved.updatedAt);
  expect(await f.tasks.get("task")).toBeUndefined();
  expect(await f.tasks.list()).toEqual([]);
  expect(f.changed).toHaveBeenCalledTimes(1);
  expect(
    (
      await f.store.db
        .prepare("SELECT count(*) AS count FROM task_history WHERE task_id='task' AND deleted=1")
        .get()
    )?.count,
  ).toBe(1);
  await f.tasks.delete("task");
  expect(f.changed).toHaveBeenCalledTimes(1);
  expect(f.apply).not.toHaveBeenCalled();
});
it("rejects a stale caller stamp before any cleanup effect", async () => {
  const f = await fixture();
  await f.store.db
    .prepare(
      "UPDATE tasks SET value=json_set(value,'$.status','review','$.branch','fixture','$.workspaceId','workspace') WHERE id='task'",
    )
    .run();
  await expect(f.tasks.delete("task", true, f.saved.updatedAt + 1)).rejects.toThrow("changed");
  expect(f.apply).not.toHaveBeenCalled();
  expect(await f.tasks.get("task")).toBeDefined();
});

it("deletes normally after unchanged workspace cleanup settles", async () => {
  const f = await fixture();
  await f.store.db
    .prepare(
      "UPDATE tasks SET value=json_set(value,'$.status','review','$.branch','fixture','$.workspaceId','workspace') WHERE id='task'",
    )
    .run();
  const deletion = f.tasks.delete("task", true, f.saved.updatedAt);
  await f.entered.promise;
  f.release.resolve();
  await deletion;
  expect(await f.tasks.get("task")).toBeUndefined();
  expect(f.apply).toHaveBeenCalledTimes(1);
  expect(f.changed).toHaveBeenCalledTimes(1);
});
