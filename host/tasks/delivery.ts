import type { TaskFinalizationPreview } from "./task-workspace-runtime";

import {
  autoMergeBlocker,
  hasUnmergedBranch,
  type HostTask,
  type TaskDeliveryReview,
} from "../../src/features/tasks/model/hostTasks";
import { taskWorkspace } from "./task-workspace";
import { transferTaskArtifacts } from "./task-artifacts";
import {
  previewTaskDeliveryArtifacts,
  validateTaskDeliveryArtifacts,
} from "./task-delivery-artifacts";
import { parseTaskWorkspace } from "../../src/features/tasks/model/taskWorkspace";
import { errorMessage } from "../sessions/sessionRuns";
import { hasShellPhysicalOwner } from "../execution/shell-ownership";
import { previewTaskFinalization, suspendedTaskDelivery } from "./task-workspace-runtime";
import type { WorkspaceOwnerAuthorization } from "../workspaces/workspace-service-contracts";
import type { WorkspaceRpcRequest } from "../workspaces/workspace-rpc-contracts";
import type { BranchMergeReceipt } from "../workspaces/workspace-contracts";
import type { TaskContext } from "./context";
import {
  conflictChildAdmitted,
  conflictStopGeneration,
  conflictStopHeld,
  recoverCommittedConflict,
} from "./conflict-recovery";
export async function retarget(
  context: TaskContext,
  id: string,
  raw: unknown,
  autoMerge?: unknown,
  owner?: WorkspaceOwnerAuthorization,
): Promise<HostTask> {
  await context.ready;

  const task = await context.get(id);
  const expected = await context.taskValue(id);
  if (!task || task.status !== "review" || !hasUnmergedBranch(task))
    throw new Error("Only a reviewed branch can change its delivery target.");
  if (context.delivering.has(id)) throw new Error("Wait for the current delivery to finish.");
  if (autoMerge !== undefined && typeof autoMerge !== "boolean")
    throw new Error("Invalid merge option");
  if (raw === undefined && autoMerge !== undefined)
    return await context.write({
      ...task,
      autoMerge,
      deliveryApprovalRequired: autoMerge ? undefined : task.deliveryApprovalRequired,
      mergeRetry: undefined,
      updatedAt: context.now(),
    });
  const workspace = parseTaskWorkspace(raw);
  const project = await context.store.project(task.projectId);
  const target = await taskWorkspace(
    project.cwd,
    workspace ?? {
      checkoutCwd: task.deliveryCwd,
      baseBranch: task.baseBranch,
    },
  );
  if (workspace?.branchName || target.cwd === task.worktreeCwd)
    throw new Error("Choose a delivery worktree separate from the task branch");
  if ((await context.get(id))?.updatedAt !== task.updatedAt)
    throw new Error("Task changed; refresh before choosing a target.");
  const selected = { checkoutCwd: target.cwd, baseBranch: target.branch };
  if (task.workspaceId) {
    if (!context.managed?.retargetWorkspace || !owner)
      throw new Error(
        "Update this host to retarget a managed workspace with authenticated owner approval.",
      );
    const registered = await context.managed.registry.get({ workspaceId: task.workspaceId });
    if (!registered) throw new Error("Managed task workspace is unavailable.");
    await context.store.db.checkAuthorization();
    const changed = await context.managed.retargetWorkspace(
      {
        workspaceId: registered.id,
        expectedRevision: registered.revision,
        idempotencyKey: `task-retarget:${task.id}:${registered.revision}:${target.branch}`,
        targetBranchRef: `refs/heads/${target.branch}`,
        targetDirectory: target.cwd,
      },
      owner,
    );
    if (
      changed.id !== registered.id ||
      changed.branchRef !== registered.branchRef ||
      changed.targetBranchRef !== `refs/heads/${target.branch}` ||
      changed.revision <= registered.revision
    )
      throw new Error("The registry did not record the selected delivery target.");
  }
  return await context.transaction(async () => {
    if (!(await context.unchangedTask(id, expected)))
      throw new Error("Task changed; refresh the recorded workspace target.");
    // Pending dependent work must inherit the same integration target.
    if (task.goalId) {
      for (const pending of await context.list())
        if (
          pending.goalId === task.goalId &&
          pending.projectId === task.projectId &&
          ["todo", "queued"].includes(pending.status) &&
          !pending.startedAt &&
          !pending.branch
        )
          await context.write({ ...pending, workspace: selected, updatedAt: context.now() });
      const goal = await context.owningGoal(task.goalId);
      if (goal) {
        await context.store.db.checkAuthorization();
        await context.store.db.prepare("UPDATE goals SET value=? WHERE id=?").run(
          JSON.stringify({
            ...goal,
            workspaces: { ...goal.workspaces, [task.projectId]: selected },
            updatedAt: context.now(),
          }),
          task.goalId,
        );
      }
    }
    return await context.write({
      ...task,
      deliveryCwd: target.cwd,
      baseBranch: target.branch,
      workspace: { ...task.workspace, ...selected },
      mergeError: undefined,
      mergeRetry: undefined,
      ...(autoMerge !== undefined
        ? {
            autoMerge: autoMerge as boolean,
            ...(autoMerge ? { deliveryApprovalRequired: undefined } : {}),
            ...(!autoMerge ? { deliveryRequested: undefined } : {}),
          }
        : {}),
      updatedAt: context.now(),
    });
  });
}

