import { forEachAsync, mapAsync } from "../async-collections";
import { assertExpectedConfiguration } from "../configurationConflict";

import {
  canEditTask,
  canMoveTask,
  canTakeOverBlockedTask,
  EMPTY_PROMPT_ERROR,
  TASK_INPUT_REQUIRED,
  taskRequiresInstructions,
  hasUnmergedBranch,
  isNewTaskStatus,
  isTaskStatus,
  parseHostTask,
  type HostTask,
} from "../../src/features/tasks/model/hostTasks";
import {
  STOPPED_BY_USER,
  cancelSessionRun,
  errorMessage,
  sessionRunState,
} from "../sessions/sessionRuns";
import { hasShellPhysicalOwner } from "../execution/shell-ownership";
import type { TaskContext } from "./context";
export function taskMessage<T>(
  context: TaskContext,
  task: HostTask,
  reason: string,
  work: () => Promise<T>,
): Promise<T> {
  return context.engine.withMessageAuthor
    ? context.engine.withMessageAuthor(
        { kind: "task", id: task.id, name: task.title, reason },
        work,
      )
    : work();
}

export function trackExternalRuns(
  context: TaskContext,
  source: () => number | Promise<number>,
): void {
  context.externalRunSources.push(source);
}

export async function save(context: TaskContext, raw: unknown): Promise<HostTask> {
  await context.ready;
  return context.store.db.scope(async () => {
    await context.ready;

    const input = parseHostTask(raw);
    if (input.crewDefinitionId) {
      if (!context.crewRunner) throw new Error("Update this host to run tasks with a crew.");
      await context.crewRunner.validate(input);
    }
    const graph = context.schedulerTasks
      ? new Map(context.schedulerTasks)
      : new Map((await context.list()).map((task) => [task.id, task]));
    graph.set(input.id, input as HostTask);
    await context.hydrateDependencies(graph, [input as HostTask]);
    const cycle = context.dependencyCycle(input.id, graph);
    if (cycle)
      throw new Error(
        `Task dependency cycle: ${cycle.join(" -> ")}. Remove a dependency to continue.`,
      );
    const requested = (
      raw as {
        status?: unknown;
      }
    ).status;
    if (requested !== undefined && !isNewTaskStatus(requested))
      throw new Error("A new task starts as to do or queued.");
    const now = context.now();
    const previous = await context.find(input.id);
    if ((raw as { expectedAbsent?: unknown }).expectedAbsent === true && previous)
      throw new Error("Task ID already exists. Choose a new ID.");
    assertExpectedConfiguration(raw, previous, parseHostTask);
    if (input.crewDefinitionId && previous && (previous.crewRunId || hasUnmergedBranch(previous)))
      throw new Error(
        "Create a separate crew task; this task already belongs to a crew or has retained branch work.",
      );
    if (!previous) {
      const status = requested ?? "queued";
      if (status === "queued" && !input.prompt.trim()) throw new Error(EMPTY_PROMPT_ERROR);
      await context.store.project(input.projectId);
      return await context.write({
        ...input,
        status,
        createdAt: now,
        updatedAt: now,
        reviewNotes: [],
      });
    }
    if (previous.status === "running" || previous.status === "verifying")
      throw new Error("Stop this task before editing it.");
    if (!canEditTask(previous.status))
      throw new Error("Only a to-do, queued or blocked task can be edited.");
    if (previous.status === "queued" && !input.prompt.trim()) throw new Error(EMPTY_PROMPT_ERROR);
    await context.store.project(previous.projectId);
    const {
      verifyCommand,
      autoMerge,
      continueUntilDone,
      crewDefinitionId: _crewDefinitionId,
      workspace: _workspace,
      ...kept
    } = previous;
    return await context.write({
      ...kept,
      ...input,
      projectId: previous.projectId,
      // Work already on a branch stays there.
      ...(hasUnmergedBranch(previous) ? { isolate: true } : {}),
      ...(previous.sessionId || previous.branch ? { workspace: previous.workspace } : {}),
      ...(previous.status === "blocked" &&
      Boolean(input.continueUntilDone) !== Boolean(previous.continueUntilDone)
        ? { awaitingOwnerRestart: true }
        : {}),
      ...(input.continueUntilDone &&
      !previous.continueUntilDone &&
      previous.repairStop?.reason === "limit"
        ? { repairStop: undefined, needsInput: undefined, awaitingOwnerRestart: true }
        : {}),
      ...(input.prompt.trim().replace(/\s+/g, " ") !== previous.prompt.trim().replace(/\s+/g, " ")
        ? {
            reviewFailureCount: 0,
            blockedTakeover: undefined,
            awaitingOwnerRestart: true,
            // Zero records owner input; undefined lets legacy goal recovery run.
            repairAttempts: 0,
            repairStop: undefined,
            repairNote: undefined,
            checkFailureFingerprint: undefined,
            needsInput: undefined,
          }
        : {}),
      updatedAt: now,
    });
  });
}

