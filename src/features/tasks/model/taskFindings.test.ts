import { describe, expect, it } from "vitest";
import type { HostTask } from "./hostTasks";
import { canFinishTaskWithFindings } from "../../../shared/model/host-contracts/task-findings";

const failed = {
  status: "blocked",
  sessionId: "worker",
  error: "Review failed: Defect remains",
  verification: { review: { verdict: "fail", note: "Defect remains" } },
} as HostTask;

describe("owner completion with findings", () => {
  it("allows retained failed reviews including crew assignments", () => {
    expect(canFinishTaskWithFindings(failed)).toBe(true);
    const crewTask = { ...failed, crewRunId: "crew" };
    expect(canFinishTaskWithFindings(crewTask)).toBe(true);
  });

  it.each([
    { error: "Stopped by user" },
    { error: "Permission required" },
    { error: "Budget exhausted" },
    { status: "running" },
    { awaitingOwnerRestart: true },
    { sessionId: undefined },
  ])("refuses non-completable work: %j", (change) => {
    expect(canFinishTaskWithFindings({ ...failed, ...change } as HostTask)).toBe(false);
  });

  it("requires a settled failing check rather than a timeout", () => {
    const task = {
      ...failed,
      error: "The check command failed (exit code 1).",
      verification: { command: { exitCode: 1, timedOut: false, output: "failed" } },
    } as HostTask;
    expect(canFinishTaskWithFindings(task)).toBe(true);
    expect(
      canFinishTaskWithFindings({
        ...task,
        verification: { command: { ...task.verification!.command!, timedOut: true } },
      }),
    ).toBe(false);
  });
});
