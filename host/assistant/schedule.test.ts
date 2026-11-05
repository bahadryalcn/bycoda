import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { HostAssistant } from "./service";
import { AssistantRepository } from "./repository";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "assistant-schedule-")),
    path = join(directory, "host.db");
  let now = new Date(2026, 10, 2, 8, 59).getTime(),
    store = new HostStore(path);
  await store.ready;
  const fixtureProject = await store.addProject(directory, "Project");
  await store.db.prepare("UPDATE projects SET id='project' WHERE id=?").run(fixtureProject.id);
  const chiefWake = vi.fn(async () => ({ tokens: 0, actions: [] })),
    reply = vi.fn(async () => ({ text: "A scoped reply", tokens: 1 }));
  const ports = {
    now: () => now,
    chiefWake,
    reply,
    readPresence: async () => ({ supported: true, locked: false, idleMs: 0 }),
    listProjects: async () => [{ id: "project", path: directory, name: "Project" }],
    roomProjectProofsValid: async (proofs: { projectId: string; cwd: string }[]) => {
      try {
        return (
          await Promise.all(
            proofs.map(async (proof) => (await store.project(proof.projectId)).cwd === proof.cwd),
          )
        ).every(Boolean);
      } catch {
        return false;
      }
    },
  };
  let service = new HostAssistant(store, ports);
  await service.ready;
  await service.request(
    {
      op: "profile.update",
      expectedVersion: 0,
      patch: {
        name: "Schedule fixture",
        enabled: true,
        setupComplete: true,
        autonomy: "report",
        dailyTokenBudget: 100000,
        quietStart: 0,
        quietEnd: 0,
      },
    },
    "owner",
  );
  closes.push(async () => {
    await service.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    get service() {
      return service;
    },
    get store() {
      return store;
    },
    chiefWake,
    reply,
    setTime: (date: Date) => {
      now = date.getTime();
    },
    restart: async () => {
      await service.close();
      await store.close();
      store = new HostStore(path);
      await store.ready;
      service = new HostAssistant(store, ports);
      await service.ready;
    },
    snapshot: async () => (await service.request({ op: "snapshot" }, "owner")).snapshot!,
  };
}

it("prepares a daily factual briefing with no GUI or model while paused, persists once, and supersedes deferred summaries without delivery acknowledgements", async () => {
  const f = await fixture();
  await f.service.request({ op: "presence.set", state: "away" }, "owner");
  await f.service.request({ op: "pauseAll" }, "owner");
  await f.service.tick();
  expect((await f.snapshot()).briefing).toBeNull();
  f.setTime(new Date(2026, 10, 2, 9, 0));
  await f.service.tick();
  const morning = await f.snapshot();
  expect(morning.briefingSchedule).toEqual({ enabled: true, time: "09:00" });
  expect(morning.briefing).not.toBeNull();
  expect(morning.paused).toBe(true);
  expect(morning.notifications).toHaveLength(1);
  expect(morning.notifications![0]).toMatchObject({
    kind: "briefing",
    eligible: false,
    deferredReason: "away",
  });
  const morningId = morning.briefing!.id;
  await f.restart();
  await f.service.tick();
  expect((await f.snapshot()).briefing!.id).toBe(morningId);
  f.setTime(new Date(2026, 10, 2, 11, 0));
  await f.service.tick();
  await f.service.request({ op: "presence.set", state: "present" }, "owner");
  const returned = await f.snapshot();
  expect(returned.briefing!.id).not.toBe(morningId);
  expect(returned.notifications).toHaveLength(1);
  expect(returned.notifications![0]).toMatchObject({ id: returned.briefing!.id, eligible: true });
  const row = await f.store.db
      .prepare("SELECT value FROM assistant_runtime WHERE id=?")
      .get(`notification:${morningId}`),
    pending = JSON.parse(row!.value).value;
  expect(pending.supersededBy).toBe(returned.briefing!.id);
  expect(pending.acknowledgedAt).toBeUndefined();
  expect(f.chiefWake).not.toHaveBeenCalled();
  await f.service.request({ op: "briefing.schedule", enabled: false, time: "09:30" }, "owner");
  f.setTime(new Date(2026, 10, 3, 12));
  await f.service.tick();
  expect((await f.snapshot()).briefing!.id).toBe(returned.briefing!.id);
  await expect(
    f.service.request({ op: "briefing.schedule", enabled: true, time: "25:90" }, "owner"),
  ).rejects.toThrow("HH:mm");
  await expect(
    f.service.request({ op: "briefing.schedule", enabled: true, time: "09:00" }, "chief"),
  ).rejects.toThrow("owner");
});