export async function move(
  context: TaskContext,
  id: string,
  to: unknown,
  reviewed?: HostTask,
  expectedGeneration?: number,
): Promise<HostTask> {
  await context.ready;

  if (context.delivering.has(id)) throw new Error("This task is being merged.");
  const { task, generation } = await context.transaction(async () => ({
    task: await context.find(id),
    generation: Number((await context.store.db.prepare("SELECT generation FROM task_admission_generation WHERE id=?").get(id))?.generation ?? 0),
  }));
  if (!task) throw new Error("Task not found.");
  if (expectedGeneration !== undefined && generation !== expectedGeneration)
    throw new Error("Task changed before starting. Refresh and try again.");
  if (reviewed) {
    assertExpectedConfiguration({ expectedConfiguration: reviewed }, task, parseHostTask);
    if (reviewed.status !== task.status)
      throw new Error("Task changed after review. Read it again.");
    if (to !== "queued") throw new Error("Reviewed task admission only queues work.");
  }
  if (!isTaskStatus(to)) throw new Error("Invalid task status");
  if (task.artifactDeliveryPending && ["todo", "queued", "done"].includes(to))
    throw new Error(
      "Finish the recorded artifact delivery before restarting or completing this task.",
    );
  if ((task.crewRunId || task.crewDefinitionId) && to === "done")
    throw new Error(
      "Accept this assignment through its crew coordinator after independent review.",
    );
  if (!canMoveTask(task.status, to))
    throw new Error(`A ${task.status} task cannot be moved to ${to}.`);
  const now = context.now();
  if ((to === "queued" || to === "todo") && context.jobs.has(id))
    throw new Error("The previous verification is still stopping. Retry after it finishes.");
  if (
    ["todo", "queued", "done"].includes(to) &&
    (await hasShellPhysicalOwner(context.store, "task", id))
  )
    throw new Error(
      "The original verification command tree is not proven stopped. Inspect Host diagnostics before retrying.",
    );
  if (to === "queued" && !task.prompt.trim()) throw new Error(EMPTY_PROMPT_ERROR);
  if (to === "queued") await context.resolveAssistantRecoveryForOwner(task);
  if (to === "queued" && canTakeOverBlockedTask(task))
    return await context.queueTakeover(task, now, task, generation);
  if (to === "queued" && taskRequiresInstructions(task)) throw new Error(TASK_INPUT_REQUIRED);
  if (to === "todo" && task.status === "queued") {
    // Only a task nothing has run for can be pulled back.
    if (task.sessionId || task.startedAt || hasUnmergedBranch(task))
      throw new Error("This task already started, so it cannot go back to To do.");
    return await context.write({ ...task, status: "todo", updatedAt: now });
  }
  if (to === "done" && task.status === "todo") {
    if (hasUnmergedBranch(task))
      throw new Error(
        `This task’s earlier work is on ${task.branch}. Run it again to review and merge that, or delete it to discard.`,
      );
    // The owner did it by hand: nothing ran, so there is nothing to merge.
    return await context.write({
      ...task,
      status: "done",
      retryFeedback: undefined,
      completedAt: now,
      updatedAt: now,
    });
  }
  if (to === "queued" || to === "todo") {
    // A task that runs again starts over in a fresh session. Unmerged work
    // stays on its branch, and the next run continues there. A task put
    // back to to-do is cleared the same way.
    const {
      sessionId,
      runId,
      error,
      needsInput,
      startedAt,
      completedAt,
      verification,
      reviewOnly,
      awaitingOwnerRestart,
      reviewer,
      crewExecutionId: _crewExecutionId,
      diffStat,
      mergeError,
      mergeRetry,
      autoMerged,
      mergedAt,
      deliveredCommit: _deliveredCommit,
      ownerNotices: _ownerNotices,
      completedWithFindings,
      ...rest
    } = task;
    if (!task.merged)
      return await context.write(
        {
          ...rest,
          ...(rest.mergeRepair ? { mergeRepair: { ...rest.mergeRepair, attempts: 0 } } : {}),
          retryFeedback: await context.retryFeedback(task),
          // An owner rerun of work finished with findings gets a fresh correction budget.
          repairAttempts: completedWithFindings ? 0 : task.repairAttempts,
          ...(completedWithFindings ? { reviewFailureCount: 0 } : {}),
          repairNote: task.repairNote,
          repairStop: task.repairStop,
          status: to,
          updatedAt: now,
        },
        undefined,
        task,
        generation,
      );
    const {
      branch,
      worktreeCwd,
      workspaceId: _workspaceId,
      workspaceGenerationId: _workspaceGenerationId,
      workspaceActivityId: _workspaceActivityId,
      deliveryState: _deliveryState,
      deliveryOperationId: _deliveryOperationId,
      deliveryArtifacts: _deliveryArtifacts,
      artifactDeliveryPending: _artifactDeliveryPending,
      artifactDeliveryActivityId: _artifactDeliveryActivityId,
      finalization: _finalization,
      baseBranch,
      baseCommit,
      deliveryCwd: _deliveryCwd,
      merged,
      retryFeedback,
      repairAttempts,
      repairNote,
      repairStop,
      attemptHistory,
      mergeRepair,
      cleanupError,
      cleanupRetryAfter,
      dependencyArtifactsPrepared,
      artifactPaths,
      artifactHashes,
      deliveryRequested,
      ...fresh
    } = rest;
    return await context.write(
      { ...fresh, status: to, updatedAt: now },
      undefined,
      task,
      generation,
    );
  }
  if (to === "blocked") {
    if (task.crewDefinitionId && context.crewRunner) {
      await context.store.db.checkAuthorization();
      await context.crewRunner.stop(task);
      return await context.block({ ...task, deliveryRequested: undefined }, STOPPED_BY_USER, now);
    }
    if (task.status === "verifying") {
      // Keep the job registered until its shell and descendants have exited.
      await context.store.db.checkAuthorization();
      context.jobControllers.get(id)?.abort();
      if (
        task.reviewer &&
        (await sessionRunState(context.store, task.reviewer, 0, now)).state === "running"
      ) {
        await cancelSessionRun(context.engine, task.reviewer);
        await context.limits.recordRun(task.reviewer, now);
      }
      return await context.block({ ...task, deliveryRequested: undefined }, STOPPED_BY_USER, now);
    }
    const run = { ...task, startedAt: task.startedAt ?? task.createdAt };
    if ((await sessionRunState(context.store, run, 0, now)).state === "running") {
      await cancelSessionRun(context.engine, run);
      await context.limits.recordRun(run, now);
    }
    return await context.block({ ...task, deliveryRequested: undefined }, STOPPED_BY_USER, now);
  }
  if (to === "done" && hasUnmergedBranch(task)) {
    throw new Error(
      "Task completion does not authorize delivery. Review changes and approve the exact delivery plan.",
    );
  }
  return await context.write({
    ...task,
    status: to,
    updatedAt: now,
  });
}

