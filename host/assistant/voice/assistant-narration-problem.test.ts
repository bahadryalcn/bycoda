import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { HostStore } from "../../store";
import { AssistantRepository } from "../repository";
import { HostAssistant } from "../service";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const admission = { environmentId: "host", deviceHash: "device", authorized: async () => true };

async function setup(profile: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "narration-problem-"));
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  let now = noon.getTime();
  const store = new HostStore(join(dir, "host.db"));
  const service = new HostAssistant(store, {
    now: () => now,
    withVoiceNarrationAuthorization: async (_input, _admission, effect) => effect(() => true),
  });
  cleanups.push(async () => {
    await service.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await service.ready;
  const request = (input: Parameters<HostAssistant["request"]>[0]) =>
    service.request(input, "owner", admission);
  const current = (await request({ op: "snapshot" })).snapshot!.profile;
  await request({
    op: "profile.update",
    expectedVersion: current.version,
    patch: {
      name: "Fixture",
      dailyTokenBudget: 100000,
      enabled: true,
      setupComplete: true,
      voiceNarration: true,
      quietStart: 0,
      quietEnd: 0,
      ...profile,
    },
  });
  const repository = new AssistantRepository(store);
  const room = (await service.globalRoomBinding())!;
  const base = { threadId: room.id, generation: "generation" };
  const row = (id: string) => ({ id, version: 0, createdAt: now, updatedAt: now });
  const job = (status: string, title = "Nightly report") =>
    repository.put("jobs", {
      ...row("job"),
      projectId: "project",
      projectIds: ["project"],
      title,
      status,
    });
  const activity = (id: string, kind: string, summary: string) =>
    repository.put("activity", { ...row(id), kind, jobId: "job", summary });
  const notification = (id: string, kind: string, body: string) =>
    repository.put("runtime", {
      ...row(`notification:${id}`),
      value: { id, kind, title: "Nightly report", body, createdAt: now, jobId: "job" },
    });
  const pending = async () => {
    await repository.put("runtime", {
      ...row("automaticPresence"),
      value: { state: "present", since: now, updatedAt: now, supported: true },
    });
    return (await request({ op: "narration.pending", ...base })).narrationEvents ?? [];
  };
  return {
    job,
    activity,
    notification,
    pending,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it("narrates a job problem once with the job title and never the error text", async () => {
  const f = await setup();
  await f.job("waiting");
  await f.activity("p1", "job.problem", "Job status check failed: C:\\secret\\path exploded");
  f.advance(1000);
  await f.activity("p2", "job.problem", "Job status check failed: a different message");
  const events = await f.pending();
  expect(events).toEqual([
    {
      eventId: "p1",
      kind: "progress",
      text: 'A job stopped with a problem: "Nightly report".',
      createdAt: expect.any(Number),
    },
  ]);
});

it("narrates a wait caused by an error as a problem, and the follow-up problem stays silent", async () => {
  const f = await setup();
  await f.job("waiting");
  await f.activity("w1", "job.waiting", "Stopped with an error: tasks were deleted");
  await f.notification("w1", "job.waiting", "Stopped with an error: tasks were deleted");
  f.advance(60_000);
  await f.activity("p1", "job.problem", "Job status check failed: The linked goal is unavailable.");
  const events = await f.pending();
  expect(events.map((event) => [event.eventId, event.text])).toEqual([
    ["w1", 'A job stopped with a problem: "Nightly report".'],
  ]);
});

it("keeps a real owner question as the generic question narration", async () => {
  const f = await setup();
  await f.job("waiting");
  await f.activity("w1", "job.waiting", "Needs your input. Pick a name");
  await f.notification("w1", "job.waiting", "Needs your input. Pick a name");
  expect((await f.pending()).map((event) => event.text)).toEqual(["A job needs your input."]);
});

it("bounds and quotes the title, and drops stale, finished or switched-off problems", async () => {
  const f = await setup();
  await f.job("waiting", `He said "stop"\n${"x".repeat(200)}`);
  await f.activity("p1", "job.problem", "boom");
  const [event] = await f.pending();
  expect(event.text.startsWith('A job stopped with a problem: "He said stop x')).toBe(true);
  expect(event.text.length).toBeLessThan(130);
  expect(event.text).not.toContain("\n");
  await f.job("done");
  expect(await f.pending()).toEqual([]);
  await f.job("waiting");
  f.advance(301_000);
  expect(await f.pending()).toEqual([]);
});

it("stays silent when narration is switched off", async () => {
  const f = await setup({ voiceNarration: false, proactiveSpeech: "never" });
  await f.job("waiting");
  await f.activity("p1", "job.problem", "boom");
  expect(await f.pending()).toEqual([]);
});
