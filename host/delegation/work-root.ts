import type { HostStore } from "../store";
import type { WorkRecord } from "../../src/shared/model/host-contracts/work";
import type { BudgetRunRegistration } from "../tasks/task-budgets";

/** Resolve only the persisted receipt for this exact parent turn. */
export async function delegationWorkRoot(
  store: HostStore,
  sessionId: string,
): Promise<string | undefined> {
  if (!store.db) return undefined;
  const parent = await store.session(sessionId);
  if (!parent.runId) return undefined;
  const tables = await store.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('work_queue','task_run_budget_ledger')",
    )
    .all();
  if (tables.some((row) => row.name === "work_queue")) {
    const rows = await store.db.prepare("SELECT value FROM work_queue").all();
    for (const row of rows) {
      const work = JSON.parse(String(row.value)) as WorkRecord;
      if (work.receipt?.sessionId === sessionId && work.receipt.runId === parent.runId)
        return work.rootWorkId;
    }
  }
  if (tables.some((row) => row.name === "task_run_budget_ledger")) {
    const row = await store.db
      .prepare("SELECT value FROM task_run_budget_ledger WHERE session_id=? AND run_id=?")
      .get(sessionId, parent.runId);
    if (row) {
      const run = JSON.parse(String(row.value)) as BudgetRunRegistration;
      return (
        run.rootWorkId ??
        (run.taskId ? `task:${run.taskId}` : run.goalId ? `goal:${run.goalId}` : undefined)
      );
    }
  }
  return undefined;
}

/** Keep the originating task, parent task and goal in the single usage ledger. */
export async function delegationBudgetScope(store: HostStore, sessionId: string) {
  if (!store.db) return undefined;
  const parent = await store.session(sessionId);
  if (
    !parent.runId ||
    !(await store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='task_run_budget_ledger'",
      )
      .get())
  )
    return undefined;
  const row = await store.db
    .prepare("SELECT value FROM task_run_budget_ledger WHERE session_id=? AND run_id=?")
    .get(sessionId, parent.runId);
  if (!row) return undefined;
  const { taskId, parentTaskId, goalId } = JSON.parse(String(row.value)) as BudgetRunRegistration;
  return {
    ...(taskId ? { taskId } : {}),
    ...(parentTaskId ? { parentTaskId } : {}),
    ...(goalId ? { goalId } : {}),
  };
}
