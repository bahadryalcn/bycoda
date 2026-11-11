import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { HostTasks } from "../tasks/tasks";
import { HostGoals } from "../goals/goals";
import { AsyncHostNotes } from "../host-notes-async";
import { assistantExecutionPorts } from "./core/assistant-runtime";
import { assistantDomain } from "../domains/assistant/service";
import { HostAssistant } from "./service";
import { AssistantRepository } from "./repository";
import { readBriefingApprovals } from "./briefing-sources";
import { assistantDetailedBriefingText } from "./briefing";
import {
  AssistantResponseValidationSchema,
  type AssistantJob,
  type AssistantNotification,
} from "../../src/shared/model/host-contracts/assistant";
import type { HostProvider } from "../providers/providers";
const execution = {
  harness: "claude" as const,
  model: "claude:fixture",
  modelSettings: {},
  runtimeMode: "supervised" as const,
  maxRunMinutes: 60,
};
const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
async function fixture() {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "assistant-briefing-"))),
    path = join(folder, "desktop.db"),
    db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,content_updated_at INTEGER NOT NULL DEFAULT 0)",
  );
  db.close();
  const store = new HostStore(join(folder, "host.db"));
  await store.ready;
  const project = await store.addProject(folder, "Verified project"),
    provider: HostProvider = {
      send: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      bind: vi.fn(),
      approve: vi.fn(),
      answer: vi.fn(),
    },
    engine = new HostEngine(store, { claude: provider });
  await engine.ready;
  const tasks = new HostTasks(store, engine);
  await tasks.ready;
  const goals = new HostGoals(store, engine, tasks);
  await goals.ready;
  const notes = new AsyncHostNotes(() => [path]),
    ports = assistantExecutionPorts(store, goals, tasks, () => notes);
  let now = new Date(2026, 10, 2, 8).getTime(),
    idleMs = 0,
    supported = true;
  ports.now = () => now;
  ports.readPresence = async () => ({ supported, locked: false, idleMs });
  ports.chiefWake = vi.fn(async () => ({ actions: [], tokens: 0 }));
  const listNotes = ports.listNotes!;
  ports.listNotes = vi.fn(async () => {
    expect(store.db.ownsScope).toBe(false);
    return listNotes();
  });
  let assistant = new HostAssistant(store, ports);
  await assistant.ready;
  const repository = new AssistantRepository(store);
  await repository.initialize();
  const owner = (input: unknown) =>
    assistantDomain(assistant, store)(input, {
      principalId: "briefing-owner",
      authorized: async () => true,
    });
  await owner({
    op: "profile.update",
    expectedVersion: 0,
    patch: {
      name: "Briefing fixture",
      enabled: true,
      setupComplete: true,
      autonomy: "report",
      dailyTokenBudget: 1000000,
      execution,
      quietStart: 0,
      quietEnd: 0,
    },
  });
  const job = (
      await owner({
        op: "jobs.create",
        title: "Approval task",
        request: "Preserve the existing assigned result",
        projectId: project.id,
        idempotencyKey: "approval-job",
      })
    ).job!,
    goalId = `assistant-${job.id}`;
  const sessionId = (
      await engine.command({
        type: "create",
        commandId: "approval-source-create",
        projectId: project.id,
        workspaceMode: "current",
        ...execution,
      })
    ).sessionId!,
    record = await store.session(sessionId);
  await store.save(
    {
      ...record,
      revision: record.revision + 1,
      runId: "approval-current-run",
      status: "running",
      session: {
        ...record.session,
        blocks: [
          {
            id: "canonical-approval",
            role: "assistant",
            text: "A simulated native permission request",
            approval: { requestId: 42, occurrenceId: "host-occurrence" },
          },
        ],
      },
    },
    { type: "fixture.pendingApproval" },
  );
  await tasks.save({
    id: "approval-child",
    projectId: project.id,
    title: "Permission for form validation",
    prompt: "Keep existing scope",
    ...execution,
    maxRunMinutes: 0,
    isolate: false,
    review: false,
  });
  await store.db
    .prepare(
      "UPDATE tasks SET value=json_set(value,'$.goalId',?,'$.status','blocked','$.sessionId',?,'$.runId','approval-current-run') WHERE id='approval-child'",
    )
    .run(goalId, sessionId);
  await store.db.prepare("INSERT INTO goals(id,value) VALUES(?,?)").run(
    goalId,
    JSON.stringify({
      ...execution,
      id: goalId,
      title: job.title,
      prompt: job.request,
      projectIds: [project.id],
      leadProjectId: project.id,
      verifyDefaults: { review: false },
      approvePlan: true,
      autoMerge: false,
      taskIds: ["approval-child"],
      status: "blocked",
      createdAt: now,
      updatedAt: now,
    }),
  );
  await store.db
    .prepare(
      "UPDATE assistant_jobs SET value=json_set(value,'$.goalId',?,'$.status','waiting','$.summary','Permission is required','$.sessionIds',json(?)) WHERE id=?",
    )
    .run(goalId, JSON.stringify([sessionId]), job.id);
  const notify = async (id: string, kind: AssistantNotification["kind"], jobId?: string) => {
    const at = now;
    await repository.put("runtime", {
      id: `notification:${id}`,
      version: 0,
      createdAt: at,
      updatedAt: at,
      value: {
        id,
        kind,
        title: "Actual pending update",
        body: "Open the assigned item",
        createdAt: at,
        ...(jobId ? { jobId, projectIds: [project.id] } : {}),
      },
    });
  };
  const snapshot = async () => (await owner({ op: "snapshot" })).snapshot!;
  closes.push(async () => {
    await assistant.close();
    await notes.close();
    await tasks.close();
    await engine.close();
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  });
  return {
    store,
    project,
    provider,
    engine,
    tasks,
    goals,
    notes,
    ports,
    repository,
    job,
    goalId,
    sessionId,
    owner,
    snapshot,
    notify,
    get assistant() {
      return assistant;
    },
    get now() {
      return now;
    },
    time: (hour: number) => {
      now = new Date(2026, 10, 2, hour).getTime();
    },
    setSupported: (value: boolean) => {
      supported = value;
    },
    setIdle: (value: number) => {
      idleMs = value;
    },
    currentJob: async () =>
      JSON.parse(
        (await store.db.prepare("SELECT value FROM assistant_jobs WHERE id=?").get(job.id))!.value,
      ) as AssistantJob,
    restart: async () => {
      await assistant.close();
      assistant = new HostAssistant(store, ports);
      await assistant.ready;
    },
  };
}