export async function startTask(
  context: TaskContext,
  id: string,
  reviewed?: HostTask,
): Promise<HostTask> {
  await context.ready;

  let { task, generation } = await context.transaction(async () => ({
    task: await context.find(id),
    generation: Number(
      (
        await context.store.db
          .prepare("SELECT generation FROM task_admission_generation WHERE id=?")
          .get(id)
      )?.generation ?? 0,
    ),
  }));
  if (!task) throw new Error("Task not found.");
  if (await hasShellPhysicalOwner(context.store, "task", id))
    throw new Error(
      "The original verification command tree is not proven stopped. Inspect Host diagnostics before retrying.",
    );
  if (reviewed) {
    assertExpectedConfiguration({ expectedConfiguration: reviewed }, task, parseHostTask);
    if (reviewed.status !== task.status)
      throw new Error("Task changed after review. Read it again.");
  }
  if (task.status === "queued") await context.resolveAssistantRecoveryForOwner(task);
  if (task.goalId && context.pausedGoals.has(task.goalId))
    throw new Error("This goal is paused. Resume it before starting its tasks.");
  if (task.goalId) {
    if ((await context.owningGoal(task.goalId))?.status === "cancelled")
      throw new Error("This goal was cancelled. Create a new task to continue its retained work.");
  }
  if (task.status !== "queued") {
    task = await context.move(id, "queued", reviewed ?? task, generation);
    const moved = task;
    generation = await context.transaction(async () => {
      const current = await context.find(id);
      const currentGeneration = Number(
        (
          await context.store.db
            .prepare("SELECT generation FROM task_admission_generation WHERE id=?")
            .get(id)
        )?.generation ?? 0,
      );
      if (!current || current.status !== "queued" || currentGeneration !== generation + 1)
        throw new Error("Task changed before starting. Refresh and try again.");
      assertExpectedConfiguration({ expectedConfiguration: moved }, current, parseHostTask);
      return currentGeneration;
    });
  }
  const accepted = await context.transaction(async () => {
    const current = await context.find(id);
    const currentGeneration = Number(
      (
        await context.store.db
          .prepare("SELECT generation FROM task_admission_generation WHERE id=?")
          .get(id)
      )?.generation ?? 0,
    );
    if (!current || current.status !== "queued" || currentGeneration !== generation)
      throw new Error("Task changed before starting. Refresh and try again.");
    assertExpectedConfiguration({ expectedConfiguration: task }, current, parseHostTask);
    await context.store.db
      .prepare("UPDATE task_admission_generation SET generation=generation+1 WHERE id=?")
      .run(id);
    generation = currentGeneration + 1;
    // Read the queue under the same transaction as its ordering writes. A
    // previous snapshot could restore another task that was stopped or edited.
    const ordered = (await context.list()).filter(
      (item) => item.status === "queued" && item.id !== id,
    );
    const accepted = await context.write({ ...current, position: 0, updatedAt: context.now() });
    await forEachAsync(
      ordered,
      async (item, index) =>
        await context.write({ ...item, position: index + 1, updatedAt: context.now() }),
    );
    return accepted;
  });
  // Acceptance is durable; the scheduler still owns capacity and dependency
  // gates. Unrelated maintenance must not hold the owner's Start response.
  // Schedule only after the enclosing commit, outside the caller's
  // short-lived Room or voice authorization.
  context.store.afterCommit(() => {
    void context.tick().catch(async (error) => {
      try {
        await context.transaction(async () => {
          const current = await context.find(id);
          const currentGeneration = Number(
            (
              await context.store.db
                .prepare("SELECT generation FROM task_admission_generation WHERE id=?")
                .get(id)
            )?.generation ?? 0,
          );
          if (current?.status === "queued" && currentGeneration === generation)
            await context.block(
              current,
              `Task scheduling failed: ${errorMessage(error)}`,
              context.now(),
            );
        });
      } catch (reportError) {
        console.error("Task scheduling failure could not be recorded:", errorMessage(reportError));
      }
    });
  });
  return accepted;
}

