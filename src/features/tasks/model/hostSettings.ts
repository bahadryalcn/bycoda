/** Work limits a machine's host keeps for the work it starts on its own:
 * how many tasks run at once and how much agent time a day may use. The host
 * advertises this capability when it has it. */
export const HOST_SETTINGS = "host.settings";
export const HOST_BEHAVIOR_DEFAULTS = "host.settings.behavior.v1";
/** Advertised only once the Host has authoritative client draft clearance; gates the archive fields. */
export const HOST_AUTO_ARCHIVE = "host.settings.autoArchive.v1";

/** `account`: another signed-in account of the same provider and model; `order`: the next
 * eligible entry of the Host's model order. */
export const USAGE_LIMIT_FAILOVERS = ["off", "account", "order"] as const;
export type UsageLimitFailover = (typeof USAGE_LIMIT_FAILOVERS)[number];

export type AgentDefaults = {
  keepAwakeWhileAgentsWork: boolean;
  keepAwakeHoldAfter: "0" | "15m" | "30m" | "1h" | "4h" | "forever";
  autoContinueInterrupted: boolean;
  resumeAtReset: boolean;
  /** Where a chat continues when its provider stops it at a usage limit; `off` waits. */
  usageLimitFailover: UsageLimitFailover;
  streamingTextMode: "paced" | "adaptive";
  archiveMergedSessions: boolean;
  archiveInactiveDays: number;
};
export type AgentDefaultsRecord = AgentDefaults & {
  schemaVersion: 1;
  version: number;
};
export const DEFAULT_AGENT_DEFAULTS: AgentDefaultsRecord = {
  schemaVersion: 1,
  version: 0,
  // Agent runs survive idle sleep by default; closing the lid or choosing Sleep still works.
  keepAwakeWhileAgentsWork: true,
  keepAwakeHoldAfter: "0",
  autoContinueInterrupted: true,
  resumeAtReset: true,
  usageLimitFailover: "off",
  streamingTextMode: "paced",
  archiveMergedSessions: false,
  archiveInactiveDays: 0,
};

/** Strict patch validation; missing fields retain the Host's current value. */
export function parseAgentDefaults(
  input: unknown,
  current = DEFAULT_AGENT_DEFAULTS,
): AgentDefaultsRecord {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid agent defaults");
  const v = input as Record<string, unknown>;
  if (v.schemaVersion !== undefined && v.schemaVersion !== 1)
    throw new Error("Unsupported agent defaults schema");
  const next = { ...current };
  for (const key of [
    "keepAwakeWhileAgentsWork",
    "autoContinueInterrupted",
    "resumeAtReset",
    "archiveMergedSessions",
  ] as const) {
    if (v[key] === undefined) continue;
    if (typeof v[key] !== "boolean") throw new Error(`Invalid ${key}`);
    next[key] = v[key];
  }
  if (v.keepAwakeHoldAfter !== undefined) {
    if (
      typeof v.keepAwakeHoldAfter !== "string" ||
      !["0", "15m", "30m", "1h", "4h", "forever"].includes(v.keepAwakeHoldAfter)
    )
      throw new Error("Invalid keep awake hold");
    next.keepAwakeHoldAfter = v.keepAwakeHoldAfter as AgentDefaults["keepAwakeHoldAfter"];
  }
  if (v.usageLimitFailover !== undefined) {
    if (!USAGE_LIMIT_FAILOVERS.includes(v.usageLimitFailover as UsageLimitFailover))
      throw new Error("Invalid usage limit failover");
    next.usageLimitFailover = v.usageLimitFailover as UsageLimitFailover;
  }
  if (v.streamingTextMode !== undefined) {
    if (v.streamingTextMode !== "paced" && v.streamingTextMode !== "adaptive")
      throw new Error("Invalid streaming mode");
    next.streamingTextMode = v.streamingTextMode;
  }
  if (v.archiveInactiveDays !== undefined)
    next.archiveInactiveDays = whole(v.archiveInactiveDays, 0, 3650, "inactive days");
  if (v.version !== undefined)
    next.version = whole(v.version, 0, Number.MAX_SAFE_INTEGER, "agent defaults version");
  return next;
}

export const DEFAULT_MAX_RUNNING_TASKS = 2;
// Concurrent agents accumulate time independently, so a day's total can exceed 24h.
export const MAX_DAILY_AGENT_MINUTES = Number.MAX_SAFE_INTEGER;

export type HostSettings = {
  /** How many tasks the host works on at once; a positive safe integer. */
  maxRunningTasks: number;
  /** Agent minutes the host may start work for per day; zero means no limit. */
  dailyAgentMinutes: number;
  agentDefaults?: AgentDefaultsRecord;
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
export const DAILY_LIMIT_UNCERTAIN_SKIP = "Daily agent time is incomplete";

/** The choices for the daily limit, in minutes. */
export const DAILY_LIMIT_CHOICES = [0, 60, 120, 240, 480, 720] as const;

function whole(value: unknown, min: number, max: number, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
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
    ...(v.agentDefaults === undefined
      ? current.agentDefaults
        ? { agentDefaults: current.agentDefaults }
        : {}
      : { agentDefaults: parseAgentDefaults(v.agentDefaults, current.agentDefaults) }),
    maxRunningTasks:
      v.maxRunningTasks === undefined
        ? current.maxRunningTasks
        : whole(v.maxRunningTasks, 1, Number.MAX_SAFE_INTEGER, "concurrent task limit"),
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
