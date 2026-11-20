import { afterEach, describe, expect, it } from "vitest";
import { HostEngine } from "../engine";
import { HostStore } from "../store";
import { HostTasks } from "./service";

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of await stores.splice(0)) await store.close();
});

async function plan(store: HostStore, sql: string): Promise<string> {
  return JSON.stringify(await store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all());
}

describe("task lookup indexes", () => {
  it("serves crewExecutionId and goalId lookups from indexes, not full scans", async () => {
    const store = new HostStore(":memory:");
    stores.push(store);
    const tasks = new HostTasks(store, new HostEngine(store, {}), () => 1000);
    await tasks.ready;
    const crew = await plan(
      store,
      "SELECT value FROM tasks WHERE CASE WHEN json_valid(value) THEN json_extract(value,'$.crewExecutionId') END='run' LIMIT 1",
    );
    expect(crew).toContain("tasks_crew_execution");
    const goal = await plan(
      store,
      "SELECT value FROM tasks WHERE json_extract(value,'$.goalId')='goal' LIMIT 1",
    );
    expect(goal).toContain("tasks_goal");
  });
});
