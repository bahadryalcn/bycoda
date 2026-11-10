import { describe, expect, it, vi } from "vitest";
import type { HostTask } from "../../../src/features/tasks/model/hostTasks";
import type { AssistantProfile } from "../../../src/shared/model/host-contracts/assistant";
import { repointUnstartedGoalTasks } from "./assistant-task-repoint";
import type { AssistantModelSelector } from "./assistant-model-execution";

const profile = {} as AssistantProfile;
const task = (overrides: Partial<HostTask>): HostTask =>
  ({
    id: "t",
    goalId: "assistant-j",
    status: "queued",
    harness: "claude",
    model: "limited",
    modelSettings: {},
    updatedAt: 5,
    ...overrides,
  }) as HostTask;
const next: Awaited<ReturnType<AssistantModelSelector>> = {
  rowId: "row-2",
  reason: "skipped:row-1",
  execution: {
    harness: "codex",
    model: "next",
    modelSettings: { effort: "low" },
    runtimeMode: "auto",
    maxRunMinutes: 30,
    providerAccountId: "acct",
  },
};
const run = async (
  children: HostTask[],
  choice: Awaited<ReturnType<AssistantModelSelector>> = next,
) => {
  const repoint = vi.fn(async () => ({}) as HostTask);
  const moved = await repointUnstartedGoalTasks({
    tasks: { repointUnstartedTask: repoint },
    selector: async () => choice,
    profile,
    children,
  });
  return { moved, repoint };
};

describe("repointUnstartedGoalTasks", () => {
  it("moves only queued assistant tasks that have not started, with their revision", async () => {
    const { moved, repoint } = await run([
      task({ id: "queued" }),
      task({ id: "running", status: "running", sessionId: "s", runId: "r" }),
      task({ id: "resuming", sessionId: "s" }),
      task({ id: "plain", goalId: "goal-1" }),
    ]);
    expect(moved).toBe(1);
    expect(repoint).toHaveBeenCalledTimes(1);
    expect(repoint).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "queued",
        expectedUpdatedAt: 5,
        harness: "codex",
        model: "next",
        providerAccountId: "acct",
      }),
    );
  });

  it("leaves tasks to wait when no pool row is eligible or the model already matches", async () => {
    expect((await run([task({})], { held: "limits" })).repoint).not.toHaveBeenCalled();
    expect((await run([task({})], null)).repoint).not.toHaveBeenCalled();
    expect(
      (await run([task({ harness: "codex", model: "next", providerAccountId: "acct" })])).repoint,
    ).not.toHaveBeenCalled();
  });
});
