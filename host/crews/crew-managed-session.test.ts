import { afterEach, expect, it } from "vitest";
import { forEachAsync } from "../async-collections";
import { HostStore } from "../store";
import { assertNotCrewManaged, crewManagedSession } from "./crew-managed-session";
import { initializeCrewSchedulerProjection } from "./crew-scheduler-projection";

const stores: HostStore[] = [];
afterEach(async () => {
  await forEachAsync(stores.splice(0), async (store) => await store.close());
});
async function fixture() {
  const store = new HostStore(":memory:");
  stores.push(store);
  await initializeCrewSchedulerProjection(store);
  await store.db.exec(
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, value TEXT NOT NULL);",
  );
  const run = (id: string, status: string, coordinator: string) =>
    store.db
      .prepare(
        "INSERT INTO crew_runs_v2(ordinal,run_id,project_id,created_at,status,coordinator_session_id,payload) VALUES((SELECT COALESCE(MAX(ordinal),-1)+1 FROM crew_runs_v2),?,?,?,?,?,?)",
      )
      .run(id, "p", 1, status, coordinator, "{}");
  const task = (id: string, value: object) =>
    store.db.prepare("INSERT INTO tasks(id,value) VALUES(?,?)").run(id, JSON.stringify(value));
  return { store, run, task };
}
it("finds coordinator, member and reviewer sessions of unfinished runs only", async () => {
  const f = await fixture();
  await f.run("live", "paused", "lead");
  await f.run("done", "finished", "old-lead");
  await f.task("t1", { crewRunId: "live", sessionId: "worker" });
  await f.task("t2", { crewRunId: "live", reviewer: { sessionId: "review" } });
  await f.task("t3", { crewRunId: "done", sessionId: "old-worker" });
  await f.task("t4", { sessionId: "plain" });
  expect(await crewManagedSession(f.store, "lead")).toEqual({ runId: "live", role: "coordinator" });
  expect(await crewManagedSession(f.store, "worker")).toEqual({ runId: "live", role: "member" });
  expect(await crewManagedSession(f.store, "review")).toEqual({ runId: "live", role: "member" });
  for (const id of ["old-lead", "old-worker", "plain", "nobody", ""])
    expect(await crewManagedSession(f.store, id)).toBeUndefined();
  await expect(assertNotCrewManaged(f.store, "lead")).rejects.toMatchObject({
    code: "crew_managed_session",
    message: "This conversation is managed by a crew. Stop or delete the work from Crews.",
  });
  await expect(assertNotCrewManaged(f.store, "plain")).resolves.toBeUndefined();
});
