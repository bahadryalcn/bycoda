// Provider quota payloads shared by the Host and desktop compatibility adapters.
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export type RateLimitProvider = "claude" | "codex" | "opencode" | "grok";
export type QuotaSource = RateLimitProvider | "pi-anthropic" | "pi-openai-codex";
export const QUOTA_POLL_MS: Readonly<Record<QuotaSource, number>> = {
  claude: 120_000,
  codex: 600_000,
  opencode: 120_000,
  grok: 600_000,
  "pi-anthropic": 900_000,
  "pi-openai-codex": 900_000,
};
export const QUOTA_RETRY_MS = [60_000, 180_000, 600_000, 900_000] as const;

export function quotaBillingProvider(source: QuotaSource): RateLimitProvider {
  if (source === "pi-anthropic") return "claude";
  if (source === "pi-openai-codex") return "codex";
  return source;
}

export type RateLimitStatus = "idle" | "fetching" | "ok" | "error" | "unavailable";

/**
 * Why usage could not be read, set only from structured evidence at the fetch
 * layer (an HTTP status, an unauthenticated provider answer, a missing binary).
 * Absent means unclassified: the `error` text is for display, never for branching.
 */
export type RateLimitFailureReason = "signedOut" | "cliMissing";

export type RateLimitWindow = {
  /** Percentage of the window consumed (0–100). */
  usedPercent: number;
  /** Window duration in minutes: 300 (5h) or 10080 (7d). */
  windowMinutes: number;
  /** Unix ms timestamp when the window resets, if known. */
  resetsAt: number | null;
};

/** What a Claude reset refills; `fable` returns only Fable's share of the week. */
export type RateLimitResetKind = "session" | "weekly" | "fable" | "full";

export type RateLimitResetCredit = {
  id: string;
  /** Claude only: names the row instead of the long provider title. */
  kind?: RateLimitResetKind;
  resetType: "codexRateLimits" | "unknown";
  status: "available" | "redeeming" | "redeemed" | "unknown";
  grantedAt: number | null;
  expiresAt: number | null;
  title: string | null;
  description: string | null;
};

export type RateLimitResetCredits = {
  availableCount: number;
  /** Optional detail rows; the backend can report only the aggregate count. */
  credits: RateLimitResetCredit[] | null;
};

export type ProviderRateLimits = {
  provider: RateLimitProvider;
  session: RateLimitWindow | null;
  weekly: RateLimitWindow | null;
  monthly: RateLimitWindow | null;
  /** Banked rate-limit resets (Codex app-server, Claude OAuth usage). */
  resetCredits: RateLimitResetCredits | null;
  updatedAt: number;
  error: string | null;
  status: RateLimitStatus;
  /** Structured cause of an `error` or `unavailable` status, when the fetch layer knew it. */
  reason?: RateLimitFailureReason;
  /** Host deadline for the next failed quota read, including Retry-After. */
  retryAt?: number;
  /**
   * Claude's local access token expired and awaits renewal by the CLI. Reading
   * it again is local-only, so the cache checks back sooner than its backoff.
   */
  renewalPending?: boolean;
};

/** A Codex notification updates only the account windows it actually contains. */
export function mergeCodexQuotaWindows(
  previous: ProviderRateLimits,
  update: ProviderRateLimits,
): ProviderRateLimits {
  return {
    ...previous,
    session: update.session ?? previous.session,
    weekly: update.weekly ?? previous.weekly,
    monthly: update.monthly ?? previous.monthly,
  };
}

export const SESSION_WINDOW_MINUTES = 300;
export const WEEKLY_WINDOW_MINUTES = 10_080;
export const MONTHLY_WINDOW_MINUTES = 43_200;

const WINDOW_DURATION_TOLERANCE_MINUTES = 1;

export function idleRateLimits(provider: RateLimitProvider): ProviderRateLimits {
  return {
    provider,
    session: null,
    weekly: null,
    monthly: null,
    resetCredits: null,
    updatedAt: 0,
    error: null,
    status: "idle",
  };
}

