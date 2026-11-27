import { t } from "../../../shared/i18n";

/**
 * Host-side and model-side text that reaches the screen as English source: a bulk-action refusal
 * or a workspace state. Each known sentence maps to its own literal key; anything else (already
 * translated or Host-written text) passes through unchanged.
 */
export function taskStateText(text: string): string {
  switch (text) {
    case "Reconnect this machine before changing its tasks.":
      return t("Reconnect this machine before changing its tasks.");
    case "Stop active work before deleting this task.":
      return t("Stop active work before deleting this task.");
    case "Unmerged work is protected. Review or discard it individually.":
      return t("Unmerged work is protected. Review or discard it individually.");
    case "This task is not running.":
      return t("This task is not running.");
    case "Only tasks in To do can be started.":
      return t("Only tasks in To do can be started.");
    case "Only blocked tasks can be retried.":
      return t("Only blocked tasks can be retried.");
    case "Update this task's instructions before starting it.":
      return t("Update this task's instructions before starting it.");
    case "Implementation finished":
      return t("Implementation finished");
    case "Implementation blocked":
      return t("Implementation blocked");
    case "Implementation in progress":
      return t("Implementation in progress");
    case "Delivery is blocked":
      return t("Delivery is blocked");
    case "Delivered":
      return t("Delivered");
    case "Not delivered":
      return t("Not delivered");
    case "Unavailable":
      return t("Unavailable");
    default:
      return text;
  }
}
