import { formatMinutes } from "../../../shared/i18n/format";
import type { Automation, AutomationRun } from "./automations";
import { elapsedSince } from "../../../shared/lib/time/timestamps";

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

/** Sums the intervals between consecutive samples that are close enough to trust. A gap (system
 * sleep, a stalled loop, a clock jump or a backwards clock) adds nothing and is not an error:
 * counting simply continues from the next sample. */
export class ObservedRunDuration {
  private wall: number;
  private monotonic: number;
  private elapsed: number;
  private gap = false;

  constructor(wall: number, monotonic: number, elapsed = 0) {
    this.wall = wall;
    this.monotonic = monotonic;
    this.elapsed = elapsed;
  }

  get value(): number {
    return this.elapsed;
  }

  /** Whether the latest sample was a gap that contributed nothing. */
  get skippedGap(): boolean {
    return this.gap;
  }

  clone(): ObservedRunDuration {
    return new ObservedRunDuration(this.wall, this.monotonic, this.elapsed);
  }

  sample(wall: number, monotonic: number, maxGap: number): number {
    const wallDelta = wall - this.wall;
    const backwards = monotonic < this.monotonic;
    const delta = elapsedSince(this.monotonic, monotonic);
    this.wall = wall;
    this.monotonic = monotonic;
    this.gap = backwards || !(delta <= maxGap && Math.abs(wallDelta - delta) <= 1_000);
    if (!this.gap) this.elapsed += delta;
    return this.elapsed;
  }
}

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

function wholePositive(value: number | undefined): number {
  return value != null && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
