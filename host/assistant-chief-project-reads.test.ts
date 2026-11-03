import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { AssistantRepository } from "./assistant/repository";
import {
  AssistantChiefReads,
  CHIEF_READ_LIMITS,
  parseChiefReadRequests,
} from "./assistant-chief-reads";
import {
  assistantQuickAutomationId,
  assistantQuickAutomationFingerprint,
} from "./assistant-quick-automations";
import type {
  AssistantJob,
  AssistantQuickAutomationJob,
} from "../src/shared/model/host-contracts/assistant";
const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "chief-project-reads-")),
    store = new HostStore(join(folder, "host.db"));
  await store.ready;
  const repository = new AssistantRepository(store);
  await repository.initialize();
  const project = await store.addProject(folder, "Assigned"),
    foreign = await store.addProject(join(folder, "foreign"), "Foreign");
  await store.db.exec(
    "CREATE TABLE goals(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE stewards(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE automations(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE assistant_quick_automations(job_id TEXT PRIMARY KEY,value TEXT NOT NULL);",
  );
  const job = {
    id: "job",
    version: 0,
    createdAt: 1,
    updatedAt: 1,
    title: "Assigned",
    request: "Read metadata",
    status: "running",
    projectId: project.id,
    projectIds: [project.id],
    goalId: "assistant-job",
    taskIds: ["task"],
    sessionIds: [],
    progress: { done: 0, total: 1 },
    tokens: 0,
    summary: "",
    idempotencyKey: "job",
    dispatchState: "submitted",
  } as AssistantJob;
  await repository.put("jobs", job, 0);
  const goal = {
    id: "assistant-job",
    title: "Owner plan",
    leadProjectId: project.id,
    projectIds: [project.id],
    taskIds: ["task"],
    status: "awaiting-approval",
    updatedAt: 5,
    prompt: "PRIVATE GOAL PROMPT",
  };
  const task = {
    id: "task",
    goalId: goal.id,
    projectId: project.id,
    title: "Blocked worker",
    status: "blocked",
    updatedAt: 7,
    prompt: "PRIVATE TASK PROMPT",
    error: "Needs owner",
  };
  const steward = {
    id: "steward",
    projectId: project.id,
    enabled: true,
    updatedAt: 10,
    nextRunAt: 999,
    lastRunStatus: "succeeded",
    focus: "PRIVATE FOCUS",
    modelSettings: { secret: "PRIVATE SETTING" },
    declined: ["PRIVATE DECLINED"],
  };
  const automation = {
    id: "automation",
    projectId: project.id,
    name: "Assigned schedule",
    enabled: true,
    createdAt: 1,
    updatedAt: 12,
    nextRunAt: 1000,
    needsInput: true,
    prompt: "PRIVATE AUTOMATION PROMPT",
    modelSettings: { secret: "PRIVATE ACCOUNT" },
  };
  const save = async (
    table: "goals" | "tasks" | "stewards" | "automations",
    value: { id: string },
  ) => {
    await store.db
      .prepare(
        `INSERT INTO ${table}(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`,
      )
      .run(value.id, JSON.stringify(value));
  };
  for (const [table, value] of [
    ["goals", goal],
    ["tasks", task],
    ["stewards", steward],
    ["automations", automation],
  ] as const)
    await save(table, value);
  await save("stewards", {
    ...steward,
    id: "foreign-steward",
    projectId: foreign.id,
  });
  await save("automations", {
    ...automation,
    id: "foreign-automation",
    projectId: foreign.id,
    name: "PRIVATE FOREIGN",
  });
  const reads = new AssistantChiefReads(store);
  await reads.ready;
  closes.push(async () => {
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const snapshot = () => reads.snapshot({ allowRoutineQuestions: false }, () => true);
  return {
    store,
    repository,
    project,
    foreign,
    job,
    goal,
    task,
    steward,
    automation,
    save,
    reads,
    snapshot,
  };
}
it("injects real scoped steward, automation and Host attention metadata without raw prompts or external provider claims", async () => {
  const f = await fixture(),
    card = await f.snapshot();
  expect(card.projectReads).toMatchObject([
    {
      jobId: "job",
      projectId: f.project.id,
      stewards: { available: true, items: [{ id: "steward", updatedAt: 10 }] },
      automations: {
        available: true,
        items: [{ id: "automation", updatedAt: 12 }],
      },
      inbox: {
        scope: "host-attention",
        sessionAttentionIncluded: false,
        socialAttentionIncluded: false,
        externalProviderInboxAvailable: false,
      },
    },
  ]);
  expect(card.externalProviderInbox.available).toBe(false);
  expect(card.externalProviderInbox.reason).toContain("privacy grant");
  expect(card.projectReads[0].inbox.items.map((item) => item.id)).toEqual(
    expect.arrayContaining(["goal:assistant-job", "task:task", "automation:automation"]),
  );
  expect(JSON.stringify(card)).not.toContain("PRIVATE");
  const result = await f.reads.execute(
    {
      operationId: "families",
      requests: [
        {
          op: "stewards.read",
          jobId: "job",
          projectId: f.project.id,
          id: "steward",
          expectedUpdatedAt: 10,
        },
        {
          op: "automations.read",
          jobId: "job",
          projectId: f.project.id,
          id: "automation",
          expectedUpdatedAt: 12,
        },
      ],
    },
    () => true,
  );
  expect(result.results.map((value) => (value.data as any).id)).toEqual(["steward", "automation"]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});
it("rejects foreign project/target and stale versions without widening the saved job", async () => {
  const f = await fixture();
  const result = await f.reads.execute(
    {
      operationId: "bad-scopes",
      requests: [
        { op: "stewards.list", jobId: "job", projectId: f.foreign.id },
        {
          op: "automations.read",
          jobId: "job",
          projectId: f.project.id,
          id: "foreign-automation",
          expectedUpdatedAt: 12,
        },
        {
          op: "stewards.read",
          jobId: "job",
          projectId: f.project.id,
          id: "steward",
          expectedUpdatedAt: 9,
        },
      ],
    },
    () => true,
  );
  expect(result.results.every((value) => (value.data as any).unavailable)).toBe(true);
  expect(JSON.stringify(result)).not.toContain("PRIVATE FOREIGN");
});
it("binds attention details to the complete canonical queue token and rechecks it after changes", async () => {
  const f = await fixture(),
    card = await f.snapshot(),
    sourceToken = card.projectReads[0].inbox.source;
  const request = {
    op: "inbox.read" as const,
    jobId: "job",
    projectId: f.project.id,
    id: "task:task",
    sourceToken,
  };
  const result = await f.reads.execute(
    { operationId: "attention", requests: [request] },
    () => true,
  );
  expect(result.results[0].data).toMatchObject({
    scope: "host-attention",
    item: { title: "Blocked worker" },
    externalProviderInboxAvailable: false,
  });
  f.task.status = "running";
  await f.save("tasks", f.task);
  const next = await f.snapshot();
  expect(JSON.stringify(next.readResults?.results)).not.toContain("Blocked worker");
  expect(
    (await f.reads.execute({ operationId: "stale-attention", requests: [request] }, () => true))
      .results[0].data,
  ).toHaveProperty("unavailable");
});
it("suppresses a result changed between read and disclosure even when a buggy writer kept its timestamp", async () => {
  const f = await fixture();
  let calls = 0;
  const result = await f.reads.execute(
    {
      operationId: "changed-during-read",
      requests: [
        {
          op: "automations.read",
          jobId: "job",
          projectId: f.project.id,
          id: "automation",
          expectedUpdatedAt: 12,
        },
      ],
    },
    async () => {
      if (++calls === 4)
        await f.save("automations", {
          ...f.automation,
          name: "PRIVATE LATE CHANGE",
        });
      return true;
    },
  );
  expect(result.results[0].data).toHaveProperty("unavailable");
  expect(JSON.stringify(result)).not.toContain("Assigned schedule");
  expect(JSON.stringify(result)).not.toContain("PRIVATE LATE CHANGE");
});
it("revalidates metadata after deferred unrelated work before exposing the next canonical card", async () => {
  const f = await fixture();
  let listCalls = 0;
  const notes = {
    list: async () => {
      if (++listCalls === 1) await f.save("stewards", { ...f.steward, enabled: false });
      return { notes: [] };
    },
    get: async () => null,
  };
  const reads = new AssistantChiefReads(f.store, () => notes as any),
    card = await reads.snapshot({ allowRoutineQuestions: false }, () => true);
  expect(card.projectReads).toEqual([]);
});
it("keeps a revoked family read out of canonical context and leaves no settled result to replay", async () => {
  const f = await fixture();
  let calls = 0;
  await expect(
    f.reads.execute(
      {
        operationId: "revoked-family",
        requests: [
          {
            op: "automations.read",
            jobId: "job",
            projectId: f.project.id,
            id: "automation",
            expectedUpdatedAt: 12,
          },
        ],
      },
      () => ++calls < 4,
    ),
  ).rejects.toThrow("revoked");
  const receipt = await f.store.db
    .prepare("SELECT value FROM assistant_chief_reads WHERE id=?")
    .get("revoked-family:0");
  expect(JSON.parse(receipt!.value)).toMatchObject({ state: "started" });
  expect(JSON.parse(receipt!.value)).not.toHaveProperty("result");
  const restartedReads = new AssistantChiefReads(f.store);
  const result = await restartedReads.execute(
    {
      operationId: "revoked-family",
      requests: [
        {
          op: "automations.read",
          jobId: "job",
          projectId: f.project.id,
          id: "automation",
          expectedUpdatedAt: 12,
        },
      ],
    },
    () => true,
  );
  expect(result.results[0].data).toMatchObject({
    unavailable: expect.stringContaining("unknown"),
  });
});
it("enforces one shared four-read budget and exact scopes across all families", () => {
  const requests = Array.from({ length: 5 }, (_, index) => ({
    op: "automations.list",
    jobId: `job-${index}`,
    projectId: "p",
  }));
  expect(() => parseChiefReadRequests(requests)).toThrow();
  expect(() =>
    parseChiefReadRequests([
      {
        op: "stewards.read",
        jobId: "j",
        projectId: "p",
        id: "s",
        expectedUpdatedAt: 1,
      },
      {
        op: "stewards.read",
        jobId: "j",
        projectId: "p",
        id: "s",
        expectedUpdatedAt: 2,
      },
    ]),
  ).toThrow("repeat");
  expect(() =>
    parseChiefReadRequests([{ op: "automations.delete", jobId: "j", projectId: "p", id: "s" }]),
  ).toThrow();
  expect(CHIEF_READ_LIMITS.calls).toBe(4);
});
it("limits quick jobs to their exact completed atomic automation receipt and never grants project stewardship", async () => {
  const f = await fixture(),
    action = {
      kind: "automation" as const,
      projectId: f.project.id,
      name: "Exact automation",
      prompt: "Owner reviewed",
      harness: "codex" as const,
      model: "owner-model",
      modelSettings: {},
      runtimeMode: "supervised" as const,
      scheduleKind: "daily" as const,
      minute: 0,
      time: "09:30",
      dayOfWeek: 1,
      maxRunMinutes: 20,
      maxRunsPerDay: 2,
      enabled: true,
    };
  const quick = {
    ...f.job,
    id: "quick",
    kind: "quick",
    status: "done",
    goalId: undefined,
    projectId: f.project.id,
    projectIds: [f.project.id],
    quickAction: action,
    quickIntent: { automationId: assistantQuickAutomationId("quick") },
  } as AssistantQuickAutomationJob;
  await f.repository.put("jobs", quick, 0);
  const automationId = assistantQuickAutomationId(quick.id),
    request = {
      op: "automations.list" as const,
      jobId: "quick",
      projectId: f.project.id,
    };
  await f.save("automations", {
    ...f.automation,
    id: automationId,
    name: "Exact automation",
  });
  expect(
    (await f.reads.execute({ operationId: "missing-proof", requests: [request] }, () => true))
      .results[0].data,
  ).toHaveProperty("unavailable");
  const receipt = {
    jobId: quick.id,
    automationId,
    state: "completed",
    fingerprint: assistantQuickAutomationFingerprint(quick),
    createdAt: 1,
    updatedAt: 2,
    automationCreatedAt: 1,
    automationUpdatedAt: 12,
  };
  await f.store.db
    .prepare("INSERT INTO assistant_quick_automations(job_id,value) VALUES(?,?)")
    .run(quick.id, JSON.stringify({ ...receipt, state: "unknown" }));
  expect(
    (await f.reads.execute({ operationId: "unknown-proof", requests: [request] }, () => true))
      .results[0].data,
  ).toHaveProperty("unavailable");
  await f.store.db
    .prepare("UPDATE assistant_quick_automations SET value=? WHERE job_id=?")
    .run(JSON.stringify(receipt), quick.id);
  const result = await f.reads.execute(
    {
      operationId: "exact-quick",
      requests: [
        request,
        { op: "stewards.list", jobId: "quick", projectId: f.project.id },
        {
          op: "automations.read",
          jobId: "quick",
          projectId: f.project.id,
          id: f.automation.id,
          expectedUpdatedAt: 12,
        },
      ],
    },
    () => true,
  );
  expect(result.results[0].data).toMatchObject({
    items: [{ id: automationId }],
  });
  expect((result.results[0].data as any).items).toHaveLength(1);
  expect(result.results.slice(1).every((value) => (value.data as any).unavailable)).toBe(true);
  await f.save("automations", {
    ...f.automation,
    id: automationId,
    createdAt: 999,
  });
  expect(
    (await f.reads.execute({ operationId: "recreated-id", requests: [request] }, () => true))
      .results[0].data,
  ).toHaveProperty("unavailable");
});
it("bounds project-family discovery and keeps unavailable tables distinct from an empty list", async () => {
  const f = await fixture();
  for (let index = 0; index < 15; index++)
    await f.save("automations", { ...f.automation, id: `automation-${index}` });
  const list = await f.reads.execute(
    {
      operationId: "bounded-list",
      requests: [{ op: "automations.list", jobId: "job", projectId: f.project.id }],
    },
    () => true,
  );
  expect(list.results[0].data).toMatchObject({
    available: true,
    truncated: true,
  });
  expect((list.results[0].data as any).items).toHaveLength(10);
  expect(JSON.stringify(list).length).toBeLessThan(CHIEF_READ_LIMITS.resultChars);
  await f.store.db.exec("DROP TABLE stewards");
  const missing = await f.reads.execute(
    {
      operationId: "missing-family",
      requests: [{ op: "stewards.list", jobId: "job", projectId: f.project.id }],
    },
    () => true,
  );
  expect(missing.results[0].data).toMatchObject({
    available: false,
    items: [],
  });
});
it("keeps mixed-family results and cached retries inside the same combined character bound", async () => {
  const f = await fixture();
  const ids = Array.from({ length: 20 }, (_, index) => `blocked-${index}`);
  for (const id of ids)
    await f.save("tasks", {
      ...f.task,
      id,
      error: "e".repeat(1000),
      title: "t".repeat(200),
    });
  await f.save("goals", {
    ...f.goal,
    taskIds: ids,
    prompt: "p".repeat(5000),
    plan: {
      tasks: ids.map((key) => ({
        key,
        title: "t".repeat(120),
        projectId: f.project.id,
        dependsOn: [],
      })),
    },
  });
  for (let index = 0; index < 10; index++)
    await f.save("automations", {
      ...f.automation,
      id: `big-${index}`,
      name: "a".repeat(120),
    });
  const requests = parseChiefReadRequests([
    { op: "inbox.list", jobId: "job", projectId: f.project.id },
    { op: "automations.list", jobId: "job", projectId: f.project.id },
    { op: "goals.read", jobId: "job", expectedUpdatedAt: 5 },
    { op: "tasks.read", jobId: "job", taskId: ids[0], expectedUpdatedAt: 7 },
  ]);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.reads.execute({ operationId: "combined-bound", requests }, () => true);
    expect(JSON.stringify(result.results).length).toBeLessThanOrEqual(
      CHIEF_READ_LIMITS.resultChars,
    );
    expect(result.results.some((value) => (value.data as any).unavailable)).toBe(true);
  }
});
