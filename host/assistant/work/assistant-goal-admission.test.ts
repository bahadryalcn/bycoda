import { expect, it } from "vitest";
import type { AssistantProfile } from "../../../src/shared/model/host-contracts/assistant";
import { autonomousJobAllowed, type GoalAdmissionDeps } from "./assistant-goal-admission";

const goalId = "assistant-job";
const job = { id: "job", goalId, status: "running", projectId: "project", projectIds: ["project"] };
const goal = {
  id: goalId,
  status: "running",
  taskIds: ["task"],
  projectIds: ["project"],
  leadProjectId: "project",
};
const task = { id: "task", goalId, projectId: "project" };

/** Canonical job, goal and task rows; only the budget state varies. */
function deps(budgetExhausted: boolean): GoalAdmissionDeps {
  const statement = (sql: string) => ({
    get: async () => (sql.includes("FROM goals") ? { value: JSON.stringify(goal) } : undefined),
    all: async () => [{ value: JSON.stringify(task) }],
  });
  return {
    store: { db: { scope: (work: () => unknown) => work(), prepare: statement } },
    repository: { get: async () => job },
    profile: async () =>
      ({ enabled: true, setupComplete: true, autonomy: "chief" }) as AssistantProfile,
    now: () => 0,
    budgetExhausted: async () => budgetExhausted,
    paused: async () => false,
    stopping: () => false,
  } as unknown as GoalAdmissionDeps;
}

it("keeps dispatched work running until the daily budget is exhausted", async () => {
  // Reporting mode (80%) stops the supervisor and new jobs, not children already dispatched.
  expect(await autonomousJobAllowed(deps(false), goalId)).toBe(true);
  expect(await autonomousJobAllowed(deps(true), goalId)).toBe(false);
});