export async function reorder(context: TaskContext, ids: unknown): Promise<HostTask[]> {
  await context.ready;
  return context.store.db.scope(async () => {
    await context.ready;

    if (
      !Array.isArray(ids) ||
      ids.length > 1000 ||
      ids.some((id) => typeof id !== "string") ||
      new Set(ids).size !== ids.length
    )
      throw new Error("Invalid task order");
    const tasks = await mapAsync(ids, async (id) => await context.get(id));
    if (tasks.some((task) => !task)) throw new Error("Task not found.");
    if (tasks.some((task) => !["todo", "queued"].includes(task!.status)))
      throw new Error("Only queued or to-do tasks can be reordered");
    if (tasks.some((task) => task!.status !== tasks[0]!.status))
      throw new Error("Reorder tasks within one status");
    return await context.transaction(
      async () =>
        await mapAsync(
          tasks,
          async (task, position) =>
            await context.write({ ...task!, position, updatedAt: context.now() }),
        ),
    );
  });
}

export async function deleteTask(
  context: TaskContext,
  id: string,
  discard = false,
  expectedUpdatedAt?: number,
): Promise<void> {
  await context.ready;

  // Capture the exact persisted value before any awaited cleanup. A timestamp
  // alone cannot distinguish two edits made within the same millisecond.
  const expected = await context.taskValue(id);
  const task =
    expected === undefined
      ? undefined
      : await context.withReviewNotes(JSON.parse(expected) as HostTask);
  let workspaceCleanupCompleted = false;
  if (task?.artifactDeliveryPending || task?.artifactDeliveryActivityId)
    throw new Error(
      "Reconcile the recorded artifact delivery before deleting this task; its source is retained.",
    );
  if (
    expectedUpdatedAt !== undefined &&
    (!Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt < 0)
  )
    throw new Error("Invalid task revision.");
  if (task && expectedUpdatedAt !== undefined && task.updatedAt !== expectedUpdatedAt)
    throw new Error("This task changed. Refresh it before deleting.");
  if (
    task &&
    task.status !== "done" &&
    (await context.list()).some(
      (other) => other.id !== id && other.status !== "done" && other.dependsOn?.includes(id),
    )
  )
    throw new Error("Other unfinished tasks depend on this task. Remove those tasks first.");
  if (context.jobs.has(id))
    throw new Error("The previous verification is still stopping. Retry after it finishes.");
  if (await hasShellPhysicalOwner(context.store, "task", id))
    throw new Error(
      "The original verification command tree is not proven stopped. Inspect Host diagnostics before deleting.",
    );
  if (task?.status === "running" || task?.status === "verifying")
    throw new Error("Stop this task before deleting it.");
  if (task && hasUnmergedBranch(task)) {
    if (context.delivering.has(id)) throw new Error("This task is being merged.");
    if (!discard)
      throw new Error(
        `This task’s work is on ${task.branch} and was never merged. Deleting it discards that branch.`,
      );
    await context.discard(task);
    workspaceCleanupCompleted = true;
  }
  if (expected === undefined) return;
  await context.store.db.checkAuthorization();
  const deleted = await context.store.db
    .prepare("DELETE FROM tasks WHERE id=? AND value=?")
    .run(id, expected);
  if (Number(deleted.changes) !== 1)
    throw Object.assign(
      new Error(
        workspaceCleanupCompleted
          ? "Task changed during workspace cleanup. Cleanup completed, but the updated task was retained. Refresh before retrying."
          : "Task changed. The updated task was retained; refresh before deleting.",
      ),
      {
        code: "TASK_REVISION_CONFLICT",
        taskId: id,
        workspaceCleanupCompleted,
      },
    );
  context.store.afterCommit(() => {
    context.invalidateAssistantGeneration(task!);
    context.onDelete?.({ id, projectId: task!.projectId });
    context.onChange?.();
  });
  context.listCache = undefined;
  context.projectListCache.clear();
  context.schedulerTasks?.delete(id);
}

