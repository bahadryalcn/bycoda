import { t } from "../../../shared/i18n";
import type { GoalStatus } from "./hostGoals";
import type { HostSprint } from "./hostSprints";
import type { StewardRunStatus } from "./hostStewards";
import type { TaskStatus } from "./hostTasks";

// One literal key per status, so the locale check sees every label.

export function goalStatusLabel(status: GoalStatus): string {
  switch (status) {
    case "planning":
      return t("Planning");
    case "awaiting-approval":
      return t("Plan ready");
    case "running":
      return t("Running");
    case "done":
      return t("Done");
    case "blocked":
      return t("Blocked");
    case "cancelled":
      return t("Cancelled");
  }
}

export function stewardStatusLabel(status: StewardRunStatus): string {
  switch (status) {
    case "running":
      return t("Running");
    case "succeeded":
      return t("Succeeded");
    case "failed":
      return t("Failed");
    case "skipped":
      return t("Skipped");
    case "cancelled":
      return t("Stopped");
  }
}

export function sprintStateLabel(state: HostSprint["state"]): string {
  switch (state) {
    case "planned":
      return t("Planned");
    case "active":
      return t("Active");
    case "completed":
      return t("Completed");
    case "archived":
      return t("Archived");
  }
}

export function taskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case "todo":
      return t("To do");
    case "queued":
      return t("Queued");
    case "running":
      return t("Running");
    case "verifying":
      return t("Verifying");
    case "review":
      return t("Review");
    case "done":
      return t("Done");
    case "blocked":
      return t("Blocked");
  }
}
