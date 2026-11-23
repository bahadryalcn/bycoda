import { t } from "../../../shared/i18n/core";
import type { TaskStatus } from "./hostTasks";

/** The list's state sections and count chips, in display order: what needs the owner first. */
export const TASK_GROUPS = ["needsYou", "blocked", "running", "todo", "done"] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

/** The fields the grouping reads, so summaries and board rows share one predicate. */
export type GroupableTask = { status: TaskStatus; needsInput?: boolean };

/**
 * One grouping predicate for list sections and count chips. Review, and running or verifying work
 * that waits for input, need the owner. Queued sits with To do but keeps its own status label and
 * actions; Blocked stays its own section. Board columns keep the raw statuses.
 */
export function taskGroup(task: GroupableTask): TaskGroup {
  switch (task.status) {
    case "review":
      return "needsYou";
    case "running":
    case "verifying":
      return task.needsInput ? "needsYou" : "running";
    case "todo":
    case "queued":
      return "todo";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
  }
}

export function taskGroupLabel(group: TaskGroup): string {
  switch (group) {
    case "needsYou":
      return t("Needs you");
    case "blocked":
      return t("Blocked");
    case "running":
      return t("Running");
    case "todo":
      return t("To do");
    case "done":
      return t("Done");
  }
}
