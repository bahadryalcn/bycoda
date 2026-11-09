import { describe, expect, it, vi } from "vitest";
import type {
  AssistantProfile,
  AssistantProjectJob,
} from "../../../src/shared/model/host-contracts/assistant";
import { AssistantGoalMissingError, GOAL_RESENT, resubmitGoal } from "./assistant-goal-recovery";

const job = {
  id: "j1",
  kind: "project",
  status: "planning",
  dispatchState: "submitted",
  goalId: "assistant-j1",
  taskIds: [],
  sessionIds: [],
} as unknown as AssistantProjectJob;
const profile = {} as AssistantProfile;

describe("resubmitGoal", () => {
  it("re-sends a submitted job whose goal row is missing, under its stable goal id", async () => {
    const createGoal = vi.fn(async () => ({ goalId: "assistant-j1" }));
    const resent = await resubmitGoal(new AssistantGoalMissingError(), job, profile, {
      createGoal,
    });
    expect(resent).toBe(true);
    expect(createGoal).toHaveBeenCalledWith({ job, profile });
    expect(GOAL_RESENT).toContain("resubmitted to the planner");
  });

  it("leaves other errors, and jobs that already reached the planner, alone", async () => {
    const createGoal = vi.fn(async () => ({ goalId: "assistant-j1" }));
    const cases: Array<[unknown, AssistantProjectJob]> = [
      [new Error("The linked goal is unavailable."), job],
      [Object.assign(new Error("scope"), { code: "ASSISTANT_JOB_SCOPE" }), job],
      [new AssistantGoalMissingError(), { ...job, dispatchState: "unknown" } as never],
      [new AssistantGoalMissingError(), { ...job, status: "running" } as never],
      [new AssistantGoalMissingError(), { ...job, taskIds: ["t1"] } as never],
      [new AssistantGoalMissingError(), { ...job, sessionIds: ["s1"] } as never],
      [new AssistantGoalMissingError(), { ...job, awaitingOwnerRestart: true } as never],
      [new AssistantGoalMissingError(), { ...job, pendingTaskDeletion: true } as never],
    ];
    for (const [error, candidate] of cases)
      expect(await resubmitGoal(error, candidate, profile, { createGoal })).toBe(false);
    expect(createGoal).not.toHaveBeenCalled();
  });

  it("returns false when the resubmission fails, so the next tick retries it", async () => {
    const createGoal = vi.fn(async () => {
      throw new Error("Choose an execution provider and model before starting jobs.");
    });
    expect(await resubmitGoal(new AssistantGoalMissingError(), job, profile, { createGoal })).toBe(
      false,
    );
  });
});

it("carries the typed missing-goal code", () => {
  const error = new AssistantGoalMissingError();
  expect(error.code).toBe("ASSISTANT_GOAL_MISSING");
  expect(error.message).toBe("The linked goal is unavailable.");
});