export async function finalizationPreview(
  context: TaskContext,
  id: string,
): Promise<TaskFinalizationPreview> {
  const task = await context.get(id);
  if (!task?.branch || !task.worktreeCwd)
    throw new Error("This task has no materialized branch to finalize.");
  return previewTaskFinalization(task.worktreeCwd, task.branch);
}

export async function requireFinalized(
  context: TaskContext,
  task: HostTask,
  cwd: string,
): Promise<void> {
  const preview = await previewTaskFinalization(cwd, task.branch!);
  const latest = await context.find(task.id);
  if (!latest || latest.updatedAt !== task.updatedAt)
    throw new Error("Task changed during finalization.");
  await context.write({ ...latest, finalization: preview });
  if (!preview.clean)
    throw new Error(
      "Finalization requires review: uncommitted task changes remain. Inspect the finalization preview, commit only the intended files on the assigned branch, and retry. The Host did not stage or commit any files.",
    );
}

export async function stopWorkspaceActivity(context: TaskContext, task: HostTask): Promise<void> {
  if (await hasShellPhysicalOwner(context.store, "task", task.id)) return;
  if (context.managed && task.workspaceActivityId) {
    await context.store.db.checkAuthorization();
    await context.managed.activity.stop(task.workspaceActivityId);
  }
}

export async function recoverMerge(
  context: TaskContext,
  task: HostTask,
  _now: number,
  _auto = true,
): Promise<void> {
  if (!task.autoMerge && !task.deliveryRequested) return;
  const parentId = task.conflictParent?.id;
  const parentFence = parentId ? conflictStopGeneration(parentId) : undefined;
  if (
    !context.managed?.automaticDelivery ||
    !task.workspaceId ||
    task.completedWithFindings ||
    task.reviewNotes?.some((note) => note.kind === "finding" && note.resolvedAt === undefined) ||
    task.verification?.review?.verdict !== "pass" ||
    autoMergeBlocker(task)
  ) {
    const current = await context.get(task.id);
    if (current?.status === "review" && current.updatedAt === task.updatedAt)
      await context.write({ ...suspendedTaskDelivery(current), mergeRetry: undefined });
    return;
  }
  try {
    const plan = await reviewDelivery(context, task.id);
    const current = await context.get(task.id);
    if (current && (current.conflictRecovery || plan.committedConflict)) {
      await recoverCommittedConflict(context, current, plan);
      return;
    }
    if (
      !current ||
      !(await conflictChildAdmitted(context, current)) ||
      current.status !== "review" ||
      current.workspaceId !== plan.workspaceId ||
      current.completedWithFindings ||
      current.reviewNotes?.some(
        (note) => note.kind === "finding" && note.resolvedAt === undefined,
      ) ||
      current.verification?.review?.verdict !== "pass" ||
      autoMergeBlocker(current) ||
      plan.action !== "merge" ||
      plan.blockers.length
    )
      throw new Error(
        "Automatic delivery requires a current passing review and an unblocked plan.",
      );
    // Persist the fallback before handing off. An interrupted or unknown receipt is never replayed.
    const pending = await context.write({
      ...suspendedTaskDelivery(current),
      mergeRetry: undefined,
      updatedAt: context.now(),
    });
    const expected = await context.taskValue(task.id);
    const controller = new AbortController();
    context.automaticDeliveryControllers.get(task.id)?.abort();
    context.automaticDeliveryControllers.set(task.id, controller);
    const valid = () =>
      !controller.signal.aborted &&
      !context.closing &&
      (!parentId ||
        (!conflictStopHeld(parentId) && conflictStopGeneration(parentId) === parentFence)) &&
      !(pending.goalId && context.pausedGoals.has(pending.goalId));
    try {
      await context.managed.automaticDelivery(
        pending,
        plan,
        async (owner) => {
          const latest = await context.unchangedTask(task.id, expected);
          if (
            !valid() ||
            !latest ||
            !(await conflictChildAdmitted(context, latest)) ||
            latest.updatedAt !== pending.updatedAt ||
            latest.status !== "review" ||
            (latest.goalId && context.pausedGoals.has(latest.goalId)) ||
            (context.assistantTaskAdmission && !(await context.assistantTaskAdmission(latest))) ||
            latest.workspaceId !== plan.workspaceId ||
            latest.completedWithFindings ||
            latest.reviewNotes?.some(
              (note) => note.kind === "finding" && note.resolvedAt === undefined,
            ) ||
            latest.verification?.review?.verdict !== "pass" ||
            autoMergeBlocker(latest)
          )
            throw new Error("Task changed after automatic delivery review.");
          return mergeDelivery(
            context,
            task.id,
            {
              workspaceId: plan.workspaceId,
              expectedRevision: plan.expectedRevision,
              idempotencyKey: `task-auto-delivery:${task.id}:${plan.token}`,
              planToken: plan.token,
            },
            owner,
          );
        },
        { signal: controller.signal, valid },
      );
    } finally {
      if (context.automaticDeliveryControllers.get(task.id) === controller)
        context.automaticDeliveryControllers.delete(task.id);
    }
  } catch (error) {
    const latest = await context.get(task.id);
    if (latest && latest.status === "review" && !latest.merged && !latest.deliveryApprovalRequired)
      await context.write({ ...suspendedTaskDelivery(latest), mergeError: errorMessage(error) });
  }
}