export async function validateTransfer(
  context: TaskContext,
  id: string,
  targetProjectId: string,
  expectedUpdatedAt: number,
): Promise<HostTask> {
  await context.ready;

  const task = await context.get(id);
  if (!task || task.updatedAt !== expectedUpdatedAt)
    throw new Error("Task changed; read it before transferring.");
  if (task.projectId === targetProjectId) throw new Error("Choose a different project.");
  await context.store.project(targetProjectId);
  if (
    task.status !== "todo" ||
    task.startedAt ||
    task.sessionId ||
    task.branch ||
    task.worktreeCwd ||
    task.goalId ||
    task.stewardId ||
    task.crewDefinitionId ||
    task.crewRunId ||
    task.workspace ||
    task.deliveryCwd ||
    task.reviewer ||
    task.dependsOn?.length ||
    (await context.list()).some((other) => other.dependsOn?.includes(id))
  )
    throw new Error("Only an unstarted independent to-do task can move between projects.");
  if (context.jobs.has(id)) throw new Error("Wait for task verification to stop.");
  return task;
}

export async function transfer(
  context: TaskContext,
  id: string,
  targetProjectId: string,
  expectedUpdatedAt: number,
): Promise<HostTask> {
  await context.ready;

  return await context.transaction(async () => {
    const task = await context.validateTransfer(id, targetProjectId, expectedUpdatedAt);
    return await context.write({ ...task, projectId: targetProjectId, updatedAt: context.now() });
  });
}

