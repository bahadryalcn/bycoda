import { randomUUID } from "node:crypto";
import type { HostTask, TaskDeliveryReview } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";
import { MAX_REPAIR_ATTEMPTS } from "./constants";
import { consultRepairAdvisor } from "./recovery";
import { git } from "./git";

// Monotonic in-process fence closes the synchronous Stop-to-persistence gap.
const conflictStopGenerations = new Map<string, number>();
const conflictStopHolds = new Set<string>();
export function fenceConflictChildren(parentId: string): void {
  conflictStopGenerations.set(parentId, conflictStopGeneration(parentId) + 1);
  conflictStopHolds.add(parentId);
}
export function releaseConflictStop(parentId: string, expected: number): void {
  if (conflictStopGeneration(parentId) === expected) conflictStopHolds.delete(parentId);
}
export function conflictStopHeld(parentId: string): boolean {
  return conflictStopHolds.has(parentId);
}
export function conflictStopGeneration(parentId: string): number {
  return conflictStopGenerations.get(parentId) ?? 0;
}

/** A recovery child may only run while its precise parent and both reviewed heads remain current. */
export async function conflictChildAdmitted(
  context: TaskContext,
  child: HostTask,
): Promise<boolean> {
  const binding = child.conflictParent;
  if (!binding) return true;
  if (conflictStopHeld(binding.id)) return false;
  const parent = await context.find(binding.id);
  if (
    !parent ||
    parent.createdAt !== binding.createdAt ||
    parent.workInvocationId !== binding.workInvocationId ||
    parent.status !== "review" ||
    parent.conflictRecovery?.childId !== child.id ||
    parent.conflictRecovery.sourceHead !== binding.sourceHead ||
    parent.conflictRecovery.targetHead !== binding.targetHead ||
    parent.conflictRecovery.targetDirectory !== binding.targetDirectory ||
    parent.conflictRecovery.targetBranch !== binding.targetBranch ||
    parent.deliveryApprovalRequired ||
    !(parent.autoMerge || parent.deliveryRequested) ||
    !parent.worktreeCwd ||
    !(await context.goalExecutionAllowed(parent.goalId)) ||
    (context.assistantTaskAdmission && !(await context.assistantTaskAdmission(parent)))
  )
    return false;
  try {
    return (
      (await git(parent.worktreeCwd, ["rev-parse", "HEAD"])) === binding.sourceHead &&
      (await git(binding.targetDirectory, ["rev-parse", "HEAD"])) === binding.targetHead &&
      (await git(binding.targetDirectory, ["symbolic-ref", "--quiet", "--short", "HEAD"])) ===
        binding.targetBranch
    );
  } catch {
    return false;
  }
}

