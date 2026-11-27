import { describe, expect, it } from "vitest";
import type { HostTask } from "./hostTasks";
import { buildTaskStop } from "../../../shared/model/host-contracts/task-stop";
import { canFinishTaskWithFindings } from "../../../shared/model/host-contracts/task-findings";

const failed = {
  status: "blocked",
  sessionId: "worker",
  stop: buildTaskStop(
    { code: "run_failed", phase: "review", message: "Review failed: Defect remains" },
    1,
  ),
  verification: { review: { verdict: "fail", note: "Defect remains" } },
} as HostTask;

describe("owner completion with findings", () => {
  it("allows retained failed reviews including crew assignments", () => {
    expect(canFinishTaskWithFindings(failed)).toBe(true);
    const crewTask = { ...failed, crewRunId: "crew" };
    expect(canFinishTaskWithFindings(crewTask)).toBe(true);
  });

  it.each([
    { stop: buildTaskStop({ code: "owner_stopped", message: "Stopped by user" }, 1) },
    { stop: buildTaskStop({ code: "permission_required", message: "Permission required" }, 1) },
    { stop: buildTaskStop({ code: "budget_exhausted", message: "Budget exhausted" }, 1) },
    { status: "running" },
    {
      stop: buildTaskStop(
        { code: "run_failed", phase: "review", nextAction: "restart", message: "Edited" },
        1,
      ),
    },
    { sessionId: undefined },
  ])("refuses non-completable work: %j", (change) => {
    expect(canFinishTaskWithFindings({ ...failed, ...change } as HostTask)).toBe(false);
  });

  it("requires a settled failing check rather than a timeout", () => {
    const task = {
      ...failed,
      stop: buildTaskStop(
        { code: "run_failed", phase: "check", message: "The check command failed (exit code 1)." },
        1,
      ),
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
