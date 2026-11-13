import { afterEach, describe, expect, it } from "vitest";
import { HostStore } from "../store";
import { HostTaskBudgets } from "../tasks/task-budgets";
import { aggregateWorkUsage, readWorkUsage, workUsageWindows, type WorkUsageRun } from "./usage";
import { evaluateWorkCaps } from "./limits";

const now = new Date(2026, 10, 13, 12).getTime();
const start = new Date(2026, 10, 13, 9).getTime();
const run = (patch: Partial<WorkUsageRun> = {}): WorkUsageRun => ({
  sessionId: "session",
  runId: "run",
  startedAt: start,
  settledAt: start + 60_000,
  provider: "codex",
  accountId: "account-1",
  tokens: 100,
  costUsd: 0.25,
  ...patch,
});
const read = (
  runs: WorkUsageRun[],
  patch: Partial<Parameters<typeof aggregateWorkUsage>[1]> = {},
) => aggregateWorkUsage(runs, { now, coverageSince: new Date(2026, 9, 1).getTime(), ...patch });

describe("Work usage calendar and admission", () => {
  it("uses Host-local dates, real month boundaries and DST midnight", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const spring = workUsageWindows(new Date(2026, 2, 8, 12).getTime());
      expect(spring.daily.nextResetAt - spring.daily.start).toBe(23 * 3_600_000);
      const fall = workUsageWindows(new Date(2026, 10, 1, 12).getTime());
      expect(fall.daily.nextResetAt - fall.daily.start).toBe(25 * 3_600_000);
      const february = workUsageWindows(new Date(2028, 1, 29, 12).getTime());
      expect(new Date(february.monthly.start).getDate()).toBe(1);
      expect(new Date(february.monthly.nextResetAt).getMonth()).toBe(2);
      expect(february.monthly.nextResetAt - february.monthly.start).toBe(29 * 86_400_000);
      process.env.TZ = "Europe/Istanbul";
      const istanbul = workUsageWindows(Date.parse("2026-11-12T22:00:00Z"));
      expect(istanbul.daily.start).toBe(Date.parse("2026-11-12T21:00:00Z"));
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("counts exact runs once and sums accounts only for their provider total", () => {
    const first = run();
    const rows = [
      first,
      first,
      run({ runId: "two", accountId: "account-2" }),
      run({ runId: "three", provider: "claude", accountId: "other" }),
    ];
    expect(read(rows).daily.tokens.used).toBe(300);
    expect(read(rows, { provider: "codex" }).daily.tokens.used).toBe(200);
    expect(read(rows, { provider: "codex", accountId: "account-1" }).daily.tokens.used).toBe(100);
    expect(read(rows, { provider: "cursor" }).monthly.costUsd.used).toBe(0);
  });

  it("keeps missing cost independent from valid normalized reported tokens", () => {
    const usage = read([run({ costUsd: null })]);
    expect(usage.daily.tokens.used).toBe(100);
    expect(usage.daily.costUsd.used).toBeNull();
    expect(evaluateWorkCaps({ daily: { tokens: 101 } }, usage).allowed).toBe(true);
    expect(evaluateWorkCaps({ daily: { costUsd: 1 } }, usage).waits[0]?.code).toBe(
      "workUsageUnknown",
    );
    expect(evaluateWorkCaps({ daily: { costUsd: 0 }, monthly: { tokens: 0 } }, usage).allowed).toBe(
      true,
    );
  });

  it("does not allocate a boundary-spanning total to completion day", () => {
    const yesterday = new Date(2026, 10, 12, 23).getTime();
    const usage = read([run({ startedAt: yesterday })]);
    expect(usage.daily.tokens.used).toBeNull();
    expect(usage.daily.tokens.reported).toBe(0);
    expect(usage.monthly.tokens.used).toBe(100);
  });

  it("uses confirmed contained deltas and preserves a spanning delta as unknown", () => {
    const midnight = workUsageWindows(now).daily.start;
    const usage = read([
      run({
        startedAt: midnight - 60_000,
        tokens: 100,
        usageIntervals: [
          { from: midnight - 60_000, to: midnight - 1, tokens: 40, costUsd: null },
          { from: midnight + 1, to: start, tokens: 60, costUsd: null },
        ],
      }),
    ]);
    expect(usage.daily.tokens.used).toBe(60);
    const spanning = read([
      run({
        startedAt: midnight - 60_000,
        usageIntervals: [{ from: midnight - 60_000, to: start, tokens: 100, costUsd: null }],
      }),
    ]);
    expect(spanning.daily.tokens.used).toBeNull();
    expect(spanning.daily.tokens.reasons.join(" ")).toContain("crosses a calendar boundary");
  });

  it("keeps historical unobserved totals, missing identity and missing coverage unknown", () => {
    const midnight = workUsageWindows(now).daily.start;
    expect(
      read([run({ startedAt: midnight - 1, usageIntervals: [] })]).daily.tokens.used,
    ).toBeNull();
    const missingIdentity = read([run({ provider: undefined })], { provider: "codex" });
    expect(missingIdentity.daily.tokens.used).toBeNull();
    expect(read([], { coverageSince: undefined }).daily.tokens.used).toBeNull();
    const partialCoverage = read([], { coverageSince: midnight });
    expect(partialCoverage.daily.tokens.used).toBe(0);
    expect(partialCoverage.monthly.tokens.used).toBeNull();
  });

  it("holds new admission while a running turn has incomplete totals", () => {
    const usage = read([run({ settledAt: undefined })]);
    expect(usage.daily.tokens.reported).toBe(100);
    expect(usage.daily.tokens.used).toBeNull();
    expect(evaluateWorkCaps({ daily: { tokens: 101 } }, usage).waits[0]?.code).toBe(
      "workUsageUnknown",
    );
    const reached = evaluateWorkCaps({ daily: { tokens: 100 }, monthly: { costUsd: 0.25 } }, usage);
    expect(reached.waits.map((wait) => wait.code)).toEqual(["workCapReached", "workCapReached"]);
    expect(reached.waits[0]?.nextResetAt).toBe(usage.daily.nextResetAt);
    expect(evaluateWorkCaps({}, usage).allowed).toBe(true);
  });

  it("excludes old and future windows without losing month-crossing uncertainty", () => {
    const month = workUsageWindows(now).monthly;
    const old = run({ startedAt: month.start - 100, settledAt: month.start - 1 });
    const future = run({
      runId: "future",
      startedAt: month.nextResetAt,
      settledAt: month.nextResetAt + 1,
    });
    expect(read([old, future]).monthly.tokens.used).toBe(0);
    expect(read([run({ startedAt: month.start - 1 })]).monthly.tokens.used).toBeNull();
  });
});

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});

