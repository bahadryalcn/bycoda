import { describe, expect, it, vi } from "vitest";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";
import { repairOrBlock } from "./recovery";
import { settleCrew } from "./verification";
import { MAX_REPAIR_ATTEMPTS } from "./constants";

describe("crew task findings", () => {
  it("finishes an exhausted failed crew review through the findings path", async () => {
    const task = {
      crewRunId: "crew",
      sessionId: "worker",
      repairAttempts: MAX_REPAIR_ATTEMPTS,
      verification: { review: { verdict: "fail", note: "Defect remains" } },
    } as HostTask;
    const completeWithFindings = vi.fn().mockResolvedValue(task);
    const block = vi.fn();
    await repairOrBlock(
      { completeWithFindings, block } as unknown as TaskContext,
      task,
      "Review failed: Defect remains",
      10,
    );
    expect(completeWithFindings).toHaveBeenCalledWith(
      task,
      "Review failed: Defect remains",
      10,
      "limit",
    );
    expect(block).not.toHaveBeenCalled();
  });

  it("verifies a finished crew instead of marking it done", async () => {
    const task = { id: "task", crewRunId: "crew", status: "running" } as HostTask;
    const verify = vi.fn();
    const write = vi.fn(async (value) => value);
    await settleCrew(
      {
        crewRunner: { state: async () => ({ status: "finished" }) },
        write,
        verify,
      } as unknown as TaskContext,
      task,
      10,
    );
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({ status: "verifying", crewRunId: "crew" }),
    );
  });
});
