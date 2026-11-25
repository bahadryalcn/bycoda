import { t } from "../../../shared/i18n";
import type { TaskColumn } from "./hostTasks";

/** A board column's name in the current language; one literal key per column for the locale check. */
export function columnLabel(column: TaskColumn): string {
  switch (column) {
    case "todo":
      return t("To do");
    case "queued":
      return t("Queued");
    case "running":
      return t("Running");
    case "review":
      return t("Review");
    case "done":
      return t("Done");
    case "blocked":
      return t("Blocked");
  }
}
