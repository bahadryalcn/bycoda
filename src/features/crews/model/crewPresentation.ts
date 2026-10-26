import { t } from "../../../shared/i18n";
import type { CrewRunView } from "./crewClient";

export type CrewWorkStatus = "input" | "blocked" | "working" | "paused" | "active";

export function crewHasRunningWork(run: CrewRunView): boolean {
  return (
    run.coordinatorStatus === "running" ||
    run.tasks.some((task) => task.status === "running" || task.status === "verifying")
  );
}

/** Older hosts may omit activity; absence is not evidence that the lead stopped. */
export function crewActivityKnown(run: CrewRunView): boolean {
  return !run.coordinatorSessionId || run.coordinatorStatus !== undefined;
}

export function crewCanStop(run: CrewRunView): boolean {
  return (
    run.status !== "finished" &&
    (run.status === "active" ||
      !crewActivityKnown(run) ||
      crewHasRunningWork(run) ||
      run.tasks.some((task) => task.status === "queued"))
  );
}

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
  if (crewHasRunningWork(run)) return "working";
  return "active";
}