export async function readNotes(
  context: TaskContext,
  id: string,
  rawIds: unknown,
): Promise<HostTask> {
  await context.ready;
  return context.store.db.scope(async () => {
    await context.ready;

    const task = await context.find(id);
    if (!task) throw new Error("Task not found.");
    if (
      !Array.isArray(rawIds) ||
      rawIds.length > 10000 ||
      rawIds.some((id) => typeof id !== "string")
    )
      throw new Error("Invalid review note IDs.");
    const ids = new Set(rawIds as string[]);
    if ([...ids].some((id) => !task.reviewNotes?.some((note) => note.id === id)))
      throw new Error("Review note not found.");
    if (!task.reviewNotes?.some((note) => ids.has(note.id) && note.readAt === undefined))
      return task;
    const now = context.now();
    return await context.write({
      ...task,
      reviewNotes: task.reviewNotes?.map((note) =>
        ids.has(note.id) && note.readAt === undefined ? { ...note, readAt: now } : note,
      ),
      updatedAt: now,
    });
  });
}

export async function resolveNote(
  context: TaskContext,
  id: string,
  noteId: unknown,
  resolved: unknown,
): Promise<HostTask> {
  await context.ready;
  return context.store.db.scope(async () => {
    await context.ready;

    const task = await context.find(id);
    if (!task) throw new Error("Task not found.");
    if (typeof resolved !== "boolean") throw new Error("Invalid review note status.");
    if (typeof noteId !== "string" || !task.reviewNotes?.some((note) => note.id === noteId))
      throw new Error("Review note not found.");
    if (
      (task.reviewNotes.find((note) => note.id === noteId)!.resolvedAt !== undefined) ===
      resolved
    )
      return task;
    const now = context.now();
    return await context.write({
      ...task,
      reviewNotes: task.reviewNotes.map((note) =>
        note.id === noteId
          ? { ...note, resolvedAt: resolved ? now : undefined, updatedAt: now }
          : note,
      ),
      updatedAt: now,
    });
  });
}

export async function cancel(context: TaskContext, id: string, reason: string): Promise<void> {
  await context.ready;

  const task = await context.find(id);
  // Active verification must reach Stop so its controller is aborted. The job
  // stays registered during process-tree cleanup, retaining retry/delete gates.
  if (context.jobs.has(id) && task?.status !== "running" && task?.status !== "verifying")
    throw new Error("The previous verification is still stopping. Retry after it finishes.");
  if (task?.status === "running" || task?.status === "verifying") await context.move(id, "blocked");
  else if (
    task?.status === "queued" ||
    (task?.status === "review" && (task.autoMerge || task.deliveryRequested))
  )
    await context.block({ ...task, deliveryRequested: undefined }, reason, context.now());
}
