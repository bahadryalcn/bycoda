import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  HostTaskSchema,
  TaskPayloadSchema,
  TasksSaveParamsSchema,
  TasksRetargetParamsSchema,
  TasksEvaluationSaveParamsSchema,
} from "../../../src/shared/model/host-contracts/tasks";

const base = {
  id: "task",
  title: "Fixture",
  prompt: "Retain",
  projectId: "project",
  harness: "claude",
  model: "fixture",
  modelSettings: { arbitraryProviderSetting: "yes" },
  runtimeMode: "auto",
  maxRunMinutes: 0,
  status: "blocked",
  createdAt: 1,
  updatedAt: 1,
};
it("inventories every declared input and persisted task key without an open task record", () => {
  const source = readFileSync("src/features/tasks/model/hostTasks.ts", "utf8");
  const keys = new Set<string>();
  for (const name of ["HostTaskInput", "HostTask"]) {
    const declaration = source.match(
      new RegExp(`export type ${name} = (?:HostTaskInput & )?\\{([\\s\\S]*?)^\\};`, "m"),
    );
    expect(declaration, `Missing ${name} inventory`).not.toBeNull();
    for (const field of declaration![1].matchAll(/^  ([a-zA-Z_]\w*)\??:/gm)) keys.add(field[1]);
  }
  expect(Object.keys(HostTaskSchema.shape).sort()).toEqual([...keys].sort());
  expect(HostTaskSchema.safeParse({ ...base, futureOwnerVariant: {} }).success).toBe(false);
});
it("roundtrips complete lifecycle metadata, nullable accounting and named string maps", () => {
  const rich = {
    ...base,
    providerAccountId: "account",
    budget: { maxAgentMinutes: 1.5, maxAttempts: 2, maxTokens: 3, warningPercent: 80 },
    preflightRequirements: [{ kind: "tool", id: "resource", required: false }],
    workflowId: "workflow",
    workflowVersion: 1,
    crewDefinitionId: "definition",
    crewRunId: "crew",
    crewScopes: ["project"],
    crewReviewFingerprint: "fingerprint",
    crewExecutionId: "execution",
    reviewerConfig: {
      harness: "codex",
      model: "review-model",
      modelSettings: {},
      instructions: "Review",
    },
    workspace: { checkoutCwd: "/target", baseBranch: "main", branchName: "feature" },
    workspaceId: "workspace",
    workspaceGenerationId: "generation",
    workspaceActivityId: "activity",
    isolate: true,
    position: 1,
    verifyCommand: "fixture",
    review: true,
    autoMerge: false,
    continueUntilDone: true,
    goalId: "goal",
    source: "goal",
    stewardId: "steward",
    dependsOn: ["dependency"],
    deliveryState: "awaitingOwner",
    deliveryOperationId: "delivery",
    artifactDeliveryPending: true,
    artifactDeliveryActivityId: "artifact-activity",
    deliveryApprovalRequired: true,
    deliveryArtifacts: {
      paths: ["out"],
      hashes: { out: "hash" },
      sourceFingerprint: "source",
      targetFingerprint: "target",
      targetHashes: { missing: null },
      blockers: [],
      planToken: "plan",
      sourceHead: "head",
      targetDirectory: "/target",
    },
    finalization: {
      branch: "feature",
      head: "head",
      status: "clean",
      diff: "",
      fingerprint: "fingerprint",
      clean: true,
    },
    evaluation: { accepted: false, reviewMinutes: 1.25, corrections: 2, recordedAt: 1 },
    budgetUsage: {
      historyComplete: false,
      agentMinutes: 1.5,
      attempts: 1,
      completedRuns: 0,
      runningRuns: 1,
      reportedTokens: 0,
      tokens: null,
      tokensComplete: false,
      unknownTokenRuns: 1,
      reportedCostUsd: null,
      estimatedCostUsd: null,
      measuredAt: 1,
    },
    budgetStop: "budget",
    preflight: {
      checkedAt: 1,
      state: "unknown",
      items: [
        {
          key: "tool",
          label: "Tool",
          state: "unknown",
          required: true,
          detail: "pending",
          checkedAt: 1,
        },
      ],
    },
    sessionId: "worker",
    runId: "run",
    error: "blocked",
    retryFeedback: "retry",
    repairAttempts: 1,
    reviewFailureCount: 1,
    awaitingOwnerRestart: true,
    blockedTakeover: { at: 1, previousSessionId: "previous", blocker: "blocked" },
    repairNote: "finding",
    checkFailureFingerprint: "fingerprint",
    repairStop: { reason: "external", message: "pending" },
    attemptHistory: [
      {
        attempt: 1,
        at: 1,
        workerSessionId: "worker",
        reviewerSessionId: "reviewer",
        workerSummary: "claim",
        verdict: "fail",
        reviewOnly: true,
        note: "finding",
        findings: ["finding"],
        workspaceFingerprint: "fingerprint",
      },
    ],
    reviewOnly: true,
    reviewNotes: [
      {
        id: "note",
        finding: "finding",
        suggestion: "suggestion",
        details: "details",
        kind: "finding",
        category: "external",
        sessionId: "reviewer",
        sessionIds: ["reviewer"],
        createdAt: 1,
        updatedAt: 1,
        occurrences: 1,
        readAt: 1,
        resolvedAt: 1,
      },
    ],
    branch: "feature",
    worktreeCwd: "/workspace",
    baseBranch: "main",
    baseCommit: "base",
    deliveryCwd: "/target",
    merged: false,
    autoMerged: false,
    mergedAt: 1,
    deliveredCommit: "commit",
    artifactPaths: ["out"],
    artifactHashes: { out: "hash" },
    deliveryRequested: false,
    dependencyArtifactsPrepared: true,
    verification: {
      command: { exitCode: null, output: "fixture", timedOut: true },
      review: { verdict: "fail", note: "finding", sessionId: "reviewer" },
      acceptance: {
        checkedAt: 1,
        sessionId: "reviewer",
        workspaceFingerprint: "fingerprint",
        criteria: [
          {
            criterionIndex: 0,
            criterion: "criterion",
            verdict: "unresolved",
            evidence: [],
            note: "pending",
          },
        ],
      },
    },
    reviewer: {
      sessionId: "reviewer",
      runId: "review-run",
      startedAt: 1,
      acceptanceRequired: true,
      workspaceFingerprint: "fingerprint",
      error: "pending",
      verdictRepairAttempts: 1,
      verdictRepairPending: true,
      recoveryPending: true,
    },
    diffStat: "diff",
    mergeError: "error",
    deliveryNote: "note",
    mergeRepair: {
      baseHead: "base",
      conflicts: ["file"],
      attempts: 1,
      prepared: true,
      replayCommit: "replay",
      replayStarted: true,
    },
    historyRecovery: [{ branch: "old", worktreeCwd: "/old", baseCommit: "base", head: "head" }],
    mergeRetry: { fingerprint: "fingerprint", after: 1 },
    cleanupError: "locked",
    cleanupRetryAfter: 1,
    cleanupArchives: ["/archive"],
    needsInput: true,
    startedAt: 1,
    completedAt: 1,
  };
  expect(HostTaskSchema.parse(rich)).toEqual(rich);
  expect(TasksSaveParamsSchema.parse({ task: { ...rich, expectedConfiguration: rich } })).toEqual({
    task: { ...rich, expectedConfiguration: rich },
  });
  for (const status of ["todo", "queued", "running", "verifying", "review", "done", "blocked"])
    expect(HostTaskSchema.parse({ ...rich, status }).status).toBe(status);
});
it("retains input defaults and reviewer clear sentinel without accepting unlisted nested fields", () => {
  const {
    modelSettings: _settings,
    maxRunMinutes: _limit,
    status: _status,
    createdAt: _created,
    updatedAt: _updated,
    ...input
  } = base;
  expect(TaskPayloadSchema.parse({ ...input, reviewerConfig: null })).toEqual({
    ...input,
    reviewerConfig: null,
  });
  expect(HostTaskSchema.safeParse(input).success).toBe(false);
  expect(TaskPayloadSchema.safeParse({ ...input, workspace: { arbitrary: true } }).success).toBe(
    false,
  );
  expect(
    TasksRetargetParamsSchema.parse({ taskId: "task", workspace: { baseBranch: "main" } }),
  ).toEqual({ taskId: "task", workspace: { baseBranch: "main" } });
  expect(
    TasksEvaluationSaveParamsSchema.parse({
      taskId: "task",
      evaluation: { accepted: true, reviewMinutes: 0.5, corrections: 0 },
    }).evaluation.reviewMinutes,
  ).toBe(0.5);
});
