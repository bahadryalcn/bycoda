import { parseHostTask } from "./routing-input";
import { randomUUID } from "node:crypto";
import { type HostTask } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";
export function invalidateAssistantGeneration(context: TaskContext, task: HostTask): void {
  if (!task.goalId?.startsWith("assistant-")) return;
  const invalidated =
    context.invalidatedAssistantGenerations.get(task.id) ?? new Set<string | undefined>();
  invalidated.add(task.workspaceGenerationId);
  context.invalidatedAssistantGenerations.set(task.id, invalidated);
}

export function isAssistantDeletionHeld(context: TaskContext, goalId: string): boolean {
  return context.assistantDeletionGoals.has(goalId);
}

export async function setAssistantDeletionHold(
  context: TaskContext,
  goalId: string,
  operationId: string,
  held: boolean,
): Promise<void> {
  await context.ready;
  if (!goalId.startsWith("assistant-") || !operationId || operationId.length > 200)
    throw new Error("Invalid assistant deletion hold.");
  await context.store.transaction(async () => {
    const old = await context.store.db
      .prepare("SELECT operation_id FROM task_goal_deletion_holds WHERE goal_id=?")
      .get(goalId);
    if (old && old.operation_id !== operationId)
      throw new Error("A different deletion intent owns this goal hold.");
    if (held)
      await context.store.db
        .prepare("INSERT OR IGNORE INTO task_goal_deletion_holds(goal_id,operation_id) VALUES(?,?)")
        .run(goalId, operationId);
    else
      await context.store.db
        .prepare("DELETE FROM task_goal_deletion_holds WHERE goal_id=? AND operation_id=?")
        .run(goalId, operationId);
    context.store.afterCommit(() => {
      if (held) context.assistantDeletionGoals.add(goalId);
      else context.assistantDeletionGoals.delete(goalId);
    });
    await context.publishGoalPause(goalId);
  }, "critical");
}

export async function assertAssistantDeletionStopped(
  context: TaskContext,
  taskIds: readonly string[],
): Promise<void> {
  for (const id of taskIds) {
    const task = await context.find(id);
    if (!task) throw new Error("A selected task disappeared before deletion.");
    if (
      task.status === "running" ||
      task.status === "verifying" ||
      context.jobs.has(id) ||
      context.delivering.has(id) ||
      context.continuingSessions.has(id) ||
      task.artifactDeliveryPending ||
      task.artifactDeliveryActivityId
    )
      throw new Error(
        "A selected task still owns active work, verification, delivery or maintenance.",
      );
  }
}

export async function markAssistantDeletionQuiescent(
  context: TaskContext,
  id: string,
  expectedValue: string,
): Promise<void> {
  if ((await context.taskValue(id)) !== expectedValue)
    throw new Error("The selected task changed during Stop.");
  const task = JSON.parse(expectedValue) as HostTask;
  if (
    context.jobs.has(id) ||
    context.delivering.has(id) ||
    context.continuingSessions.has(id) ||
    task.artifactDeliveryPending ||
    task.artifactDeliveryActivityId
  )
    throw new Error("The task's actual work is still retiring.");
  await context.write({
    ...task,
    status: task.status === "done" ? "done" : "blocked",
    ...(task.status === "done"
      ? {}
      : {
          error:
            "Held after owner-reviewed job deletion; original execution may still need inspection.",
        }),
    workspaceGenerationId: randomUUID(),
    awaitingOwnerRestart: true,
    needsInput: undefined,
    reviewer: undefined,
    deliveryRequested: undefined,
    updatedAt: context.now(),
  });
  context.store.afterCommit(() => context.invalidateAssistantGeneration(task));
}

export async function assistantDeletionRunRetired(
  context: TaskContext,
  source: {
    sessionId: string;
    runId: string;
    projectId: string;
    executionCwd: string;
    authorityGeneration?: number;
  },
): Promise<boolean> {
  const current = await context.store.session(source.sessionId);
  if (
    current.runId !== source.runId ||
    current.projectId !== source.projectId ||
    (current.session.worktreeCwd ?? current.session.cwd) !== source.executionCwd ||
    current.authorityGeneration !== source.authorityGeneration
  )
    throw new Error(
      "The original deletion source changed; a replacement turn will not be cancelled.",
    );
  if (!context.activeRecoveryRun)
    throw new Error("Actual engine retirement cannot be verified on this Host.");
  if (current.status === "interrupted")
    throw new Error(
      "An interrupted source is not proof of original provider retirement; inspect its recovery state before clearing deletion.",
    );
  const root = current.session.blocks.findLastIndex(
    (block) => block.role === "user" && !block.continuationOf,
  );
  if (
    current.session.blocks
      .slice(root + 1)
      .some((block) => block.role === "system" && block.text.trim() === "Stopped by you.") &&
    context.retainedDeletionWriter?.(source.sessionId)
  )
    return false;
  return current.status !== "running" && !context.activeRecoveryRun(source.sessionId);
}

export async function assertAssistantDeletionSourceStable(
  context: TaskContext,
  source: {
    sessionId: string;
    runId: string;
    projectId: string;
    executionCwd: string;
    authorityGeneration?: number;
  },
): Promise<void> {
  const current = await context.store.session(source.sessionId);
  if (
    current.runId !== source.runId ||
    current.projectId !== source.projectId ||
    (current.session.worktreeCwd ?? current.session.cwd) !== source.executionCwd ||
    current.authorityGeneration !== source.authorityGeneration
  )
    throw new Error(
      "The original unknown source changed. Its replacement will not be cancelled or adopted.",
    );
}

export async function restoreAssistantDeletedTask(
  context: TaskContext,
  snapshot: HostTask,
  goalId: string,
): Promise<HostTask> {
  await context.ready;
  parseHostTask(snapshot);
  if (snapshot.goalId !== goalId || !goalId.startsWith("assistant-"))
    throw new Error("The deleted task is outside its original assistant goal.");
  return context.store.transaction(async () => {
    if ((await context.taskValue(snapshot.id)) !== undefined)
      throw new Error("A task with this identity already exists. Nothing was restored.");
    await context.store.project(snapshot.projectId);
    const done = snapshot.status === "done";
    return context.write({
      ...snapshot,
      status: done ? "done" : "blocked",
      ...(done
        ? {}
        : {
            error:
              "Restored from Recently deleted. Review this task before explicitly restarting it.",
          }),
      workspaceGenerationId: randomUUID(),
      awaitingOwnerRestart: true,
      needsInput: undefined,
      reviewer: undefined,
      deliveryRequested: undefined,
      mergeRetry: undefined,
      blockedTakeover: undefined,
      runStall: undefined,
      updatedAt: context.now(),
    });
  }, "critical");
}