/** Reserve one repair and advisor identity before creating or launching a recovery child. */
export async function recoverCommittedConflict(
  context: TaskContext,
  task: HostTask,
  plan: TaskDeliveryReview,
): Promise<void> {
  const conflict = plan.committedConflict ?? task.conflictRecovery;
  if (!conflict || !task.worktreeCwd || !task.workInvocationId)
    throw new Error("Committed conflict lacks a stable task, source or target identity.");
  let current = task;
  if (!current.conflictRecovery) {
    if (
      plan.action !== "merge" ||
      plan.blockers.some(
        (blocker) =>
          blocker !== "Committed branches conflict; resolve in the source and review again",
      )
    )
      throw new Error("Delivery has additional blockers; conflict recovery cannot start.");
    if ((current.repairAttempts ?? 0) >= MAX_REPAIR_ATTEMPTS)
      throw new Error("Automatic correction limit reached; review the committed conflict.");
    if (!plan.targetDirectory || !plan.targetBranchRef.startsWith("refs/heads/"))
      throw new Error("Conflict delivery target checkout or branch is unavailable.");
    const targetDirectory = plan.targetDirectory;
    const targetBranch = plan.targetBranchRef.slice("refs/heads/".length);
    const sessionId = current.sessionId ?? current.verification?.review?.sessionId;
    if (!sessionId) throw new Error("Committed conflict advisor needs the retained task session.");
    const expected = await context.taskValue(current.id);
    const childId = randomUUID();
    const findings = `Resolve committed Git conflict between source ${conflict.sourceHead} and target ${conflict.targetHead}. Preserve both changes and review the result.`;
    const reserved = await context.transaction(async () => {
      const latest = await context.unchangedTask(current.id, expected);
      if (!latest || latest.status !== "review" || latest.conflictRecovery) return undefined;
      return context.write({
        ...latest,
        repairAttempts: (latest.repairAttempts ?? 0) + 1,
        conflictRecovery: {
          childId,
          sourceHead: conflict.sourceHead,
          targetHead: conflict.targetHead,
          targetDirectory,
          targetBranch,
        },
        repairAdvisor: {
          requestId: `task-conflict:${randomUUID()}`,
          sessionId,
          findings,
          feedback: findings,
          error: findings,
          fingerprint: JSON.stringify(conflict),
        },
        updatedAt: context.now(),
      });
    });
    if (!reserved) return;
    current = reserved;
  }
  const binding = current.conflictRecovery!;
  if (
    binding.sourceHead !== conflict.sourceHead ||
    binding.targetHead !== conflict.targetHead ||
    (plan.committedConflict &&
      (plan.targetDirectory !== binding.targetDirectory ||
        plan.targetBranchRef !== `refs/heads/${binding.targetBranch}`))
  )
    throw new Error("Delivery commits changed during conflict recovery; review the new plan.");
  const existing = await context.find(binding.childId);
  if (existing) {
    if (
      existing.conflictParent?.id !== current.id ||
      existing.conflictParent.createdAt !== current.createdAt ||
      existing.conflictParent.workInvocationId !== current.workInvocationId
    )
      throw new Error("Conflict recovery child identity changed.");
    if (existing.status === "done" && existing.merged) {
      const expected = await context.taskValue(current.id);
      await context.transaction(async () => {
        const latest = await context.unchangedTask(current.id, expected);
        if (latest?.conflictRecovery?.childId === existing.id)
          await context.write({
            ...latest,
            conflictRecovery: undefined,
            repairAdvisor: undefined,
            updatedAt: context.now(),
          });
      });
    } else if (
      existing.status === "blocked" ||
      (existing.status === "done" && !existing.merged) ||
      (existing.status === "review" && existing.deliveryApprovalRequired)
    ) {
      throw new Error("Conflict recovery child needs owner review; its work is retained.");
    }
    return;
  }
  if (!current.repairAdvisor) throw new Error("Conflict advisor identity is unavailable.");
  const probe = {
    id: binding.childId,
    conflictParent: {
      id: current.id,
      createdAt: current.createdAt,
      workInvocationId: current.workInvocationId,
      sourceHead: binding.sourceHead,
      targetHead: binding.targetHead,
      targetDirectory: binding.targetDirectory,
      targetBranch: binding.targetBranch,
    },
  } as HostTask;
  if (!(await conflictChildAdmitted(context, probe)))
    throw new Error("Conflict recovery parent or commits changed before consultation.");
  const advice = await consultRepairAdvisor(context, current);
  if (!advice) return;
  const expected = await context.taskValue(current.id);
  await context.transaction(async () => {
    const latest = await context.unchangedTask(current.id, expected);
    if (
      !latest ||
      latest.conflictRecovery?.childId !== binding.childId ||
      (await context.find(binding.childId))
    )
      return;
    const parentBinding = {
      id: latest.id,
      createdAt: latest.createdAt,
      workInvocationId: latest.workInvocationId,
      sourceHead: binding.sourceHead,
      targetHead: binding.targetHead,
      targetDirectory: binding.targetDirectory,
      targetBranch: binding.targetBranch,
    };
    const now = context.now();
    await context.write({
      id: binding.childId,
      title: `Resolve conflict: ${latest.title}`,
      prompt: `In this isolated checkout based on ${binding.targetHead}, merge commit ${binding.sourceHead}. Resolve all conflicts preserving both sides, commit the merge, and run relevant checks. Do not modify the original checkout.\n\n${advice}`,
      projectId: latest.projectId,
      harness: latest.harness,
      model: latest.model,
      modelSettings: latest.modelSettings,
      runtimeMode: latest.runtimeMode,
      maxRunMinutes: latest.maxRunMinutes,
      providerAccountId: latest.providerAccountId,
      modelChoice: latest.modelChoice,
      reviewerConfig: latest.reviewerConfig,
      goalId: latest.goalId,
      workspace: { checkoutCwd: binding.targetDirectory, baseBranch: binding.targetBranch },
      isolate: true,
      review: true,
      autoMerge: true,
      continueUntilDone: false,
      repairAttempts: MAX_REPAIR_ATTEMPTS,
      conflictParent: parentBinding,
      workInvocationId: randomUUID(),
      status: "queued",
      createdAt: now,
      updatedAt: now,
      reviewNotes: [],
    });
    await context.write({ ...latest, repairAdvisor: undefined, updatedAt: now });
  });
}