export async function reviewDelivery(
  context: TaskContext,
  id: string,
): Promise<TaskDeliveryReview> {
  const task = await context.get(id);
  if (!task?.workspaceId || !context.managed)
    throw new Error("Update this host to review managed task delivery.");
  const workspace = await context.managed.registry.get({ workspaceId: task.workspaceId });
  if (!workspace) throw new Error("The task workspace is unavailable.");
  const plan = await context.managed.delivery.review({
    workspaceId: workspace.id,
    expectedRevision: workspace.revision,
    action: "merge",
  });
  if (workspace.directoryState === "removed") return plan;
  const targetDirectory =
    (plan as typeof plan & { targetDirectory?: string }).targetDirectory ??
    task.deliveryCwd ??
    (await context.store.project(task.projectId)).cwd;
  const artifacts = await previewTaskDeliveryArtifacts(workspace.path, targetDirectory);
  const latest = await context.get(id);
  if (!latest || latest.workspaceId !== workspace.id || latest.updatedAt !== task.updatedAt)
    throw new Error("Task changed while reviewing its delivery artifacts.");
  if (
    artifacts.paths.length ||
    artifacts.blockers.length ||
    task.artifactDeliveryPending ||
    task.deliveryArtifacts
  ) {
    await context.write({
      ...latest,
      deliveryArtifacts: {
        ...artifacts,
        planToken: plan.token,
        sourceHead: plan.sourceHead,
        targetDirectory,
      },
    });
    return { ...plan, artifacts, blockers: [...plan.blockers, ...artifacts.blockers] };
  }
  return plan;
}

export async function mergeDelivery(
  context: TaskContext,
  id: string,
  request: WorkspaceRpcRequest<"workspaces.delivery.merge">,
  owner: WorkspaceOwnerAuthorization,
): Promise<HostTask> {
  const task = await context.get(id);
  if (!task?.workspaceId || !context.managed || request.workspaceId !== task.workspaceId)
    throw new Error("The delivery plan does not belong to this task.");
  if (!["review", "done"].includes(task.status))
    throw new Error("Finish task verification before delivery.");
  // A task finished with open findings has no PASS by design; this owner-
  // authorized delivery is the explicit approval its notices ask for.
  const blocker = task.completedWithFindings ? undefined : autoMergeBlocker(task);
  if (blocker) throw new Error(blocker);
  if (context.delivering.has(id)) throw new Error("This task is already being delivered.");
  context.delivering.add(id);
  try {
    const artifacts = task.deliveryArtifacts;
    if (artifacts) {
      if (artifacts.planToken !== request.planToken || !task.worktreeCwd)
        throw new Error("Review task artifacts again before delivery.");
      const previous = await context.managed.registry.findOperation({
        workspaceId: task.workspaceId,
        kind: "delivery",
        idempotencyKey: request.idempotencyKey,
      });
      await validateTaskDeliveryArtifacts(artifacts, task.worktreeCwd, artifacts.targetDirectory, {
        allowCopied: previous?.kind === "delivery" && Boolean(previous.merge),
      });
    }
    const receipt = await context.managed.delivery.merge(request, owner);
    const latest = await context.get(id);
    if (
      !latest ||
      latest.workspaceId !== task.workspaceId ||
      latest.status !== task.status ||
      context.automaticDeliveryControllers.get(id)?.signal.aborted
    )
      throw new Error("Task changed during delivery; the workspace receipt is retained.");
    return await context.finishDeliveryReceipt(latest, receipt, request.planToken);
  } finally {
    context.delivering.delete(id);
  }
}

