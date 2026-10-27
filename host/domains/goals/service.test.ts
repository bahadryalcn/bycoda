import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { HostEngine } from "../../engine";
import { HostGoals } from "../../goals";
import { HostStore } from "../../store";
import { HostTasks } from "../../tasks";
import * as dto from "../../../src/shared/model/host-contracts/goals";
import { createHostGoalsService } from "./service";

// Isolated SQLite + real HostGoals/HostTasks; provider is an inert fixture.
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function fixture() {
  const folder = resolve(await mkdtemp(join(tmpdir(), "bycoda-goals-domain-")));
  if (dirname(folder) !== resolve(tmpdir()) || !basename(folder).startsWith("bycoda-goals-domain-"))
    throw new Error("Unexpected fixture directory");
  cleanups.push(() => rm(folder, { recursive: true, force: true }));
  const store = new HostStore(join(folder, "host.db"));
  cleanups.push(() => store.close());
  const provider = {
    send: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { claude: provider });
  cleanups.push(() => engine.close());
  const tasks = new HostTasks(store, engine);
  cleanups.push(() => tasks.close());
  const goals = new HostGoals(store, engine, tasks);
  await goals.ready;
  const project = await store.addProject(folder, "Goal fixture");
  const reached = vi.spyOn(tasks.limits, "reached").mockResolvedValue(true);
  // These tests explicitly exercise public owner calls, not a background timer.
  const tick = vi.spyOn(tasks, "tick").mockResolvedValue();
  const context = { authorized: vi.fn(async () => true) };
  const service = createHostGoalsService({ goals });
  const input = {
    id: "goal",
    title: "İstanbul 日本語 🧭",
    prompt: "  Keep the complete objective.\n第二行  ",
    projectIds: [project.id],
    leadProjectId: project.id,
    harness: "claude" as const,
    model: "claude:fixture",
    modelSettings: { custom: "長い値" },
    runtimeMode: "auto" as const,
    maxRunMinutes: 0,
    isolate: false,
    verifyDefaults: { review: false },
    approvePlan: true,
  };
  async function seed(overrides: Partial<dto.HostGoal> = {}) {
    const goal = { ...(await goals.create(input)), ...overrides };
    await store.db
      .prepare("UPDATE goals SET value=? WHERE id=?")
      .run(JSON.stringify(goal), goal.id);
    return goal;
  }
  async function stored() {
    const row = await store.db.prepare("SELECT value FROM goals WHERE id=?").get(input.id);
    return row ? (JSON.parse(String(row.value)) as dto.HostGoal) : undefined;
  }
  return {
    store,
    engine,
    tasks,
    goals,
    service,
    context,
    provider,
    input,
    project,
    reached,
    tick,
    seed,
    stored,
  };
}