export function fetchingRateLimits(
  provider: RateLimitProvider,
  previous?: ProviderRateLimits | null,
): ProviderRateLimits {
  if (
    previous &&
    (previous.session || previous.weekly || previous.monthly || previous.resetCredits)
  ) {
    const { reason: _previousReason, ...retained } = previous;
    return { ...retained, status: "fetching" };
  }
  return {
    provider,
    session: previous?.session ?? null,
    weekly: previous?.weekly ?? null,
    monthly: previous?.monthly ?? null,
    resetCredits: previous?.resetCredits ?? null,
    updatedAt: previous?.updatedAt ?? 0,
    error: null,
    status: "fetching",
  };
}

export function unavailableRateLimits(
  provider: RateLimitProvider,
  error: string,
  reason?: RateLimitFailureReason,
): ProviderRateLimits {
  return {
    provider,
    session: null,
    weekly: null,
    monthly: null,
    resetCredits: null,
    updatedAt: Date.now(),
    error,
    status: "unavailable",
    ...(reason ? { reason } : {}),
  };
}

/** A new failure retains the last usage observation and uses its own cause. */
export function errorRateLimits(
  provider: RateLimitProvider,
  error: string,
  previous?: ProviderRateLimits | null,
  reason?: RateLimitFailureReason,
): ProviderRateLimits {
  if (
    previous &&
    (previous.session || previous.weekly || previous.monthly || previous.resetCredits)
  ) {
    const {
      reason: _previousReason,
      renewalPending: _previousRenewal,
      retryAt: _retryAt,
      ...retained
    } = previous;
    return {
      ...retained,
      error,
      status: "error",
      ...(reason ? { reason } : {}),
    };
  }
  return {
    provider,
    session: null,
    weekly: null,
    monthly: null,
    resetCredits: null,
    updatedAt: Date.now(),
    error,
    status: "error",
    ...(reason ? { reason } : {}),
  };
}

export function clampUsedPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function parseResetTimestamp(value: unknown): number | null {
  if (typeof value === "number") {
    return normalizeEpochMs(value);
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && value.trim() !== "") {
    return normalizeEpochMs(numeric);
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeEpochMs(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  // 1e10 sits between seconds-epoch (<2286) and millisecond-epoch (>2001).
  return value > 10_000_000_000 ? value : value * 1000;
}

export function mapUsageWindow(raw: unknown, windowMinutes: number): RateLimitWindow | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const usedPercent = usedPercentFrom(rec);
  if (usedPercent == null) return null;
  return {
    usedPercent: clampUsedPercent(usedPercent),
    windowMinutes,
    resetsAt: parseResetTimestamp(rec.resets_at) ?? parseResetTimestamp(rec.resetsAt) ?? null,
  };
}

function usedPercentFrom(rec: Record<string, unknown>): number | null {
  const value =
    numberField(rec, "used_percentage") ??
    numberField(rec, "usedPercent") ??
    numberField(rec, "utilization");
  if (value == null) return null;
  return value;
}

export function parseClaudeOAuthUsage(body: string): ProviderRateLimits {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return errorRateLimits("claude", "Claude usage response was not JSON");
  }
  const rec = asRecord(parsed);
  if (!rec) {
    return errorRateLimits("claude", "Claude usage response was empty");
  }
  return {
    provider: "claude",
    session: mapUsageWindow(rec.five_hour, SESSION_WINDOW_MINUTES),
    weekly: mapUsageWindow(rec.seven_day, WEEKLY_WINDOW_MINUTES),
    monthly: null,
    resetCredits: parseClaudeResetGrants(rec.cedar_ember),
    updatedAt: Date.now(),
    error: null,
    status: "ok",
  };
}

