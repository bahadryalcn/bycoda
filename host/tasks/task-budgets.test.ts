import { forEachAsync } from "../async-collections";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostEngine } from "../engine";
import { HostStore } from "../store";
import { HostTasks } from "./service";
import {
  BUDGET_RUN_SEAL_AFTER_MS,
  HostTaskBudgets,
  type BudgetRunRegistration,
} from "./task-budgets";
import { readWorkUsage } from "../work/usage";
import { usageUpperBoundMinutes } from "../../src/features/tasks/model/taskBudget";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { HostSession } from "../../src/features/connections/model/protocol";
import type { TurnMetrics } from "../../src/features/sessions/model/session";
import { admitRunDuration, finishRunDuration } from "../execution/run-duration";
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
  const budgets = new HostTaskBudgets(
    store,
    () => clock.now,
    () => clock.now,
  );
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
  it("reclaims a finished reviewer run's budget cache entry and retains its ledger row", async () => {
    const { store, project, clock, save } = await setup();
    const tasks = new HostTasks(store, new HostEngine(store, {}), () => clock.now);
    const task = await tasks.save({
      id: "task",
      projectId: project.id,
      title: "Review",
      prompt: "Review the change",
      harness: "codex",
      model: "test",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      review: true,
      budget: { maxAgentMinutes: 60 },
    });
    const sessionId = "reviewer";
    const runId = "review-run";
    await save(sessionId, runId);
    const reviewer = { sessionId, runId, startedAt: clock.now };
    const verifying = await tasks["write"]({ ...task, status: "verifying", reviewer });
    const cache = tasks["registeredBudgetRuns"];
    const ledger = store.db.prepare(
      `SELECT json_extract(value,'$.taskId') AS taskId, json_extract(value,'$.role') AS role
       FROM task_run_budget_ledger WHERE session_id=? AND run_id=?`,
    );
    const registered = { taskId: task.id, role: "reviewer" };
    expect(cache.get(task.id)).toBe(JSON.stringify([sessionId, runId]));
    expect(await ledger.get(sessionId, runId)).toEqual(registered);
    await tasks["write"]({ ...verifying, status: "done", reviewer: undefined });
    expect(cache.has(task.id)).toBe(false);
    expect(await ledger.get(sessionId, runId)).toEqual(registered);
  });

  it("admits another limited run after a confirmed owned completion", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.store.transaction(() =>
      admitRunDuration(s.store, "session", "run", s.clock.now, s.clock.now),
    );
    await s.register();
    s.clock.now += 30_000;
    await finishRunDuration(s.store, "session", "run", s.clock.now, s.clock.now);
    await s.finish("session", { durationMs: 3_600_000, metrics: reported });
    const result = await s.budgets.evaluate(
      { taskId: "task" },
      { maxAgentMinutes: 2 },
      { starting: true },
    );
    expect(result).toMatchObject({
      blocked: false,
      usage: { agentMinutes: 0.5, historyComplete: true, tokens: 89 },
    });
  });
  it("reconciles a trusted completion checkpoint arriving after the first terminal read", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.store.transaction(() =>
      admitRunDuration(s.store, "session", "run", s.clock.now, s.clock.now),
    );
    await s.register();
    s.clock.now += 30_000;
    await s.finish("session", { durationMs: 3_600_000, metrics: reported });
    // The unverified interval is bounded by the 30 second wall-clock span: well under 2 minutes.
    expect(
      await s.budgets.evaluate({ taskId: "task" }, { maxAgentMinutes: 2 }, { starting: true }),
    ).toMatchObject({ blocked: false, usage: { historyComplete: false, agentMinutes: 0 } });
    expect(
      (await s.budgets.evaluate({ taskId: "task" }, { maxAgentMinutes: 0.4 }, { starting: true }))
        .blocked,
    ).toBe(true);
    await finishRunDuration(s.store, "session", "run", s.clock.now, s.clock.now);
    expect(
      await s.budgets.evaluate({ taskId: "task" }, { maxAgentMinutes: 2 }, { starting: true }),
    ).toMatchObject({ blocked: false, usage: { agentMinutes: 0.5, historyComplete: true } });
  });
  it("excludes an unobserved gap, keeps confirmed time and marks history incomplete", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.register();
    s.clock.now += 30_000;
    expect((await s.budgets.read({ taskId: "task" })).agentMinutes).toBe(0.5);
    s.clock.now += 3_600_000;
    expect(await s.budgets.read({ taskId: "task" })).toMatchObject({
      agentMinutes: 0.5,
      historyComplete: false,
    });
    s.clock.now += 30_000;
    expect(await s.budgets.read({ taskId: "task" })).toMatchObject({
      agentMinutes: 1,
      historyComplete: false,
    });
  });
  it("bounds an unobserved gap by wall-clock time and asks the owner only when the bound reaches the total", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.register();
    s.clock.now += 30_000;
    await s.budgets.read({ taskId: "task" });
    s.clock.now += 3_600_000;
    const usage = await s.budgets.read({ taskId: "task" });
    expect(usage).toMatchObject({ agentMinutes: 0.5, uncertainty: { unboundedRuns: 0 } });
    expect(usageUpperBoundMinutes(usage)).toBeCloseTo(60.5, 5);
    const roomy = await s.budgets.evaluate(
      { taskId: "task" },
      { maxAgentMinutes: 600 },
      { starting: true },
    );
    expect(roomy).toMatchObject({ blocked: false, warning: true });
    const tight = await s.budgets.evaluate(
      { taskId: "task" },
      { maxAgentMinutes: 30 },
      { starting: true },
    );
    expect(tight.blocked).toBe(true);
    expect(tight.reasons.join(" ")).toContain("limit 30 min");
    expect(
      await s.budgets.evaluate(
        { taskId: "task" },
        { maxAgentMinutes: 30 },
        { starting: true, accepted: { ...usage.uncertainty!, at: s.clock.now } },
      ),
    ).toMatchObject({ blocked: false });
  });
  it("preserves legacy wall-derived time without treating it as a proven active-time breach", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.register();
    await s.store.db
      .prepare(
        "UPDATE task_run_budget_ledger SET value=json_set(json_remove(value, '$.confirmedElapsedMs'), '$.elapsedMs', 3600000) WHERE session_id='session' AND run_id='run'",
      )
      .run();
    const result = await s.budgets.evaluate({ taskId: "task" }, { maxAgentMinutes: 1 });
    expect(result.usage).toMatchObject({ historyComplete: false, agentMinutes: 0 });
    expect(result.blocked).toBe(false);
    expect(
      (await s.budgets.evaluate({ taskId: "task" }, { maxAgentMinutes: 1 }, { starting: true }))
        .blocked,
    ).toBe(true);
    const row = await s.store.db
      .prepare(
        "SELECT value FROM task_run_budget_ledger WHERE session_id='session' AND run_id='run'",
      )
      .get();
    expect(JSON.parse(String(row?.value))).toMatchObject({ legacyElapsedMs: 3600000 });
  });
  it("does not treat a settled legacy transcript duration as confirmed budget use", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.register();
    await s.store.db
      .prepare(
        "UPDATE task_run_budget_ledger SET value=json_set(json_remove(value, '$.confirmedElapsedMs'), '$.elapsedMs', 3600000) WHERE session_id='session' AND run_id='run'",
      )
      .run();
    await s.finish("session", { durationMs: 3_600_000, metrics: reported, cost: 2 });
    const result = await s.budgets.evaluate({ taskId: "task" }, { maxAgentMinutes: 1 });
    expect(result).toMatchObject({
      blocked: false,
      usage: { agentMinutes: 0, historyComplete: false, tokens: 89, reportedCostUsd: 2 },
    });
    expect(
      (await s.budgets.evaluate({ taskId: "task" }, { maxAgentMinutes: 1 }, { starting: true }))
        .blocked,
    ).toBe(true);
  });
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
      agentMinutes: 0.5,
      attempts: 1,
      completedRuns: 1,
      runningRuns: 0,
      tokens: 89,
    });
    s.clock.now += 60000;
    expect((await s.budgets.read({ goalId: "goal" })).agentMinutes).toBe(0.5);
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
    expect((await s.budgets.read({ taskId: "task" })).tokens).toBe(89);
    await s.save("session", "follow-up", { previous: ended });
    await s.register("session", "follow-up", { role: "reviewer" });
    s.clock.now += 10000;
    await s.finish("session", { durationMs: 10000, metrics: { inputTokens: 5, outputTokens: 5 } });
    const restarted = new HostTaskBudgets(s.store, () => s.clock.now);
    expect(await restarted.read({ taskId: "task" })).toMatchObject({
      attempts: 2,
      agentMinutes: 0,
      tokens: 99,
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
    expect((await s.budgets.read({ taskId: "task" })).tokens).toBe(218);
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
    expect((await s.budgets.evaluate({ goalId: "goal" }, { maxTokens: 80 })).blocked).toBe(true);
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
      historyComplete: false,
      agentMinutes: 0,
      tokens: 89,
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
      reportedTokens: 89,
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
        tokens: 89,
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
  it("does not reload settled run transcripts until their session changes", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.store.transaction(() =>
      admitRunDuration(s.store, "session", "run", s.clock.now, s.clock.now),
    );
    await s.register();
    s.clock.now += 30_000;
    await finishRunDuration(s.store, "session", "run", s.clock.now, s.clock.now);
    await s.finish("session", { durationMs: 30_000, metrics: reported, cost: 1 });
    const settled = await s.budgets.read({ taskId: "task" });
    expect(settled).toMatchObject({ runningRuns: 0, tokens: 89, reportedCostUsd: 1 });
    const transcripts = vi.spyOn(s.store, "session");
    expect(await s.budgets.read({ taskId: "task" })).toMatchObject({
      agentMinutes: settled.agentMinutes,
      tokens: 89,
      reportedCostUsd: 1,
    });
    expect(transcripts).not.toHaveBeenCalled();
    const current = await s.store.session("session");
    await s.store.save(
      {
        ...current,
        revision: current.revision + 1,
        session: {
          ...current.session,
          usage: { costUsd: 3, apiMs: 0, lastProcessCostUsd: 3, lastProcessApiMs: 0 },
        },
      },
      {},
    );
    transcripts.mockClear();
    expect((await s.budgets.read({ taskId: "task" })).reportedCostUsd).toBe(3);
    expect(transcripts).toHaveBeenCalledTimes(1);
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
      reportedTokens: 89,
      tokens: null,
      agentMinutes: 0,
    });
    expect((await restarted.read({ goalId: "goal" })).historyComplete).toBe(false);
  });
});

