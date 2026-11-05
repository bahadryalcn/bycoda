import { afterEach, describe, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { HostTasks } from "./service";
const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of await stores.splice(0)) await store.close();
});
async function setup() {
  const store = new HostStore(":memory:");
  await stores.push(store);
  const project = await store.addProject(process.cwd(), "Synthetic dependency checks");
  const tasks = new HostTasks(store, new HostEngine(store, {}), () => 1000);
  const input = (id: string, dependsOn: string[] = []) => ({
    id,
    dependsOn,
    projectId: project.id,
    title: id,
    prompt: "Synthetic task",
    harness: "claude",
    model: "claude:test",
    runtimeMode: "auto",
    modelSettings: {},
    isolate: false,
    review: false,
  });
  return { store, tasks, input };
}
describe("task dependency cycles", () => {
  it("hydrates a shared unfinished dependency once and skips admission reads", async () => {
    const { store, tasks, input } = await setup();
    const hold = await tasks.save({ ...input("hold"), status: "todo" });
    const queued = await tasks.save({ ...input("first", ["hold", "hold"]), status: "todo" });
    for (const id of ["first", "second"]) {
      await store.db
        .prepare("INSERT OR REPLACE INTO tasks VALUES (?, ?)")
        .run(id, JSON.stringify({ ...queued, id, status: "queued" }));
    }
    const source = vi.fn(() => 0);
    tasks.trackExternalRuns(source);
    const find = vi.spyOn(tasks as never, "find" as never);
    await tasks.tick();
    expect(find.mock.calls.filter(([id]) => id === hold.id)).toHaveLength(1);
    expect(source).not.toHaveBeenCalled();
    expect((await tasks.list()).filter((task) => task.status === "queued")).toHaveLength(2);
  });
  it("creates the scheduler index on an already populated database", async () => {
    const { store, tasks, input } = await setup();
    await tasks.ready;
    const legacy = await tasks.save({ ...input("legacy"), status: "todo" });
    await store.db
      .prepare("UPDATE tasks SET value=? WHERE id=?")
      .run(JSON.stringify({ ...legacy, status: "done", merged: true }), legacy.id);
    await store.db.exec("DROP INDEX tasks_scheduler_status_merged");
    const reopened = new HostTasks(store, new HostEngine(store, {}), () => 1000);
    await reopened.ready;
    const plan = await store.db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT value FROM tasks WHERE json_extract(value, '$.status')='done' AND json_extract(value, '$.merged')=1",
      )
      .all();
    expect(JSON.stringify(plan)).toContain("tasks_scheduler_status_merged");
    expect(await reopened.get("legacy")).toBeDefined();
  });
  it("does not release unfinished dependents by deleting their prerequisite", async () => {
    const { tasks, input } = await setup();
    await tasks.save({ ...input("a"), status: "todo" });
    await tasks.save({ ...input("b", ["a"]), status: "todo" });
    await expect(tasks.delete("a")).rejects.toThrow("Other unfinished tasks depend");
    expect(await tasks.get("a")).toBeDefined();
    await tasks.delete("b");
    await tasks.delete("a");
    expect(await tasks.list()).toEqual([]);
  });
  it("refuses stale or malformed deletion revisions while keeping retries idempotent", async () => {
    const { tasks, input } = await setup();
    const saved = await tasks.save({ ...input("a"), status: "todo" });
    await expect(tasks.delete("a", false, saved.updatedAt + 1)).rejects.toThrow(
      "This task changed",
    );
    await expect(tasks.delete("a", false, -1)).rejects.toThrow("Invalid task revision");
    expect(await tasks.get("a")).toBeDefined();
    await tasks.delete("a", false, saved.updatedAt);
    await tasks.delete("a", false, saved.updatedAt);
    expect(await tasks.get("a")).toBeUndefined();
  });
  it("rejects a forward reference closed by a later save, without inserting it", async () => {
    const { tasks, input } = await setup();
    await tasks.save(input("a", ["b"]));
    await expect((async () => await tasks.save(input("b", ["a"])))()).rejects.toThrow(
      "b -> a -> b",
    );
    expect((await tasks.list()).map((task) => task.id)).toEqual(["a"]);
    expect(await tasks.save(input("b"))).toMatchObject({ id: "b" });
  });
  it("rejects longer cycles introduced by edits atomically", async () => {
    const { tasks, input } = await setup();
    await tasks.save(input("a", ["b"]));
    await tasks.save(input("b", ["c"]));
    const before = await tasks.save(input("c"));
    await expect((async () => await tasks.save(input("c", ["a"])))()).rejects.toThrow(
      "c -> a -> b -> c",
    );
    expect((await tasks.list()).find((task) => task.id === "c")).toEqual(before);
  });
  it("blocks persisted legacy cycles with a visible path before any dispatch", async () => {
    const { store, tasks, input } = await setup();
    const a = await tasks.save(input("a", ["b"]));
    const b = { ...a, ...input("b", ["a"]) };
    await store.db.prepare("INSERT INTO tasks VALUES (?, ?)").run("b", JSON.stringify(b));
    // Refresh the public list as a restarted scheduler would.
    await tasks.tick();
    expect(await tasks.list()).toHaveLength(2);
    for (const task of await tasks.list())
      expect(task).toMatchObject({
        status: "blocked",
        error: expect.stringContaining(
          `${task.id} -> ${task.id === "a" ? "b" : "a"} -> ${task.id}`,
        ),
      });
    expect(await store.sessions()).toEqual([]);
  });
});