/** Claude's banked limit resets: one row per reset still left in each grant. */
function parseClaudeResetGrants(raw: unknown): RateLimitResetCredits | null {
  const grants = asRecord(raw)?.grants;
  if (!Array.isArray(grants)) return null;
  const credits: RateLimitResetCredit[] = [];
  for (const grant of grants.map(asRecord)) {
    if (!grant || typeof grant.id !== "string" || grant.id.trim() === "") continue;
    const left = Math.min(Math.max(0, Math.floor(numberField(grant, "resets_left") ?? 0)), 20);
    for (let index = 0; index < left; index++) {
      credits.push({
        id: `${grant.id}:${index}`,
        kind: claudeResetKind(grant),
        resetType: "unknown",
        status: grant.usable_now === true ? "available" : "unknown",
        grantedAt: parseResetTimestamp(grant.starts_at),
        expiresAt: parseResetTimestamp(grant.ends_at),
        title: stringField(grant, "label"),
        description: null,
      });
    }
  }
  return credits.length > 0 ? { availableCount: credits.length, credits } : null;
}

/** Same precedence as Claude Code's `/limit-reset` picker. */
function claudeResetKind(grant: Record<string, unknown>): RateLimitResetKind {
  if (grant.gives_back_weekly === true) return "fable";
  if (grant.type === "session" || grant.type === "weekly" || grant.type === "full") {
    return grant.type;
  }
  const clears = Array.isArray(grant.clears) ? grant.clears : [];
  const session = clears.includes("five_hour");
  const other = clears.some((limit) => limit !== "five_hour");
  return session && !other ? "session" : other && !session ? "weekly" : "full";
}

type CodexWindowSnapshot = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: unknown;
};

export function parseCodexRateLimits(result: unknown): ProviderRateLimits {
  const rec = asRecord(result);
  const wrapper = asRecord(rec?.rateLimits) ?? rec;
  const classified = classifyCodexWindows({
    primary: snapshotFrom(asRecord(wrapper?.primary)),
    secondary: snapshotFrom(asRecord(wrapper?.secondary)),
  });
  return {
    provider: "codex",
    session: mapCodexSnapshot(classified.session, SESSION_WINDOW_MINUTES),
    weekly: mapCodexSnapshot(classified.weekly, WEEKLY_WINDOW_MINUTES),
    monthly: mapCodexSnapshot(classified.monthly, MONTHLY_WINDOW_MINUTES),
    resetCredits: parseResetCredits(rec?.rateLimitResetCredits ?? rec?.rate_limit_reset_credits),
    updatedAt: Date.now(),
    error: null,
    status: "ok",
  };
}

/**
 * Parse the official OpenCode Go usage payload:
 * { usage: { rolling: { status, percent, resetsAt },
 *            weekly: {...}, monthly: {...} } }
 * `percent` is percent used, matching the dashboard.
 */
export function parseOpencodeGoUsage(result: unknown): ProviderRateLimits {
  const rec = asRecord(result);
  const usage = asRecord(rec?.usage) ?? rec;
  return {
    provider: "opencode",
    session: mapOpencodeGoWindow(usage?.rolling, SESSION_WINDOW_MINUTES),
    weekly: mapOpencodeGoWindow(usage?.weekly, WEEKLY_WINDOW_MINUTES),
    monthly: mapOpencodeGoWindow(usage?.monthly, MONTHLY_WINDOW_MINUTES),
    resetCredits: null,
    updatedAt: Date.now(),
    error: null,
    status: "ok",
  };
}

function mapOpencodeGoWindow(raw: unknown, windowMinutes: number): RateLimitWindow | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  // Require an explicit valid status; unknown shapes are dropped so the
  // caller can treat a fully empty payload as an error, not a snapshot.
  const status = rec.status;
  if (status !== "ok" && status !== "rate-limited") return null;
  const usedPercent = numberField(rec, "percent") ?? numberField(rec, "usedPercent");
  if (usedPercent == null) return null;
  return {
    usedPercent: clampUsedPercent(usedPercent),
    windowMinutes,
    resetsAt: parseResetTimestamp(rec.resetsAt) ?? parseResetTimestamp(rec.resets_at),
  };
}