describe("bounded ledger lookups with sealed runs", () => {
  const sealedAt = async (s: Awaited<ReturnType<typeof setup>>, runId = "run") =>
    (
      await s.store.db
        .prepare("SELECT sealed_settled_at FROM task_run_budget_ledger WHERE run_id=?")
        .get(runId)
    )?.sealed_settled_at;
  async function settledRun(
    s: Awaited<ReturnType<typeof setup>>,
    sessionId = "session",
    runId = "run",
    patch: Partial<BudgetRunRegistration> = {},
  ) {
    await s.save(sessionId, runId);
    await s.store.transaction(() =>
      admitRunDuration(s.store, sessionId, runId, s.clock.now, s.clock.now),
    );
    await s.register(sessionId, runId, patch);
    s.clock.now += 30_000;
    await finishRunDuration(s.store, sessionId, runId, s.clock.now, s.clock.now);
    await s.finish(sessionId, { durationMs: 30_000, metrics: reported, cost: 2 });
    // Observe the settlement now, so its age counts from here.
    await s.budgets.sync();
  }
  /** A later sent turn: provider usage now merges into it and the session's run is another one. */
  async function supersede(s: Awaited<ReturnType<typeof setup>>, sessionId = "session") {
    await s.save(sessionId, "next-run", {
      previous: await s.store.session(sessionId),
      status: "idle",
    });
    await s.budgets.sync();
  }
  const stable = <T extends { measuredAt: number }>(usage: T) => ({ ...usage, measuredAt: 0 });
  const late = { inputTokens: 200, outputTokens: 50 };

  it("keeps charging provider usage that arrives long after settlement while the run can still receive it", async () => {
    const s = await setup();
    await settledRun(s, "session", "run", { parentTaskId: "parent" });
    s.clock.now += 30 * BUDGET_RUN_SEAL_AFTER_MS;
    await s.budgets.sync();
    await s.budgets.sync();
    // Age alone never seals: this is still the session's latest turn and current run.
    expect(await sealedAt(s)).toBeNull();
    await s.finish("session", { durationMs: 30_000, metrics: late, cost: 5 });
    await s.budgets.syncGoalUsage();
    for (const scope of [{ taskId: "task" }, { taskId: "parent" }, { goalId: "goal" }])
      expect(await s.budgets.read(scope)).toMatchObject({
        attempts: 1,
        reportedTokens: 250,
        reportedCostUsd: 5,
      });
    expect((await s.budgets.readGoalUsage(["goal"])).get("goal")).toMatchObject({
      attempts: 1,
      reportedTokens: 250,
      reportedCostUsd: 5,
    });
    expect(await sealedAt(s)).toBeNull();
  });

  it("seals only once a later turn proves the run cannot receive usage, with the late usage included", async () => {
    const s = await setup();
    await settledRun(s, "session", "run", { parentTaskId: "parent" });
    s.clock.now += 24 * 60 * 60 * 1000;
    await s.finish("session", { durationMs: 30_000, metrics: late, cost: 5 });
    await s.budgets.sync();
    expect(await sealedAt(s)).toBeNull();
    await supersede(s);
    // Superseded, but not yet old enough: the grace window still applies.
    expect(await sealedAt(s)).toBeNull();
    s.clock.now += BUDGET_RUN_SEAL_AFTER_MS;
    await s.budgets.syncGoalUsage();
    expect(await sealedAt(s)).not.toBeNull();
    // The next turn's usage is that turn's, never added to the sealed receipt.
    await s.finish("session", { durationMs: 1000, metrics: reported, cost: 9 });
    await s.budgets.sync();
    for (const scope of [{ taskId: "task" }, { taskId: "parent" }, { goalId: "goal" }])
      expect(await s.budgets.read(scope)).toMatchObject({
        attempts: 1,
        reportedTokens: 250,
        reportedCostUsd: 5,
      });
  });

  it("does not treat a draft as a later turn", async () => {
    const s = await setup();
    await settledRun(s);
    const previous = await s.store.session("session");
    await s.store.save(
      {
        ...previous,
        runId: "next-run",
        revision: previous.revision + 1,
        session: {
          ...previous.session,
          blocks: [
            ...previous.session.blocks,
            { id: "draft", role: "user", text: "unsent", draft: true },
          ],
        },
      },
      {},
    );
    await s.budgets.sync();
    s.clock.now += BUDGET_RUN_SEAL_AFTER_MS;
    await s.budgets.sync();
    expect(await sealedAt(s)).toBeNull();
  });

  it("seals a settled run once and keeps every scope total, even after its transcript is gone", async () => {
    const s = await setup();
    await settledRun(s, "session", "run", { parentTaskId: "parent" });
    await supersede(s);
    const before = {
      task: stable(await s.budgets.read({ taskId: "task" })),
      parent: stable(await s.budgets.read({ taskId: "parent" })),
      goal: stable(await s.budgets.read({ goalId: "goal" })),
    };
    expect(before.task).toMatchObject({ attempts: 1, agentMinutes: 0.5, tokens: 89 });
    expect(await sealedAt(s)).toBeNull();
    s.clock.now += BUDGET_RUN_SEAL_AFTER_MS;
    await s.budgets.sync();
    await s.budgets.sync();
    expect(await sealedAt(s)).not.toBeNull();
    const transcripts = vi.spyOn(s.store, "session");
    const after = {
      task: stable(await s.budgets.read({ taskId: "task" })),
      parent: stable(await s.budgets.read({ taskId: "parent" })),
      goal: stable(await s.budgets.read({ goalId: "goal" })),
    };
    expect(after).toEqual(before);
    expect(transcripts).not.toHaveBeenCalled();
    await s.store.deleteSession("session");
    s.clock.now += 1000;
    expect(stable(await s.budgets.read({ goalId: "goal" }))).toEqual(before.goal);
    expect((await s.budgets.evaluate({ taskId: "task" }, { maxAgentMinutes: 0.5 })).blocked).toBe(
      true,
    );
  });

  it("never seals an active debit or a run still awaiting its finish checkpoint", async () => {
    const s = await setup();
    await s.save("session", "run");
    await s.register();
    s.clock.now += 30_000;
    await s.save("late", "late-run");
    await s.store.transaction(() =>
      admitRunDuration(s.store, "late", "late-run", s.clock.now, s.clock.now),
    );
    await s.register("late", "late-run");
    await s.finish("late", { durationMs: 1000, metrics: reported });
    await s.budgets.sync();
    s.clock.now += BUDGET_RUN_SEAL_AFTER_MS;
    await s.budgets.sync();
    expect(await sealedAt(s, "run")).toBeNull();
    expect(await sealedAt(s, "late-run")).toBeNull();
    expect(await s.budgets.read({ taskId: "task" })).toMatchObject({
      attempts: 2,
      runningRuns: 1,
    });
    // The missing checkpoint can still arrive and is then accounted exactly once.
    await finishRunDuration(s.store, "late", "late-run", s.clock.now, s.clock.now);
    await s.budgets.sync();
    expect(await s.budgets.read({ taskId: "task" })).toMatchObject({ attempts: 2 });
  });

  it("counts a sealed run once across repeated registration, enrichment and reads", async () => {
    const s = await setup();
    await settledRun(s, "session", "run", { goalId: undefined });
    await supersede(s);
    s.clock.now += BUDGET_RUN_SEAL_AFTER_MS;
    await s.budgets.sync();
    expect(await sealedAt(s)).not.toBeNull();
    await s.register("session", "run", { goalId: undefined });
    await s.register("session", "run", { goalId: "goal", parentTaskId: "parent" });
    await s.register("session", "run", { goalId: "goal", parentTaskId: "parent" });
    await s.budgets.sync();
    for (const scope of [{ taskId: "task" }, { taskId: "parent" }, { goalId: "goal" }])
      expect(await s.budgets.read(scope)).toMatchObject({
        attempts: 1,
        agentMinutes: 0.5,
        reportedTokens: 89,
        reportedCostUsd: 2,
      });
  });

  it("combines sealed and open runs in goal lists, once per distinct goal", async () => {
    const s = await setup();
    await settledRun(s);
    await supersede(s);
    s.clock.now += BUDGET_RUN_SEAL_AFTER_MS;
    await s.budgets.sync();
    await s.save("open", "open-run");
    await s.register("open", "open-run", { role: "reviewer" });
    await s.budgets.markUnknownHistory({ goalId: "legacy" });
    await s.budgets.sync();
    const usage = await s.budgets.readGoalUsage(["goal", "fresh", "legacy", "goal"]);
    expect(stable(usage.get("goal")!)).toEqual(stable(await s.budgets.read({ goalId: "goal" })));
    expect(usage.get("goal")).toMatchObject({ attempts: 2, runningRuns: 1, completedRuns: 1 });
    expect(usage.get("fresh")).toMatchObject({ attempts: 0, historyComplete: true });
    expect(usage.get("legacy")).toMatchObject({ attempts: 0, historyComplete: false });
    await s.budgets.syncGoalUsage();
    expect(stable((await s.budgets.readGoalUsage(["goal"])).get("goal")!)).toEqual(
      stable(usage.get("goal")!),
    );
  });

  it("keeps sealed history in the budget decision and reads only recent runs for Work windows", async () => {
    const s = await setup();
    await settledRun(s);
    await supersede(s);
    s.clock.now += 60 * 24 * 60 * 60 * 1000;
    await s.budgets.sync();
    expect(await sealedAt(s)).not.toBeNull();
    expect(
      (await s.budgets.evaluate({ goalId: "goal" }, { maxAttempts: 1 }, { starting: true }))
        .blocked,
    ).toBe(true);
    const reading = await readWorkUsage(s.store, s.budgets, {
      now: s.clock.now,
      coverageSince: 0,
    });
    // The run settled two months earlier, outside every calendar window.
    expect(reading.monthly.tokens).toMatchObject({ reported: 0, complete: true });
    await s.save("recent", "recent-run");
    await s.register("recent", "recent-run", { startedAt: s.clock.now });
    await s.finish("recent", { durationMs: 1000, metrics: reported });
    expect(
      (await readWorkUsage(s.store, s.budgets, { now: s.clock.now, coverageSince: 0 })).monthly
        .tokens.reported,
    ).toBe(89);
  });
});
