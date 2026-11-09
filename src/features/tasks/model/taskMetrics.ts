import type { HostTask } from "./hostTasks";
import type { TaskRunBudgetUsage } from "./taskBudget";
import { readTaskInstructions } from "./taskInstructions";

export type TaskEvaluationInput = { accepted: boolean; reviewMinutes: number; corrections: number };
export type TaskEvaluation = TaskEvaluationInput & { recordedAt: number };
export type TaskMetricsSource = Pick<
  HostTask,
  "id" | "projectId" | "status" | "harness" | "model" | "modelSettings" | "prompt" | "completedAt"
> & {
  machineId?: string;
  evaluation?: TaskEvaluation;
  budgetUsage?: TaskRunBudgetUsage;
  workflowId?: string;
  workflowVersion?: number;
};
export type TaskMetricsGroup = {
  key: string;
  harness: HostTask["harness"];
  model: string;
  modelSettings: Record<string, string>;
  workflowId?: string;
  workflowVersion?: number;
  samples: number;
  agentMinutes: number | null;
  observedAgentMinutes: number;
  agentMinutesPerAccepted: number | null;
  unknownTimeSamples: number;
  tokens: number | null;
  reportedTokens: number;
  unknownTokenSamples: number;
  reportedCostUsd: number | null;
  observedCostUsd: number;
  unknownCostSamples: number;
  estimatedCostUsd: null;
  attempts: number | null;
  unknownRunSamples: number;
  reviewMinutes: number;
  corrections: number;
  objectiveVariants: number;
  criteriaVariants: number;
  taskIds: string[];
};
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function parseTaskEvaluation(raw: unknown): TaskEvaluationInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid task evaluation.");
  const input = raw as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !["accepted", "reviewMinutes", "corrections"].includes(key)) ||
    typeof input.accepted !== "boolean" ||
    !nonnegative(input.reviewMinutes) ||
    input.reviewMinutes > 52_560_000 ||
    !nonnegative(input.corrections) ||
    !Number.isSafeInteger(input.corrections) ||
    input.corrections > 1_000_000
  )
    throw new Error("Enter a valid review time and correction count.");
  return {
    accepted: input.accepted,
    reviewMinutes: input.reviewMinutes,
    corrections: input.corrections,
  };
}

export function readTaskEvaluation(raw: unknown): TaskEvaluation | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const { recordedAt, ...input } = raw as Record<string, unknown>;
  if (!nonnegative(recordedAt) || recordedAt > 8_640_000_000_000_000) return;
  try {
    return { ...parseTaskEvaluation(input), recordedAt };
  } catch {
    return;
  }
}

/** Descriptive observations of owner-accepted completed work, not a controlled model benchmark. */
export function taskMetricsComparisons(tasks: readonly TaskMetricsSource[]): TaskMetricsGroup[] {
  const groups = new Map<
    string,
    { group: TaskMetricsGroup; objectives: Set<string>; criteria: Set<string> }
  >();
  const seen = new Set<string>();
  for (const task of tasks) {
    const evaluation = readTaskEvaluation(task.evaluation);
    const identity = JSON.stringify([task.machineId ?? null, task.projectId, task.id]);
    if (
      task.status !== "done" ||
      !evaluation?.accepted ||
      seen.has(identity) ||
      (task.completedAt !== undefined && evaluation.recordedAt < task.completedAt)
    )
      continue;
    seen.add(identity);
    const settings = Object.fromEntries(
      Object.entries(task.modelSettings).sort(([a], [b]) => a.localeCompare(b)),
    );
    const key = JSON.stringify([
      task.harness,
      task.model,
      settings,
      task.workflowId ?? null,
      task.workflowVersion ?? null,
    ]);
    let entry = groups.get(key);
    if (!entry) {
      const group: TaskMetricsGroup = {
        key,
        harness: task.harness,
        model: task.model,
        modelSettings: settings,
        workflowId: task.workflowId,
        workflowVersion: task.workflowVersion,
        samples: 0,
        agentMinutes: 0,
        observedAgentMinutes: 0,
        agentMinutesPerAccepted: 0,
        unknownTimeSamples: 0,
        tokens: 0,
        reportedTokens: 0,
        unknownTokenSamples: 0,
        reportedCostUsd: 0,
        observedCostUsd: 0,
        unknownCostSamples: 0,
        estimatedCostUsd: null,
        attempts: 0,
        unknownRunSamples: 0,
        reviewMinutes: 0,
        corrections: 0,
        objectiveVariants: 0,
        criteriaVariants: 0,
        taskIds: [],
      };
      entry = { group, objectives: new Set(), criteria: new Set() };
      groups.set(key, entry);
    }
    const group = entry.group;
    group.samples++;
    group.taskIds.push(task.id);
    group.reviewMinutes += evaluation.reviewMinutes;
    group.corrections += evaluation.corrections;
    const brief = readTaskInstructions(task.prompt);
    entry.objectives.add((brief?.objective ?? task.prompt).trim());
    entry.criteria.add(JSON.stringify(brief?.acceptance ?? []));
    // A legacy completed task may predate ledger registration. An empty ledger is
    // not evidence that the historical agent work was free or instantaneous.
    const usage = task.budgetUsage && task.budgetUsage.attempts > 0 ? task.budgetUsage : undefined;
    if (usage && nonnegative(usage.agentMinutes)) {
      group.observedAgentMinutes += usage.agentMinutes;
      if (usage.historyComplete === false) group.unknownTimeSamples++;
    } else group.unknownTimeSamples++;
    if (
      usage &&
      usage.historyComplete !== false &&
      usage.tokensComplete &&
      nonnegative(usage.tokens) &&
      Number.isSafeInteger(usage.tokens)
    )
      group.reportedTokens += usage.tokens;
    else {
      group.unknownTokenSamples++;
      if (usage && nonnegative(usage.reportedTokens)) group.reportedTokens += usage.reportedTokens;
    }
    if (usage && usage.historyComplete !== false && nonnegative(usage.reportedCostUsd))
      group.observedCostUsd += usage.reportedCostUsd;
    else group.unknownCostSamples++;
    if (
      usage &&
      usage.historyComplete !== false &&
      nonnegative(usage.attempts) &&
      Number.isSafeInteger(usage.attempts)
    )
      group.attempts = (group.attempts ?? 0) + usage.attempts;
    else group.unknownRunSamples++;
  }
  return [...groups.values()]
    .map(({ group, objectives, criteria }) => ({
      ...group,
      agentMinutes: group.unknownTimeSamples ? null : group.observedAgentMinutes,
      agentMinutesPerAccepted: group.unknownTimeSamples
        ? null
        : group.observedAgentMinutes / group.samples,
      tokens:
        group.unknownTokenSamples || !Number.isSafeInteger(group.reportedTokens)
          ? null
          : group.reportedTokens,
      attempts: group.unknownRunSamples ? null : group.attempts,
      reportedCostUsd: group.unknownCostSamples ? null : group.observedCostUsd,
      objectiveVariants: objectives.size,
      criteriaVariants: criteria.size,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
