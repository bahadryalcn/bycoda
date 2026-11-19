import { afterEach, describe, expect, it } from "vitest";
import { HostEngine } from "../engine";
import { HostStore } from "../store";
import { HostTasks } from "./service";

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of await stores.splice(0)) await store.close();
});

async function fixture() {
  const store = new HostStore(":memory:");
  stores.push(store);
  const tasks = new HostTasks(store, new HostEngine(store, {}), () => 1000);
  await tasks.ready;
  const insert = (id: string, value: Record<string, unknown>) =>
    store.db
      .prepare("INSERT INTO tasks (id, value) VALUES (?, ?)")
      .run(id, JSON.stringify({ id, createdAt: 1, status: "done", ...value }));
  return { store, tasks, insert };
}

describe("HostTasks.listCrewRun", () => {
  it("returns only the run's tasks of the run's project, oldest first, without listing the project", async () => {
    const { store, tasks, insert } = await fixture();
    await insert("late", { projectId: "p", crewRunId: "run", createdAt: 30 });
    await insert("early", { projectId: "p", crewRunId: "run", createdAt: 10 });
    await insert("other-run", { projectId: "p", crewRunId: "other" });
    await insert("history", { projectId: "p" });
    await insert("foreign", { projectId: "q", crewRunId: "run" });
    await store.db.prepare("INSERT INTO tasks (id, value) VALUES ('broken', 'not json')").run();

    expect((await tasks.listCrewRun("run", "p")).map((task) => task.id)).toEqual(["early", "late"]);
    expect((await tasks.listCrewRun("missing", "p")).map((task) => task.id)).toEqual([]);
    expect((await tasks.listCrewRun("run", "q")).map((task) => task.id)).toEqual(["foreign"]);
  });

  it("seeks the crew run index and ignores unrelated task writes", async () => {
    const { store, tasks, insert } = await fixture();
    const plan = JSON.stringify(
      await store.db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT value FROM tasks WHERE CASE WHEN json_valid(value) THEN json_extract(value,'$.crewRunId') END=?",
        )
        .all("run"),
    );
    expect(plan).toContain("tasks_crew_run");
    await insert("mine", { projectId: "p", crewRunId: "run", status: "review", updatedAt: 5 });
    const before = await tasks.listCrewRun("run", "p");
    await insert("noise", { projectId: "p", status: "running" });
    expect(await tasks.listCrewRun("run", "p")).toEqual(before);
  });
});
