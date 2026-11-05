import { expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { HostTasks } from "./service";

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "task-admission-"));
  const cwd = join(dir, "project");
  mkdirSync(cwd);
  const store = new HostStore(join(dir, "host.db"));
  const project = await store.addProject(cwd, "Project");
  const engine = new HostEngine(store, {});
  const tasks = new HostTasks(store, engine);
  await tasks.ready;
  await tasks.save({ id: "task", projectId: project.id, title: "Task", prompt: "Do work", harness: "claude", model: "test", modelSettings: {}, runtimeMode: "auto", status: "todo" });
  vi.spyOn(tasks, "tick").mockResolvedValue(undefined);
  const retry = tasks as unknown as { retryFeedback(task: unknown): Promise<string | undefined> };
  return { dir, store, engine, tasks, retry };
}

it("preserves an unrelated update during queue preparation", async () => {
  const f = await fixture();
  try {
    vi.spyOn(f.retry, "retryFeedback").mockImplementationOnce(async () => {
      await f.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.ownerNotices',json(?)) WHERE id=?").run(JSON.stringify([{ id: "notice", text: "kept" }]), "task");
      return undefined;
    });
    const accepted = await f.tasks.startTask("task");
    expect(accepted.status).toBe("queued");
    expect(accepted.ownerNotices).toEqual([{ id: "notice", text: "kept" }]);
  } finally {
    await f.tasks.close();
    await f.engine.close();
    await f.store.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

it("rejects status ABA during queue preparation", async () => {
  const f = await fixture();
  try {
    vi.spyOn(f.retry, "retryFeedback").mockImplementationOnce(async () => {
      await f.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.status','queued') WHERE id=?").run("task");
      await f.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.status','todo') WHERE id=?").run("task");
      return undefined;
    });
    await expect(f.tasks.startTask("task")).rejects.toThrow("before queue admission");
    expect((await f.tasks.get("task"))?.status).toBe("todo");
  } finally {
    await f.tasks.close();
    await f.engine.close();
    await f.store.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
