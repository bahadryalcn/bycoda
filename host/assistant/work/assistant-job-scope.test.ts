import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostSession } from "../../../src/features/connections/model/protocol";
import type { AssistantJob } from "../../../src/shared/model/host-contracts/assistant";
import type { HostGoals } from "../../goals/goals";
import type { HostTasks } from "../../tasks/tasks";
import { HostStore } from "../../store";
import { assistantExecutionPorts } from "../core/assistant-runtime";
import { assistantJobCurrentSessionIds, assistantJobSessionBelongs } from "./assistant-job-scope";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});

/** A job whose saved ids still name `stale`, a session of a task the goal no longer has. */
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-assistant-scope-"));
  const store = new HostStore(join(dir, "host.db"));
  await store.ready;
  cleanups.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = await store.addProject(dir, "Test");
  const session = (id: string): HostSession => ({
    projectId: project.id,
    revision: 1,
    status: "idle",
    updatedAt: 1,
    session: {
      id,
      cwd: dir,
      harness: "codex",
      model: "test",
      modelSettings: {},
      runtimeMode: "supervised",
      title: id,
      blocks: [],
    },
  });
  for (const id of ["stale", "planner", "worker", "foreign"]) await store.save(session(id), {});
  const job = {
    id: "job",
    kind: "project",
    goalId: "assistant-job",
    projectId: project.id,
    projectIds: [project.id],
    sessionIds: ["stale", "planner", "foreign", "worker"],
    taskIds: ["task"],
  } as unknown as AssistantJob;
  await store.db.exec(
    "CREATE TABLE assistant_jobs(id TEXT PRIMARY KEY,value TEXT NOT NULL,deleted_at INTEGER);CREATE TABLE goals(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  await store.db
    .prepare("INSERT INTO assistant_jobs(id,value) VALUES(?,?)")
    .run(job.id, JSON.stringify(job));
  await store.db.prepare("INSERT INTO goals(id,value) VALUES(?,?)").run(
    "assistant-job",
    JSON.stringify({
      id: "assistant-job",
      projectIds: [project.id],
      leadProjectId: project.id,
      plannerSessionId: "planner",
      taskIds: ["task"],
    }),
  );
  await store.db.prepare("INSERT INTO tasks(id,value) VALUES(?,?)").run(
    "task",
    JSON.stringify({
      id: "task",
      goalId: "assistant-job",
      projectId: project.id,
      sessionId: "worker",
      reviewer: { sessionId: "foreign" },
    }),
  );
  const ports = assistantExecutionPorts(store, {} as HostGoals, {} as HostTasks);
  return { store, job, project, ports };
}

it("marks the sessions the goal still references and skips ids kept only as provenance", async () => {
  const { store, job, project, ports } = await fixture();
  // The scope check itself is unchanged: the stale id does not belong and the store refuses it.
  expect(await assistantJobSessionBelongs(store, job, "stale", project.id)).toBe(false);
  await expect(store.markAssistantManagedSession("stale", job.id)).rejects.toThrow(
    "does not belong",
  );
  expect(await assistantJobCurrentSessionIds(store, job)).toEqual(["planner", "foreign", "worker"]);
  await ports.markManagedSessions!(job);
  for (const id of ["planner", "worker", "foreign"])
    expect((await store.session(id)).managedBy?.jobId).toBe("job");
  expect((await store.session("stale")).managedBy).toBeUndefined();
});

it("keeps marking the other sessions when the store refuses one and names the job", async () => {
  const { store, job, ports } = await fixture();
  const foreign = await store.session("foreign");
  const managedBy = { assistant: true as const, jobId: "another-job", managedAt: 1 };
  await store.save(
    {
      ...foreign,
      managedBy,
      session: { ...foreign.session, managedBy },
      revision: foreign.revision + 1,
    },
    { type: "session.managed", managedBy },
  );
  await expect(ports.markManagedSessions!(job)).rejects.toThrow(
    "job job could not mark managed sessions foreign: Session already belongs to another assistant scope.",
  );
  // `worker` follows the refused id in the saved order and is still marked.
  expect((await store.session("worker")).managedBy?.jobId).toBe("job");
  expect((await store.session("planner")).managedBy?.jobId).toBe("job");
  expect((await store.session("foreign")).managedBy?.jobId).toBe("another-job");
});

it("reports a repeating maintenance failure once per window", async () => {
  const { ports } = await fixture();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const failure = new Error("job job could not mark managed sessions s1: refused for dedupe test");
  for (let tick = 0; tick < 5; tick++) ports.onError!(failure);
  expect(warn.mock.calls).toEqual([
    [
      "Assistant maintenance failed: job job could not mark managed sessions s1: refused for dedupe test",
    ],
  ]);
});