it("enriches every message acknowledgement, retry, page and search with actual complete contributor scope, discarding stale convenience stamps", async () => {
  const f = await fixture(),
    repository = new AssistantRepository(f.store),
    actualProject = await f.store.addProject(
      join(tmpdir(), "actual-message-project"),
      "Actual project",
    );
  await f.store.save(
    {
      projectId: actualProject.id,
      revision: 1,
      status: "idle",
      createdAt: 1,
      updatedAt: 1,
      session: {
        id: "manual-unenrolled",
        cwd: actualProject.cwd,
        harness: "codex",
        model: "codex:test",
        modelSettings: {},
        runtimeMode: "supervised",
        title: "A real manual source",
        blocks: [],
      },
    },
    {},
  );
  const thread = (await f.service.request({ op: "threads.open" }, "owner")).thread!,
    job = (
      await f.service.request(
        {
          op: "jobs.create",
          title: "Scope job",
          request: "Record job scope",
          projectId: "project",
          idempotencyKey: "message-scope-job",
        },
        "owner",
      )
    ).job!;
  const append = {
    op: "threads.append" as const,
    threadId: thread.id,
    role: "user" as const,
    via: "text" as const,
    text: "Scope contributors",
    sessionId: "manual-unenrolled",
    jobIds: [job.id],
    idempotencyKey: "scoped-message",
  };
  const first = (await f.service.request(append, "owner")).message!,
    expected = ["project", actualProject.id].sort();
  expect(first.projectIds).toEqual(expected);
  await repository.put("messages", { ...first, projectIds: [] }, first.version);
  expect((await f.service.request(append, "owner")).message!.projectIds).toEqual(expected);
  expect(
    (
      await f.service.request({ op: "threads.messages", threadId: thread.id }, "owner")
    ).messages!.find((message) => message.id === first.id)!.projectIds,
  ).toEqual(expected);
  expect(
    (await f.service.request({ op: "conversations.search", query: "contributors" }, "owner"))
      .messages![0].projectIds,
  ).toEqual(expected);
  const global = (
    await f.service.request(
      { ...append, sessionId: undefined, jobIds: [], idempotencyKey: "global-message" },
      "owner",
    )
  ).message!;
  expect(global.projectIds).toEqual([]);
  await expect(
    f.service.request(
      {
        ...append,
        sessionId: "missing-native-only",
        jobIds: [],
        idempotencyKey: "unknown-message",
      },
      "owner",
    ),
  ).rejects.toThrow("not available on this Host");
  const current = (await f.service.request({ op: "snapshot" }, "owner")).snapshot!.profile;
  await f.service.request(
    {
      op: "profile.update",
      expectedVersion: current.version,
      patch: {
        execution: {
          harness: "codex",
          model: "codex:test",
          modelSettings: {},
          runtimeMode: "supervised",
          maxRunMinutes: 60,
        },
      },
    },
    "owner",
  );
  const projectThread = (
      await f.service.request({ op: "threads.open", projectId: "project" }, "owner")
    ).thread!,
    send = {
      op: "threads.send" as const,
      threadId: projectThread.id,
      via: "text" as const,
      text: "A scoped conversation",
      idempotencyKey: "send-scope",
    };
  const scopedReply = await f.service.request(send, "owner");
  expect(
    scopedReply.messages!.every((message) => JSON.stringify(message.projectIds) === '["project"]'),
    JSON.stringify(scopedReply),
  ).toBe(true);
  expect((await f.service.request(send, "owner")).messages![0].projectIds).toEqual(["project"]);
  const originalProject = await f.store.project("project");
  await f.store.withProjectIdentityWrite(() =>
    f.store.db
      .prepare("UPDATE projects SET cwd=? WHERE id=?")
      .run(`${originalProject.cwd}-retargeted`, "project")
      .then(() => undefined),
  );
  expect((await f.service.request(send, "owner")).messages![0]).toMatchObject({
    text: "This message is unavailable because its source access changed.",
    unverifiedToolContext: true,
  });
  await f.store.withProjectIdentityWrite(() =>
    f.store.db
      .prepare("UPDATE projects SET cwd=? WHERE id=?")
      .run(originalProject.cwd, "project")
      .then(() => undefined),
  );
  // Deleted referenced jobs keep their authoritative project identity. A
  // genuinely lost association remains unknown even inside a project thread.
  await f.service.request(
    { op: "jobs.control", id: job.id, expectedVersion: job.version, action: "delete" },
    "owner",
  );
  expect((await f.service.request(append, "owner")).message!.projectIds).toEqual(expected);
  await f.store.db.prepare("DELETE FROM assistant_jobs WHERE id=?").run(job.id);
  expect((await f.service.request(append, "owner")).message).not.toHaveProperty("projectIds");
});

