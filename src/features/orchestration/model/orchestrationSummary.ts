import type { OrchestrationRun, TaskStatus } from "./orchestration";
import { sessionNeedsInput, type HarnessId, type Session } from "../../sessions/model/session";

/** Small history projection; never includes prompts, results or credentials. */
export type OrchestrationSummary = {
  status: OrchestrationRun["status"];
  live?: boolean;
  tasks: {
    sessionId: string;
    title: string;
    harness: HarnessId;
    model: string;
    status: TaskStatus;
    needsInput?: boolean;
  }[];
};

export function summarizeOrchestration(
  run: OrchestrationRun,
  sessions: readonly Session[],
): OrchestrationSummary {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return {
    status: run.status,
    live: true,
    tasks: run.tasks.map(({ sessionId, title, harness, model, status }) => ({
      sessionId,
      title,
      harness,
      model,
      status,
      needsInput: !!byId.get(sessionId) && sessionNeedsInput(byId.get(sessionId)!),
    })),
  };
}

/** Status code for a subagent row; the UI translates it at render time. */
export type OrchestrationTaskLabelCode =
  | "needsInput"
  | "saved"
  | "paused"
  | "queued"
  | "working"
  | "stopping"
  | "done"
  | "failed"
  | "needsReview"
  | "interrupted"
  | "cancelled";

export function orchestrationTaskLabelCode(
  task: OrchestrationSummary["tasks"][number],
  summary: OrchestrationSummary,
): OrchestrationTaskLabelCode {
  if (task.needsInput) return "needsInput";
  if (!summary.live && ["running", "cancelling", "queued"].includes(task.status)) return "saved";
  if (summary.status === "paused" && task.status === "queued") return "paused";
  return {
    queued: "queued",
    running: "working",
    cancelling: "stopping",
    completed: "done",
    failed: "failed",
    blocked: "needsReview",
    interrupted: "interrupted",
    cancelled: "cancelled",
  }[task.status];
}
