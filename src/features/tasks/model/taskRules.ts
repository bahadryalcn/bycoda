import type { HostTask, TaskStatus } from "./hostTasks";
/** Shared task rules. This module has no desktop or native runtime dependencies. */

/** Where the user may move a task from each status. Running or verifying to
 * blocked stops the run; anything to queued runs the task again in a fresh
 * session; review to done merges an isolated task's branch. A to-do item
 * goes to done when the owner did it by hand, and a queued task goes back to
 * to-do only while it has not started. */
export const TASK_MOVES: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["queued", "done"],
  queued: ["todo"],
  running: ["blocked"],
  verifying: ["blocked"],
  review: ["done", "queued"],
  done: ["queued", "todo"],
  blocked: ["queued", "todo"],
};

export function canMoveTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_MOVES[from].includes(to);
}

/** A task can be edited while nothing has run or is running for it. */
export function canEditTask(status: TaskStatus): boolean {
  return status === "todo" || status === "queued" || status === "blocked";
}

export const MAX_TASK_REVIEW_FAILURES = 3;

export const TASK_INPUT_REQUIRED =
  "Update the task description before retrying: explain what changed, provide the missing evidence, or revise the requirement.";

export function taskReviewFailureCount(task: HostTask): number {
  if (task.reviewFailureCount !== undefined) return task.reviewFailureCount;
  // Older hosts reset repairAttempts on Retry. Recover the budget from history.
  const history = task.attemptHistory ?? [];
  let failures = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index].verdict === "pass") break;
    if (history[index].verdict === "fail") failures++;
  }
  return failures;
}

export function taskRequiresInstructions(task: HostTask): boolean {
  if (canTakeOverBlockedTask(task)) return false;
  // Only the scheduler queues a takeover; manual retries are checked while blocked.
  if (task.status === "queued" && task.blockedTakeover) return false;
  return (
    ["blocked", "todo", "queued"].includes(task.status) &&
    Boolean(
      task.repairStop ||
      (!task.continueUntilDone &&
        (task.blockedTakeover ||
          (task.status !== "queued" && (task.repairAttempts ?? 0) >= MAX_TASK_REVIEW_FAILURES) ||
          taskReviewFailureCount(task) >= MAX_TASK_REVIEW_FAILURES)),
    )
  );
}

export function canTakeOverBlockedTask(
  task: HostTask & { blockedTakeoverSupported?: boolean },
): boolean {
  if (task.blockedTakeoverSupported === false) return false;
  if (
    task.status !== "blocked" ||
    task.blockedTakeover ||
    task.awaitingOwnerRestart ||
    !task.sessionId
  )
    return false;
  const review = task.verification?.review;
  const command = task.verification?.command;
  return Boolean(
    (review?.verdict === "fail" &&
      review.note !== NO_VERDICT &&
      task.error === `Review failed: ${review.note}`) ||
    (command &&
      !command.timedOut &&
      command.exitCode !== null &&
      command.exitCode !== 0 &&
      task.error === `The check command failed (exit code ${command.exitCode}).`),
  );
}

/** The task has a branch of its own that has not been merged. */
export function hasUnmergedBranch(task: Pick<HostTask, "branch" | "merged">): boolean {
  return Boolean(task.branch) && !task.merged;
}

export const NO_VERDICT = "Reviewer gave no verdict";
