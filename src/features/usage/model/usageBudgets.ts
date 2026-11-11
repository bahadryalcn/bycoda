import { pathKey } from "../../../shared/lib/paths";
import type { Session } from "../../sessions/model/session";
import type { ProviderRateLimits } from "../../providers/model/rateLimits";
import type { UsageRow } from "../../providers/model/providerUsage";

export type BudgetScope = "project" | "session" | "workspace" | "machine";
export type BudgetPeriod = "all" | "weekly" | "fiveHour";
export type UsageBudget = {
  id: string;
  scope: BudgetScope;
  target: string;
  /** Session project identity, retained so closed sessions respect group locks. */
  project?: string;
  label: string;
  metric: "tokens" | "accountPercent";
  period: BudgetPeriod;
  /** Token capacity, or 100 for account percentage rules. */
  capacity: number;
  /** The allocated percentage of capacity. */
  percent: number;
  provider: "codex" | "claude";
  accountId: string;
  action: "monitor" | "block";
};

export type BudgetReading = {
  used: number | null;
  limit: number;
  state: "ok" | "warning" | "exceeded" | "unknown";
  resetsAt?: number | null;
};

export function normalizeBudget(value: unknown): UsageBudget | null {
  if (!value || typeof value !== "object") return null;
  const b = value as UsageBudget;
  if (
    !["project", "session", "workspace", "machine"].includes(b.scope) ||
    (b.scope === "machine" && (b.target !== "local" || b.metric !== "tokens")) ||
    !["all", "weekly", "fiveHour"].includes(b.period) ||
    !["tokens", "accountPercent"].includes(b.metric) ||
    !["monitor", "block"].includes(b.action) ||
    !["codex", "claude"].includes(b.provider) ||
    ![b.id, b.target, b.label, b.accountId].every(
      (s) => typeof s === "string" && s.trim().length > 0 && s.length <= 4096,
    ) ||
    (b.scope === "session" &&
      (typeof b.project !== "string" || !b.project || b.project.length > 4096)) ||
    !Number.isSafeInteger(b.capacity) ||
    b.capacity <= 0 ||
    !Number.isFinite(b.percent) ||
    b.percent <= 0 ||
    b.percent > 100 ||
    (b.metric === "accountPercent" && (b.period === "all" || b.capacity !== 100))
  )
    return null;
  return {
    id: b.id,
    scope: b.scope,
    target: b.scope === "project" ? pathKey(b.target) : b.target,
    label: b.label,
    metric: b.metric,
    period: b.period,
    capacity: b.capacity,
    percent: b.percent,
    provider: b.provider,
    accountId: b.accountId,
    action: b.action,
    ...(b.scope === "session" ? { project: b.project } : {}),
  };
}

export function budgetSince(period: BudgetPeriod, now: number): number {
  return period === "all" ? 0 : now - (period === "weekly" ? 7 * 24 : 5) * 3_600_000;
}

export function budgetMatches(
  b: UsageBudget,
  session: Pick<Session, "id" | "cwd">,
  groupFor: (cwd: string) => string | undefined,
): boolean {
  return b.scope === "machine"
    ? b.target === "local" && !session.cwd.startsWith("remote://")
    : b.scope === "session"
      ? b.target === session.id
      : b.scope === "project"
        ? pathKey(b.target) === pathKey(session.cwd)
        : b.target === groupFor(session.cwd);
}

export function budgetReading(
  b: UsageBudget,
  used: number | null,
  resetsAt?: number | null,
): BudgetReading {
  const limit = (b.capacity * b.percent) / 100;
  if (used == null || !Number.isFinite(used) || used < 0)
    return { used: null, limit, state: "unknown", resetsAt };
  return {
    used,
    limit,
    state: used >= limit ? "exceeded" : used >= limit * 0.8 ? "warning" : "ok",
    resetsAt,
  };
}

/** Provider percentages describe the whole account, never attributed token use. */
export function accountBudgetReading(
  b: UsageBudget,
  limits: ProviderRateLimits,
  now: number,
): BudgetReading {
  const window = b.period === "fiveHour" ? limits.session : limits.weekly;
  const minutes = b.period === "fiveHour" ? 300 : 10_080;
  const valid =
    limits.status === "ok" &&
    limits.updatedAt > 0 &&
    now - limits.updatedAt < 5 * 60_000 &&
    window &&
    window.windowMinutes === minutes &&
    (window.resetsAt == null || window.resetsAt > now);
  return budgetReading(b, valid ? window.usedPercent : null, window?.resetsAt);
}

/** Cached reads cost about a tenth of a normal input token, so budgets count them at this weight. */
export const CACHE_READ_TOKEN_WEIGHT = 0.1;

/**
 * Budget-weighted tokens of one turn or row: new input, output and cache writes at full
 * weight, cached reads at CACHE_READ_TOKEN_WEIGHT. With `inputIncludesCacheRead` (Codex) the
 * cached reads are first taken out of `input`, never below zero. Always a safe integer.
 */
export function budgetWeightedTokens(parts: {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  inputIncludesCacheRead?: boolean;
}): number {
  const cacheRead = parts.cacheRead ?? 0;
  const input = parts.inputIncludesCacheRead ? Math.max(0, parts.input - cacheRead) : parts.input;
  return Math.round(
    input + parts.output + (parts.cacheWrite ?? 0) + cacheRead * CACHE_READ_TOKEN_WEIGHT,
  );
}

export function rowTokens(row: UsageRow): number {
  const values = [row.input, row.output, row.cacheRead, row.cacheWrite5m, row.cacheWrite1h];
  return values.every((n) => Number.isFinite(n) && n >= 0)
    ? budgetWeightedTokens({
        input: row.input,
        output: row.output,
        cacheRead: row.cacheRead,
        cacheWrite: row.cacheWrite5m + row.cacheWrite1h,
      })
    : NaN;
}

/** Unknown or partial history must never appear as zero usage. */
export function sessionBudgetTokens(
  session: Session,
  period: BudgetPeriod,
  now: number,
): number | null {
  if (session.historyPartial || session.historyLoading || session.historyLoadError) return null;
  const since = budgetSince(period, now);
  let total = 0;
  for (const block of session.blocks) {
    if (block.role !== "user" || block.draft) continue;
    if (period !== "all" && block.startedAt == null) return null;
    if (block.startedAt != null && block.startedAt < since) continue;
    const m = block.turnMetrics;
    if (!m || m.inputTokens == null || m.outputTokens == null) return null;
    // Codex input already contains cached input. Claude reports it separately.
    const provider = block.turnModel?.harness ?? session.harness;
    if (!["codex", "claude"].includes(provider)) return null;
    const values = [m.inputTokens, m.outputTokens, m.cacheReadTokens ?? 0, m.cacheWriteTokens ?? 0];
    if (values.some((n) => !Number.isFinite(n) || n < 0)) return null;
    total += budgetWeightedTokens({
      input: m.inputTokens,
      output: m.outputTokens,
      cacheRead: m.cacheReadTokens,
      cacheWrite: m.cacheWriteTokens,
      inputIncludesCacheRead: provider === "codex",
    });
  }
  return total;
}
