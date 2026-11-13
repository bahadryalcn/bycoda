import { expect, it } from "vitest";
import { taskDeliveryOperation } from "./tasks";

const task = { id: "task", projectId: "project", updatedAt: 1 };
const plan = {
  action: "merge" as const,
  token: "reviewed-plan",
  expiresAt: 2000,
  workspaceId: "workspace",
  expectedRevision: 1,
  sourceBranchRef: "refs/heads/task",
  sourceHead: "a".repeat(40),
  targetBranchRef: "refs/heads/main",
  targetDirectory: "/repo",
  targetHead: "b".repeat(40),
  targetStatusFingerprint: "target-status",
  sourceStatusFingerprint: "source-status",
  commits: [],
  changedPaths: ["large.ts"],
  overlappingPaths: [],
  checks: [],
  visualEvidence: [],
  blockers: [],
  diff: "large reviewed patch".repeat(20_000),
  diffStat: "large.ts",
};

it("keeps large reviewed patches inside the Native effect envelope limit", () => {
  expect(Buffer.byteLength(JSON.stringify(taskDeliveryOperation(task, plan)))).toBeLessThan(4096);
});

it("binds hidden review content as well as reviewed heads and target branch", () => {
  const original = taskDeliveryOperation(task, plan);
  const changedPlan = { ...plan, diff: "changed patch" };
  const changed = taskDeliveryOperation(task, changedPlan);
  expect(original.input).toMatchObject({
    projectId: "project",
    taskId: "task",
    taskUpdatedAt: 1,
    review: { currentBranch: "main" },
  });
  expect(original.input.plan).toMatchObject({
    token: plan.token,
    sourceHead: plan.sourceHead,
    targetHead: plan.targetHead,
  });
  expect(original.input.plan).not.toEqual(changed.input.plan);
});
