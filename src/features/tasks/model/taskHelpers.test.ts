import { describe, expect, it } from "vitest";
import { failuresByTask, type TaskHelper } from "./taskHelpers";

const helper = (taskId: string, status: TaskHelper["status"], startedAt: number, error?: string) =>
  ({
    runId: `${taskId}-${startedAt}`,
    taskId,
    kind: "subagent",
    title: "Helper",
    harness: "codex",
    model: "m",
    status,
    startedAt,
    ...(error ? { error } : {}),
  }) satisfies TaskHelper;

describe("failuresByTask", () => {
  it("keeps the newest failure per machine and task", () => {
    const failures = failuresByTask(
      ["a", "b"],
      [
        [
          helper("t", "failed", 1, "old"),
          helper("t", "failed", 2, "new"),
          helper("u", "running", 3),
        ],
        [helper("t", "failed", 1, "other machine")],
      ],
    );
    expect([...failures].map(([key, value]) => [key, value.error])).toEqual([
      ["a:t", "new"],
      ["b:t", "other machine"],
    ]);
  });
});
