import { t } from "../../../shared/i18n";
import type { HostTask, TaskOwnerNotice } from "./hostTasks";
import {
  MAX_TASK_REPAIR_ATTEMPTS,
  canTakeOverBlockedTask,
  taskRequiresInstructions,
} from "./taskRules";

/** Host copy for an owner stop (host/sessions/sessionRuns.ts STOPPED_BY_USER). */
const STOPPED_BY_OWNER = "Stopped by you.";
/** Host copy for interrupted or crashed runs. */
const INTERRUPTED = /\binterrupted\b|^Host (?:stopped|restarted)\b|could not be stopped/i;

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
  | "blocked";

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

function stripPrefix(text: string | undefined, prefix: string): string | undefined {
  return text?.startsWith(prefix) ? text.slice(prefix.length) : text;
}

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

  if (active && task.needsInput) return line("needs_input", "warning", t("Needs input"));
  if (task.status === "queued" && task.modelRoutingWait?.reason)
    return line("waiting", "neutral", t("Waiting"), firstSentence(t(task.modelRoutingWait.reason)));
  if (task.status !== "blocked" && taskRequiresInstructions(task))
    return line(
      "needs_instructions",
      "warning",
      t("Waiting for your instructions"),
      firstSentence(task.repairStop?.message ?? task.blockedTakeover?.blocker ?? task.error),
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

  // Blocked: name the specific reason, most actionable first.
  if (task.budgetStop)
    return line(
      "budget_stop",
      "warning",
      t("Run budget reached"),
      firstSentence(stripPrefix(task.budgetStop, "Run budget: ")),
    );
  if (task.error?.trim() === STOPPED_BY_OWNER)
    return line("stopped_by_owner", "neutral", t("Stopped by you"));
  if (canTakeOverBlockedTask(task))
    return line("takeover", "info", t("AI takeover pending"), firstSentence(failureReason(task)));
  if (task.awaitingOwnerRestart)
    return line(
      "awaiting_restart",
      "info",
      t("Ready to restart"),
      t("Instructions or settings changed. Retry to run it again."),
    );
  if (task.repairStop?.reason === "external")
    return line(
      "external_check",
      "warning",
      t("Needs an external check"),
      firstSentence(task.repairStop.message),
    );
  if (task.repairStop?.reason === "no_progress")
    return line(
      "correction_stalled",
      "warning",
      t("Correction stopped · findings unchanged"),
      firstSentence(task.repairStop.message || failureReason(task)),
    );
  if (task.repairStop?.reason === "limit")
    return line(
      "correction_limit",
      "warning",
      t("Correction limit reached"),
      firstSentence(task.repairStop.message || failureReason(task)),
    );
  if (taskRequiresInstructions(task))
    return line(
      "needs_instructions",
      "warning",
      t("Waiting for your instructions"),
      firstSentence(task.blockedTakeover?.blocker ?? failureReason(task)),
    );
  if (task.mergeError)
    return line(
      "delivery_blocked",
      "danger",
      t("Delivery is blocked"),
      firstSentence(task.mergeError),
    );
  if (task.error && INTERRUPTED.test(task.error))
    return line("interrupted", "danger", t("Interrupted"), firstSentence(task.error));
  if (task.verification?.review?.verdict === "fail")
    return line("review_failed", "danger", t("Review failed"), firstSentence(failureReason(task)));
  const command = task.verification?.command;
  if (command && (command.timedOut || command.exitCode !== 0))
    return line("checks_failed", "danger", t("Checks failed"), firstSentence(task.error));
  if (task.error) return line("failed", "danger", t("Failed"), firstSentence(task.error));
  return line("blocked", "neutral", t("Blocked"));
}

function failureReason(task: HostTask): string | undefined {
  return task.verification?.review?.verdict === "fail"
    ? task.verification.review.note || stripPrefix(task.error, "Review failed: ")
    : task.error;
}
