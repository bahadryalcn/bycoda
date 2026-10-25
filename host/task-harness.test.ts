import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { HostProvider } from "./providers";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { HostTasks } from "./tasks";
import { taskPreflightResourceKey } from "../src/features/tasks/model/taskPreflight";
if (process.platform === "win32") vi.setConfig({ testTimeout: 60000 });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-harness-")));
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Harness fixture");
  const clock = { now: new Date("2026-10-24T12:00:00").getTime() };
  const turns: Array<{
    input: SendTurnInput;
    finish: () => void;
  }> = [];
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
    id: "harness-task",
    title: "Prepare the checked report",
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
  const task = async () => (await tasks.get("harness-task"))!;
  const tick = async () => {
    await tasks.tick();
    await tasks.idle();
  };
  const start = async (overrides: Record<string, unknown> = {}) => {
    await tasks.save(input(overrides));
    clock.now += 1;
    await tick();
    if ((await task()).status === "running")
      await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 10000 });
    return await task();
  };
  const finish = async (reply = "Prepared the report") => {
    const turn = turns.at(-1)!;
    turn.input.onEvent({ type: "message.delta", text: reply });
    turn.input.onEvent({ type: "message.completed" });
    turn.finish();
    await vi.waitFor(
      async () => expect((await store.session(turn.input.sessionId)).status).toBe("idle"),
      {
        timeout: 10000,
      },
    );
    clock.now += 1;
    await tick();
  };
  cleanups.push(async () => {
    for (const turn of turns) turn.finish();
    await engine.close();
    await tasks.idle();
    await store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  return {
    directory,
    store,
    project,
    clock,
    turns,
    provider,
    engine,
    tasks,
    input,
    task,
    tick,
    start,
    finish,
  };
}
describe("task harness preparation and aggregate budgets", () => {
  it("blocks a missing required source before any provider send", async () => {
    const s = await setup();
    await s.start({ preflightRequirements: [{ kind: "source", id: "missing-brief.md" }] });
    expect(await s.task()).toMatchObject({ status: "blocked", preflight: { state: "blocked" } });
    expect((await s.task()).error).toContain("missing-brief.md");
    expect(s.provider.send).not.toHaveBeenCalled();
  });
  it("starts with a readable local source and records the actual host observation", async () => {
    const s = await setup();
    writeFileSync(join(s.directory, "brief.md"), "Source text");
    const requirement = { kind: "source" as const, id: "brief.md" };
    await s.start({ preflightRequirements: [requirement] });
    expect((await s.task()).status).toBe("running");
    expect(
      (await s.task()).preflight?.items.find(
        (item) => item.key === taskPreflightResourceKey(requirement),
      ),
    ).toMatchObject({ state: "ready" });
    expect(s.provider.send).toHaveBeenCalledTimes(1);
  });
  it("requires checked tool access while optional unknown resources only warn", async () => {
    const blocked = await setup();
    await blocked.start({ preflightRequirements: [{ kind: "tool", id: "unverified-browser" }] });
    expect((await blocked.task()).status).toBe("blocked");
    expect(blocked.provider.send).not.toHaveBeenCalled();
    const optional = await setup();
    await optional.start({
      preflightRequirements: [{ kind: "tool", id: "unverified-browser", required: false }],
    });
    expect((await optional.task()).status).toBe("running");
    expect((await optional.task()).preflight?.items.at(-1)).toMatchObject({
      state: "unknown",
      required: false,
    });
    expect(optional.provider.send).toHaveBeenCalledTimes(1);
  });
  it("counts the worker toward the family attempt cap before starting its reviewer", async () => {
    const s = await setup();
    await s.start({ review: true, budget: { maxAttempts: 1 } });
    await s.finish();
    expect((await s.task()).status).toBe("blocked");
    expect((await s.task()).budgetStop).toBeTruthy();
    expect(s.turns).toHaveLength(1);
    expect((await s.tasks.budgets.read({ taskId: (await s.task()).id })).attempts).toBe(1);
  });
  it("stops a running worker at the cumulative minute cap and preserves its files", async () => {
    const s = await setup();
    await s.start({ budget: { maxAgentMinutes: 1 } });
    writeFileSync(join(s.directory, "retained-result.md"), "Keep this work");
    s.clock.now += 2 * 60000;
    await s.tick();
    expect((await s.task()).status).toBe("blocked");
    expect((await s.task()).budgetStop).toBeTruthy();
    expect(s.provider.cancel).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(s.directory, "retained-result.md"), "utf8")).toBe("Keep this work");
    expect((await s.task()).sessionId).toBeTruthy();
  });
  it("keeps consumed runs after a host-task board restart and an explicit retry", async () => {
    const s = await setup();
    await s.start({ review: true, budget: { maxAttempts: 1 } });
    await s.finish();
    const restarted = new HostTasks(s.store, s.engine, () => s.clock.now);
    await restarted.ready;
    expect((await restarted.budgets.read({ taskId: (await s.task()).id })).attempts).toBe(1);
    await restarted.move((await s.task()).id, "queued");
    await restarted.tick();
    await restarted.idle();
    expect((await restarted.get((await s.task()).id))?.status).toBe("blocked");
    expect(s.turns).toHaveLength(1);
  });
  it("records owner outcome measurements without changing completion and rejects stale writes", async () => {
    const s = await setup();
    await s.start();
    await s.finish();
    const result = await s.task();
    expect(result.status).toBe("done");
    const measured = await s.tasks.recordEvaluation(
      result.id,
      { accepted: false, reviewMinutes: 12, corrections: 3 },
      result.updatedAt,
    );
    expect(measured).toMatchObject({
      status: "done",
      evaluation: { accepted: false, reviewMinutes: 12, corrections: 3, recordedAt: s.clock.now },
    });
    await expect(
      (async () =>
        await s.tasks.recordEvaluation(
          result.id,
          { accepted: true, reviewMinutes: 0, corrections: 0 },
          result.updatedAt,
        ))(),
    ).rejects.toThrow("changed");
    await expect(
      (async () =>
        await s.tasks.recordEvaluation(
          result.id,
          { accepted: true, reviewMinutes: -1, corrections: 0 },
          measured.updatedAt,
        ))(),
    ).rejects.toThrow("valid review time");
  });
  it("clears accepted outcome measurements before rerunning the same task", async () => {
    const s = await setup();
    await s.start();
    await s.finish();
    s.clock.now += 1;
    await s.tasks.recordEvaluation(
      (await s.task()).id,
      { accepted: true, reviewMinutes: 2, corrections: 0 },
      (await s.task()).updatedAt,
    );
    expect((await s.task()).evaluation?.accepted).toBe(true);
    await s.tasks.move((await s.task()).id, "queued");
    expect((await s.task()).evaluation).toBeUndefined();
  });
  it("retains the independent reviewer session for inspection after a running budget stop", async () => {
    const s = await setup();
    await s.start({ review: true, budget: { maxAgentMinutes: 1 } });
    await s.finish();
    await vi.waitFor(() => expect(s.turns).toHaveLength(2), { timeout: 10000 });
    const reviewerId = (await s.task()).reviewer!.sessionId!;
    s.clock.now += 61000;
    await s.tick();
    expect(await s.task()).toMatchObject({
      status: "blocked",
      reviewer: { sessionId: reviewerId },
      awaitingOwnerRestart: true,
    });
    expect(s.provider.cancel).toHaveBeenCalledWith(reviewerId);
    expect((await s.store.session(reviewerId)).session.id).toBe(reviewerId);
  });
  it("retains unknown historical consumption instead of granting a fresh total budget", async () => {
    const s = await setup();
    const old = await s.tasks.save(await s.input({ status: "todo" }));
    await s.store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(
      JSON.stringify({
        ...old,
        status: "blocked",
        startedAt: s.clock.now - 1000,
        sessionId: "deleted-old-session",
        error: "Legacy failure",
      }),
      old.id,
    );
    const upgraded = new HostTasks(s.store, s.engine, () => s.clock.now);
    await upgraded.ready;
    expect((await upgraded.budgets.read({ taskId: old.id })).historyComplete).toBe(false);
    expect(
      (await upgraded.budgets.evaluate({ taskId: old.id }, { maxAttempts: 20 }, { starting: true }))
        .blocked,
    ).toBe(true);
  });
});
