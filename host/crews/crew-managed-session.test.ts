import { afterEach, expect, it, vi } from "vitest";
import { forEachAsync } from "../async-collections";
import { HostEngine } from "../engine";
import { HostStore } from "../store";
import { HostTasks } from "../tasks/service";
import {
  assertNotCrewManaged,
  crewManagedSession,
  crewMemberRunIds,
  crewSessionRuns,
} from "./crew-managed-session";
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
it("resolves unfinished runs for member and reviewer sessions without decoding run payloads", async () => {
  const f = await fixture();
  await f.run("a", "active", "lead-a");
  await f.run("b", "paused", "lead-b");
  await f.run("done", "finished", "old-lead");
  await f.task("t1", { crewRunId: "a", sessionId: "worker" });
  await f.task("t2", { crewRunId: "b", reviewer: { sessionId: "worker" } });
  await f.task("t3", { crewRunId: "done", sessionId: "worker" });
  await f.task("t4", { sessionId: "plain" });
  await f.store.db.prepare("INSERT INTO tasks(id,value) VALUES('broken','{')").run();
  expect(await crewMemberRunIds(f.store, "worker")).toEqual(["a", "b"]);
  for (const id of ["lead-a", "plain", "nobody", ""]) expect(await crewMemberRunIds(f.store, id)).toEqual([]);
  const bare = new HostStore(":memory:");
  stores.push(bare);
  expect(await crewMemberRunIds(bare, "worker")).toEqual([]);
});

it("lists every crew session of a project, finished runs included, for list summaries", async () => {
  const f = await fixture();
  await f.run("live", "paused", "lead");
  await f.run("done", "finished", "old-lead");
  await f.task("t1", { crewRunId: "live", sessionId: "worker", reviewer: { sessionId: "review" } });
  await f.task("t2", { crewRunId: "done", sessionId: "old-worker" });
  await f.task("t3", { sessionId: "plain" });
  await f.store.db.prepare("INSERT INTO tasks(id,value) VALUES('broken','{')").run();
  expect(Object.fromEntries(await crewSessionRuns(f.store, "p"))).toEqual({
    lead: "live",
    worker: "live",
    review: "live",
    "old-lead": "done",
    "old-worker": "done",
  });
  expect((await crewSessionRuns(f.store, "other")).size).toBe(0);
  const bare = new HostStore(":memory:");
  stores.push(bare);
  expect((await crewSessionRuns(bare, "p")).size).toBe(0);
});

it("uses the task index when listing sessions for a project's crew runs", async () => {
  const f = await fixture();
  await f.run("legacy", "finished", "lead");
  await f.task("legacy-task", {
    id: "legacy-task",
    projectId: "p",
    status: "done",
    updatedAt: 1,
    crewRunId: "legacy",
    sessionId: "worker",
  });
  await new HostTasks(f.store, new HostEngine(f.store, {})).ready;
  const prepare = vi.spyOn(f.store.db, "prepare");
  expect((await crewSessionRuns(f.store, "p")).get("worker")).toBe("legacy");
  const query = prepare.mock.calls.find(([sql]) => sql.includes("tasks t"))?.[0];
  const plan = await f.store.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all("p");
  expect(plan.map((row) => row.detail)).toContainEqual(
    expect.stringMatching(/SEARCH t USING INDEX tasks_crew_run/),
  );
});