it("derives deleted and briefing scope from stored associations and leaves missing provenance unknown", async () => {
  const f = await fixture(),
    repository = new AssistantRepository(f.store);
  await repository.initialize();
  const job = (
    await f.service.request(
      {
        op: "jobs.create",
        title: "Project job",
        request: "Track this project",
        projectId: "project",
        idempotencyKey: "scope-job",
      },
      "owner",
    )
  ).job!;
  for (const projectId of [undefined, "project"]) {
    const thread = (
      await f.service.request({ op: "threads.open", ...(projectId ? { projectId } : {}) }, "owner")
    ).thread!;
    const message = (
      await f.service.request(
        {
          op: "threads.append",
          threadId: thread.id,
          role: "user",
          via: "text",
          text: "Deleted message",
          idempotencyKey: projectId ?? "global",
        },
        "owner",
      )
    ).message!;
    await f.service.request(
      { op: "messages.delete", id: message.id, expectedVersion: message.version },
      "owner",
    );
  }
  await f.service.request(
    { op: "jobs.control", id: job.id, expectedVersion: job.version, action: "delete" },
    "owner",
  );
  const stamp = { version: 0, createdAt: Date.now(), updatedAt: Date.now() };
  const unknown = await repository.put("activity", {
    ...stamp,
    id: "unknown-event",
    kind: "unknown",
    summary: "Unknown project must remain concealed",
  });
  await repository.trash("activity", unknown.id, unknown.version, Date.now());
  await f.service.request({ op: "activity.clear", jobId: job.id }, "owner");
  const snapshot = await f.snapshot();
  expect(snapshot.trash.find((item) => item.id === `jobs:${job.id}`)?.projectId).toBe("project");
  expect(
    snapshot.trash.filter((item) => item.kind === "messages").map((item) => item.projectId),
  ).toEqual(expect.arrayContaining([null, "project"]));
  expect(
    snapshot.trash
      .filter((item) => item.kind === "activity" && item.id !== "activity:unknown-event")
      .every((item) => item.projectId === "project"),
  ).toBe(true);
  expect(snapshot.trash.find((item) => item.id === "activity:unknown-event")).not.toHaveProperty(
    "projectId",
  );
  // A surviving event resolves a deleted job's actual project before generation.
  await repository.put("activity", {
    ...stamp,
    id: "deleted-job-event",
    kind: "job.done",
    jobId: job.id,
    summary: "Saved job association",
  });
  await f.service.request({ op: "briefing.daily", day: "2026-11-02" }, "owner");
  expect((await f.snapshot()).briefing!.projectIds).toEqual(["project"]);
  await repository.put("activity", {
    ...stamp,
    id: "unresolved",
    kind: "job.done",
    jobId: "missing-job",
    summary: "Missing source",
  });
  await f.service.request({ op: "briefing.daily", day: "2026-11-03" }, "owner");
  expect((await f.snapshot()).briefing).not.toHaveProperty("projectIds");
});

