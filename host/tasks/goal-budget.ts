import { type HostTask } from "../../src/features/tasks/model/hostTasks";
import type { HostGoal } from "../../src/features/tasks/model/hostGoals";
import type { TaskContext } from "./context";
export async function goalExecutionAllowed(
  context: TaskContext,
  goalId?: string,
): Promise<boolean> {
  await context.ready;
  return (
    !context.closing &&
    (!goalId ||
      (!context.pausedGoals.has(goalId) &&
        (!context.assistantGoalAdmission || (await context.assistantGoalAdmission(goalId)))))
  );
}

export async function setGoalPaused(
  context: TaskContext,
  goalId: string,
  paused: boolean,
): Promise<void> {
  await context.ready;
  await context.store.transaction(async () => {
    if (paused)
      await context.store.db
        .prepare("INSERT OR IGNORE INTO task_goal_holds(goal_id) VALUES (?)")
        .run(goalId);
    else await context.store.db.prepare("DELETE FROM task_goal_holds WHERE goal_id=?").run(goalId);
    await context.publishGoalPause(goalId);
  }, "critical");
}

export async function setGoalPauseReason(
  context: TaskContext,
  goalId: string,
  reason: "assistant-budget" | "assistant-hours",
  paused: boolean,
): Promise<void> {
  if (reason !== "assistant-budget" && reason !== "assistant-hours")
    throw new Error("Unsupported goal pause reason.");
  await context.ready;
  await context.store.transaction(async () => {
    if (paused)
      await context.store.db
        .prepare("INSERT OR IGNORE INTO task_goal_reason_holds(goal_id,reason) VALUES (?,?)")
        .run(goalId, reason);
    else
      await context.store.db
        .prepare("DELETE FROM task_goal_reason_holds WHERE goal_id=? AND reason=?")
        .run(goalId, reason);
    await context.publishGoalPause(goalId);
  }, "critical");
}

export async function publishGoalPause(context: TaskContext, goalId: string): Promise<void> {
  const held = !!(await context.store.db
    .prepare(
      "SELECT goal_id FROM task_goal_holds WHERE goal_id=? UNION SELECT goal_id FROM task_goal_reason_holds WHERE goal_id=? UNION SELECT goal_id FROM task_goal_deletion_holds WHERE goal_id=? LIMIT 1",
    )
    .get(goalId, goalId, goalId));
  context.store.afterCommit(() => {
    if (held) context.pausedGoals.add(goalId);
    else context.pausedGoals.delete(goalId);
  });
}

export async function hasRunningGoalWork(
  context: TaskContext,
  goalIds: readonly string[],
): Promise<boolean> {
  await context.ready;
  const selected = new Set(goalIds);
  return (await context.list()).some(
    (task) => task.goalId && selected.has(task.goalId) && context.jobs.has(task.id),
  );
}

export async function budgetReason(
  context: TaskContext,
  task: HostTask,
  starting = false,
): Promise<string | undefined> {
  const own = await context.budgets.evaluate({ taskId: task.id }, task.budget, { starting });
  const parent = await context.budgetParent(task);
  const parentLimit = parent?.budget
    ? await context.budgets.evaluate({ taskId: parent.id }, parent.budget, { starting })
    : undefined;
  const goalId = task.goalId ?? parent?.goalId;
  const goal = goalId ? await context.owningGoal(goalId) : undefined;
  const family = goal?.budget
    ? await context.budgets.evaluate({ goalId: goal.id }, goal.budget, { starting })
    : undefined;
  return own.blocked
    ? `Task ${task.title}: ${own.reasons.join(" ")}`
    : parentLimit?.blocked
      ? `Crew task ${parent!.title}: ${parentLimit.reasons.join(" ")}`
      : family?.blocked
        ? `Goal ${goal!.title}: ${family.reasons.join(" ")}`
        : undefined;
}

export async function budgetParent(
  context: TaskContext,
  task: HostTask,
): Promise<HostTask | undefined> {
  if (!task.crewRunId) return;
  const row = await context.store.db
    .prepare("SELECT value FROM tasks WHERE json_extract(value, '$.crewExecutionId')=? LIMIT 1")
    .get(task.crewRunId);
  return row ? (JSON.parse(String(row.value)) as HostTask) : undefined;
}

export async function budgetBlock(
  context: TaskContext,
  task: HostTask,
  reason: string,
  now: number,
): Promise<HostTask> {
  return await context.block(
    { ...task, budgetStop: reason, awaitingOwnerRestart: true },
    `Run budget: ${reason}`,
    now,
    true,
  );
}

export async function updateGoalSettings(
  context: TaskContext,
  goalId: string,
  taskIds: readonly string[],
  settings: {
    autoMerge?: boolean;
    continueUntilDone?: boolean;
    maxRunMinutes?: number;
  },
): Promise<void> {
  await context.ready;
  return context.store.db.scope(async () => {
    await context.ready;

    if (!Object.keys(settings).length) return;
    for (const id of taskIds) {
      const task = await context.find(id);
      if (!task || task.goalId !== goalId || task.status === "done") continue;
      if (context.delivering.has(id))
        throw new Error("A goal task is being merged. Try again later.");
      const active = task.status === "running" || task.status === "verifying";
      const changedContinue =
        settings.continueUntilDone !== undefined &&
        Boolean(task.continueUntilDone) !== settings.continueUntilDone;
      await context.write({
        ...task,
        ...(settings.autoMerge !== undefined
          ? { autoMerge: settings.autoMerge && task.isolate !== false ? true : undefined }
          : {}),
        ...(settings.continueUntilDone !== undefined
          ? { continueUntilDone: settings.continueUntilDone || undefined }
          : {}),
        // Do not shorten a run that is already in progress.
        ...(!active && settings.maxRunMinutes !== undefined
          ? { maxRunMinutes: settings.maxRunMinutes }
          : {}),
        ...(task.status === "blocked" && changedContinue ? { awaitingOwnerRestart: true } : {}),
        ...(settings.continueUntilDone &&
        !task.continueUntilDone &&
        task.repairStop?.reason === "limit"
          ? { repairStop: undefined, needsInput: undefined, awaitingOwnerRestart: true }
          : {}),
        updatedAt: context.now(),
      });
    }
  });
}

export async function owningGoal(context: TaskContext, id: string): Promise<HostGoal | undefined> {
  if (
    !(await context.store.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='goals'")
      .get())
  )
    return undefined;
  const row = await context.store.db.prepare("SELECT value FROM goals WHERE id=?").get(id);
  return row ? (JSON.parse(String(row.value)) as HostGoal) : undefined;
}
