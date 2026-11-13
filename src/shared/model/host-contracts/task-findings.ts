/** A failed review without a usable verdict cannot authorize completion. */
export const NO_VERDICT = "Reviewer gave no verdict";

type TaskFindingsCandidate = {
  status: string;
  sessionId?: string;
  mergeRepair?: unknown;
  awaitingOwnerRestart?: boolean;
  merged?: boolean;
  error?: string;
  verification?: {
    review?: { verdict: string; note: string };
    command?: { timedOut: boolean; exitCode: number | null };
  };
};

/** Portable eligibility only; the Host still verifies authority and exact run retirement. */
export function canFinishTaskWithFindings(task: TaskFindingsCandidate): boolean {
  if (
    task.status !== "blocked" ||
    !task.sessionId ||
    task.mergeRepair ||
    task.awaitingOwnerRestart ||
    task.merged
  )
    return false;
  const { review, command } = task.verification ?? {};
  return Boolean(
    (review?.verdict === "fail" &&
      review.note !== NO_VERDICT &&
      review.note.trim() !== "" &&
      task.error === `Review failed: ${review.note}`) ||
    (command &&
      command.timedOut === false &&
      command.exitCode !== null &&
      Number.isInteger(command.exitCode) &&
      command.exitCode !== 0 &&
      task.error === `The check command failed (exit code ${command.exitCode}).`),
  );
}