it("delivers urgent real pending approvals and budget while away, retaining ordinary summaries and all quiet/DND gates", async () => {
  const f = await fixture();
  await f.notify("approval", "job.waiting", f.job.id);
  await f.notify("budget", "budget.exhausted");
  await f.notify("ordinary", "job.done", f.job.id);
  await f.owner({ op: "presence.set", state: "away" });
  let snapshot = await f.snapshot();
  expect(snapshot.notifications?.find((item) => item.id === "approval")?.eligible).toBe(true);
  expect(snapshot.notifications?.find((item) => item.id === "budget")?.eligible).toBe(true);
  expect(snapshot.notifications?.find((item) => item.id === "ordinary")).toMatchObject({
    eligible: false,
    deferredReason: "away",
  });
  await f.owner({ op: "presence.set", state: "dnd" });
  expect(
    (await f.snapshot()).notifications?.every(
      (item) => !item.eligible && item.deferredReason === "dnd",
    ),
  ).toBe(true);
  snapshot = await f.snapshot();
  await f.owner({
    op: "profile.update",
    expectedVersion: snapshot.profile.version,
    patch: { quietStart: 0, quietEnd: 23 },
  });
  await f.owner({ op: "presence.set", state: "away" });
  expect(
    (await f.snapshot()).notifications?.every(
      (item) => !item.eligible && item.deferredReason === "quiet",
    ),
  ).toBe(true);
  snapshot = await f.snapshot();
  await f.owner({
    op: "profile.update",
    expectedVersion: snapshot.profile.version,
    patch: { quietStart: 0, quietEnd: 0 },
  });
  f.time(10);
  await f.owner({ op: "presence.set", state: "present" });
  // Without a readable desktop the owner is away, never unknown: urgent items stay eligible.
  snapshot = await f.snapshot();
  expect(snapshot.effectivePresence).toBe("away");
  expect(snapshot.notifications?.find((item) => item.id === "approval")?.eligible).toBe(true);
  expect(snapshot.notifications?.find((item) => item.id === "ordinary")).toMatchObject({
    eligible: false,
    deferredReason: "away",
  });
  expect(snapshot.notifications?.some((item) => item.deferredReason === "unknown")).toBe(false);
  expect(f.provider.approve).not.toHaveBeenCalled();
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("does not label an ordinary question or a replaced/manual session as a current urgent job approval", async () => {
  const f = await fixture();
  await f.notify("waiting", "job.waiting", f.job.id);
  await f.owner({ op: "presence.set", state: "away" });
  const record = await f.store.session(f.sessionId);
  await f.store.save(
    { ...record, revision: record.revision + 1, runId: "replacement-owner-run" },
    { type: "fixture.replacement" },
  );
  expect((await f.snapshot()).notifications?.find((item) => item.id === "waiting")?.eligible).toBe(
    false,
  );
  expect((await readBriefingApprovals(f.store, [await f.currentJob()])).items).toEqual([]);
  await f.store.db
    .prepare(
      "UPDATE tasks SET value=json_set(value,'$.sessionId','unknown-manual-source') WHERE id='approval-child'",
    )
    .run();
  expect((await readBriefingApprovals(f.store, [await f.currentJob()])).items).toEqual([]);
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("uses actual today/yesterday Notes through AsyncHostNotes outside Host SQL, bounded canonical approval/job details and forbidden-word checks", async () => {
  const f = await fixture();
  await f.owner({
    op: "memory.save",
    kind: "rule",
    text: "Do not say the forbidden term",
    scope: "all",
    source: "typed",
    forbiddenTerms: ["SECRET"],
  });
  await f.owner({
    op: "notes.save",
    id: "today",
    expectedUpdatedAt: 0,
    title: "Old assistant name · 2026-11-02",
    body: "Verified today note: the acceptance plan is retained.\nSECRET",
  });
  await f.owner({
    op: "notes.save",
    id: "yesterday",
    expectedUpdatedAt: 0,
    title: "Briefing fixture · 2026-11-01",
    body: "Verified yesterday note: the narrow retry remains available.",
  });
  await f.owner({
    op: "notes.save",
    id: "old-note",
    expectedUpdatedAt: 0,
    title: "Briefing fixture · 2026-10-30",
    body: "OLD NOTE MUST NOT APPEAR",
  });
  f.time(10);
  await f.owner({ op: "briefing.daily", day: "2026-11-02" });
  const snapshot = await f.snapshot(),
    text = snapshot.briefing!.text;
  expect(text).toContain("Approvals:");
  expect(text).toContain("Permission for form validation");
  expect(text).toContain("Approval task: Permission is required");
  expect(text).toContain("Verified today note");
  expect(text).toContain("Verified yesterday note");
  expect(text).not.toContain("OLD NOTE MUST NOT APPEAR");
  expect(text).not.toContain("SECRET");
  expect(text.length).toBeLessThanOrEqual(6000);
  expect(snapshot.briefing?.projectIds).toEqual([f.project.id]);
  expect(AssistantResponseValidationSchema.safeParse({ snapshot }).success).toBe(true);
  expect(f.provider.send).not.toHaveBeenCalled();
  expect(f.ports.chiefWake).not.toHaveBeenCalled();
  const id = snapshot.briefing!.id;
  await f.restart();
  await f.owner({ op: "briefing.daily", day: "2026-11-02" });
  expect((await f.snapshot()).briefing?.id).toBe(id);
});

it("returns the exact retained daily artifact after another day replaces the global briefing, without notification replay across restart", async () => {
  const f = await fixture();
  f.time(10);
  const first = (await f.owner({ op: "briefing.daily", day: "2026-11-02" })).snapshot!.briefing!;
  expect(first.voiceReceipt).toBeUndefined();
  expect(first.projectIds).toContain(f.project.id);
  expect(first.text.length).toBeLessThanOrEqual(6000);
  f.time(34);
  const later = (await f.owner({ op: "briefing.daily", day: "2026-11-03" })).snapshot!.briefing!;
  expect(later.id).not.toBe(first.id);
  const count = async () =>
    Number(
      (await f.store.db
        .prepare("SELECT count(*) AS n FROM assistant_runtime WHERE id LIKE 'notification:%'")
        .get())!.n,
    );
  const notifications = await count();
  await f.restart();
  const restored = (await f.owner({ op: "briefing.daily", day: "2026-11-02" })).snapshot!.briefing;
  expect(restored).toEqual(first);
  expect((await f.snapshot()).briefing).toEqual(later);
  expect(await count()).toBe(notifications);
  await f.owner({ op: "briefing.daily", day: "2026-11-02" });
  expect(await count()).toBe(notifications);
});

it("reuses the same local-day artifact across restart while note titles remain UTC", async () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const f = await fixture();
    f.time(10);
    const first = (await f.owner({ op: "briefing.daily", day: "2026-11-02" })).snapshot!.briefing!;
    await f.restart();
    const second = (await f.owner({ op: "briefing.daily", day: "2026-11-02" })).snapshot!.briefing!;
    expect(second).toEqual(first);
    const count = await f.store.db
      .prepare(
        "SELECT count(*) AS n FROM assistant_runtime WHERE id LIKE 'dailyBriefingArtifact:%'",
      )
      .get();
    expect(Number(count!.n)).toBe(1);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

it("reuses a legacy daily key only when its exact current briefing is retained, otherwise returns missing without creating anything", async () => {
  const f = await fixture();
  f.time(10);
  const first = (await f.owner({ op: "briefing.daily", day: "2026-11-02" })).snapshot!.briefing!;
  await f.store.db
    .prepare("DELETE FROM assistant_runtime WHERE id=?")
    .run("dailyBriefingArtifact:2026-11-02");
  expect((await f.owner({ op: "briefing.daily", day: "2026-11-02" })).snapshot!.briefing).toEqual(
    first,
  );
  f.time(34);
  const later = (await f.owner({ op: "briefing.daily", day: "2026-11-03" })).snapshot!.briefing!;
  const count = async () =>
    Number(
      (await f.store.db
        .prepare("SELECT count(*) AS n FROM assistant_runtime WHERE id LIKE 'notification:%'")
        .get())!.n,
    );
  const notifications = await count();
  await f.restart();
  expect(
    (await f.owner({ op: "briefing.daily", day: "2026-11-02" })).snapshot!.briefing,
  ).toBeNull();
  expect((await f.snapshot()).briefing).toEqual(later);
  expect(await count()).toBe(notifications);
  await expect(
    f.assistant.request({ op: "briefing.daily", day: "2026-11-03" }, "chief"),
  ).rejects.toThrow();
  await expect(f.owner({ op: "briefing.daily", day: "2026-10-01" })).rejects.toThrow(
    "current local calendar date",
  );
});

it("does not turn an unknown note event into global provenance or echo unavailable private note details", async () => {
  const f = await fixture();
  await f.owner({
    op: "notes.save",
    id: "unknown-note-source",
    expectedUpdatedAt: 0,
    title: "Briefing fixture · 2026-11-02",
    body: "UNRESOLVED PRIVATE SOURCE <!-- assistant-event:unknown-event -->",
  });
  f.time(10);
  await f.owner({ op: "briefing.daily", day: "2026-11-02" });
  const briefing = (await f.snapshot()).briefing!;
  expect(briefing.text).not.toContain("UNRESOLVED PRIVATE SOURCE");
  expect(briefing.text).toContain("Some note details are unavailable");
  expect(briefing.projectIds).toEqual([f.project.id]);
});

it("does not claim an old completed job finished during absence merely because late usage updated its row", async () => {
  const f = await fixture();
  await f.store.db
    .prepare(
      "UPDATE assistant_jobs SET value=json_set(value,'$.status','done','$.updatedAt',?) WHERE id=?",
    )
    .run(f.now, f.job.id);
  f.time(10);
  await f.owner({ op: "briefing.daily", day: "2026-11-02" });
  expect((await f.snapshot()).briefing?.text).not.toContain("finished while you were away");
});

it("retains actual completion evidence beyond the latest hundred activity entries", async () => {
  const f = await fixture();
  await f.store.db
    .prepare(
      "UPDATE assistant_jobs SET value=json_set(value,'$.status','done','$.updatedAt',?) WHERE id=?",
    )
    .run(f.now, f.job.id);
  await f.repository.put("activity", {
    id: "actual-completion",
    version: 0,
    createdAt: f.now,
    updatedAt: f.now,
    kind: "job.done",
    summary: "The exact assigned job completed",
    jobId: f.job.id,
  });
  for (let i = 0; i < 101; i++)
    await f.repository.put("activity", {
      id: `later-metadata-${i}`,
      version: 0,
      createdAt: f.now + i + 1,
      updatedAt: f.now + i + 1,
      kind: "chief.woke",
      summary: "A bounded later review",
    });
  f.time(10);
  await f.owner({ op: "briefing.daily", day: "2026-11-02" });
  const briefing = (await f.snapshot()).briefing!;
  expect(briefing.text).toContain("1 jobs finished while you were away");
  expect(briefing.text).toContain("Completed:");
  expect(briefing.projectIds).toContain(f.project.id);
});

it.each(["tr-TR", "en-US", "de-DE", "fr-FR", "es-ES", "pt-PT", "zh-CN", "ja-JP"])(
  "orders bounded decision/approval details before completed/in-progress details in %s",
  (language) => {
    const text = assistantDetailedBriefingText(
      language,
      { waiting: 1, done: 1, updates: 4, hour: 9 },
      {
        decisions: ["DECISION SOURCE"],
        approvals: ["APPROVAL SOURCE"],
        done: ["COMPLETED SOURCE"],
        running: ["RUNNING SOURCE"],
        notes: ["NOTES SOURCE"],
      },
    );
    expect(text.indexOf("DECISION SOURCE")).toBeLessThan(text.indexOf("APPROVAL SOURCE"));
    expect(text.indexOf("APPROVAL SOURCE")).toBeLessThan(text.indexOf("COMPLETED SOURCE"));
    expect(text.indexOf("COMPLETED SOURCE")).toBeLessThan(text.indexOf("RUNNING SOURCE"));
    expect(text).toContain("NOTES SOURCE");
    expect(text.length).toBeLessThanOrEqual(6000);
  },
);

it("classifies a real return with a waiting approval and validates its receipt", async () => {
  const f = await fixture();
  f.time(10);
  await f.owner({ op: "presence.set", state: "away" });
  f.time(11);
  await f.owner({ op: "presence.set", state: "present" });
  const snapshot = await f.snapshot();
  expect(snapshot.briefing?.voiceReceipt).toMatchObject({
    reason: "return",
    meaningful: true,
    important: true,
  });
  expect(AssistantResponseValidationSchema.safeParse({ snapshot }).success).toBe(true);
});
