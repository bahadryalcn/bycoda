import type { ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert, type AlertTone } from "../../../shared/ui/Alert";
import { TASK_INPUT_REQUIRED, type HostTask } from "../model/hostTasks";
import { taskRequiresInstructions, taskReviewFailureCount } from "../model/taskRules";
import type { TaskStatusLine, TaskStatusTone } from "../model/taskStatusLine";
import { TaskStatusText } from "./TaskStatusLine";

const ALERT_TONE: Record<TaskStatusTone, AlertTone> = {
  neutral: "info",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-ui-micro text-(--ui-text-muted)">{label}</p>
      <p className="whitespace-pre-wrap break-words text-(--ui-text-secondary)">{children}</p>
    </div>
  );
}

/** The single place in the detail panel that says why a task stopped or what
 * it waits for: the status line's reason, the next step, and every recorded
 * host message behind one disclosure. */
export function TaskStatusReason({ task, status }: { task: HostTask; status: TaskStatusLine }) {
  useLocale();
  const stopped = task.status === "blocked" || status.kind === "delivery_blocked";
  if (!stopped) {
    // Running work stays calm: one muted line, no alarm.
    return status.detail ? <TaskStatusText status={status} className="text-ui-caption" /> : null;
  }
  const nextStep =
    taskRequiresInstructions(task)
      ? t(TASK_INPUT_REQUIRED)
      : status.kind === "takeover" && task.status === "blocked"
        ? t(
            "A fresh AI session will inspect the previous attempts and continue the retained work automatically when capacity is available.",
          )
        : status.kind === "takeover"
          ? t("The recovery agent must pass the original checks and review before delivery.")
          : undefined;
  const failures = taskReviewFailureCount(task);
  const facts: ReactNode[] = [];
  const fact = (key: string, label: string, value: ReactNode | undefined) => {
    if (value !== undefined && value !== "" && value !== null)
      facts.push(
        <Fact key={key} label={label}>
          {value}
        </Fact>,
      );
  };
  fact("error", t("Reason"), task.error);
  fact("merge", t("Delivery"), task.mergeError);
  fact("stop", t("Automatic correction"), task.repairStop?.message);
  fact("budget", t("Run budget"), task.budgetStop);
  fact("blocker", t("Blocker"), task.blockedTakeover?.blocker);
  fact("note", t("Latest finding"), task.repairNote);
  fact("feedback", t("Feedback for the next run"), task.retryFeedback);
  if (task.repairAttempts) fact("attempts", t("Correction runs"), String(task.repairAttempts));
  if (failures) fact("failures", t("Failed reviews"), String(failures));
  return (
    <Alert
      tone={ALERT_TONE[status.tone]}
      title={status.label}
      data-task-status-reason={status.kind}
      className="break-words"
    >
      {status.detail ? <p>{status.detail}</p> : null}
      {nextStep ? <p className="mt-1">{nextStep}</p> : null}
      {facts.length > 0 || task.status === "blocked" ? (
        <details className="mt-1.5 text-ui-caption">
          <summary className="cursor-pointer select-none text-(--ui-text-secondary)">
            {t("Full details")}
          </summary>
          <div className="mt-1.5 space-y-1.5">
            {facts}
            {task.status === "blocked" ? (
              <p className="text-ui-micro text-(--ui-text-muted)">
                {t(
                  "Dependent tasks stay queued until this task passes its checks and is delivered. Independent queued tasks can continue.",
                )}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </Alert>
  );
}
