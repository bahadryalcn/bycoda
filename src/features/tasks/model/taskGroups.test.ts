import { describe, expect, it } from "vitest";
import { TASK_STATUSES } from "./hostTasks";
import { TASK_GROUPS, taskGroup } from "./taskGroups";

describe("task groups", () => {
  it("puts review and waiting work under Needs you and keeps Blocked apart", () => {
    expect(taskGroup({ status: "review" })).toBe("needsYou");
    expect(taskGroup({ status: "running", needsInput: true })).toBe("needsYou");
    expect(taskGroup({ status: "verifying", needsInput: true })).toBe("needsYou");
    expect(taskGroup({ status: "running" })).toBe("running");
    expect(taskGroup({ status: "verifying" })).toBe("running");
    expect(taskGroup({ status: "queued" })).toBe("todo");
    expect(taskGroup({ status: "todo" })).toBe("todo");
    expect(taskGroup({ status: "blocked" })).toBe("blocked");
    expect(taskGroup({ status: "done" })).toBe("done");
  });

  it("assigns every status to a listed group", () => {
    for (const status of TASK_STATUSES) expect(TASK_GROUPS).toContain(taskGroup({ status }));
  });
});
