import { afterEach, expect, it } from "vitest";
import { HostStore } from "../store";
import { HostTaskBudgets } from "../tasks/task-budgets";
import { registerHelperUsage, settleHelperUsage, type HelperUsageReceipt } from "./helper-usage";
import { readWorkUsage } from "./usage";

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});
async function setup() {
  const store = new HostStore(":memory:");
  stores.push(store);
  const startedAt = new Date(2026, 10, 13, 12).getTime();
  const receipt: HelperUsageReceipt = {
    sessionId: "assistant-helper:reply",
    runId: "invocation-one",
    workId: "work-one",
    provider: "codex",
    accountId: "account-one",
    role: "worker",
    startedAt,
  };
  await registerHelperUsage(store, receipt);
  return { store, receipt, budgets: new HostTaskBudgets(store), now: startedAt + 1000 };
}

it("keeps a dispatched helper unsettled and unknown across canonical session sync", async () => {
  const f = await setup();
  const usage = await readWorkUsage(f.store, f.budgets, { now: f.now, coverageSince: 0 });
  expect(usage.daily.tokens.used).toBeNull();
  const row = await f.store.db.prepare("SELECT value FROM task_run_budget_ledger").get();
  expect(JSON.parse(String(row!.value))).toMatchObject({ receiptKind: "helper", tokens: null });
  expect(JSON.parse(String(row!.value)).settledAt).toBeUndefined();
});

it("settles exact helper measurements once without inventing missing cost", async () => {
  const f = await setup();
  const measurement = { tokens: 42, elapsedMs: 500, settledAt: f.now };
  await settleHelperUsage(f.store, f.receipt, measurement);
  await settleHelperUsage(f.store, f.receipt, measurement);
  await registerHelperUsage(f.store, f.receipt);
  const usage = await readWorkUsage(f.store, f.budgets, { now: f.now, coverageSince: 0 });
  expect(usage.daily.tokens.used).toBe(42);
  expect(usage.daily.costUsd.used).toBeNull();
  await expect(
    settleHelperUsage(f.store, f.receipt, { ...measurement, tokens: 43 }),
  ).rejects.toThrow("settlement cannot change");
  await expect(registerHelperUsage(f.store, { ...f.receipt, provider: "claude" })).rejects.toThrow(
    "identity changed",
  );
});

it("retains missing helper tokens as incomplete after proven retirement", async () => {
  const f = await setup();
  await settleHelperUsage(f.store, f.receipt, { elapsedMs: 500, settledAt: f.now, costUsd: 0 });
  const usage = await readWorkUsage(f.store, f.budgets, { now: f.now, coverageSince: 0 });
  expect(usage.daily.tokens.used).toBeNull();
  expect(usage.daily.costUsd.used).toBe(0);
});