export async function finishDeliveryReceipt(
  context: TaskContext,
  task: HostTask,
  receipt: BranchMergeReceipt,
  planToken: string,
): Promise<HostTask> {
  const controller = context.automaticDeliveryControllers.get(task.id);
  const write = (value: HostTask) => {
    if (
      controller &&
      (controller.signal.aborted ||
        context.closing ||
        (task.goalId && context.pausedGoals.has(task.goalId)))
    )
      throw new Error("Task stopped during delivery; the workspace receipt is retained.");
    return context.write(value);
  };
  const delivered: HostTask = {
    ...task,
    status: "review",
    merged: true,
    deliveredCommit: receipt.targetHead,
    mergedAt: context.now(),
    deliveryState: "merged",
    deliveryOperationId: receipt.operationId,
    deliveryApprovalRequired: undefined,
    mergeError: undefined,
    updatedAt: context.now(),
  };
  await write(delivered);
  const target =
    task.deliveryArtifacts?.targetDirectory ??
    task.deliveryCwd ??
    (await context.store.project(task.projectId)).cwd;
  if (!task.worktreeCwd)
    return write(
      task.artifactDeliveryPending
        ? {
            ...delivered,
            artifactDeliveryPending: true,
            mergeError: "The artifact source is unavailable; the Git receipt is retained.",
          }
        : { ...delivered, status: "done" },
    );
  let activityId = task.artifactDeliveryActivityId;
  try {
    activityId ??= (
      await context.managed!.activity.start({
        workspaceId: task.workspaceId!,
        kind: "operation",
        ownerId: `task-artifacts:${receipt.operationId}`,
      })
    ).id;
    await write({
      ...delivered,
      artifactDeliveryPending: true,
      artifactDeliveryActivityId: activityId,
    });
    const preview = await previewTaskDeliveryArtifacts(task.worktreeCwd, target);
    if (preview.blockers.length) throw new Error(preview.blockers.join("; "));
    let artifactPaths: string[] = [];
    const approved = task.deliveryArtifacts;
    if (preview.paths.length) {
      if (
        !approved ||
        approved.planToken !== planToken ||
        approved.sourceHead !== receipt.sourceHead
      ) {
        return write({
          ...delivered,
          artifactDeliveryPending: true,
          artifactDeliveryActivityId: activityId,
          mergeError:
            "The Git receipt is retained. Review local task artifacts before completing delivery.",
        });
      }
      await validateTaskDeliveryArtifacts(approved, task.worktreeCwd, target, {
        allowCopied: true,
      });
      artifactPaths = await transferTaskArtifacts(
        task.worktreeCwd,
        target,
        approved.paths,
        approved.hashes,
      );
    } else if (approved?.paths.length) {
      throw new Error(
        "Reviewed artifact sources disappeared. The Git receipt and directory reservation are retained.",
      );
    }
    const completed = await write({
      ...delivered,
      status: "done",
      artifactDeliveryPending: undefined,
      cleanupError: undefined,
      cleanupRetryAfter: undefined,
      artifactDeliveryActivityId: activityId,
      ...(artifactPaths.length ? { artifactPaths, artifactHashes: approved!.hashes } : {}),
    });
    await context.managed!.activity.stop(activityId);
    return await write({ ...completed, artifactDeliveryActivityId: undefined });
  } catch (error) {
    await write({
      ...delivered,
      artifactDeliveryPending: true,
      artifactDeliveryActivityId: activityId,
      mergeError: `Git delivery is recorded; artifact delivery must resume: ${errorMessage(error)}`,
    });
    // A pending operation retains its activity fence: global retention must not race recovery.
    throw error;
  }
}

