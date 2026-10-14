import type { Automation, AutomationRun } from "./automations";

/** Limits on an unattended run. Zero means the limit is off. */
export type AutomationLimits = {
  maxRunMinutes: number;
  maxRunsPerDay: number;
};

export const NO_LIMITS: AutomationLimits = {
  maxRunMinutes: 0,
  maxRunsPerDay: 0,
};

export const LOCKED_PROJECT_SKIP = "Skipped: the project is in a locked group.";

export function automationLimits(
  automation: Pick<Automation, "maxRunMinutes" | "maxRunsPerDay">,
): AutomationLimits {
  return {
    maxRunMinutes: wholePositive(automation.maxRunMinutes),
    maxRunsPerDay: wholePositive(automation.maxRunsPerDay),
  };
}

/** Why a running run must stop now, or null while it is within its limits. */
export function runLimitBreach(
  limits: AutomationLimits,
  progress: { startedAt: number; now: number },
): string | null {
  if (
    limits.maxRunMinutes > 0 &&
    progress.now - progress.startedAt >= limits.maxRunMinutes * 60_000
  ) {
    return `Stopped: reached the ${formatMinutes(limits.maxRunMinutes)} time limit.`;
  }
  return null;
}

/** Why a claimed run must not start, or null when today's allowance has room.
 * `runs` is the automation's history; the run being started is not counted. */
export function dailyRunLimitSkip(
  limits: AutomationLimits,
  runs: readonly Pick<AutomationRun, "id" | "status" | "startedAt">[],
  runId: string,
  now: number,
): string | null {
  if (limits.maxRunsPerDay <= 0) return null;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const started = runs.filter(
    (run) =>
      run.id !== runId &&
      run.status !== "skipped" &&
      run.startedAt != null &&
      run.startedAt >= dayStart.getTime(),
  ).length;
  if (started < limits.maxRunsPerDay) return null;
  return `Skipped: reached the limit of ${limits.maxRunsPerDay} ${
    limits.maxRunsPerDay === 1 ? "run" : "runs"
  } per day.`;
}

function formatMinutes(minutes: number): string {
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}-hour` : `${minutes}-minute`;
}

function wholePositive(value: number | undefined): number {
  return value != null && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
