import { describe, expect, it } from "vitest";
import {
  parseTaskEvaluation,
  readTaskEvaluation,
  taskMetricsComparisons,
  type TaskMetricsSource,
} from "./taskMetrics";
import type { TaskRunBudgetUsage } from "./taskBudget";
const usage = (patch: Partial<TaskRunBudgetUsage> = {}): TaskRunBudgetUsage => ({
  historyComplete: true,
  agentMinutes: 4,
  attempts: 3,
  completedRuns: 3,
  runningRuns: 0,
  reportedTokens: 100,
  tokens: 100,
  tokensComplete: true,
  unknownTokenRuns: 0,
  reportedCostUsd: 0.2,
  estimatedCostUsd: null,
  measuredAt: 10,
  ...patch,
});
const task = (patch: Partial<TaskMetricsSource> = {}): TaskMetricsSource => ({
  id: "one",
  projectId: "project",
  status: "done",
  harness: "codex",
  model: "model",
  modelSettings: { effort: "medium" },
  workflowId: "write",
  workflowVersion: 1,
  completedAt: 50,
  prompt: JSON.stringify({
    schema: "bycoda.task.v1",
    objective: "Write a checked report",
    deliverables: ["report.md"],
    acceptance: ["Sources checked"],
    constraints: [],
    verification: [],
  }),
  evaluation: { accepted: true, reviewMinutes: 2, corrections: 1, recordedAt: 100 },
  budgetUsage: usage(),
  ...patch,
});

describe("accepted-work metrics", () => {
  it("includes only explicit owner-accepted completed results", () => {
    const groups = taskMetricsComparisons([
      task(),
      task({ id: "unrated", evaluation: undefined }),
      task({
        id: "rejected",
        evaluation: { accepted: false, reviewMinutes: 1, corrections: 0, recordedAt: 100 },
      }),
      task({ id: "review", status: "review" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      samples: 1,
      agentMinutes: 4,
      agentMinutesPerAccepted: 4,
      attempts: 3,
      tokens: 100,
      reportedCostUsd: 0.2,
      reviewMinutes: 2,
      corrections: 1,
    });
  });
  it("groups stable model settings independent of object insertion order", () => {
    const groups = taskMetricsComparisons([
      task({ modelSettings: { effort: "high", mode: "normal" } }),
      task({ id: "two", modelSettings: { mode: "normal", effort: "high" } }),
      task({ id: "other-model", model: "different" }),
      task({ id: "other-settings", modelSettings: { effort: "low" } }),
      task({ id: "other-version", workflowVersion: 2 }),
    ]);
    expect(groups).toHaveLength(4);
    expect(groups.find((group) => group.samples === 2)).toMatchObject({
      agentMinutes: 8,
      attempts: 6,
      reviewMinutes: 4,
      corrections: 2,
      tokens: 200,
    });
  });
  it("keeps partial token, time and billing observations separate from complete totals", () => {
    const groups = taskMetricsComparisons([
      task(),
      task({ id: "missing", budgetUsage: undefined }),
      task({
        id: "partial",
        budgetUsage: usage({
          tokens: null,
          tokensComplete: false,
          reportedTokens: 30,
          reportedCostUsd: null,
        }),
      }),
    ]);
    expect(groups[0]).toMatchObject({
      samples: 3,
      agentMinutes: null,
      observedAgentMinutes: 8,
      agentMinutesPerAccepted: null,
      tokens: null,
      reportedTokens: 130,
      unknownTokenSamples: 2,
      reportedCostUsd: null,
      observedCostUsd: 0.2,
      unknownCostSamples: 2,
      unknownTimeSamples: 1,
      attempts: null,
      estimatedCostUsd: null,
    });
  });
  it("does not count an old acceptance after the result completes again", () => {
    expect(taskMetricsComparisons([task({ completedAt: 101 })])).toEqual([]);
  });

  it("does not turn an unregistered legacy run into free instantaneous accepted work", () => {
    const groups = taskMetricsComparisons([
      task({
        budgetUsage: usage({
          attempts: 0,
          agentMinutes: 0,
          tokens: 0,
          reportedTokens: 0,
          reportedCostUsd: 0,
        }),
      }),
    ]);
    expect(groups[0]).toMatchObject({
      agentMinutes: null,
      agentMinutesPerAccepted: null,
      tokens: null,
      reportedCostUsd: null,
      attempts: null,
    });
  });

  it("keeps incomplete historic agent totals out of accepted-work averages", () => {
    const groups = taskMetricsComparisons([
      task({ budgetUsage: usage({ historyComplete: false }) }),
    ]);
    expect(groups[0]).toMatchObject({
      agentMinutes: null,
      observedAgentMinutes: 4,
      tokens: null,
      reportedTokens: 100,
      reportedCostUsd: null,
      attempts: null,
    });
  });
  it("deduplicates repeated views without hiding distinct host/project results", () => {
    const one = task();
    expect(
      taskMetricsComparisons([
        one,
        one,
        task({ projectId: "other" }),
        task({ machineId: "remote" }),
      ])[0].samples,
    ).toBe(3);
  });
  it("exposes different objectives and criteria instead of calling them a controlled benchmark", () => {
    const groups = taskMetricsComparisons([
      task(),
      task({ id: "other", prompt: "Different request" }),
    ]);
    expect(groups[0]).toMatchObject({ objectiveVariants: 2, criteriaVariants: 2 });
  });
  it("validates owner ratings and rejects unknown fields and invalid provenance", () => {
    expect(parseTaskEvaluation({ accepted: true, reviewMinutes: 0.5, corrections: 0 })).toEqual({
      accepted: true,
      reviewMinutes: 0.5,
      corrections: 0,
    });
    for (const invalid of [
      { accepted: true, reviewMinutes: -1, corrections: 0 },
      { accepted: true, reviewMinutes: 0, corrections: 0.5 },
      { accepted: true, reviewMinutes: 0, corrections: 0, status: "done" },
      { accepted: "yes", reviewMinutes: 0, corrections: 0 },
    ])
      expect(() => parseTaskEvaluation(invalid)).toThrow();
    expect(
      readTaskEvaluation({
        accepted: true,
        reviewMinutes: 0,
        corrections: 0,
        recordedAt: Infinity,
      }),
    ).toBeUndefined();
    expect(
      readTaskEvaluation({ accepted: true, reviewMinutes: 0, corrections: 0, recordedAt: 9e20 }),
    ).toBeUndefined();
  });
});
