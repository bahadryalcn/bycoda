import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { HostTaskBudgets, type BudgetRunRegistration } from "../tasks/task-budgets";
import { admitRunDuration, finishRunDuration, forgetRunSamples } from "../execution/run-duration";
import { readTaskRuntimeBudget, stopTaskRuntimeRuns } from "./runtime-budget";
import { usageUpperBoundMinutes } from "../../src/features/tasks/model/taskBudget";
import type { SessionRunEngine } from "../sessions/sessionRuns";

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});

async function setup() {
  const store = new HostStore(":memory:");
  stores.push(store);
  const project = await store.addProject("/runtime", "Runtime");
  const clock = { now: 1000 };
  const budgets = new HostTaskBudgets(
    store,
    () => clock.now,
    () => clock.now,
  );
  const start = async (
    sessionId: string,
    runId: string,
    role: BudgetRunRegistration["role"] = "worker",
  ) => {
    const previous = await store.session(sessionId).catch(() => undefined);
    await store.save(
      {
        projectId: project.id,
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: clock.now,
        status: "running",
        runId,
        session: {
          id: sessionId,
          cwd: "/runtime",
          title: "Task",
          harness: "codex",
          model: "test",
          modelSettings: {},
          runtimeMode: "auto",
          blocks: [{ id: `block-${runId}`, role: "user", text: "Work", startedAt: clock.now }],
        },
      },
      {},
    );
    await store.transaction(() => admitRunDuration(store, sessionId, runId, clock.now, clock.now));
    const receipt: BudgetRunRegistration = {
      taskId: "task",
      role,
      sessionId,
      runId,
      startedAt: clock.now,
      rootWorkId: "task:task",
    };
    await budgets.register(receipt);
    return receipt;
  };
  const finish = async (receipt: BudgetRunRegistration) => {
    await finishRunDuration(store, receipt.sessionId, receipt.runId, clock.now, clock.now);
    const session = await store.session(receipt.sessionId);
    await store.save(
      { ...session, status: "idle", revision: session.revision + 1, updatedAt: clock.now },
      {},
    );
  };
  return { store, clock, budgets, start, finish };
}

it("charges exact receipts once and sums worker, reviewer, repair and advisor", async () => {
  const s = await setup();
  const task = { id: "task", maxRunMinutes: 2 };
  for (const role of ["worker", "reviewer", "repair", "advisor"] as const) {
    const receipt = await s.start(role, role, role);
    await s.budgets.register(receipt);
    s.clock.now += 30_000;
    await s.finish(receipt);
  }
  expect(await readTaskRuntimeBudget(s.budgets, task)).toMatchObject({
    allowanceMinutes: 2,
    confirmedMinutes: 2,
    usedMinutes: 2,
    exceeded: true,
    blocked: true,
  });
  expect((await s.budgets.read({ taskId: task.id })).attempts).toBe(4);
  expect(await readTaskRuntimeBudget(s.budgets, task, true)).toMatchObject({
    exceeded: true,
    blocked: true,
  });
});

it("retains earlier turns when a worker resumes the same session", async () => {
  const s = await setup();
  const first = await s.start("session", "first");
  s.clock.now += 30_000;
  await s.finish(first);
  const resumed = await s.start("session", "resumed");
  s.clock.now += 30_000;
  await s.finish(resumed);
  expect(await readTaskRuntimeBudget(s.budgets, { id: "task", maxRunMinutes: 1 })).toMatchObject({
    confirmedMinutes: 1,
    exceeded: true,
    allowanceMinutes: 1,
  });
});

it("retains confirmed progress across a lost process sample without charging the gap", async () => {
  const s = await setup();
  const receipt = await s.start("session", "run");
  s.clock.now += 30_000;
  await s.budgets.read({ taskId: "task" });
  forgetRunSamples(s.store, receipt.sessionId, receipt.runId);
  s.clock.now += 3_600_000;
  const task = { id: "task", maxRunMinutes: 1 };
  expect(await readTaskRuntimeBudget(s.budgets, task)).toMatchObject({
    confirmedMinutes: 0.5,
    usedMinutes: null,
    historyComplete: false,
    blocked: false,
    exceeded: false,
  });
  expect(await readTaskRuntimeBudget(s.budgets, task, true)).toMatchObject({
    blocked: true,
    exceeded: false,
  });
});

it("keeps explicit zero unlimited even when historical intervals are unknown", async () => {
  const s = await setup();
  await s.budgets.markUnknownHistory({ taskId: "task" });
  expect(
    await readTaskRuntimeBudget(s.budgets, { id: "task", maxRunMinutes: 0 }, true),
  ).toMatchObject({
    allowanceMinutes: 0,
    usedMinutes: null,
    historyComplete: false,
    exceeded: false,
    blocked: false,
  });
});

