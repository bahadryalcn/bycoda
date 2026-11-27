import { describe, expect, it } from "vitest";
import { TasksHelpersResultSchema } from "../../src/shared/model/host-contracts/tasks";
import { MAX_TASK_HELPERS, taskHelpers } from "./task-helpers";
import type { DelegationRecord } from "./store";

const record = (index: number, extra: Partial<DelegationRecord> = {}): DelegationRecord => ({
  runId: `run-${index}`,
  kind: "subagent",
  parentSessionId: "parent",
  childSessionId: `child-${index}`,
  model: { harness: "codex", model: "gpt-6.1" },
  title: `Helper ${index}`,
  requestKey: `key-${index}`,
  payloadHash: `hash-${index}`,
  budgetScope: { taskId: "task" },
  startedAt: index,
  ...extra,
});

describe("taskHelpers", () => {
  it("returns only the task's own helpers, newest first, in the contract shape", () => {
    const rows = taskHelpers(
      [
        record(1),
        record(2, { status: "succeeded", finishedAt: 5 }),
        record(3, { budgetScope: { taskId: "other" } }),
        record(4, { budgetScope: undefined }),
      ],
      { taskId: "task" },
    );
    expect(rows.map((row) => [row.runId, row.status])).toEqual([
      ["run-2", "succeeded"],
      ["run-1", "running"],
    ]);
    expect(TasksHelpersResultSchema.parse(rows)).toEqual(rows);
  });

  it("without a task id lists only failed helpers of any task, with their error", () => {
    const rows = taskHelpers(
      [
        record(1, { status: "failed", error: "No capacity." }),
        record(2, { status: "succeeded" }),
        record(3, { status: "failed", budgetScope: { taskId: "other" } }),
        record(4, { status: "failed", budgetScope: undefined }),
      ],
      { failedOnly: true },
    );
    expect(rows.map((row) => [row.taskId, row.error])).toEqual([
      ["other", undefined],
      ["task", "No capacity."],
    ]);
  });

  it("is bounded", () => {
    const rows = taskHelpers(
      Array.from({ length: MAX_TASK_HELPERS + 5 }, (_, index) => record(index)),
      { taskId: "task" },
    );
    expect(rows).toHaveLength(MAX_TASK_HELPERS);
    expect(rows[0].runId).toBe(`run-${MAX_TASK_HELPERS + 4}`);
  });
});
