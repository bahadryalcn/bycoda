import { afterEach, describe, expect, it } from "vitest";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { HostTasks } from "./tasks";

const stores: HostStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function setup() {
  const store = new HostStore(":memory:");
  stores.push(store);
  const project = store.addProject(process.cwd(), "Synthetic dependency checks");
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
  it("rejects a forward reference closed by a later save, without inserting it", () => {
    const { tasks, input } = setup();
    tasks.save(input("a", ["b"]));
    expect(() => tasks.save(input("b", ["a"]))).toThrow("b -> a -> b");
    expect(tasks.list().map((task) => task.id)).toEqual(["a"]);
    expect(tasks.save(input("b"))).toMatchObject({ id: "b" });
  });

  it("rejects longer cycles introduced by edits atomically", () => {
    const { tasks, input } = setup();
    tasks.save(input("a", ["b"]));
    tasks.save(input("b", ["c"]));
    const before = tasks.save(input("c"));
    expect(() => tasks.save(input("c", ["a"]))).toThrow("c -> a -> b -> c");
    expect(tasks.list().find((task) => task.id === "c")).toEqual(before);
  });

  it("blocks persisted legacy cycles with a visible path before any dispatch", async () => {
    const { store, tasks, input } = setup();
    const a = tasks.save(input("a", ["b"]));
    const b = { ...a, ...input("b", ["a"]) };
    store.db.prepare("INSERT INTO tasks VALUES (?, ?)").run("b", JSON.stringify(b));
    // Refresh the public list as a restarted scheduler would.
    await tasks.tick();
    expect(tasks.list()).toHaveLength(2);
    for (const task of tasks.list())
      expect(task).toMatchObject({
        status: "blocked",
        error: expect.stringContaining(
          `${task.id} -> ${task.id === "a" ? "b" : "a"} -> ${task.id}`,
        ),
      });
    expect(store.sessions()).toEqual([]);
  });
});