export async function reconcileDelivery(
  context: TaskContext,
  workspaceId: string,
): Promise<HostTask | undefined> {
  if (!context.managed) throw new Error("Managed task delivery is unavailable.");
  const workspace = await context.managed.registry.get({ workspaceId });
  if (
    !workspace ||
    workspace.owner.kind !== "task" ||
    !["finished", "merged"].includes(workspace.state)
  )
    return;
  const task = await context.get(workspace.owner.id);
  if (!task || task.workspaceId !== workspace.id || !["review", "done"].includes(task.status))
    return;
  const operations = await context.managed.registry.listOperations(workspace.id);
  const delivery = operations.find(
    (entry) =>
      entry.kind === "delivery" &&
      entry.phase === "complete" &&
      workspace.state === "merged" &&
      entry.merge?.targetHead === workspace.deliveredCommit,
  );
  if (!delivery || delivery.kind !== "delivery" || !delivery.merge) {
    const publication = operations.find(
      (entry) =>
        entry.kind === "delivery" &&
        entry.phase === "complete" &&
        entry.plan.action === "publish" &&
        entry.publication?.status === "complete" &&
        entry.expectedRevision === workspace.revision,
    );
    if (!publication || publication.kind !== "delivery") return task;
    return context.write({
      ...task,
      status: "done",
      deliveryState: "published",
      deliveryOperationId: publication.id,
      deliveryApprovalRequired: undefined,
      updatedAt: context.now(),
    });
  }
  return context.finishDeliveryReceipt(task, delivery.merge, delivery.plan.token);
}

export async function cleanupDelivered(
  context: TaskContext,
  task: HostTask,
  now: number,
): Promise<HostTask> {
  if (!task.workspaceId || !context.managed || (task.cleanupRetryAfter ?? 0) > now) return task;
  try {
    const workspace = await context.managed.registry.get({ workspaceId: task.workspaceId });
    if (!workspace || workspace.directoryState === "removed") return task;
    if (task.artifactDeliveryPending)
      throw new Error("Task artifacts have not been delivered; the source directory is retained.");
    const target =
      task.deliveryArtifacts?.targetDirectory ??
      task.deliveryCwd ??
      (await context.store.project(task.projectId)).cwd;
    const artifacts = await previewTaskDeliveryArtifacts(workspace.path, target);
    if (artifacts.blockers.length) throw new Error(artifacts.blockers.join("; "));
    if (artifacts.paths.length) {
      if (!task.deliveryArtifacts)
        throw new Error(
          "Ignored task outputs require an owner-reviewed delivery before retirement.",
        );
      await validateTaskDeliveryArtifacts(task.deliveryArtifacts, workspace.path, target, {
        allowCopied: true,
      });
      if (
        artifacts.paths.some(
          (path) => artifacts.targetHashes[path] !== task.deliveryArtifacts!.hashes[path],
        )
      )
        throw new Error(
          "Task artifacts are not safely delivered; the source directory is retained.",
        );
    }
    const plan = await context.managed.removal.plan({
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
    });
    if (plan.blockers.length || plan.dirty) return task;
    await context.managed.removal.apply(
      {
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
        idempotencyKey: `task-retire:${task.id}:${plan.token}`,
        planToken: plan.token,
      },
      { kind: "retentionScheduler" },
    );
    return context.write({
      ...task,
      worktreeCwd: undefined,
      cleanupError: undefined,
      cleanupRetryAfter: undefined,
    });
  } catch (error) {
    return context.write({
      ...task,
      cleanupError: errorMessage(error),
      cleanupRetryAfter: now + 2 * 60000,
    });
  }
}

export async function discard(context: TaskContext, task: HostTask): Promise<void> {
  if (!task.workspaceId || !context.managed)
    throw new Error(
      "This legacy branch is retained. Register it as a managed workspace before directory retirement.",
    );
  let workspace = await context.managed.registry.get({ workspaceId: task.workspaceId });
  if (!workspace)
    throw new Error("The managed task workspace is unavailable; its branch is retained.");
  await context.store.db.checkAuthorization();
  workspace = await context.managed.registry.close({
    workspaceId: workspace.id,
    expectedRevision: workspace.revision,
    idempotencyKey: `task-close:${task.id}:${workspace.revision}`,
  });
  const plan = await context.managed.removal.plan({
    workspaceId: workspace.id,
    expectedRevision: workspace.revision,
  });
  if (plan.blockers.length || plan.dirty)
    throw new Error(
      `The task branch is retained. Directory removal blocked: ${plan.blockers.join("; ") || "uncommitted changes"}`,
    );
  await context.store.db.checkAuthorization();
  await context.managed.removal.apply(
    {
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
      idempotencyKey: `task-discard:${task.id}:${plan.token}`,
      planToken: plan.token,
    },
    { kind: "retentionScheduler" },
  );
}
