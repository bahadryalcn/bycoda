import type { HostGoal } from "../../../src/features/tasks/model/hostGoals";
import type { HostTask } from "../../../src/features/tasks/model/hostTasks";

export const NO_VERIFICATION = "No verification was recorded.";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One line saying what verification the canonical records actually hold; never claims more. */
export function describeVerification(
  goal: Pick<HostGoal, "finalAcceptance"> | undefined,
  tasks: readonly Pick<HostTask, "verification" | "completedWithFindings">[],
): string {
  const parts: string[] = [];
  const commands = tasks.flatMap((task) =>
    task.verification?.command ? [task.verification.command] : [],
  );
  if (commands.length) {
    const passed = commands.filter((run) => run.exitCode === 0 && !run.timedOut).length;
    parts.push(
      passed === commands.length
        ? `The verify command passed for ${plural(passed, "task")}.`
        : `The verify command failed for ${plural(commands.length - passed, "task")}.`,
    );
  }
  const reviews = tasks.flatMap((task) =>
    task.verification?.review ? [task.verification.review] : [],
  );
  if (reviews.length) {
    const passed = reviews.filter((review) => review.verdict === "pass").length;
    parts.push(
      passed === reviews.length
        ? `Independent review passed for ${plural(passed, "task")}.`
        : `Independent review failed for ${plural(reviews.length - passed, "task")}.`,
    );
  }
  const open = tasks.filter((task) => task.completedWithFindings).length;
  if (open) parts.push(`${plural(open, "task")} finished with open findings.`);
  const final = goal?.finalAcceptance?.status;
  if (final === "passed") parts.push("Final review accepted the integrated result.");
  else if (final === "failed") parts.push("Final review did not accept the integrated result.");
  else if (final) parts.push("Final review has not finished.");
  return parts.join(" ") || NO_VERIFICATION;
}