it("stops exact advisor and worker receipts without cancelling a replacement turn", async () => {
  const s = await setup();
  await s.start("worker", "worker-run");
  await s.start("advisor", "advisor-run", "advisor");
  await s.start("replaced", "old-run");
  const replaced = await s.store.session("replaced");
  await s.store.save(
    { ...replaced, runId: "unrelated-owner-run", revision: replaced.revision + 1 },
    {},
  );
  const command = vi.fn().mockResolvedValue({});
  await stopTaskRuntimeRuns(s.store, { command } as unknown as SessionRunEngine, "task", {
    sessionId: "worker",
    runId: "worker-run",
  });
  expect(
    command.mock.calls
      .map(([input]) => ({ sessionId: input.sessionId, runId: input.runId }))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
  ).toEqual([
    { sessionId: "advisor", runId: "advisor-run" },
    { sessionId: "worker", runId: "worker-run" },
  ]);
  expect(command.mock.calls.every(([input]) => input.type === "cancel")).toBe(true);
});

const MINUTE = 60_000;
/** A run observed every minute, so every interval is verified. */
async function verifiedRun(s: Awaited<ReturnType<typeof setup>>, id: string, minutes: number) {
  const receipt = await s.start(id, id);
  for (let minute = 0; minute < minutes; minute++) {
    s.clock.now += MINUTE;
    await s.budgets.read({ taskId: "task" });
  }
  await s.finish(receipt);
}

const uncertainCases = {
  "the Host restarted during a run": async (s: Awaited<ReturnType<typeof setup>>) => {
    const receipt = await s.start("restarted", "restarted");
    s.clock.now += MINUTE;
    await s.budgets.read({ taskId: "task" });
    forgetRunSamples(s.store, receipt.sessionId, receipt.runId);
    s.clock.now += 5 * MINUTE;
    await s.finish(receipt);
  },
  "two samples are 91 seconds apart": async (s: Awaited<ReturnType<typeof setup>>) => {
    const receipt = await s.start("gap", "gap");
    s.clock.now += 91_000;
    await s.budgets.read({ taskId: "task" });
    await s.finish(receipt);
  },
  "the run settled without a close record": async (s: Awaited<ReturnType<typeof setup>>) => {
    const receipt = await s.start("unclosed", "unclosed");
    s.clock.now += 5 * MINUTE;
    const session = await s.store.session(receipt.sessionId);
    await s.store.save(
      { ...session, status: "idle", revision: session.revision + 1, updatedAt: s.clock.now },
      {},
    );
  },
};

for (const [name, uncertainRun] of Object.entries(uncertainCases))
  it(`still starts a 600 minute task after ${name}`, async () => {
    const s = await setup();
    await verifiedRun(s, "verified", 60);
    await uncertainRun(s);
    const task = { id: "task", maxRunMinutes: 600 };
    const budget = await readTaskRuntimeBudget(s.budgets, task, true);
    expect(budget).toMatchObject({ historyComplete: false, blocked: false, exceeded: false });
    expect(budget.upperBoundMinutes).toBeGreaterThanOrEqual(60);
    expect(budget.upperBoundMinutes).toBeLessThan(75);
    expect((await s.budgets.read({ taskId: "task" })).uncertainty?.unboundedRuns).toBe(0);
    expect(
      await s.budgets.evaluate({ taskId: "task" }, { maxAgentMinutes: 600 }, { starting: true }),
    ).toMatchObject({ blocked: false, warning: true });
  });

it("asks the owner when an unverified interval can reach the limit", async () => {
  const s = await setup();
  await verifiedRun(s, "verified", 60);
  const receipt = await s.start("lost", "lost");
  forgetRunSamples(s.store, receipt.sessionId, receipt.runId);
  s.clock.now += 20 * MINUTE;
  await s.finish(receipt);
  const task = { id: "task", maxRunMinutes: 70 };
  const budget = await readTaskRuntimeBudget(s.budgets, task, true);
  expect(budget).toMatchObject({ blocked: true, exceeded: false });
  expect(budget.reason).toContain("verified 60 min");
  expect(budget.reason).toContain("at most 80 min");
  expect(budget.reason).toContain("limit 70 min");
  expect(
    await s.budgets.evaluate({ taskId: "task" }, { maxAgentMinutes: 70 }, { starting: true }),
  ).toMatchObject({ blocked: true });
  // Accepting the uncertainty makes only the verified time count from here on.
  const usage = await s.budgets.read({ taskId: "task" });
  const runtimeAccepted = { ...usage.uncertainty!, at: s.clock.now };
  expect(usageUpperBoundMinutes(usage, runtimeAccepted)).toBe(60);
  expect(
    await readTaskRuntimeBudget(
      s.budgets,
      { id: "task", maxRunMinutes: 120, runtimeAccepted },
      true,
    ),
  ).toMatchObject({ blocked: false });
  expect(
    await s.budgets.evaluate(
      { taskId: "task" },
      { maxAgentMinutes: 70 },
      { starting: true, accepted: runtimeAccepted },
    ),
  ).toMatchObject({ blocked: false });
});

it("treats a run whose clock went backwards as having no upper bound", async () => {
  const s = await setup();
  await verifiedRun(s, "verified", 60);
  const receipt = await s.start("backwards", "backwards");
  forgetRunSamples(s.store, receipt.sessionId, receipt.runId);
  s.clock.now -= 10 * MINUTE;
  await s.finish(receipt);
  const budget = await readTaskRuntimeBudget(s.budgets, { id: "task", maxRunMinutes: 600 }, true);
  expect(budget).toMatchObject({ blocked: true, upperBoundMinutes: null });
  expect(budget.reason).toContain("no known upper bound");
});
