import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { HostTasks } from "./tasks";
import { HostGoals } from "./goals";
import { HostAssistant } from "./assistant/service";
import { assistantExecutionPorts } from "./assistant-runtime";
import type { HostProvider } from "./providers";
import type { SendTurnInput } from "../src/integrations/harness/core/types";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
async function fixture() {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "assistant-projects-"))),
    store = new HostStore(join(dir, "host.db"));
  await store.ready;
  const projects = [];
  for (const name of ["lead", "secondary", "third"]) {
    const path = join(dir, name);
    mkdirSync(path);
    projects.push(await store.addProject(path, name));
  }
  const turns: { input: SendTurnInput; finish: () => void }[] = [],
    provider: HostProvider = {
      send: vi.fn(
        (input) =>
          new Promise<void>((finish) => {
            turns.push({ input, finish });
          }),
      ),
      stop: vi.fn(async () => {}),
      cancel: vi.fn(async () => {
        turns.at(-1)?.finish();
      }),
      bind: vi.fn(),
      approve: vi.fn(),
      answer: vi.fn(),
    };
  provider.retireOriginal = provider.stop;
  const engine = new HostEngine(store, { claude: provider });
  await engine.ready;
  const tasks = new HostTasks(store, engine);
  await tasks.ready;
  const goals = new HostGoals(store, engine, tasks);
  await goals.ready;
  const ports = assistantExecutionPorts(store, goals, tasks);
  ports.chiefWake = async () => ({ actions: [], tokens: 0 });
  ports.onError = () => {};
  let service = new HostAssistant(store, ports);
  await service.ready;
  await service.request(
    {
      op: "profile.update",
      expectedVersion: 0,
      patch: {
        name: "Project fixture",
        enabled: true,
        setupComplete: true,
        autonomy: "report",
        dailyTokenBudget: 10000000,
        execution: {
          harness: "claude",
          model: "claude:test",
          modelSettings: {},
          runtimeMode: "supervised",
          maxRunMinutes: 60,
        },
      },
    },
    "owner",
  );
  closes.push(async () => {
    for (const turn of turns) turn.finish();
    await service.close();
    await tasks.close();
    await engine.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  const request = (input: unknown) => service.request(input, "owner"),
    snapshot = async () => (await request({ op: "snapshot" })).snapshot!;
  return {
    store,
    engine,
    tasks,
    goals,
    ports,
    turns,
    projects,
    request,
    snapshot,
    get service() {
      return service;
    },
    restart: async () => {
      await service.close();
      service = new HostAssistant(store, ports);
      await service.ready;
    },
    configure: async () => {
      const profile = (await snapshot()).profile;
      await request({
        op: "profile.update",
        expectedVersion: profile.version,
        patch: { autonomy: "jobs" },
      });
    },
  };
}

it("persists normalized project selection and retry identity, then creates the actual Goal with every participant and the original lead", async () => {
  const f = await fixture(),
    [lead, secondary] = f.projects,
    input = {
      op: "jobs.create",
      title: "Cross-project work",
      request: "Coordinate both projects",
      projectId: lead.id,
      projectIds: [secondary.id, secondary.id],
      idempotencyKey: "multi-project",
    };
  const job = (await f.request(input)).job!;
  expect(job.projectIds).toEqual([lead.id, secondary.id]);
  expect(job.status).toBe("queued");
  expect(await f.goals.list()).toEqual([]);
  expect(f.turns).toHaveLength(0);
  await f.restart();
  expect((await f.request(input)).job).toEqual(job);
  await expect(
    f.request({ ...input, projectIds: [secondary.id, f.projects[2].id] }),
  ).rejects.toThrow("preserve the original");
  await expect(
    f.request({ ...input, projectId: secondary.id, projectIds: [lead.id] }),
  ).rejects.toThrow("preserve the original");
  await expect(
    f.request({ ...input, idempotencyKey: "unknown", projectIds: ["not-a-Host-project"] }),
  ).rejects.toThrow("not available");
  await expect(
    f.request({
      ...input,
      idempotencyKey: "too-many",
      projectIds: Array.from({ length: 20 }, (_, i) => `project-${i}`),
    }),
  ).rejects.toThrow("at most 20");
  await f.configure();
  await f.service.tick();
  const dispatched = (await f.snapshot()).jobs.find((value) => value.id === job.id)!,
    goal = (await f.goals.list()).find((value) => value.id === dispatched.goalId)!;
  expect(goal.projectIds).toEqual([lead.id, secondary.id]);
  expect(goal.leadProjectId).toBe(lead.id);
  expect(goal.autoMerge).not.toBe(true);
  expect(goal.approvePlan).toBe(true);
  expect(goal.plannerSessionId).toBeTruthy();
  expect((await f.store.session(goal.plannerSessionId!)).projectId).toBe(lead.id);
  expect((await f.store.session(goal.plannerSessionId!)).session.cwd).toBe(lead.cwd);
  // Goal acceptance precedes its already-authorized planner's asynchronous entry.
  // Establish the real planner/source before fault injection, so it cannot be
  // mistaken for an extra dispatch caused by a rejected scope operation.
  await vi.waitFor(() => expect(f.turns).toHaveLength(1), { timeout: 5000 });
  expect(f.turns[0].input).toMatchObject({
    sessionId: goal.plannerSessionId,
    cwd: lead.cwd,
    model: "claude:test",
    runtimeMode: "supervised",
  });
  expect(f.turns[0].input.text).toContain(job.request);
  expect(goal.taskIds).toEqual([]);
  const count = f.turns.length;
  await f.store.db
    .prepare("UPDATE goals SET value=json_set(value,'$.projectIds',json(?)) WHERE id=?")
    .run(JSON.stringify([lead.id]), goal.id);
  await expect(f.ports.findGoal!(job.id, dispatched)).rejects.toThrow("complete project scope");
  await expect(
    f.ports.createGoal!({ job: dispatched, profile: (await f.snapshot()).profile }),
  ).rejects.toThrow("complete project scope");
  await expect(
    f.ports.goalStatus!(goal.id, (await f.snapshot()).profile, [], dispatched),
  ).rejects.toThrow("complete project scope");
  expect(f.turns).toHaveLength(count);
  await f.service.tick();
  expect((await f.snapshot()).jobs.find((value) => value.id === job.id)).toMatchObject({
    status: "waiting",
    summary: expect.stringContaining("complete project scope"),
  });
  const blockedCount = (await f.snapshot()).activity.filter(
    (event) => event.kind === "job.scopeBlocked",
  ).length;
  await f.service.tick();
  expect(
    (await f.snapshot()).activity.filter((event) => event.kind === "job.scopeBlocked"),
  ).toHaveLength(blockedCount);
  expect(f.turns).toHaveLength(count);
});

it("normalizes legacy jobs to their one saved project and rechecks selected projects immediately before dispatch", async () => {
  const f = await fixture(),
    [lead, , third] = f.projects,
    input = {
      op: "jobs.create",
      title: "Legacy",
      request: "Original single project",
      projectId: lead.id,
      idempotencyKey: "legacy",
    };
  const legacy = (await f.request(input)).job!;
  await f.store.db
    .prepare("UPDATE assistant_jobs SET value=json_remove(value,'$.projectIds') WHERE id=?")
    .run(legacy.id);
  await f.restart();
  expect((await f.snapshot()).jobs.find((job) => job.id === legacy.id)!.projectIds).toEqual([
    lead.id,
  ]);
  expect((await f.request(input)).job!.projectIds).toEqual([lead.id]);
  const missing = (
    await f.request({
      ...input,
      title: "Missing participant",
      projectIds: [third.id],
      idempotencyKey: "removed-project",
    })
  ).job!;
  await f.store.db.prepare("DELETE FROM projects WHERE id=?").run(third.id);
  await f.configure();
  await f.service.tick();
  expect((await f.goals.list()).some((goal) => goal.id === `assistant-${missing.id}`)).toBe(false);
  expect((await f.snapshot()).jobs.find((job) => job.id === missing.id)?.summary).toContain(
    "not available",
  );
  expect(
    (await f.goals.list()).find((goal) => goal.id === `assistant-${legacy.id}`)?.projectIds,
  ).toEqual([lead.id]);
});

it("unions every participating project into message, deleted-record, briefing and notification privacy scope", async () => {
  const f = await fixture(),
    [lead, secondary] = f.projects,
    job = (
      await f.request({
        op: "jobs.create",
        title: "Private multi-project",
        request: "Track both sources",
        projectId: lead.id,
        projectIds: [secondary.id],
        idempotencyKey: "privacy-multi",
      })
    ).job!,
    expected = [lead.id, secondary.id].sort();
  const thread = (await f.request({ op: "threads.open", projectId: secondary.id })).thread!,
    message = (
      await f.request({
        op: "threads.append",
        threadId: thread.id,
        role: "user",
        via: "text",
        text: "Both project sources",
        jobIds: [job.id],
        idempotencyKey: "multi-message",
      })
    ).message!;
  expect(message.projectIds).toEqual(expected);
  await f.configure();
  await f.service.tick();
  const current = (await f.snapshot()).jobs.find((value) => value.id === job.id)!;
  // A canonical owner-input state exercises the real adapter/outbox without
  // asserting that the fixture provider completed or an approval was granted.
  await f.store.db
    .prepare("UPDATE goals SET value=json_set(value,'$.status','awaiting-approval') WHERE id=?")
    .run(current.goalId);
  await f.service.tick();
  expect(
    (await f.snapshot()).notifications!.find((notification) => notification.jobId === job.id)
      ?.projectIds,
  ).toEqual([lead.id, secondary.id]);
  // Stop through the actual Goal owner before trashing the fixture job.
  const stopped = (
    await f.request({
      op: "jobs.control",
      id: job.id,
      expectedVersion: (await f.snapshot()).jobs.find((value) => value.id === job.id)!.version,
      action: "stop",
    })
  ).job!;
  await f.request({
    op: "jobs.control",
    id: job.id,
    expectedVersion: stopped.version,
    action: "delete",
  });
  await f.request({ op: "messages.delete", id: message.id, expectedVersion: message.version });
  await f.request({ op: "briefing.daily", day: "2026-11-02" });
  expect((await f.snapshot()).briefing!.projectIds).toEqual(expected);
  await f.request({ op: "activity.clear", jobId: job.id });
  const trash = (await f.snapshot()).trash;
  expect(
    trash
      .find((item) => item.id === `jobs:${job.id}`)
      ?.projectIds?.slice()
      .sort(),
  ).toEqual(expected);
  expect(trash.find((item) => item.id === `messages:${message.id}`)?.projectIds).toEqual(expected);
  expect(
    trash
      .filter((item) => item.kind === "activity")
      .every(
        (item) => JSON.stringify(item.projectIds?.slice().sort()) === JSON.stringify(expected),
      ),
  ).toBe(true);
});
