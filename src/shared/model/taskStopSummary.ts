import { t } from "../i18n/core";
import {
  taskAwaitsRestart,
  waitFitsStatus,
  type TaskNextAction,
  type TaskStopCode,
  type TaskStopFields,
  type TaskWaitCode,
} from "./host-contracts/task-stop";

/** The one owner-facing account of why a task is stopped or waiting. Card, list, detail,
 * notifications, the daily summary, Host notes and the assistant (voice, Room) all read it. */

export type TaskStopTone = "neutral" | "info" | "warning" | "danger";

export type TaskStopSummary = {
  /** `unrecorded` is a blocked task saved without a code. */
  code: TaskStopCode | TaskWaitCode | "unrecorded";
  /** Short state label. */
  title: string;
  /** One clamped sentence of detail, when there is one. */
  reason?: string;
  /** What the owner can do next; absent when nothing is expected. */
  action?: string;
  tone: TaskStopTone;
};

/** A task as the summary reads it; any snapshot carrying status, stop and wait fits. */
export type TaskStopSummaryInput = TaskStopFields & { status: string };

/** The first sentence of a host message on one line, clamped to `max` characters. */
export function firstSentence(text: string | undefined, max = 120): string | undefined {
  if (!text) return undefined;
  const line = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return undefined;
  const end = line.search(/[.!?](?:\s|$)/);
  const sentence = end >= 0 ? line.slice(0, end + 1) : line;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

function stopTitle(code: TaskStopCode, phase?: string, repair?: string): string {
  switch (code) {
    case "owner_stopped":
      return t("Stopped by you");
    case "host_interrupted":
      return t("Interrupted");
    case "budget_exhausted":
      return t("Run budget reached");
    case "run_failed":
      return phase === "review"
        ? t("Review failed")
        : phase === "check"
          ? t("Checks failed")
          : t("Failed");
    case "repair_exhausted":
      return repair === "external"
        ? t("Needs an external check")
        : repair === "no_progress"
          ? t("Correction stopped · findings unchanged")
          : t("Correction limit reached");
    case "preparation_failed":
      return t("Could not prepare");
    case "permission_required":
      return t("Needs permission");
    case "input_required":
      return t("Waiting for your instructions");
    case "dependency_cycle":
      return t("Dependency cycle");
    case "dependency_stopped":
      return t("Dependency stopped");
    case "crew_unavailable":
      return t("Crew unavailable");
    case "working_copy_changed":
      return t("Working copy changed");
    case "cleanup_failed":
      return t("Cleanup failed");
    case "restored":
      return t("Restored");
    case "scheduling_failed":
      return t("Could not be scheduled");
  }
}

function waitTitle(code: TaskWaitCode): string {
  switch (code) {
    case "model_quota":
      return t("Waiting for model quota");
    case "usage_limit":
      return t("Waiting for usage limit");
    case "daily_limit":
      return t("Daily limit reached");
    case "crew_capacity":
      return t("Waiting for crew capacity");
    case "dependency":
      return t("Waiting for a dependency");
    case "assistant_hold":
      return t("On hold for the assistant");
  }
}

function actionText(action: TaskNextAction): string | undefined {
  switch (action) {
    case "retry":
      return t("Retry the task");
    case "takeover":
      return t("Let an independent AI finish it");
    case "raise_budget":
      return t("Raise the budget");
    case "provide_input":
      return t("Update the instructions");
    case "fix_dependency":
      return t("Fix or remove the dependency");
    case "restart":
      return t("Retry to run it again");
    case "none":
      return undefined;
  }
}

const STOP_TONE: Record<TaskStopCode, TaskStopTone> = {
  owner_stopped: "neutral",
  host_interrupted: "danger",
  budget_exhausted: "warning",
  run_failed: "danger",
  repair_exhausted: "warning",
  preparation_failed: "danger",
  permission_required: "warning",
  input_required: "warning",
  dependency_cycle: "danger",
  dependency_stopped: "warning",
  crew_unavailable: "danger",
  working_copy_changed: "warning",
  cleanup_failed: "danger",
  restored: "info",
  scheduling_failed: "danger",
};

/** Title, reason and action for a task's stop or wait; undefined when it has neither. */
export function taskStopSummary(task: TaskStopSummaryInput): TaskStopSummary | undefined {
  const { stop, wait } = task;
  if (stop) {
    const code = stop.code;
    if (taskAwaitsRestart(task))
      return {
        code,
        title: t("Ready to restart"),
        reason: t("Instructions or settings changed. Retry to run it again."),
        action: actionText("restart"),
        tone: "info",
      };
    if (stop.nextAction === "takeover")
      return {
        code,
        title: t("AI takeover pending"),
        reason: firstSentence(stop.message),
        action: actionText("takeover"),
        tone: "info",
      };
    // A live task paused on a question or approval is not "waiting for instructions".
    const asking = code === "input_required" && task.status !== "blocked";
    // A failure the owner can only resolve by changing the instructions reads as that request.
    const instructions = code === "run_failed" && stop.nextAction === "provide_input";
    return {
      code,
      title: asking
        ? t("Needs input")
        : instructions
          ? t("Waiting for your instructions")
          : stopTitle(code, stop.phase, stop.repair),
      reason: firstSentence(stop.message),
      action: actionText(stop.nextAction),
      tone: STOP_TONE[code],
    };
  }
  if (wait && waitFitsStatus({ status: task.status, wait })) {
    const reason =
      wait.code === "dependency" && wait.waitsOn?.code
        ? t("Dependency: {p0}", { p0: stopTitle(wait.waitsOn.code) })
        : firstSentence(wait.message);
    return { code: wait.code, title: waitTitle(wait.code), reason, tone: "neutral" };
  }
  if (task.status === "blocked")
    return {
      code: "unrecorded",
      title: t("Blocked"),
      reason: t("Reason not recorded"),
      tone: "neutral",
    };
  return undefined;
}

/** One line for plain-text surfaces (notes, voice, Room, notifications): "Title: reason". */
export function summaryText(summary: TaskStopSummary): string {
  return summary.reason ? `${summary.title}: ${summary.reason}` : summary.title;
}

/** `summaryText` of a task's stop or wait; undefined when it has neither. */
export function taskStopText(task: TaskStopSummaryInput): string | undefined {
  const summary = taskStopSummary(task);
  return summary ? summaryText(summary) : undefined;
}
