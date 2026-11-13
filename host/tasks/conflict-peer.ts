import { randomUUID } from "node:crypto";
import type { HostTask, TaskDeliveryReview } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";
import { git } from "./git";
import { conflictStopGeneration, conflictStopHeld } from "./conflict-recovery";

/** Wait for physical retirement, including a later owner run, before re-planning. */
export async function settleConflictPeer(
  context: TaskContext,
  parent: HostTask,
  plan: TaskDeliveryReview,
): Promise<void> {
  const binding = parent.conflictRecovery;
  const intent = binding?.peer;
  if (!binding || !intent) return;
  let session;
  try {
    session = await context.store.session(intent.sessionId);
  } catch {
    return;
  }
  if (session.status !== "idle") return;
  const live = (await context.list(parent.projectId)).some(
    (task) =>
      task.id !== parent.id &&
      task.worktreeCwd === binding.targetDirectory &&
      ["running", "verifying"].includes(task.status),
  );
  if (live) return;
  // Only the freshly reviewed original source and target may complete this attempt.
  if (
    plan.action !== "merge" ||
    plan.committedConflict ||
    plan.blockers.length ||
    plan.sourceHead !== binding.sourceHead ||
    plan.targetDirectory !== binding.targetDirectory ||
    plan.targetBranchRef !== `refs/heads/${binding.targetBranch}`
  )
    throw new Error(
      "Conflict peer retired without an unblocked delivery; owner review is required.",
    );
  const expected = await context.taskValue(parent.id);
  await context.transaction(async () => {
    const latest = await context.unchangedTask(parent.id, expected);
    if (latest?.conflictRecovery?.peer?.commandId === intent.commandId)
      await context.write({
        ...latest,
        conflictRecovery: undefined,
        repairAdvisor: undefined,
        updatedAt: context.now(),
      });
  });
}

/** An exact active target writer gets one durable, guarded message for this repair. */
export async function attemptConflictPeer(
  context: TaskContext,
  parent: HostTask,
  advice: string,
): Promise<boolean> {
  const binding = parent.conflictRecovery;
  if (!binding || binding.peer) return true;
  const candidates = (await context.list(parent.projectId)).filter(
    (task) =>
      task.id !== parent.id &&
      task.worktreeCwd === binding.targetDirectory &&
      ["running", "verifying"].includes(task.status),
  );
  if (!candidates.length) return false;
  // An ambiguous, inaccessible or unguarded active writer holds the attempt.
  if (candidates.length !== 1 || !context.admitCommand) return true;
  const peer = candidates[0];
  if (
    peer.status !== "running" ||
    !Number.isFinite(peer.createdAt) ||
    !peer.sessionId ||
    !peer.runId ||
    !peer.workInvocationId
  )
    return true;
  let record;
  try {
    record = await context.store.session(peer.sessionId);
  } catch {
    return true;
  }
  if (
    record.status !== "running" ||
    record.runId !== peer.runId ||
    record.projectId !== parent.projectId ||
    (record.session.worktreeCwd ?? record.session.cwd) !== binding.targetDirectory
  )
    return true;
  try {
    if (
      (await git(binding.targetDirectory, ["rev-parse", "HEAD"])) !== binding.targetHead ||
      (await git(binding.targetDirectory, ["symbolic-ref", "--quiet", "--short", "HEAD"])) !==
        binding.targetBranch
    )
      return true;
  } catch {
    return true;
  }
  const fence = conflictStopGeneration(parent.id);
  if (conflictStopHeld(parent.id)) return true;
  const intent = {
    taskId: peer.id,
    createdAt: peer.createdAt,
    workInvocationId: peer.workInvocationId,
    sessionId: peer.sessionId,
    runId: peer.runId,
    commandId: `task-conflict-peer:${randomUUID()}`,
  };
  const expected = await context.taskValue(parent.id);
  const saved = await context.transaction(async () => {
    const latest = await context.unchangedTask(parent.id, expected);
    if (
      !latest ||
      latest.status !== "review" ||
      latest.conflictRecovery?.childId !== binding.childId ||
      latest.conflictRecovery.peer ||
      conflictStopHeld(parent.id) ||
      conflictStopGeneration(parent.id) !== fence
    )
      return undefined;
    return context.write({
      ...latest,
      conflictRecovery: { ...latest.conflictRecovery, peer: intent },
      updatedAt: context.now(),
    });
  });
  if (!saved) return true;
  const check = async (stage: { sessionId: string; runId?: string }) => {
    const latest = await context.find(parent.id);
    const current = await context.find(intent.taskId);
    const session = await context.store.session(intent.sessionId);
    if (
      context.closing ||
      conflictStopHeld(parent.id) ||
      conflictStopGeneration(parent.id) !== fence ||
      !latest ||
      latest.createdAt !== parent.createdAt ||
      latest.workInvocationId !== parent.workInvocationId ||
      latest.status !== "review" ||
      latest.conflictRecovery?.peer?.commandId !== intent.commandId ||
      latest.deliveryApprovalRequired ||
      !(latest.autoMerge || latest.deliveryRequested) ||
      !(await context.goalExecutionAllowed(latest.goalId)) ||
      (context.assistantTaskAdmission && !(await context.assistantTaskAdmission(latest))) ||
      !current ||
      current.createdAt !== intent.createdAt ||
      current.workInvocationId !== intent.workInvocationId ||
      current.status !== "running" ||
      !(await context.goalExecutionAllowed(current.goalId)) ||
      (context.assistantTaskAdmission && !(await context.assistantTaskAdmission(current))) ||
      current.sessionId !== intent.sessionId ||
      current.runId !== intent.runId ||
      current.worktreeCwd !== binding.targetDirectory ||
      stage.sessionId !== intent.sessionId ||
      (stage.runId !== undefined && stage.runId !== intent.runId) ||
      session.status !== "running" ||
      session.runId !== intent.runId ||
      session.projectId !== parent.projectId ||
      (session.session.worktreeCwd ?? session.session.cwd) !== binding.targetDirectory ||
      session.session.pendingQuestion ||
      session.session.pendingSwitch ||
      session.session.queuedMessages?.length ||
      session.session.blocks.some(
        (block) => block.draft || (block.approval && !block.approval.decided),
      ) ||
      !latest.worktreeCwd ||
      (await git(latest.worktreeCwd, ["rev-parse", "HEAD"])) !== binding.sourceHead ||
      (await git(binding.targetDirectory, ["rev-parse", "HEAD"])) !== binding.targetHead ||
      (await git(binding.targetDirectory, ["symbolic-ref", "--quiet", "--short", "HEAD"])) !==
        binding.targetBranch ||
      conflictStopHeld(parent.id) ||
      conflictStopGeneration(parent.id) !== fence
    )
      throw new Error("Conflict peer or parent authority changed before dispatch.");
  };
  try {
    await context.taskMessage(saved, "conflict coordination", () =>
      context.admitCommand!({ check }, () =>
        context.engine.command({
          type: "steer",
          commandId: intent.commandId,
          sessionId: intent.sessionId,
          runId: intent.runId,
          text: `Delivery of task ${parent.id} conflicts with your branch. In your own checkout incorporate commit ${binding.sourceHead}, preserve both changes, resolve conflicts and verify. Never change another task's checkout.\n\n${advice}`,
        }),
      ),
    );
  } catch {
    // The command might have reached the peer; retain intent and never replay it.
  }
  return true;
}
