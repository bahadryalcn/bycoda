import { pathKey } from "../../../shared/lib/paths";
import type { Session } from "../../sessions/model/session";
import type { ProviderRateLimits } from "../../providers/model/rateLimits";
import type { UsageRow } from "../../providers/model/providerUsage";

export type BudgetScope = "project" | "session" | "workspace";
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
    !["project", "session", "workspace"].includes(b.scope) ||
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
  return b.scope === "session"
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

export function rowTokens(row: UsageRow): number {
  const values = [row.input, row.output, row.cacheRead, row.cacheWrite5m, row.cacheWrite1h];
  return values.every((n) => Number.isFinite(n) && n >= 0)
    ? values.reduce((sum, n) => sum + n, 0)
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
    total +=
      m.inputTokens +
      m.outputTokens +
      (provider === "codex" ? 0 : (m.cacheReadTokens ?? 0)) +
      (m.cacheWriteTokens ?? 0);
  }
  return total;
}