it("retains mixed-project causal reply scope through retries and recursive history, and refuses missing, cleared, cyclic or uncaptured summary context", async () => {
  const f = await fixture(),
    repository = new AssistantRepository(f.store),
    actual = await f.store.addProject(
      join(tmpdir(), "causal-message-project"),
      "Hidden contributor",
    );
  await f.store.save(
    {
      projectId: actual.id,
      revision: 1,
      status: "idle",
      createdAt: 1,
      updatedAt: 1,
      session: {
        id: "hidden-source",
        cwd: actual.cwd,
        harness: "codex",
        model: "codex:test",
        modelSettings: {},
        runtimeMode: "supervised",
        title: "Hidden source",
        blocks: [],
      },
    },
    {},
  );
  const profile = (await f.snapshot()).profile;
  await f.service.request(
    {
      op: "profile.update",
      expectedVersion: profile.version,
      patch: {
        execution: {
          harness: "codex",
          model: "codex:test",
          modelSettings: {},
          runtimeMode: "supervised",
          maxRunMinutes: 60,
        },
      },
    },
    "owner",
  );
  const thread = (await f.service.request({ op: "threads.open" }, "owner")).thread!;
  const source = (
    await f.service.request(
      {
        op: "threads.append",
        threadId: thread.id,
        role: "user",
        via: "voice",
        text: "Input from a private project",
        sessionId: "hidden-source",
        idempotencyKey: "causal-source",
      },
      "owner",
    )
  ).message!;
  const send = {
    op: "threads.send" as const,
    threadId: thread.id,
    via: "text" as const,
    text: "Explain that project",
    idempotencyKey: "causal-reply",
  };
  const first = (await f.service.request(send, "owner")).messages!.at(-1)!;
  expect(first.projectIds, JSON.stringify(first)).toEqual([actual.id]);
  expect((await f.service.request(send, "owner")).messages![0].projectIds).toEqual([actual.id]);
  expect(f.reply).toHaveBeenCalledTimes(1);
  const secondSend = {
      ...send,
      text: "Continue that explanation",
      idempotencyKey: "second-causal",
    },
    second = (await f.service.request(secondSend, "owner")).messages!.at(-1)!;
  expect(second.projectIds).toEqual([actual.id]);
  await f.service.request(
    { op: "messages.delete", id: source.id, expectedVersion: source.version },
    "owner",
  );
  expect((await f.service.request(send, "owner")).messages![0]).not.toHaveProperty("projectIds");
  expect((await f.service.request(secondSend, "owner")).messages![0]).not.toHaveProperty(
    "projectIds",
  );
  expect(f.reply).toHaveBeenCalledTimes(2);
  await f.service.request({ op: "trash.restore", id: `messages:${source.id}` }, "owner");
  expect((await f.service.request(secondSend, "owner")).messages![0].projectIds).toEqual([
    actual.id,
  ]);
  const direct = (
    await f.service.request(
      {
        op: "threads.append",
        threadId: thread.id,
        role: "assistant",
        via: "voice",
        text: "Broader voice context was not captured",
        idempotencyKey: "direct-voice",
      },
      "assistant",
    )
  ).message!;
  expect(direct).not.toHaveProperty("projectIds");
  const current = (await f.snapshot()).threads.find((value) => value.id === thread.id)!;
  await f.service.request(
    { op: "threads.clear", threadId: thread.id, expectedVersion: current.version },
    "owner",
  );
  await f.service.request({ op: "trash.restore", id: `messages:${second.id}` }, "owner");
  expect((await f.service.request(secondSend, "owner")).messages![0]).not.toHaveProperty(
    "projectIds",
  );
  expect(f.reply).toHaveBeenCalledTimes(2);
  const cycleId = `messageScopeSources:${second.id}`,
    old = await repository.get<{
      id: string;
      version: number;
      createdAt: number;
      updatedAt: number;
      value: unknown;
    }>("runtime", cycleId);
  await repository.put(
    "runtime",
    { ...old!, value: { threadId: thread.id, messageIds: [second.id], summaryUsed: false } },
    old!.version,
  );
  expect(
    (await f.service.request({ op: "threads.messages", threadId: thread.id }, "owner"))
      .messages![0],
  ).not.toHaveProperty("projectIds");
  const bound = (await f.service.request({ op: "threads.open", projectId: "project" }, "owner"))
    .thread!;
  await f.service.request(
    {
      op: "threads.summary",
      threadId: bound.id,
      expectedVersion: bound.version,
      summary: "A summary with unknown older contributors",
    },
    "assistant",
  );
  const summarized = (
    await f.service.request(
      { ...send, threadId: bound.id, idempotencyKey: "summary-input" },
      "owner",
    )
  ).messages!.at(-1)!;
  expect(summarized).not.toHaveProperty("projectIds");
});
