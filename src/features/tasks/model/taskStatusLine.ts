import { t } from "../../../shared/i18n";
import type { HostTask, TaskOwnerNotice } from "./hostTasks";
import { MAX_TASK_REPAIR_ATTEMPTS, taskRequiresInstructions } from "./taskRules";
import {
  taskAwaitsRestart,
  taskNeedsInput,
  type TaskStop,
} from "../../../shared/model/host-contracts/task-stop";
import { firstSentence, taskStopSummary } from "../../../shared/model/taskStopSummary";

export { firstSentence };

export type TaskStatusKind =
  | "todo"
  | "queued"
  | "waiting"
  | "running"
  | "stalled"
  | "verifying"
  | "correcting"
  | "takeover"
  | "needs_input"
  | "needs_instructions"
  | "finished"
  | "finished_with_notes"
  | "done"
  | "delivery_blocked"
  | "budget_stop"
  | "stopped_by_owner"
  | "awaiting_restart"
  | "external_check"
  | "correction_limit"
  | "correction_stalled"
  | "interrupted"
  | "review_failed"
  | "checks_failed"
  | "failed"
  | "blocked"
  | "unrecorded";

export type TaskStatusTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

/** Plain board states already named by their column; exceptional states keep their own line. */
export const QUIET_TASK_STATUS: ReadonlySet<TaskStatusKind> = new Set([
  "todo",
  "queued",
  "running",
  "finished",
  "done",
  "blocked",
]);

export type TaskStatusLine = {
  kind: TaskStatusKind;
  tone: TaskStatusTone;
  /** Translated, short state label. */
  label: string;
  /** One clamped sentence explaining the state, when there is one. */
  detail?: string;
  /** Owner notices to show after completion; zero while the task is unfinished. */
  notices: number;
};

/** Notices the owner should read once the task has finished. */
export function finishedOwnerNotices(task: HostTask): readonly TaskOwnerNotice[] {
  return task.status === "review" || task.status === "done" ? (task.ownerNotices ?? []) : [];
}

function correctionLabel(task: HostTask): string {
  const attempt = task.repairAttempts ?? 0;
  return t("Auto-correcting {p0}/{p1}", {
    p0: Math.min(attempt, MAX_TASK_REPAIR_ATTEMPTS),
    p1: MAX_TASK_REPAIR_ATTEMPTS,
  });
}

/** One concise, owner-facing line for a task's current state. The board card,
 * list row and detail header all read it, so a state is named the same everywhere. */
export function taskStatusLine(task: HostTask): TaskStatusLine {
  const line = (
    kind: TaskStatusKind,
    tone: TaskStatusTone,
    label: string,
    detail?: string,
    notices = 0,
  ): TaskStatusLine => ({ kind, tone, label, ...(detail ? { detail } : {}), notices });
  const active =
    task.status === "queued" || task.status === "running" || task.status === "verifying";

  const summary = taskStopSummary(task);
  if (active && taskNeedsInput(task)) return line("needs_input", "warning", t("Needs input"));
  if (task.status === "queued" && task.wait && summary)
    return line("waiting", "neutral", summary.title, summary.reason);
  if (task.stop && taskAwaitsRestart(task) && summary)
    return line("awaiting_restart", "info", summary.title, summary.reason);
  if (task.status !== "blocked" && taskRequiresInstructions(task))
    return line(
      "needs_instructions",
      "warning",
      t("Waiting for your instructions"),
      firstSentence(task.blockedTakeover?.blocker ?? task.error),
    );

  if (
    task.status === "running" &&
    task.runStall &&
    task.runStall.runId === task.runId &&
    task.runStall.sessionId === task.sessionId &&
    task.runStall.detectedAt - task.runStall.lastActivityAt >= 15 * 60_000
  )
    return line(
      "stalled",
      "warning",
      t("Running · no recent output"),
      t("No output observed for at least 15 minutes. The task is still running."),
    );
  switch (task.status) {
    case "todo":
      return line("todo", "neutral", t("To do"));
    case "queued":
    case "running":
      if (task.repairAdvisor)
        return line("queued", "neutral", t("Queued"), t("Waiting for advisor"));
      if (task.blockedTakeover)
        return line(
          "takeover",
          "accent",
          t("Independent AI completing blocked work"),
          firstSentence(task.blockedTakeover.blocker),
        );
      if ((task.repairAttempts ?? 0) > 0)
        return line("correcting", "accent", correctionLabel(task), firstSentence(task.repairNote));
      return task.status === "queued"
        ? line("queued", "neutral", t("Queued"))
        : line("running", "accent", t("Running"));
    case "verifying":
      return line(
        "verifying",
        "accent",
        (task.repairAttempts ?? 0) > 0
          ? t("Verifying · correction {p0}", { p0: task.repairAttempts })
          : t("Verifying"),
      );
    case "review":
    case "done": {
      if (task.mergeError)
        return line(
          "delivery_blocked",
          "danger",
          t("Delivery is blocked"),
          firstSentence(task.mergeError),
        );
      const notices = finishedOwnerNotices(task).length;
      if (notices > 0 || task.completedWithFindings)
        return line(
          "finished_with_notes",
          task.completedWithFindings ? "warning" : "success",
          notices > 0
            ? t(notices === 1 ? "Completed · {p0} note" : "Completed · {p0} notes", { p0: notices })
            : t("Completed with open findings"),
          undefined,
          notices,
        );
      return task.status === "done"
        ? line("done", "success", t("Done"))
        : line("finished", "success", t("Completed"));
    }
    case "blocked":
      break;
  }

  // Blocked: the stop code names the reason; nothing here reads `error` text.
  const { stop } = task;
  if (!stop || !summary) return line("unrecorded", "neutral", t("Blocked"), summary?.reason);
  if (task.mergeError && (stop.code === "run_failed" || stop.code === "host_interrupted"))
    return line(
      "delivery_blocked",
      "danger",
      t("Delivery is blocked"),
      firstSentence(task.mergeError),
    );
  return line(stopKind(stop), summary.tone, summary.title, summary.reason);
}

function stopKind(stop: TaskStop): TaskStatusKind {
  if (stop.nextAction === "restart") return "awaiting_restart";
  if (stop.nextAction === "takeover") return "takeover";
  if (stop.code === "run_failed" && stop.nextAction === "provide_input")
    return "needs_instructions";
  switch (stop.code) {
    case "owner_stopped":
      return "stopped_by_owner";
    case "budget_exhausted":
      return "budget_stop";
    case "repair_exhausted":
      return stop.repair === "external"
        ? "external_check"
        : stop.repair === "no_progress"
          ? "correction_stalled"
          : "correction_limit";
    case "input_required":
      return "needs_instructions";
    case "permission_required":
      return "needs_input";
    case "host_interrupted":
      return "interrupted";
    case "run_failed":
      return stop.phase === "review"
        ? "review_failed"
        : stop.phase === "check"
          ? "checks_failed"
          : "failed";
    case "dependency_cycle":
    case "dependency_stopped":
      return "blocked";
    default:
      return "failed";
  }
}
