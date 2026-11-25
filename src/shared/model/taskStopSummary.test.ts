import { describe, expect, it } from "vitest";
import {
  TASK_STOP_CODES,
  TASK_WAIT_CODES,
  buildTaskStop,
  type TaskStopInput,
  type TaskWait,
} from "./host-contracts/task-stop";
import { taskStopSummary, taskStopText } from "./taskStopSummary";

const blocked = (input: TaskStopInput) => ({
  status: "blocked",
  stop: buildTaskStop(input, 1),
});
const waiting = (wait: TaskWait) => ({ status: "queued", wait });

describe("taskStopSummary", () => {
  it("names every stop code with a title, reason and next action", () => {
    expect(
      TASK_STOP_CODES.map((code) => {
        const summary = taskStopSummary(
          blocked({ code, message: `Detail for ${code.replace(/_/g, " ")}.` }),
        );
        return [code, summary?.title, summary?.reason, summary?.action, summary?.tone];
      }),
    ).toMatchInlineSnapshot(`
      [
        [
          "owner_stopped",
          "Stopped by you",
          "Detail for owner stopped.",
          "Retry the task",
          "neutral",
        ],
        [
          "host_interrupted",
          "Interrupted",
          "Detail for host interrupted.",
          "Retry the task",
          "danger",
        ],
        [
          "budget_exhausted",
          "Run budget reached",
          "Detail for budget exhausted.",
          "Raise the budget",
          "warning",
        ],
        [
          "run_failed",
          "Failed",
          "Detail for run failed.",
          "Retry the task",
          "danger",
        ],
        [
          "repair_exhausted",
          "Correction limit reached",
          "Detail for repair exhausted.",
          "Update the instructions",
          "warning",
        ],
        [
          "preparation_failed",
          "Could not prepare",
          "Detail for preparation failed.",
          "Retry the task",
          "danger",
        ],
        [
          "permission_required",
          "Needs permission",
          "Detail for permission required.",
          "Update the instructions",
          "warning",
        ],
        [
          "input_required",
          "Waiting for your instructions",
          "Detail for input required.",
          "Update the instructions",
          "warning",
        ],
        [
          "dependency_cycle",
          "Dependency cycle",
          "Detail for dependency cycle.",
          "Fix or remove the dependency",
          "danger",
        ],
        [
          "dependency_stopped",
          "Dependency stopped",
          "Detail for dependency stopped.",
          "Fix or remove the dependency",
          "warning",
        ],
        [
          "crew_unavailable",
          "Crew unavailable",
          "Detail for crew unavailable.",
          "Retry the task",
          "danger",
        ],
        [
          "working_copy_changed",
          "Working copy changed",
          "Detail for working copy changed.",
          "Retry the task",
          "warning",
        ],
        [
          "cleanup_failed",
          "Cleanup failed",
          "Detail for cleanup failed.",
          "Retry the task",
          "danger",
        ],
        [
          "restored",
          "Restored",
          "Detail for restored.",
          "Retry the task",
          "info",
        ],
        [
          "scheduling_failed",
          "Could not be scheduled",
          "Detail for scheduling failed.",
          "Retry the task",
          "danger",
        ],
      ]
    `);
  });

  it("names the phase and repair detail of a stop", () => {
    const title = (input: TaskStopInput) => taskStopSummary(blocked(input))?.title;
    expect(title({ code: "run_failed", phase: "review", message: "x" })).toBe("Review failed");
    expect(title({ code: "run_failed", phase: "check", message: "x" })).toBe("Checks failed");
    expect(title({ code: "repair_exhausted", repair: "external", message: "x" })).toBe(
      "Needs an external check",
    );
    expect(title({ code: "repair_exhausted", repair: "no_progress", message: "x" })).toBe(
      "Correction stopped · findings unchanged",
    );
    expect(title({ code: "run_failed", nextAction: "takeover", message: "x" })).toBe(
      "AI takeover pending",
    );
    expect(title({ code: "owner_stopped", nextAction: "restart", message: "x" })).toBe(
      "Ready to restart",
    );
  });

  it("names every wait code, and the dependency a task waits on", () => {
    expect(
      TASK_WAIT_CODES.map((code) => {
        const summary = taskStopSummary(
          waiting({ code, message: `Detail for ${code.replace(/_/g, " ")}.` }),
        );
        return [code, summary?.title, summary?.reason];
      }),
    ).toMatchInlineSnapshot(`
      [
        [
          "model_quota",
          "Waiting for model quota",
          "Detail for model quota.",
        ],
        [
          "usage_limit",
          "Waiting for usage limit",
          "Detail for usage limit.",
        ],
        [
          "daily_limit",
          "Daily limit reached",
          "Detail for daily limit.",
        ],
        [
          "crew_capacity",
          "Waiting for crew capacity",
          "Detail for crew capacity.",
        ],
        [
          "dependency",
          "Waiting for a dependency",
          "Detail for dependency.",
        ],
        [
          "assistant_hold",
          "On hold for the assistant",
          "Detail for assistant hold.",
        ],
      ]
    `);
    expect(
      taskStopSummary(
        waiting({
          code: "dependency",
          waitsOn: { taskId: "d", code: "owner_stopped" },
          message: "Waiting for Build.",
        }),
      )?.reason,
    ).toBe("Dependency: Stopped by you");
  });

  it("shows a blocked task without a recorded code as having no recorded reason", () => {
    expect(taskStopSummary({ status: "blocked" })).toMatchObject({
      code: "unrecorded",
      title: "Blocked",
      reason: "Reason not recorded",
    });
    expect(taskStopSummary({ status: "running" })).toBeUndefined();
  });

  it("gives plain-text surfaces one line, built from the same summary", () => {
    expect(
      taskStopText(blocked({ code: "budget_exhausted", message: "Agent minutes 30/30." })),
    ).toBe("Run budget reached: Agent minutes 30/30.");
    expect(taskStopText(waiting({ code: "daily_limit", message: "Limit reached." }))).toBe(
      "Daily limit reached: Limit reached.",
    );
    expect(taskStopText({ status: "done" })).toBeUndefined();
  });
});
