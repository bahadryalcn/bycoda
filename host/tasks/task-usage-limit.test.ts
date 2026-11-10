import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../../src/integrations/harness/core/types";
import type { HostProvider } from "../providers/providers";
import { HostEngine } from "../engine";
import { HostStore } from "../store";
import { HostTasks } from "./service";
import { USAGE_LIMIT_RESUME_GRACE_MS } from "../../src/features/sessions/model/usageLimit";
import * as time from "../../src/shared/lib/time/timestamps";

if (process.platform === "win32") vi.setConfig({ testTimeout: 60000 });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  } finally {
    vi.restoreAllMocks();
  }
});

async function setup() {
  const fixture = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-usage-limit-")));
  const directory = join(fixture, "workspace");
  mkdirSync(directory);
  const clock = { now: new Date("2026-11-10T12:00:00").getTime() };
  vi.spyOn(Date, "now").mockImplementation(() => clock.now);
  vi.spyOn(time, "monotonicNow").mockImplementation(() => clock.now);
  const store = new HostStore(join(fixture, "host.db"));
  const project = await store.addProject(directory, "Usage fixture");
  const turns: Array<{ input: SendTurnInput; finish: () => void }> = [];
  const provider: HostProvider = {
    send: vi.fn(
      (input) =>
        new Promise<void>((finish) => {
          turns.push({ input, finish });
        }),
    ),
    cancel: vi.fn(async (sessionId) => {
      turns.findLast((turn) => turn.input.sessionId === sessionId)?.finish();
    }),
    stop: vi.fn(async (sessionId) => {
      turns.findLast((turn) => turn.input.sessionId === sessionId)?.finish();
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { claude: provider });
  const tasks = new HostTasks(store, engine, () => clock.now);
  const input = (overrides: Record<string, unknown> = {}) => ({
    id: "limited-task",
    title: "Prepare the report",
    prompt: "Prepare the requested report",
    projectId: project.id,
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    isolate: false,
    review: false,
    ...overrides,
  });
  const task = async (id = "limited-task") => (await tasks.get(id))!;
  const tick = async () => {
    await tasks.tick();
    await tasks.idle();
  };
  const start = async (overrides: Record<string, unknown> = {}) => {
    await tasks.save(input(overrides));
    clock.now += 1;
    await tick();
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 10000 });
    return await task(String(overrides.id ?? "limited-task"));
  };
  /** The provider reports its limit, then the turn ends in error, as Claude and Codex do. */
  const hitLimit = async (resetsAt: number) => {
    const turn = turns.at(-1)!;
    const sessionId = turn.input.sessionId;
    turn.input.onEvent({ type: "session.error", message: "You have hit your usage limit." });
    turn.input.onEvent({ type: "usage.limited", resetsAt });
    turn.finish();
    await vi.waitFor(async () => expect((await store.session(sessionId)).status).toBe("idle"), {
      timeout: 10000,
    });
    return sessionId;
  };
  cleanups.push(async () => {
    for (const turn of turns) turn.finish();
    await engine.close();
    await tasks.idle();
    await store.close();
    rmSync(fixture, { recursive: true, force: true, maxRetries: 5 });
  });
  return { store, project, clock, turns, engine, tasks, input, task, tick, start, hitLimit };
}

describe("a task stopped by a provider usage limit", () => {
  it("is not blocked and continues once on its own session after the reset", async () => {
    const s = await setup();
    const started = await s.start({ goalId: "assistant-job" });
    const resetsAt = s.clock.now + 60 * 60_000;
    const sessionId = await s.hitLimit(resetsAt);
    s.clock.now += 1000;
    await s.tick();
    // Assistant goals are armed automatically; nothing blocks, nothing resumes early.
    expect((await s.store.session(sessionId)).session.usageLimit).toMatchObject({
      resumeAtReset: true,
    });
    expect(await s.task()).toMatchObject({ status: "running", sessionId });
    expect(s.turns).toHaveLength(1);
    s.clock.now = resetsAt + USAGE_LIMIT_RESUME_GRACE_MS - 1;
    await s.tick();
    expect(s.turns).toHaveLength(1);
    s.clock.now = resetsAt + USAGE_LIMIT_RESUME_GRACE_MS;
    await s.tick();
    await vi.waitFor(() => expect(s.turns).toHaveLength(2), { timeout: 10000 });
    const resumed = await s.task();
    expect(resumed).toMatchObject({ status: "running", sessionId, model: started.model });
    expect(resumed.runId).not.toBe(started.runId);
    expect(s.turns[1].input.sessionId).toBe(sessionId);
    expect(s.turns[1].input.text).toContain("usage limit has reset");
    expect((await s.store.session(sessionId)).session.usageLimit).toBeUndefined();
    // Later ticks see the cleared limit and do nothing more.
    s.clock.now += 60_000;
    await s.tick();
    expect(s.turns).toHaveLength(2);
  });

  it("keeps today's failure handling for a task outside the assistant that did not arm a resume", async () => {
    const s = await setup();
    const started = await s.start();
    await s.hitLimit(s.clock.now + 60 * 60_000);
    s.clock.now += 1000;
    await s.tick();
    // The ordinary path retries the failed run in a fresh session; no wait, no resume.
    expect((await s.task()).sessionId).not.toBe(started.sessionId);
    expect((await s.task()).ownerNotices?.[0]).toMatchObject({ kind: "auto_continued" });
  });
});

describe("re-pointing unstarted assistant goal tasks", () => {
  const next = {
    harness: "claude" as const,
    model: "claude:next",
    modelSettings: { effort: "low" },
  };
  it("moves a queued task that has not started and refuses a stale revision", async () => {
    const s = await setup();
    await s.tasks.save(s.input({ goalId: "assistant-job", status: "queued", prompt: "wait" }));
    const queued = await s.task();
    expect(
      await s.tasks.repointUnstartedTask({
        taskId: queued.id,
        expectedUpdatedAt: queued.updatedAt + 1,
        ...next,
      }),
    ).toBeUndefined();
    const saved = await s.tasks.repointUnstartedTask({
      taskId: queued.id,
      expectedUpdatedAt: queued.updatedAt,
      ...next,
    });
    expect(saved).toMatchObject({ model: "claude:next", modelSettings: { effort: "low" } });
  });

  it("never changes a running task", async () => {
    const s = await setup();
    const running = await s.start({ goalId: "assistant-job" });
    expect(
      await s.tasks.repointUnstartedTask({
        taskId: running.id,
        expectedUpdatedAt: running.updatedAt,
        ...next,
      }),
    ).toBeUndefined();
    expect((await s.task()).model).toBe("claude:test");
  });

  it("never changes a task outside an assistant goal", async () => {
    const s = await setup();
    await s.tasks.save(s.input({ goalId: "goal-1", status: "todo" }));
    const plain = await s.task();
    expect(
      await s.tasks.repointUnstartedTask({
        taskId: plain.id,
        expectedUpdatedAt: plain.updatedAt,
        ...next,
      }),
    ).toBeUndefined();
    expect((await s.task()).model).toBe("claude:test");
  });
});
