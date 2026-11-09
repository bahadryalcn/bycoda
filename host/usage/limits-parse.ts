import type { LimitWindow } from "./limits-pace";

/** Parsers for provider quota payloads, mirroring the desktop's
 * `src/features/providers/model/rateLimits.ts` without its UI/i18n imports. */

export type WindowKind = "session" | "weekly" | "monthly";
export type NamedWindow = {
  /** Stable key shared by accounts of one provider, e.g. `weekly` or `weekly:opus`. */
  key: string;
  kind: WindowKind;
  /** Model the limit is scoped to, when it is not provider-wide. */
  model: string | null;
  window: LimitWindow;
};
export type ParsedLimits = {
  windows: NamedWindow[];
  resetCredits: number | null;
};

export const SESSION_MINUTES = 300;
export const WEEKLY_MINUTES = 10_080;
export const MONTHLY_MINUTES = 43_200;
const DURATION_TOLERANCE_MINUTES = 1;
const MODEL_LIMIT_CAP = 8;
/** Claude usage fields named like model limits that are not one. */
const NOT_A_MODEL = new Set(["oauth_apps", "cowork", "iguana_necktie"]);

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function number(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Epoch seconds, epoch ms or an ISO string, as the providers mix them. */
export function resetTimestamp(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) && value > 0 ? (value > 1e10 ? value : value * 1000) : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return resetTimestamp(numeric);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));

function claudeWindow(raw: unknown, windowMinutes: number): LimitWindow | null {
  const source = record(raw);
  if (!source) return null;
  const used =
    number(source, "utilization") ??
    number(source, "used_percentage") ??
    number(source, "usedPercent");
  if (used === null) return null;
  return {
    usedPercent: clamp(used),
    windowMinutes,
    resetsAt: resetTimestamp(source.resets_at) ?? resetTimestamp(source.resetsAt),
  };
}

const modelName = (suffix: string) =>
  suffix
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");

/** Claude's OAuth usage body: `five_hour`, `seven_day` and `seven_day_<model>` windows. */
export function parseClaudeUsage(body: unknown): ParsedLimits {
  const source = record(body);
  const windows: NamedWindow[] = [];
  if (!source) return { windows, resetCredits: null };
  const session = claudeWindow(source.five_hour, SESSION_MINUTES);
  if (session)
    windows.push({
      key: "session",
      kind: "session",
      model: null,
      window: session,
    });
  const weekly = claudeWindow(source.seven_day, WEEKLY_MINUTES);
  if (weekly)
    windows.push({
      key: "weekly",
      kind: "weekly",
      model: null,
      window: weekly,
    });
  for (const name of Object.keys(source).sort()) {
    const match = /^seven_day_([a-z0-9_]{1,40})$/.exec(name);
    if (!match || NOT_A_MODEL.has(match[1]) || windows.length >= 2 + MODEL_LIMIT_CAP) continue;
    const window = claudeWindow(source[name], WEEKLY_MINUTES);
    if (window)
      windows.push({
        key: `weekly:${match[1]}`,
        kind: "weekly",
        model: modelName(match[1]),
        window,
      });
  }
  return { windows, resetCredits: null };
}

function kindOf(minutes: number | null): WindowKind | null {
  if (minutes === null) return null;
  if (Math.abs(minutes - SESSION_MINUTES) <= DURATION_TOLERANCE_MINUTES) return "session";
  if (Math.abs(minutes - WEEKLY_MINUTES) <= DURATION_TOLERANCE_MINUTES) return "weekly";
  if (Math.abs(minutes - MONTHLY_MINUTES) <= DURATION_TOLERANCE_MINUTES) return "monthly";
  return null;
}
const MINUTES: Record<WindowKind, number> = {
  session: SESSION_MINUTES,
  weekly: WEEKLY_MINUTES,
  monthly: MONTHLY_MINUTES,
};

type CodexSnapshot = {
  used: number;
  minutes: number | null;
  resetsAt: unknown;
};
function codexSnapshot(raw: unknown): CodexSnapshot | null {
  const source = record(raw);
  if (!source) return null;
  const used =
    number(source, "usedPercent") ??
    number(source, "used_percent") ??
    number(source, "used_percentage");
  if (used === null) return null;
  return {
    used,
    minutes: number(source, "windowDurationMins") ?? number(source, "window_duration_mins"),
    resetsAt: source.resetsAt ?? source.resets_at,
  };
}

/** Same classification as the desktop: by duration, falling back to primary=session, secondary=weekly. */
function codexWindows(limit: unknown, model: string | null, prefix: string): NamedWindow[] {
  const source = record(limit);
  const primary = codexSnapshot(source?.primary);
  const secondary = codexSnapshot(source?.secondary);
  const found: Partial<Record<WindowKind, CodexSnapshot>> = {};
  for (const snapshot of [primary, secondary]) {
    const kind = snapshot && kindOf(snapshot.minutes);
    if (snapshot && kind && !found[kind]) found[kind] = snapshot;
  }
  if (!found.session && primary && kindOf(primary.minutes) === null) found.session = primary;
  if (!found.weekly && secondary && kindOf(secondary.minutes) === null) found.weekly = secondary;
  return (["session", "weekly", "monthly"] as const).flatMap((kind) => {
    const snapshot = found[kind];
    if (!snapshot) return [];
    return [
      {
        key: `${prefix}${kind}`,
        kind,
        model,
        window: {
          usedPercent: clamp(snapshot.used),
          windowMinutes: MINUTES[kind],
          resetsAt: resetTimestamp(snapshot.resetsAt),
        },
      },
    ];
  });
}

/** Codex `account/rateLimits/read` result, including per-model limits when the app-server lists them. */
export function parseCodexLimits(result: unknown): ParsedLimits {
  const source = record(result);
  const windows = codexWindows(source?.rateLimits ?? source, null, "");
  const byId = record(source?.rateLimitsByLimitId ?? source?.rate_limits_by_limit_id);
  if (byId) {
    for (const id of Object.keys(byId).sort().slice(0, MODEL_LIMIT_CAP)) {
      const entry = record(byId[id]);
      const name = typeof entry?.limitName === "string" ? entry.limitName.trim() : "";
      if (id === "codex" || !name || name.length > 60) continue;
      windows.push(...codexWindows(entry, name, `${id.slice(0, 40)}:`));
    }
  }
  const credits = record(source?.rateLimitResetCredits ?? source?.rate_limit_reset_credits);
  const count = credits
    ? (number(credits, "availableCount") ?? number(credits, "available_count"))
    : null;
  return {
    windows,
    resetCredits: count === null ? null : Math.max(0, Math.floor(count)),
  };
}
