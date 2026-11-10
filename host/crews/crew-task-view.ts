import type { HostTask } from "../../src/features/tasks/model/hostTasks";

/** Read-view redaction of a crew task: no prompt, feedback, notes, summaries or reviewer instructions. */
export function redactCrewTask(task: HostTask) {
  return {
    ...task,
    prompt: "",
    retryFeedback: undefined,
    reviewNotes: [],
    attemptHistory: task.attemptHistory?.slice(-20).map((attempt) => ({
      attempt: attempt.attempt,
      at: attempt.at,
      workerSessionId: attempt.workerSessionId,
      reviewerSessionId: attempt.reviewerSessionId,
      verdict: attempt.verdict,
      reviewOnly: attempt.reviewOnly,
      workerSummary: "",
      note: "",
      findings: [],
    })),
    reviewerConfig: task.reviewerConfig ? { ...task.reviewerConfig, instructions: "" } : undefined,
    verification: task.verification
      ? {
          ...task.verification,
          command: task.verification.command
            ? {
                ...task.verification.command,
                output: task.verification.command.output.slice(0, 1000),
              }
            : undefined,
        }
      : undefined,
  };
}
