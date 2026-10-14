/** Work limits a machine's host keeps for the work it starts on its own:
 * how many tasks run at once and how much agent time a day may use. The host
 * advertises this capability when it has it. */
export const HOST_SETTINGS = "host.settings";

export const MAX_RUNNING_TASKS_LIMIT = 8;
export const DEFAULT_MAX_RUNNING_TASKS = 2;
// Concurrent agents accumulate time independently, so a day's total can exceed 24h.
export const MAX_DAILY_AGENT_MINUTES = Number.MAX_SAFE_INTEGER;

export type HostSettings = {
  /** How many tasks the host works on at once, 1 to 8. */
  maxRunningTasks: number;
  /** Agent minutes the host may start work for per day; zero means no limit. */
  dailyAgentMinutes: number;
};

export const DEFAULT_HOST_SETTINGS: HostSettings = {
  maxRunningTasks: DEFAULT_MAX_RUNNING_TASKS,
  dailyAgentMinutes: 0,
};

/** The settings with how much of today's time is used. */
export type HostSettingsState = HostSettings & {
  usedMinutes: number;
  /** Today's time is used up, so no new work starts until tomorrow. */
  limitReached: boolean;
};

/** The reason a steward records when it skips a run for the daily limit. */
export const DAILY_LIMIT_SKIP = "Daily agent time used up";

/** The choices for the daily limit, in minutes. */
export const DAILY_LIMIT_CHOICES = [0, 60, 120, 240, 480, 720] as const;

function whole(value: unknown, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
    throw new Error(`Invalid ${label}`);
  return Number(value);
}

/** Validates what a desktop sent. A missing field keeps `current`. Throws with
 * the reason on bad input. */
export function parseHostSettings(
  input: unknown,
  current: HostSettings = DEFAULT_HOST_SETTINGS,
): HostSettings {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid settings");
  const v = input as Record<string, unknown>;
  return {
    maxRunningTasks:
      v.maxRunningTasks === undefined
        ? current.maxRunningTasks
        : whole(v.maxRunningTasks, 1, MAX_RUNNING_TASKS_LIMIT, "concurrent task limit"),
    dailyAgentMinutes:
      v.dailyAgentMinutes === undefined
        ? current.dailyAgentMinutes
        : whole(v.dailyAgentMinutes, 0, MAX_DAILY_AGENT_MINUTES, "daily agent time"),
  };
}

/** Reads a host's reply; null when it is not settings. */
export function parseHostSettingsState(value: unknown): HostSettingsState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  try {
    const settings = parseHostSettings(v);
    if (typeof v.usedMinutes !== "number" || !(v.usedMinutes >= 0)) return null;
    return {
      ...settings,
      usedMinutes: v.usedMinutes,
      limitReached: v.limitReached === true,
    };
  } catch {
    return null;
  }
}

/** "1h 5m", "40m", "0m". */
export function formatAgentMinutes(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}
