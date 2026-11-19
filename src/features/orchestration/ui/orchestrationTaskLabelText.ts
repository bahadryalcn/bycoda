import { t } from "../../../shared/i18n";
import type { OrchestrationTaskLabelCode } from "../model/orchestrationSummary";

export function orchestrationTaskLabelText(code: OrchestrationTaskLabelCode): string {
  return orchestrationTaskLabelTextWith(code, t);
}

export function orchestrationTaskLabelTextWith(
  code: OrchestrationTaskLabelCode,
  t: (message: string) => string,
): string {
  switch (code) {
    case "needsInput":
      return t("Needs input");
    case "saved":
      return t("Saved");
    case "paused":
      return t("Paused");
    case "queued":
      return t("Queued");
    case "working":
      return t("Working");
    case "stopping":
      return t("Stopping");
    case "done":
      return t("Done");
    case "failed":
      return t("Failed");
    case "needsReview":
      return t("Needs review");
    case "interrupted":
      return t("Interrupted");
    case "cancelled":
      return t("Cancelled");
  }
}
