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
