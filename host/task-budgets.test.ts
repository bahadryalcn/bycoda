import { forEachAsync } from "./async-collections";
import { afterEach, describe, expect, it } from "vitest";
import { HostStore } from "./store";
import { HostTaskBudgets, type BudgetRunRegistration } from "./task-budgets";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { HostSession } from "../src/features/connections/model/protocol";
import type { TurnMetrics } from "../src/features/sessions/model/session";
const stores: HostStore[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const store of await stores.splice(0)) await store.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
async function setup() {
  const store = new HostStore(":memory:");
  await stores.push(store);
  const project = await store.addProject("/budget", "Budget");
  const clock = { now: 1000 };
  const budgets = new HostTaskBudgets(store, () => clock.now);
  const save = async (
    id: string,
    runId: string,
    options: {
      status?: HostSession["status"];
      durationMs?: number;
      metrics?: TurnMetrics;
      cost?: number;
      previous?: HostSession;
      provider?: "codex" | "claude" | "cursor";
    } = {},
  ) => {
    const previous = options.previous;
    return await store.save(
      {
        projectId: project.id,
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: clock.now,
        status: options.status ?? "running",
        runId,
        session: {
          id,
          cwd: "/budget",
          title: "Private task",
          harness: options.provider ?? "codex",
          model: "test",
          modelSettings: {},
          runtimeMode: "auto",
          blocks: [
            ...(previous?.session.blocks ?? []),
            {
              id: `block-${runId}`,
              role: "user",
              text: "private prompt",
              startedAt: clock.now,
              ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
              ...(options.metrics === undefined ? {} : { turnMetrics: options.metrics }),
            },
          ],
          ...(options.cost === undefined
            ? {}
            : {
                usage: {
                  costUsd: options.cost,
                  apiMs: 0,
                  lastProcessCostUsd: options.cost,
                  lastProcessApiMs: 0,
                },
              }),
        },
      },
      {},
    );
  };
  const register = async (
    sessionId = "session",
    runId = "run",
    patch: Partial<BudgetRunRegistration> = {},
  ) =>
    await budgets.register({
      taskId: "task",
      goalId: "goal",
      role: "worker",
      sessionId,
      runId,
      startedAt: clock.now,
      ...patch,
    });
  const finish = async (
    id: string,
    options: {
      durationMs?: number;
      metrics?: TurnMetrics;
      cost?: number;
    } = {},
  ) => {
    const previous = await store.session(id);
    return await store.save(
      {
        ...previous,
        status: "idle",
        revision: previous.revision + 1,
        updatedAt: clock.now,
        session: {
          ...previous.session,
          ...(options.cost === undefined
            ? {}
            : {
                usage: {
                  costUsd: options.cost,
                  apiMs: 0,
                  lastProcessCostUsd: options.cost,
                  lastProcessApiMs: 0,
                },
              }),
          blocks: previous.session.blocks.map((block, index) =>
            index === previous.session.blocks.length - 1
              ? {
                  ...block,
                  durationMs: options.durationMs ?? 0,
                  ...options,
                  ...(options.metrics ? { turnMetrics: options.metrics } : {}),
                }
              : block,
          ),
        },
      },
      {},
    );
  };
  return { store, project, clock, budgets, save, register, finish };
}
const reported = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 5 };
describe("durable task/goal family budgets", () => {
  it("accounts active time once, then settles without double counting or polling inflation", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.register();
    s.clock.now += 30000;
    expect(await s.budgets.read({ taskId: "task" })).toMatchObject({
      agentMinutes: 0.5,
      attempts: 1,
      runningRuns: 1,
      tokens: null,
    });
    await s.register();
    s.clock.now += 30000;
    await s.finish("session", { durationMs: 60000, metrics: reported });
    expect(await s.budgets.read({ taskId: "task" })).toMatchObject({
      agentMinutes: 1,
      attempts: 1,
      completedRuns: 1,
      runningRuns: 0,
      tokens: 125,
    });
    s.clock.now += 60000;
    expect((await s.budgets.read({ goalId: "goal" })).agentMinutes).toBe(1);
  });
  it("adds concurrent planner, worker, reviewer and repair time to the owning family", async () => {
    const s = await setup();
    const roles = ["planner", "worker", "reviewer", "repair", "recovery", "final-review"] as const;
    await forEachAsync(roles, async (role, index) => {
      await s.save(`s${index}`, `r${index}`);
      await s.register(`s${index}`, `r${index}`, {
        role,
        ...(role === "planner" || role === "final-review" ? { taskId: undefined } : {}),
      });
    });
    s.clock.now += 60000;
    expect(await s.budgets.read({ goalId: "goal" })).toMatchObject({
      agentMinutes: 6,
      attempts: 6,
      runningRuns: 6,
    });
    expect(await s.budgets.read({ taskId: "task" })).toMatchObject({
      agentMinutes: 4,
      attempts: 4,
    });
  });
  it("survives helper recreation and retained-session follow-ups without charging old turns twice", async () => {
    const s = await setup();
    const first = await s.save("session", "run");
    await s.register();
    s.clock.now += 20000;
    const ended = await s.finish("session", { durationMs: 20000, metrics: reported });
    expect((await s.budgets.read({ taskId: "task" })).tokens).toBe(125);
    await s.save("session", "follow-up", { previous: ended });
    await s.register("session", "follow-up", { role: "reviewer" });
    s.clock.now += 10000;
    await s.finish("session", { durationMs: 10000, metrics: { inputTokens: 5, outputTokens: 5 } });
    const restarted = new HostTaskBudgets(s.store, () => s.clock.now);
    expect(await restarted.read({ taskId: "task" })).toMatchObject({
      attempts: 2,
      agentMinutes: 0.5,
      tokens: 135,
    });
    expect(first.runId).toBe("run");
  });
  it("never replaces unavailable provider readings with zero or an invented cost estimate", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.register();
    await s.finish("session");
    expect(await s.budgets.read({ taskId: "task" })).toMatchObject({
      tokens: null,
      unknownTokenRuns: 1,
      reportedCostUsd: null,
      estimatedCostUsd: null,
    });
    expect(
      (await s.budgets.evaluate({ taskId: "task" }, { maxTokens: 500 }, { starting: true }))
        .blocked,
    ).toBe(true);
    expect((await s.budgets.evaluate({ taskId: "task" }, { maxTokens: 500 })).blocked).toBe(false);
  });
  it("counts Codex cache once and Claude cache separately", async () => {
    const s = await setup();
    await s.save("codex", "one", { provider: "codex" });
    await s.register("codex", "one");
    await s.finish("codex", { metrics: reported });
    await s.save("claude", "two", { provider: "claude" });
    await s.register("claude", "two");
    await s.finish("claude", { metrics: reported });
    expect((await s.budgets.read({ taskId: "task" })).tokens).toBe(290);
  });
  it("keeps unsupported provider token metrics unknown", async () => {
    const s = await setup();
    await s.save("cursor", "run", { provider: "cursor" });
    await s.register("cursor", "run");
    await s.finish("cursor", { metrics: reported });
    expect((await s.budgets.read({ taskId: "task" })).tokens).toBeNull();
  });
  it("enforces summed time and known token caps during active runs but reserves the last allowed run", async () => {
    const s = await setup();
    await s.save("session", "run", { metrics: reported });
    await s.register();
    expect((await s.budgets.evaluate({ taskId: "task" }, { maxAttempts: 1 })).blocked).toBe(false);
    expect(
      (await s.budgets.evaluate({ taskId: "task" }, { maxAttempts: 1 }, { starting: true }))
        .blocked,
    ).toBe(true);
    s.clock.now += 60000;
    expect((await s.budgets.evaluate({ goalId: "goal" }, { maxAgentMinutes: 1 })).blocked).toBe(
      true,
    );
    expect((await s.budgets.evaluate({ goalId: "goal" }, { maxTokens: 100 })).blocked).toBe(true);
  });
  it("warns at the configured threshold and distinguishes unknown active totals", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.register();
    s.clock.now += 48000;
    expect(
      await s.budgets.evaluate({ taskId: "task" }, { maxAgentMinutes: 1, warningPercent: 80 }),
    ).toMatchObject({ warning: true, blocked: false });
    await s.finish("session", { durationMs: 48000, metrics: reported });
    expect(
      await s.budgets.evaluate({ taskId: "task" }, { maxTokens: 200, warningPercent: 70 }),
    ).toMatchObject({ warning: false, blocked: false });
  });
  it("preserves settled measurements when the source transcript is removed", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.register();
    await s.finish("session", { durationMs: 5000, metrics: reported });
    await s.budgets.sync();
    await s.store.deleteSession("session");
    s.clock.now += 90000;
    expect(await s.budgets.read({ taskId: "task" })).toMatchObject({
      historyComplete: true,
      agentMinutes: 5000 / 60000,
      tokens: 125,
      attempts: 1,
    });
  });
  it("keeps last observed active time as a lower bound after the unsettled transcript is removed", async () => {
    const s = await setup();
    await s.save("session", "run", { metrics: reported });
    await s.register("session", "run", { parentTaskId: "parent" });
    s.clock.now += 5000;
    expect((await s.budgets.read({ taskId: "task" })).agentMinutes).toBe(5000 / 60000);
    const current = await s.store.session("session");
    await s.store.save({ ...current, status: "idle", revision: current.revision + 1 }, {});
    await s.store.deleteSession("session");
    s.clock.now += 3600000;
    expect(await s.budgets.read({ taskId: "task" })).toMatchObject({
      historyComplete: false,
      agentMinutes: 5000 / 60000,
      reportedTokens: 125,
      tokens: null,
      reportedCostUsd: null,
    });
    expect((await s.budgets.read({ taskId: "parent" })).historyComplete).toBe(false);
    expect((await s.budgets.read({ goalId: "goal" })).historyComplete).toBe(false);
    expect(
      (await s.budgets.evaluate({ taskId: "parent" }, { maxAgentMinutes: 10 }, { starting: true }))
        .blocked,
    ).toBe(true);
    expect(
      (await new HostTaskBudgets(s.store, () => s.clock.now + 3600000).read({ taskId: "task" }))
        .agentMinutes,
    ).toBe(5000 / 60000);
  });
  it.each([true, false])(
    "marks terminal missing-block/duration history unknown without charging time until the next poll: removed=%s",
    async (removeBlock) => {
      const s = await setup();
      await s.save("session", "run", { metrics: reported });
      await s.register();
      s.clock.now += 4000;
      await s.budgets.read({ taskId: "task" });
      const current = await s.store.session("session");
      await s.store.save(
        {
          ...current,
          status: "idle",
          revision: current.revision + 1,
          session: { ...current.session, blocks: removeBlock ? [] : current.session.blocks },
        },
        {},
      );
      s.clock.now += 3600000;
      expect(await s.budgets.read({ taskId: "task" })).toMatchObject({
        historyComplete: false,
        agentMinutes: 4000 / 60000,
        tokens: null,
      });
    },
  );
  it("records only provider-reported cost deltas and keeps estimates separate", async () => {
    const s = await setup();
    await s.save("session", "run", { cost: 1 });
    await s.register();
    await s.finish("session", { metrics: reported, cost: 3 });
    expect(await s.budgets.read({ taskId: "task" })).toMatchObject({
      reportedCostUsd: 3,
      estimatedCostUsd: null,
    });
    const previous = await s.store.session("session");
    await s.save("session", "follow-up", { previous, cost: 3.5 });
    await s.register("session", "follow-up", { role: "reviewer" });
    await s.finish("session", { metrics: reported, cost: 4 });
    expect((await s.budgets.read({ taskId: "task" })).reportedCostUsd).toBe(4);
  });
  it("retains run totals through an actual database close and reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-budget-test-"));
    directories.push(directory);
    const path = join(directory, "host.db");
    const first = new HostStore(path);
    const budgets = new HostTaskBudgets(first, () => 5000);
    await budgets.register({
      taskId: "task",
      role: "worker",
      sessionId: "missing",
      runId: "one",
      startedAt: 1000,
    });
    expect(await budgets.read({ taskId: "task" })).toMatchObject({
      attempts: 1,
      historyComplete: false,
      agentMinutes: 0,
      tokens: null,
    });
    await first.close();
    const second = new HostStore(path);
    await stores.push(second);
    expect(await new HostTaskBudgets(second, () => 100000).read({ taskId: "task" })).toMatchObject({
      attempts: 1,
      historyComplete: false,
      agentMinutes: 0,
      tokens: null,
    });
  });
  it("rejects owner identity changes and invalid scopes without reassigning a run", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.register();
    await expect(
      (async () => await s.register("session", "run", { taskId: "another" }))(),
    ).rejects.toThrow("different task");
    await expect(
      (async () => await s.budgets.read({ taskId: "task", goalId: "goal" } as never))(),
    ).rejects.toThrow("scope");
    await expect(
      (async () =>
        await s.budgets.register({ sessionId: "s", runId: "r", startedAt: 1, role: "worker" }))(),
    ).rejects.toThrow("identity");
  });
  it("rolls crew members into the parent while retaining each child's own totals", async () => {
    const s = await setup();
    await s.save("lead", "lead-run");
    await s.register("lead", "lead-run", { taskId: "parent", role: "worker" });
    await s.save("member", "member-run");
    await s.register("member", "member-run", {
      taskId: "child",
      parentTaskId: "parent",
      role: "reviewer",
    });
    await s.register("member", "member-run", {
      taskId: "child",
      parentTaskId: "parent",
      role: "reviewer",
    });
    s.clock.now += 60000;
    expect(await s.budgets.read({ taskId: "parent" })).toMatchObject({
      attempts: 2,
      agentMinutes: 2,
    });
    expect(await s.budgets.read({ taskId: "child" })).toMatchObject({
      attempts: 1,
      agentMinutes: 1,
    });
    expect((await s.budgets.read({ goalId: "goal" })).attempts).toBe(2);
    await expect(
      (async () =>
        await s.register("member", "member-run", {
          taskId: "child",
          parentTaskId: "other",
          role: "reviewer",
        }))(),
    ).rejects.toThrow("different task");
  });
  it("can enrich host-resolved parent lineage once without duplicating old runs", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.register("session", "run", { goalId: undefined });
    await s.register("session", "run", { goalId: "goal", parentTaskId: "parent" });
    expect((await s.budgets.read({ taskId: "parent" })).attempts).toBe(1);
    expect((await s.budgets.read({ goalId: "goal" })).attempts).toBe(1);
  });
  it("persists unknown historical coverage and never calls an empty legacy ledger zero total usage", async () => {
    const s = await setup();
    expect((await s.budgets.read({ taskId: "fresh" })).historyComplete).toBe(true);
    await s.budgets.markUnknownHistory({ taskId: "legacy" });
    await s.budgets.markUnknownHistory({ goalId: "goal" });
    const restarted = new HostTaskBudgets(s.store, () => s.clock.now);
    expect(await restarted.read({ taskId: "legacy" })).toMatchObject({
      historyComplete: false,
      tokens: null,
      tokensComplete: false,
      reportedCostUsd: null,
    });
    expect(
      await restarted.evaluate({ taskId: "legacy" }, { maxAgentMinutes: 10 }, { starting: true }),
    ).toMatchObject({ blocked: true, warning: true });
    expect(
      (await restarted.evaluate({ taskId: "legacy" }, undefined, { starting: true })).blocked,
    ).toBe(false);
    await s.save("session", "run");
    await s.register("session", "run", { taskId: "legacy" });
    await s.finish("session", { metrics: reported, durationMs: 1000, cost: 1 });
    expect(await restarted.read({ taskId: "legacy" })).toMatchObject({
      historyComplete: false,
      reportedTokens: 125,
      tokens: null,
      agentMinutes: 1000 / 60000,
    });
    expect((await restarted.read({ goalId: "goal" })).historyComplete).toBe(false);
  });
});