describe("paired goal domain", () => {
  it("preserves owner Unicode/defaults, approval, budgets and quarantined delivery", async () => {
    const f = await fixture();
    const created = await f.service.create(
      { goal: { ...f.input, isolate: true, autoMerge: true, budget: { maxAttempts: 3 } } },
      f.context,
    );
    expect(created).toMatchObject({
      title: f.input.title,
      prompt: f.input.prompt,
      modelSettings: f.input.modelSettings,
      approvePlan: true,
      deliveryApprovalRequired: true,
      budget: { maxAttempts: 3, warningPercent: 80 },
      taskIds: [],
      status: "planning",
    });
    expect(created.autoMerge).toBeUndefined();
    expect(dto.HostGoalSchema.safeParse(created).success).toBe(true);
    const listed = await f.service.list({}, f.context);
    expect(dto.GoalsListResultSchema.safeParse(listed).success).toBe(true);
    expect(listed[0].budgetUsage).toMatchObject({ attempts: 0, historyComplete: true });
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  it("keeps the budget ledger as the sole launch admission owner", async () => {
    const f = await fixture();
    await f.tasks.budgets.register({
      goalId: "goal",
      role: "planner",
      sessionId: "retained-session",
      runId: "retained-run",
      startedAt: 1,
    });
    f.reached.mockResolvedValue(false);
    const command = vi.spyOn(f.engine, "command");
    const result = await f.service.create(
      { goal: { ...f.input, budget: { maxAttempts: 1 } } },
      f.context,
    );
    expect(result).toMatchObject({ status: "blocked", budgetUsage: { attempts: 1 } });
    expect(result.budgetStop).toContain("budget is exhausted");
    expect(command).not.toHaveBeenCalled();
    expect(f.provider.send).not.toHaveBeenCalled();
    expect((await f.stored())?.budget).toEqual({ maxAttempts: 1, warningPercent: 80 });
  });

  it("preserves approval gates and child ownership with the real transaction", async () => {
    const f = await fixture();
    const current = await f.seed({
      status: "awaiting-approval",
      deliveryApprovalRequired: true,
      budget: { maxAttempts: 5 },
      plan: {
        tasks: [
          {
            key: "first",
            project: f.project.cwd,
            projectId: f.project.id,
            title: "First",
            prompt: "Retain instructions",
            dependsOn: [],
          },
        ],
      },
    });
    const result = await f.service.approve({ goalId: current.id }, f.context);
    expect(result.status).toBe("running");
    expect(result.taskIds).toHaveLength(1);
    const child = await f.tasks.get(result.taskIds[0]);
    expect(child).toMatchObject({
      goalId: current.id,
      projectId: f.project.id,
      prompt: "Retain instructions",
    });
    expect(child?.autoMerge).not.toBe(true);
    expect(result.deliveryApprovalRequired).toBe(true);
    await expect(f.service.approve({ goalId: current.id }, f.context)).rejects.toThrow(
      "waiting for approval",
    );
    expect(await f.tasks.list()).toHaveLength(1);
    expect((await f.stored())?.budget).toEqual({ maxAttempts: 5 });
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  it("rejects a revoked request queued behind actual SQLite work without writing", async () => {
    const f = await fixture();
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const queued = Promise.withResolvers<void>();
    const blocker = f.store.db.scope(async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const create = f.goals.create.bind(f.goals);
    vi.spyOn(f.goals, "create").mockImplementation((raw) => {
      queued.resolve();
      return create(raw);
    });
    const pending = f.service.create({ goal: f.input }, f.context);
    const rejection = expect(pending).rejects.toThrow("revoked");
    await queued.promise;
    f.context.authorized.mockResolvedValue(false);
    release.resolve();
    await blocker;
    await rejection;
    expect(await f.stored()).toBeUndefined();
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  it("rechecks after preparation before the first engine launch", async () => {
    const f = await fixture();
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    f.reached.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return false;
    });
    const command = vi.spyOn(f.engine, "command");
    const pending = f.service.create({ goal: f.input }, f.context);
    const rejection = expect(pending).rejects.toThrow("revoked");
    await entered.promise;
    f.context.authorized.mockResolvedValue(false);
    release.resolve();
    await rejection;
    expect(command).not.toHaveBeenCalled();
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(await f.stored()).toBeUndefined();
  });

  it("finishes accepted storage when only the socket waiter is cancelled", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    f.reached.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return true;
    });
    const pending = f.service.create(
      { goal: f.input },
      { ...f.context, signal: controller.signal },
    );
    await entered.promise;
    controller.abort();
    release.resolve();
    expect((await pending).id).toBe("goal");
    expect((await f.stored())?.prompt).toBe(f.input.prompt);
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  it("does not attach a creator grant to later system-owned maintenance", async () => {
    const f = await fixture();
    await f.service.create({ goal: f.input }, f.context);
    f.context.authorized.mockResolvedValue(false);
    // No grant context survives this completed request. Persisted goal remains.
    const listed = await f.goals.list();
    expect(listed[0].id).toBe("goal");
    f.tick.mockRestore();
    await f.tasks.tick();
    expect((await f.stored())?.id).toBe("goal");
    await expect(f.service.list({}, f.context)).rejects.toThrow("revoked");
  });

  it("rechecks a revoked grant after the planner lookup before Stop", async () => {
    const f = await fixture();
    const receipt = await f.engine.command({
      type: "create",
      commandId: "planner-create",
      projectId: f.project.id,
      harness: "claude",
      model: "claude:fixture",
      runtimeMode: "auto",
      workspaceMode: "current",
    });
    const value = await f.store.session(receipt.sessionId);
    await f.store.save(
      { ...value, status: "running", runId: "owned-run", revision: value.revision + 1 },
      { kind: "fixture" },
    );
    await f.seed({
      plannerSessionId: receipt.sessionId,
      plannerRunId: "owned-run",
      plannerStartedAt: 1,
    });
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const session = f.store.session.bind(f.store);
    vi.spyOn(f.store, "session").mockImplementation(async (id) => {
      const result = await session(id);
      if (id === receipt.sessionId) {
        entered.resolve();
        await release.promise;
      }
      return result;
    });
    const command = vi.spyOn(f.engine, "command");
    const pending = f.service.cancel({ goalId: "goal" }, f.context);
    const rejection = expect(pending).rejects.toThrow("revoked");
    await entered.promise;
    f.context.authorized.mockResolvedValue(false);
    release.resolve();
    await rejection;
    expect(command).not.toHaveBeenCalled();
    expect(f.provider.cancel).not.toHaveBeenCalled();
    // The authorized cancellation marker committed before the lost grant;
    // remaining external effects are denied rather than replayed or rolled back.
    expect((await f.stored())?.status).toBe("cancelled");
  });

  it("rechecks inside an already admitted list scope before progress writes", async () => {
    const f = await fixture();
    await f.seed({ status: "running", taskIds: ["missing-child"] });
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const taskIndex = f.tasks.taskIndex.bind(f.tasks);
    vi.spyOn(f.tasks, "taskIndex").mockImplementation(async (ids) => {
      const result = await taskIndex(ids);
      entered.resolve();
      await release.promise;
      return result;
    });
    const pending = f.service.list({}, f.context);
    const rejection = expect(pending).rejects.toThrow("revoked");
    await entered.promise;
    f.context.authorized.mockResolvedValue(false);
    release.resolve();
    await rejection;
    expect((await f.stored())?.status).toBe("running");
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  it("reconciles list progress without launching a reviewer and enforces final-review CAS", async () => {
    const f = await fixture();
    const child = await f.tasks.save({
      id: "child",
      title: "Child",
      prompt: "Child work",
      projectId: f.project.id,
      harness: "claude",
      model: "claude:fixture",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      isolate: false,
      review: false,
      goalId: "goal",
      status: "todo",
    });
    // Retained completed child fixture; no provider is launched by this test.
    await f.store.db
      .prepare("UPDATE tasks SET value=? WHERE id=?")
      .run(JSON.stringify({ ...child, status: "done" }), child.id);
    const old = await f.seed({ status: "running", finalReview: true, taskIds: [child.id] });
    const listed = await f.service.list({}, f.context);
    expect(listed[0].finalAcceptance).toMatchObject({
      status: "pending",
      requestId: expect.any(String),
    });
    expect((await f.stored())?.finalAcceptance).toEqual(listed[0].finalAcceptance);
    await expect(
      f.service.recheckFinalReview(
        { goalId: "goal", expectedUpdatedAt: old.updatedAt - 1 },
        f.context,
      ),
    ).rejects.toThrow("changed");
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  it("strictly inventories params/results while legacy HTTP retains its parser behavior", async () => {
    const f = await fixture();
    await expect(
      f.service.create({ goal: { ...f.input, forgedOwner: "other" } }, f.context),
    ).rejects.toThrow();
    await expect(f.service.list({ extra: true }, f.context)).rejects.toThrow();
    const result = await f.service.create(
      { extra: true, goal: { ...f.input, forgedOwner: "other" } },
      f.context,
      { legacy: true },
    );
    expect(result).not.toHaveProperty("forgedOwner");
    expect(dto.HostGoalSchema.safeParse({ ...result, forgedOwner: true }).success).toBe(false);
    await expect(
      f.service.update(
        {
          goalId: "goal",
          expectedUpdatedAt: result.updatedAt,
          settings: {
            autoMerge: false,
            continueUntilDone: false,
            maxRunningTasks: 0,
            maxRunMinutes: 0,
            unexpected: true,
          },
        },
        f.context,
        { legacy: true },
      ),
    ).rejects.toThrow("Invalid goal settings");
    await f.store.db
      .prepare("UPDATE goals SET value=? WHERE id=?")
      .run(JSON.stringify({ ...result, status: "awaiting-approval" }), result.id);
    await expect(f.service.replan({ goalId: "goal", feedback: "a\0b" }, f.context)).rejects.toThrow(
      "feedback",
    );
  });

  it("keeps cancel/delete and no-op deletion on their existing owner paths", async () => {
    const f = await fixture();
    await f.seed({ status: "awaiting-approval" });
    expect((await f.service.cancel({ goalId: "goal" }, f.context)).status).toBe("cancelled");
    expect(await f.service.delete({ goalId: "goal", withTasks: false }, f.context)).toEqual({
      deleted: true,
    });
    expect(await f.stored()).toBeUndefined();
    expect(await f.service.delete({ goalId: "missing" }, f.context)).toEqual({ deleted: true });
  });
});
