import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { AssistantRepository } from "./assistant/repository";
import { HostAssistant } from "./assistant/service";
import { chiefActions, chiefReadRequests } from "./assistant-text";
import {
  AssistantChiefReads,
  CHIEF_READ_LIMITS,
  currentAssistantRunActivity,
  parseChiefReadRequests,
} from "./assistant-chief-reads";
import type { HostSession } from "../src/features/connections/model/protocol";
import type { AssistantJob } from "../src/shared/model/host-contracts/assistant";
import type { AsyncHostNotes } from "./host-notes-async";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-chief-reads-")),
    store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const repository = new AssistantRepository(store);
  await repository.initialize();
  const project = await store.addProject(directory, "Project");
  await store.db.exec(
    "CREATE TABLE goals(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL);",
  );
  const job = {
    id: "job",
    version: 0,
    createdAt: 1,
    updatedAt: 1,
    title: "Job",
    request: "Work",
    status: "running",
    projectId: project.id,
    projectIds: [project.id],
    goalId: "assistant-job",
    taskIds: ["task"],
    sessionIds: ["worker"],
    progress: { done: 0, total: 1 },
    tokens: 0,
    summary: "",
    idempotencyKey: "job",
    dispatchState: "submitted",
  } as AssistantJob;
  await repository.put("jobs", job, 0);
  const goal = {
    id: "assistant-job",
    leadProjectId: project.id,
    projectIds: [project.id],
    taskIds: ["task"],
    status: "running",
    updatedAt: 5,
    prompt: "Goal source",
  };
  const task = {
    id: "task",
    goalId: goal.id,
    projectId: project.id,
    sessionId: "worker",
    runId: "run",
    status: "running",
    updatedAt: 7,
    title: "Task",
    prompt: "Task source",
  };
  await store.db.prepare("INSERT INTO goals VALUES(?,?)").run(goal.id, JSON.stringify(goal));
  await store.db.prepare("INSERT INTO tasks VALUES(?,?)").run(task.id, JSON.stringify(task));
  const record = {
    projectId: project.id,
    status: "running",
    runId: "run",
    authorityGeneration: 1,
    updatedAt: Date.now(),
    runActivity: { runId: "run", lastActivityAt: 1000 },
    session: {
      id: "worker",
      cwd: directory,
      harness: "codex",
      model: "owner-model",
      modelSettings: {},
      blocks: [
        { id: "accepted", role: "user", text: "Accepted user source" },
        { id: "draft", role: "user", text: "PRIVATE UNSENT", draft: true },
        { id: "tool", role: "tool", text: "PRIVATE TOOL JSON" },
        { id: "a", role: "assistant", text: "x".repeat(10000) },
      ],
    },
  } as unknown as HostSession;
  const session = vi.spyOn(store, "session").mockImplementation(async (id) => {
    if (id !== "worker") throw new Error("Unknown source");
    return record;
  });
  const note = {
    id: "note",
    title: "Assistant notebook",
    body: "Notebook source",
    tags: ["assistant"],
    createdAt: 1,
    updatedAt: 9,
  };
  const notes = {
    list: vi.fn(async () => ({ notes: [note] })),
    get: vi.fn(async (id: string) => (id === note.id ? note : null)),
  };
  const reads = new AssistantChiefReads(store, () => notes as unknown as AsyncHostNotes);
  await reads.ready;
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const snapshot = () => reads.snapshot({ allowRoutineQuestions: false }, () => true);
  const token = async () => ((await snapshot()).statuses[0] as any).sourceToken as string;
  return {
    store,
    repository,
    job,
    goal,
    task,
    record,
    session,
    note,
    notes,
    reads,
    snapshot,
    token,
    saveTask: () =>
      store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(JSON.stringify(task), task.id),
  };
}
it("injects cheap canonical goal/task/status/note metadata before any transcript reads", async () => {
  const f = await fixture(),
    card = await f.snapshot();
  expect(card.jobs).toMatchObject([
    {
      jobId: "job",
      goal: { id: "assistant-job", updatedAt: 5 },
      tasks: [{ id: "task", updatedAt: 7 }],
    },
  ]);
  expect(card.statuses).toMatchObject([
    {
      jobId: "job",
      sessionId: "worker",
      lastActivityAt: 1000,
      activityKnown: true,
      lastAssistantMessage: "x".repeat(400),
    },
  ]);
  expect(JSON.stringify(card)).not.toContain("PRIVATE");
  expect(f.notes.get).not.toHaveBeenCalled();
  expect(card.notes).toMatchObject([{ id: "note", updatedAt: 9 }]);
});
it("requires exact status source token, returns prose only, and bounds one excerpt to three messages/6000chars", async () => {
  const f = await fixture(),
    request = {
      op: "sessions.read" as const,
      jobId: "job",
      sessionId: "worker",
      sourceToken: await f.token(),
      limit: 3,
    };
  const result = await f.reads.execute(
      { operationId: "read-one", requests: [request] },
      () => true,
    ),
    data = result.results[0].data as any;
  expect(data.messages).toHaveLength(2);
  expect(
    data.messages.reduce((n: number, item: any) => n + item.text.length, 0),
  ).toBeLessThanOrEqual(6000);
  expect(data.truncated).toBe(true);
  expect(JSON.stringify(data)).not.toContain("PRIVATE");
  expect((await f.snapshot()).readResults?.operationId).toBe("read-one");
  await expect(
    f.reads.execute({ operationId: "read-one", requests: [{ ...request, limit: 1 }] }, () => true),
  ).rejects.toThrow("preserve");
});
it("retains exact settled read receipts through restart and withholds them after run/source replacement", async () => {
  const f = await fixture(),
    request = {
      op: "sessions.read" as const,
      jobId: "job",
      sessionId: "worker",
      sourceToken: await f.token(),
      limit: 1,
    },
    input = { operationId: "restart", requests: [request] };
  const result = await f.reads.execute(input, () => true);
  const restarted = new AssistantChiefReads(f.store);
  await restarted.ready;
  expect(await restarted.execute(input, () => true)).toEqual(result);
  f.record.runId = "replacement";
  expect(JSON.stringify((await restarted.execute(input, () => true)).results)).not.toContain(
    "xxxxxxxx",
  );
  expect(JSON.stringify((await f.snapshot()).readResults)).not.toContain("xxxxxxxx");
});
it("does not re-read an interrupted original read or retarget it after pending receipt recovery", async () => {
  const f = await fixture(),
    request = {
      op: "sessions.read" as const,
      jobId: "job",
      sessionId: "worker",
      sourceToken: await f.token(),
      limit: 1,
    };
  await f.reads.execute({ operationId: "unknown", requests: [request] }, () => true);
  const row = await f.store.db
      .prepare("SELECT value FROM assistant_chief_reads WHERE id='unknown:0'")
      .get(),
    receipt = JSON.parse(row!.value);
  delete receipt.result;
  receipt.state = "started";
  await f.store.db
    .prepare("UPDATE assistant_chief_reads SET value=? WHERE id='unknown:0'")
    .run(JSON.stringify(receipt));
  expect(
    JSON.stringify(
      await new AssistantChiefReads(f.store).execute(
        { operationId: "unknown", requests: [request] },
        () => true,
      ),
    ),
  ).toContain("Original read outcome is unknown");
});
it("refuses arbitrary projects, manual session IDs, owner notes and task/goal version changes", async () => {
  const f = await fixture(),
    requests: any[] = [
      { op: "sessions.status", jobId: "job", sessionId: "owner-session" },
      { op: "sessions.status", jobId: "foreign", sessionId: "worker" },
      { op: "tasks.read", jobId: "job", taskId: "task", expectedUpdatedAt: 99 },
      { op: "goals.read", jobId: "job", expectedUpdatedAt: 99 },
    ];
  for (const [index, request] of requests.entries())
    expect(
      JSON.stringify(
        await f.reads.execute({ operationId: `denied-${index}`, requests: [request] }, () => true),
      ),
    ).toContain("unavailable");
  f.note.tags = [];
  expect(
    JSON.stringify(
      await f.reads.execute(
        {
          operationId: "owner-note",
          requests: [{ op: "notes.read", id: "note", expectedUpdatedAt: 9 }],
        },
        () => true,
      ),
    ),
  ).not.toContain("Notebook source");
});
it("rechecks scope after asynchronous read and suppresses raw data on canonical relationship changes", async () => {
  const f = await fixture(),
    request = {
      op: "sessions.read" as const,
      jobId: "job",
      sessionId: "worker",
      sourceToken: await f.token(),
      limit: 1,
    };
  let calls = 0;
  const result = await f.reads.execute(
    { operationId: "changed", requests: [request] },
    async () => {
      if (++calls === 4) {
        f.task.projectId = "outside";
        await f.saveTask();
      }
      return true;
    },
  );
  expect(JSON.stringify(result)).not.toContain("xxxxxxxx");
});
it("stops before read/disclosure on revoked authority and strictly caps schemas, duplicate scopes and excerpt counts", async () => {
  const f = await fixture();
  await expect(
    f.reads.execute({ operationId: "revoked", requests: [] }, () => false),
  ).rejects.toThrow("revoked");
  const request = {
    op: "sessions.read",
    jobId: "job",
    sessionId: "worker",
    sourceToken: await f.token(),
    limit: 1,
  };
  for (const requests of [
    [{ ...request, limit: 4 }],
    [request, request],
    [request, { ...request, sessionId: "other" }],
    [{ op: "owner.rpc", method: "configure" }],
    [{ ...request, approved: true }],
    Array.from({ length: CHIEF_READ_LIMITS.calls + 1 }, (_, i) => ({
      op: "sessions.status",
      jobId: "job",
      sessionId: String(i),
    })),
  ])
    expect(() => parseChiefReadRequests(requests)).toThrow();
});
it("uses only exact current-run event activity and treats bookkeeping, unknown/mismatched/future timestamps as unknown", () => {
  const record = {
    runId: "run",
    updatedAt: 999999,
    runActivity: { runId: "run", lastActivityAt: 1000 },
  } as HostSession;
  expect(currentAssistantRunActivity(record, 2000)).toBe(1000);
  record.updatedAt = 9999999;
  expect(currentAssistantRunActivity(record, 2000)).toBe(1000);
  for (const activity of [
    undefined,
    { runId: "old", lastActivityAt: 1000 },
    { runId: "run", lastActivityAt: 3000 },
    { runId: "run", lastActivityAt: -1 },
  ]) {
    record.runActivity = activity;
    expect(currentAssistantRunActivity(record, 2000)).toBeUndefined();
  }
});
it("bounds real status attempts even when sources fail and distinguishes unavailable notes from an empty notebook", async () => {
  const f = await fixture(),
    job = (await f.repository.get<AssistantJob>("jobs", "job"))!;
  await f.repository.put(
    "jobs",
    {
      ...job,
      sessionIds: Array.from({ length: 50 }, (_, i) => `missing-${i}`),
    },
    job.version,
  );
  f.notes.list.mockRejectedValueOnce(new Error("Notebook unavailable"));
  const card = await f.snapshot();
  expect(card.statusCalls).toBe(CHIEF_READ_LIMITS.statuses);
  expect(f.session).toHaveBeenCalledTimes(CHIEF_READ_LIMITS.statuses);
  expect(card.unavailableSessions).toBe(CHIEF_READ_LIMITS.statuses);
  expect(card.omittedSessions).toBe(40);
  expect(card.notesAvailable).toBe(false);
});
it("provides bounded own-note/task/goal reads and enforces whole-batch retry identity", async () => {
  const f = await fixture();
  f.note.body = "n".repeat(10000);
  const requests = [
    { op: "notes.read" as const, id: "note", expectedUpdatedAt: 9 },
    {
      op: "tasks.read" as const,
      jobId: "job",
      taskId: "task",
      expectedUpdatedAt: 7,
    },
    { op: "goals.read" as const, jobId: "job", expectedUpdatedAt: 5 },
  ];
  const result = await f.reads.execute({ operationId: "scoped", requests }, () => true);
  expect((result.results[0].data as any).body).toHaveLength(4000);
  expect(JSON.stringify(result.results)).toContain("Task source");
  expect(JSON.stringify(result.results)).toContain("Goal source");
  expect(JSON.stringify(result.results).length).toBeLessThanOrEqual(CHIEF_READ_LIMITS.resultChars);
  await expect(
    f.reads.execute({ operationId: "scoped", requests: requests.slice(0, 1) }, () => true),
  ).rejects.toThrow("preserve");
});
it("validates finite read decisions separately from mutations and rejects authority fields or unbounded read lists", () => {
  const read = { op: "sessions.status", jobId: "job", sessionId: "worker" };
  expect(chiefActions(JSON.stringify({ actions: [], reads: [read] }))).toEqual([]);
  expect(chiefReadRequests(JSON.stringify({ actions: [], reads: [read] }))).toEqual([read]);
  for (const value of [
    {
      actions: [{ op: "jobs.replan", id: "job", expectedVersion: 1, feedback: "x" }],
      reads: [read],
    },
    { actions: [], reads: [{ ...read, principal: "owner" }] },
    { actions: [], reads: [read, read] },
    { actions: [], reads: [{ op: "owner.rpc", method: "approve" }] },
  ])
    expect(() => chiefActions(JSON.stringify(value))).toThrow();
});
it("runs one reasoning call per wake, persists scoped reads and supplies them on the next separately charged wake", async () => {
  const f = await fixture();
  const wake = vi.fn(async (input: any) => {
    if (wake.mock.calls.length === 1) {
      const status = JSON.parse(input.stateCard).workerReads.statuses[0];
      return {
        tokens: 50,
        actions: [],
        reads: [
          {
            op: "sessions.read" as const,
            jobId: "job",
            sessionId: "worker",
            sourceToken: status.sourceToken,
            limit: 1,
          },
          {
            op: "inbox.list" as const,
            jobId: "job",
            projectId: f.record.projectId,
          },
        ],
      };
    }
    expect(
      JSON.parse(input.stateCard).workerReads.readResults.results[0].data.messages,
    ).toHaveLength(1);
    expect(JSON.parse(input.stateCard).workerReads.readResults.results[1].data).toMatchObject({
      scope: "host-attention",
      externalProviderInboxAvailable: false,
    });
    return { tokens: 70, actions: [] };
  });
  const core = new HostAssistant(f.store, {
    chiefWake: wake,
    chiefReadSnapshot: (profile, auth) => f.reads.snapshot(profile, auth),
    chiefRead: (input, auth) => f.reads.execute(input, auth),
    goalStatus: async () => ({
      status: "running",
      taskIds: ["task"],
      sessionIds: ["worker"],
      progress: { done: 0, total: 1 },
      tokens: 0,
      tokensComplete: true,
      usageIncomplete: false,
    }),
    listProjects: async () => [
      { id: f.record.projectId, path: f.record.session.cwd, name: "Project" },
    ],
  });
  await core.ready;
  cleanups.push(() => core.close());
  await core.request(
    {
      op: "profile.update",
      expectedVersion: 0,
      patch: {
        name: "Assistant",
        setupComplete: true,
        enabled: true,
        autonomy: "chief",
        dailyTokenBudget: 1000000,
        perWakeTokenCap: 30000,
        execution: {
          harness: "codex",
          model: "owner-model",
          modelSettings: {},
          runtimeMode: "supervised",
          maxRunMinutes: 30,
        },
      },
    },
    "owner",
  );
  await core.tick();
  expect(wake).toHaveBeenCalledTimes(1);
  expect((await core.request({ op: "snapshot" }, "owner")).snapshot!.usage.chiefTokens).toBe(50);
  expect(
    await f.store.db
      .prepare("SELECT id FROM assistant_chief_reads WHERE id!='latest' AND id NOT LIKE '%:batch'")
      .all(),
  ).toHaveLength(2);
  await core.tick();
  expect(wake).toHaveBeenCalledTimes(2);
  const snapshot = (await core.request({ op: "snapshot" }, "owner")).snapshot!;
  expect(snapshot.usage.chiefTokens).toBe(120);
  expect(JSON.stringify(snapshot.activity)).not.toContain("xxxxxxx");
});
