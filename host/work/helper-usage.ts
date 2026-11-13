import { isDeepStrictEqual } from "node:util";
import type { HostStore } from "../store";
import { HostTaskBudgets, type BudgetRunRegistration } from "../tasks/task-budgets";

export type HelperUsageReceipt = BudgetRunRegistration & {
  workId: string;
  provider: string;
  accountId: string;
};

/** Isolated text invocation receipts share the canonical ledger, never session history. */
export async function registerHelperUsage(store: HostStore, receipt: HelperUsageReceipt) {
  const budgets = new HostTaskBudgets(store);
  await budgets.ready;
  await store.transaction(async () => {
    const existing = await store.db
      .prepare("SELECT value FROM task_run_budget_ledger WHERE session_id=? AND run_id=?")
      .get(receipt.sessionId, receipt.runId);
    if (existing) {
      const previous = JSON.parse(String(existing.value));
      if (
        previous.receiptKind !== "helper" ||
        Object.entries(receipt).some(([key, value]) => !isDeepStrictEqual(previous[key], value))
      )
        throw new Error("Helper usage receipt identity changed.");
      return;
    }
    await budgets.register(receipt);
    const row = await store.db
      .prepare("SELECT value FROM task_run_budget_ledger WHERE session_id=? AND run_id=?")
      .get(receipt.sessionId, receipt.runId);
    const value = {
      ...JSON.parse(String(row!.value)),
      receiptKind: "helper",
      confirmedElapsedMs: 0,
    };
    await store.db
      .prepare("UPDATE task_run_budget_ledger SET value=? WHERE session_id=? AND run_id=?")
      .run(JSON.stringify(value), receipt.sessionId, receipt.runId);
  }, "critical");
}

/** Call only after the exact invocation returned and physically retired. Missing metrics stay null. */
export async function settleHelperUsage(
  store: HostStore,
  receipt: HelperUsageReceipt,
  measurement: { tokens?: number; costUsd?: number; elapsedMs: number; settledAt: number },
) {
  for (const value of Object.values(measurement)) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      throw new Error("Invalid helper usage measurement.");
  }
  if (measurement.tokens !== undefined && !Number.isSafeInteger(measurement.tokens))
    throw new Error("Invalid helper token measurement.");
  await store.transaction(async () => {
    const row = await store.db
      .prepare("SELECT value FROM task_run_budget_ledger WHERE session_id=? AND run_id=?")
      .get(receipt.sessionId, receipt.runId);
    if (!row) throw new Error("Helper usage has no registered receipt.");
    const previous = JSON.parse(String(row.value));
    if (
      previous.receiptKind !== "helper" ||
      Object.entries(receipt).some(([key, value]) => !isDeepStrictEqual(previous[key], value))
    )
      throw new Error("Helper usage receipt identity changed.");
    if (measurement.settledAt < previous.startedAt)
      throw new Error("Invalid helper settlement time.");
    const settlement = {
      tokens: measurement.tokens ?? null,
      costUsd: measurement.costUsd ?? null,
      elapsedMs: measurement.elapsedMs,
      settledAt: measurement.settledAt,
    };
    if (previous.settledAt !== undefined) {
      if (Object.entries(settlement).some(([key, value]) => previous[key] !== value))
        throw new Error("Helper usage settlement cannot change.");
      return;
    }
    const value = {
      ...previous,
      ...settlement,
      confirmedElapsedMs: measurement.elapsedMs,
      usageIntervals: [
        {
          from: previous.startedAt,
          to: measurement.settledAt,
          tokens: settlement.tokens,
          costUsd: settlement.costUsd,
        },
      ],
    };
    await store.db
      .prepare("UPDATE task_run_budget_ledger SET value=? WHERE session_id=? AND run_id=?")
      .run(JSON.stringify(value), receipt.sessionId, receipt.runId);
  }, "critical");
}
