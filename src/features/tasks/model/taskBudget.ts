/** The host durably accounts for every planner, worker, reviewer and correction run. */
export const TASK_RUN_BUDGET_CAPABILITY = "tasks.run-budget";

/** Zero or an omitted field means unlimited. Minutes add concurrent agent time. */
export type TaskRunBudget = {
  maxAgentMinutes?: number;
  /** All agent turns count, including reviewers and format-only follow-ups. */
  maxAttempts?: number;
  /** A turn-boundary limit. A running provider may report its tokens only at completion. */
  maxTokens?: number;
  warningPercent?: number;
};

export type BudgetRunRole =
  | "advisor"
  | "planner"
  | "worker"
  | "reviewer"
  | "repair"
  | "recovery"
  | "final-review";
export type TaskBudgetScope =
  | { taskId: string; goalId?: never }
  | { goalId: string; taskId?: never };
export type TaskRunBudgetUsage = {
  /** False when older work exists outside the durable run ledger. Totals are lower bounds. */
  historyComplete: boolean;
  agentMinutes: number;
  /**
   * Present only when some interval is not verified. A run never outlasts its wall-clock span, so
   * `extraMinutes` bounds the bounded runs above their verified time; `unboundedRuns` counts runs
   * (or unknown history) whose timestamps cannot bound them.
   */
  uncertainty?: { extraMinutes: number; unboundedRuns: number };
  attempts: number;
  completedRuns: number;
  runningRuns: number;
  /** A lower bound when some provider metrics are unavailable. */
  reportedTokens: number;
  /** Null means incomplete or unsupported provider metrics, never zero usage. */
  tokens: number | null;
  tokensComplete: boolean;
  unknownTokenRuns: number;
  reportedCostUsd: number | null;
  /** No price estimate is inferred from absent billing data. */
  estimatedCostUsd: null;
  measuredAt: number;
};
/** What the owner accepted when continuing a task past an uncertain interval; it is not counted again. */
export type TaskRuntimeAcceptance = { extraMinutes: number; unboundedRuns: number; at: number };

/** Most agent minutes the usage can stand for, or null when no run-time bound exists. */
export function usageUpperBoundMinutes(
  usage: Pick<TaskRunBudgetUsage, "agentMinutes" | "uncertainty">,
  accepted?: Pick<TaskRuntimeAcceptance, "extraMinutes" | "unboundedRuns">,
): number | null {
  const uncertainty = usage.uncertainty;
  if (!uncertainty) return usage.agentMinutes;
  if (uncertainty.unboundedRuns > (accepted?.unboundedRuns ?? 0)) return null;
  return usage.agentMinutes + Math.max(0, uncertainty.extraMinutes - (accepted?.extraMinutes ?? 0));
}

const minutesText = (value: number) => `${Math.round(value * 10) / 10} min`;
/** The owner-decision facts: what is verified, the most it can be, and the limit. */
export function runtimeDecisionMessage(
  verifiedMinutes: number,
  upperBoundMinutes: number | null,
  limitMinutes: number,
): string {
  return `Earlier runs include an unverified interval: verified ${minutesText(verifiedMinutes)}, ${
    upperBoundMinutes === null
      ? "no known upper bound"
      : `at most ${minutesText(upperBoundMinutes)}`
  }, limit ${minutesText(limitMinutes)}.`;
}

/** A blocked task whose unverified earlier runtime can reach its limit: the owner decides. */
export function canContinueTaskRuntime(task: {
  status: string;
  maxRunMinutes: number;
  budgetUsage?: TaskRunBudgetUsage;
  runtimeAccepted?: TaskRuntimeAcceptance;
}): boolean {
  const usage = task.budgetUsage;
  if (task.status !== "blocked" || task.maxRunMinutes <= 0 || !usage || usage.historyComplete)
    return false;
  const upper = usageUpperBoundMinutes(usage, task.runtimeAccepted);
  return usage.agentMinutes < task.maxRunMinutes && (upper === null || upper >= task.maxRunMinutes);
}

export type TaskRunBudgetEvaluation = {
  usage: TaskRunBudgetUsage;
  blocked: boolean;
  warning: boolean;
  reasons: string[];
};

export function parseTaskRunBudget(raw: unknown): TaskRunBudget | undefined {
  if (raw === undefined) return;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid run budget.");
  const input = raw as Record<string, unknown>;
  const allowed = ["maxAgentMinutes", "maxAttempts", "maxTokens", "warningPercent"];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("Invalid run budget field.");
  const result: TaskRunBudget = {};
  for (const key of ["maxAgentMinutes", "maxAttempts", "maxTokens"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      (key !== "maxAgentMinutes" && !Number.isSafeInteger(value)) ||
      (key === "maxAgentMinutes" && value > 52_560_000)
    )
      throw new Error("Invalid run budget limit.");
    if (value > 0) result[key] = value;
  }
  const warning = input.warningPercent ?? 80;
  if (typeof warning !== "number" || !Number.isInteger(warning) || warning < 1 || warning > 100)
    throw new Error("Invalid run budget warning percentage.");
  if (!Object.keys(result).length) return;
  result.warningPercent = warning;
  return result;
}
