import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { HostSession } from "../src/features/connections/model/protocol";
import { HostStore, summary } from "./store";
import { HostAssistant } from "./assistant/service";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
it("keeps Host provenance through metadata edits, sparse saves, summaries and reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-provenance-store-"));
  const path = join(dir, "host.db");
  let store = new HostStore(path);
  await store.ready;
  const project = await store.addProject(dir, "Test");
  const core = new HostAssistant(store, {
    listProjects: async () => [{ id: project.id, path: dir, name: "Test" }],
    createGoal: async ({ job }) => ({ goalId: `assistant-${job.id}` }),
    goalStatus: async () => ({
      status: "running",
      taskIds: ["task"],
      sessionIds: ["owned"],
      progress: { done: 0, total: 1 },
    }),
  });
  await core.ready;
  cleanups.push(async () => {
    await core.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await core.request(
    {
      op: "profile.update",
      expectedVersion: 0,
      patch: {
        name: "Owner Name",
        autonomy: "jobs",
        dailyTokenBudget: 100000,
        setupComplete: true,
        enabled: true,
        execution: {
          harness: "codex",
          model: "test",
          modelSettings: {},
          runtimeMode: "supervised",
          maxRunMinutes: 60,
        },
      },
    },
    "owner",
  );
  const job = (
    await core.request(
      {
        op: "jobs.create",
        title: "Test",
        request: "Test work",
        projectId: project.id,
        idempotencyKey: "job",
      },
      "owner",
    )
  ).job!;
  const author = {
    kind: "assistant" as const,
    name: "Owner Name",
    jobId: job.id,
    reason: "kickoff" as const,
    operationId: "host-kickoff",
  };
  const record: HostSession = {
    projectId: project.id,
    revision: 1,
    status: "idle",
    updatedAt: 1,
    session: {
      id: "owned",
      cwd: dir,
      harness: "codex",
      model: "test",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Worker",
      blocks: [
        { id: "user", role: "user", text: "Work", author },
        { id: "reply", role: "assistant", text: "Started" },
      ],
    },
  };
  await store.save(record, {});
  await store.db.exec(
    "CREATE TABLE goals(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  await store.db.prepare("INSERT INTO goals(id,value) VALUES(?,?)").run(
    job.goalId,
    JSON.stringify({
      id: job.goalId,
      projectIds: [project.id],
      leadProjectId: project.id,
      taskIds: ["task"],
    }),
  );
  await store.db
    .prepare("INSERT INTO tasks(id,value) VALUES(?,?)")
    .run(
      "task",
      JSON.stringify({ id: "task", goalId: job.goalId, projectId: project.id, sessionId: "owned" }),
    );
  const managed = await store.markAssistantManagedSession("owned", job.id);
  expect(managed.managedBy?.jobId).toBe(job.id);
  const before = await store.session("owned");
  await store.markAssistantManagedSession("owned", job.id);
  expect((await store.session("owned")).revision).toBe(before.revision);
  await expect(
    store.updateSession("owned", {
      managedBy: { assistant: true, jobId: "forged", managedAt: 0 },
    } as never),
  ).rejects.toThrow("client-editable");
  await store.updateSession("owned", { title: "Renamed" });
  let current = await store.session("owned");
  const legacy = {
    ...current,
    managedBy: undefined,
    session: {
      ...current.session,
      managedBy: undefined,
      blocks: current.session.blocks.map((block) =>
        block.id === "user" ? { ...block, text: "Updated by owner", author: undefined } : block,
      ),
    },
    revision: current.revision + 1,
  };
  await store.save(legacy, { type: "test.legacy" }, { journal: true });
  current = await store.session("owned");
  expect(current.session.blocks[0].author).toEqual(author);
  expect(summary(current).managedBy?.jobId).toBe(job.id);
  await expect(
    store.save(
      {
        ...current,
        revision: current.revision + 1,
        session: {
          ...current.session,
          blocks: [
            { ...current.session.blocks[0], author: { ...author, name: "Impersonated" } },
            ...current.session.blocks.slice(1),
          ],
        },
      },
      {},
    ),
  ).rejects.toThrow("authorship");
  await store.db
    .prepare(
      "UPDATE assistant_jobs SET value=json_set(value,'$.detachedSessionIds',json('[\"owned\"]')) WHERE id=?",
    )
    .run(job.id);
  await store.markAssistantManagedSession("owned", job.id);
  const withdrawn = await store.session("owned"),
    detachedAt = withdrawn.session.managedBy!.detachedAt;
  expect(detachedAt).toBeGreaterThan(0);
  await store.save(
    {
      ...withdrawn,
      managedBy: before.managedBy,
      session: { ...withdrawn.session, managedBy: before.session.managedBy },
      revision: withdrawn.revision + 1,
    },
    { type: "test.staleManagement" },
  );
  expect((await store.session("owned")).session.managedBy?.detachedAt).toBe(detachedAt);
  await core.close();
  await store.close();
  store = new HostStore(path);
  await store.ready;
  const reopened = await store.session("owned");
  expect(reopened.session.blocks[0].author).toEqual(author);
  expect(reopened.session.managedBy?.jobId).toBe(job.id);
  expect(reopened.session.managedBy?.detachedAt).toBe(detachedAt);
  expect((await store.summaries(project.id))[0].managedBy?.jobId).toBe(job.id);
});