it("registers projectless Work on the existing durable ledger and refuses identity rebinding", async () => {
  const store = new HostStore(":memory:");
  stores.push(store);
  const budgets = new HostTaskBudgets(
    store,
    () => now,
    () => now,
  );
  const identity = {
    workId: "work",
    rootWorkId: "root",
    provider: "codex",
    accountId: "one",
    role: "worker" as const,
    sessionId: "missing-session",
    runId: "exact-run",
    startedAt: start,
  };
  await budgets.register(identity);
  await budgets.register(identity);
  await expect(budgets.register({ ...identity, accountId: "two" })).rejects.toThrow(
    "different Work execution identity",
  );
  const rows = await store.db.prepare("SELECT value FROM task_run_budget_ledger").all();
  expect(rows).toHaveLength(1);
  expect(JSON.parse(String(rows[0]?.value))).toMatchObject(identity);
  const usage = await readWorkUsage(store, budgets, { now, coverageSince: 0, provider: "codex" });
  expect(usage.daily.tokens.used).toBeNull();
  expect(usage.daily.costUsd.used).toBeNull();
});

it("persists incremental observations once without replacing per-run cost baselines", async () => {
  const store = new HostStore(":memory:");
  stores.push(store);
  const project = await store.addProject("/work-usage", "Work usage");
  let clock = start;
  const budgets = new HostTaskBudgets(
    store,
    () => clock,
    () => clock,
  );
  const first = await store.save(
    {
      projectId: project.id,
      revision: 1,
      updatedAt: clock,
      status: "running",
      runId: "one",
      session: {
        id: "measured",
        cwd: "/work-usage",
        title: "Work",
        harness: "codex",
        model: "test",
        modelSettings: {},
        runtimeMode: "auto",
        providerAccountId: "account-1",
        blocks: [{ id: "block", role: "user", text: "Work", startedAt: clock }],
        usage: { costUsd: 0.5, apiMs: 0, lastProcessCostUsd: 0.5, lastProcessApiMs: 0 },
      },
    },
    {},
  );
  await budgets.register({
    workId: "one",
    rootWorkId: "one",
    role: "worker",
    sessionId: "measured",
    runId: "one",
    startedAt: start,
    provider: "codex",
    accountId: "account-1",
  });
  clock += 1000;
  await budgets.sync();
  clock += 1000;
  await store.save(
    {
      ...first,
      revision: 2,
      updatedAt: clock,
      session: {
        ...first.session,
        usage: { costUsd: 0.75, apiMs: 0, lastProcessCostUsd: 0.75, lastProcessApiMs: 0 },
      },
    },
    {},
  );
  await budgets.sync();
  await budgets.sync();
  const row = await store.db
    .prepare("SELECT value FROM task_run_budget_ledger WHERE run_id=?")
    .get("one");
  const saved = JSON.parse(String(row?.value)) as WorkUsageRun & { costBaseline: number };
  expect(saved.costBaseline).toBe(0);
  expect(saved.costUsd).toBe(0.75);
  expect(saved.usageIntervals?.filter((interval) => interval.costUsd !== null)).toEqual([
    { from: start, to: start + 1000, tokens: null, costUsd: 0.5 },
    { from: start + 1000, to: start + 2000, tokens: null, costUsd: 0.25 },
  ]);
});