function parseResetCredits(raw: unknown): RateLimitResetCredits | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const count = numberField(rec, "availableCount") ?? numberField(rec, "available_count");
  if (count == null) return null;
  const rawCredits = rec.credits;
  const credits = Array.isArray(rawCredits)
    ? rawCredits
        .map(parseResetCredit)
        .filter((credit): credit is RateLimitResetCredit => credit != null)
    : null;
  return {
    availableCount: Math.max(0, Math.floor(count)),
    credits,
  };
}

function parseResetCredit(raw: unknown): RateLimitResetCredit | null {
  const rec = asRecord(raw);
  if (!rec || typeof rec.id !== "string" || rec.id.trim() === "") {
    return null;
  }
  const resetType = rec.resetType === "codexRateLimits" ? "codexRateLimits" : "unknown";
  const status =
    rec.status === "available" || rec.status === "redeeming" || rec.status === "redeemed"
      ? rec.status
      : "unknown";
  return {
    id: rec.id,
    resetType,
    status,
    grantedAt: parseResetTimestamp(rec.grantedAt ?? rec.granted_at),
    expiresAt: parseResetTimestamp(rec.expiresAt ?? rec.expires_at),
    title: stringField(rec, "title"),
    description: stringField(rec, "description"),
  };
}

function snapshotFrom(rec: Record<string, unknown> | null): CodexWindowSnapshot | null {
  if (!rec) return null;
  const usedPercent =
    numberField(rec, "usedPercent") ??
    numberField(rec, "used_percent") ??
    numberField(rec, "used_percentage");
  if (usedPercent == null) return null;
  return {
    usedPercent,
    windowDurationMins:
      numberField(rec, "windowDurationMins") ?? numberField(rec, "window_duration_mins") ?? null,
    resetsAt: rec.resetsAt ?? rec.resets_at,
  };
}

function classifyCodexWindows(input: {
  primary: CodexWindowSnapshot | null;
  secondary: CodexWindowSnapshot | null;
}): {
  session: CodexWindowSnapshot | null;
  weekly: CodexWindowSnapshot | null;
  monthly: CodexWindowSnapshot | null;
} {
  let session: CodexWindowSnapshot | null = null;
  let weekly: CodexWindowSnapshot | null = null;
  let monthly: CodexWindowSnapshot | null = null;
  for (const window of [input.primary, input.secondary]) {
    if (!window) continue;
    const kind = classifyWindowDuration(window.windowDurationMins);
    if (kind === "session" && !session) session = window;
    else if (kind === "weekly" && !weekly) weekly = window;
    else if (kind === "monthly" && !monthly) monthly = window;
  }
  if (
    !session &&
    input.primary &&
    classifyWindowDuration(input.primary.windowDurationMins) === null
  ) {
    session = input.primary;
  }
  if (
    !weekly &&
    input.secondary &&
    classifyWindowDuration(input.secondary.windowDurationMins) === null
  ) {
    weekly = input.secondary;
  }
  return { session, weekly, monthly };
}

function classifyWindowDuration(duration: number | null): "session" | "weekly" | "monthly" | null {
  if (duration == null || !Number.isFinite(duration)) return null;
  if (Math.abs(duration - SESSION_WINDOW_MINUTES) <= WINDOW_DURATION_TOLERANCE_MINUTES) {
    return "session";
  }
  if (Math.abs(duration - WEEKLY_WINDOW_MINUTES) <= WINDOW_DURATION_TOLERANCE_MINUTES) {
    return "weekly";
  }
  // Free plans get a single 30-day window.
  if (Math.abs(duration - MONTHLY_WINDOW_MINUTES) <= WINDOW_DURATION_TOLERANCE_MINUTES) {
    return "monthly";
  }
  return null;
}

function mapCodexSnapshot(
  raw: CodexWindowSnapshot | null,
  windowMinutes: number,
): RateLimitWindow | null {
  if (!raw) return null;
  return {
    usedPercent: clampUsedPercent(raw.usedPercent),
    windowMinutes,
    resetsAt: parseResetTimestamp(raw.resetsAt),
  };
}

function numberField(rec: Record<string, unknown>, key: string): number | null {
  const value = rec[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringField(rec: Record<string, unknown>, key: string): string | null {
  const value = rec[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
