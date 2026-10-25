import { t } from "../../../shared/i18n";
import type { CrewRunView } from "./crewClient";

export type CrewWorkStatus = "input" | "blocked" | "working" | "paused" | "active";

export function crewWorkStatusLabel(status: CrewWorkStatus) {
  return status === "input"
    ? t("Needs decision")
    : status === "blocked"
      ? t("Blocked")
      : status === "working"
        ? t("Working")
        : status === "paused"
          ? t("Paused")
          : t("Active");
}

export function crewWorkStatus(run: CrewRunView): CrewWorkStatus {
  if (run.status === "paused") return "paused";
  if (run.messages.some((m) => !m.resolvedAt) || run.tasks.some((task) => task.status === "review"))
    return "input";
  if (run.tasks.some((task) => task.status === "blocked")) return "blocked";
  if (
    run.coordinatorStatus === "running" ||
    run.tasks.some((task) => task.status === "running" || task.status === "verifying")
  )
    return "working";
  return "active";
}
