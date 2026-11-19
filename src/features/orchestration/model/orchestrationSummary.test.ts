import { describe, expect, it } from "vitest";
import { orchestrationTaskLabelCode, type OrchestrationSummary } from "./orchestrationSummary";

type Task = OrchestrationSummary["tasks"][number];

function task(status: Task["status"], extra: Partial<Task> = {}): Task {
  return {
    sessionId: "s1",
    title: "Worker",
    harness: "codex",
    model: "m",
    status,
    ...extra,
  } as Task;
}

describe("orchestrationTaskLabelCode", () => {
  it("maps each live status to its code", () => {
    const live: OrchestrationSummary = { status: "running", live: true, tasks: [] };
    expect(orchestrationTaskLabelCode(task("queued"), live)).toBe("queued");
    expect(orchestrationTaskLabelCode(task("running"), live)).toBe("working");
    expect(orchestrationTaskLabelCode(task("cancelling"), live)).toBe("stopping");
    expect(orchestrationTaskLabelCode(task("completed"), live)).toBe("done");
    expect(orchestrationTaskLabelCode(task("failed"), live)).toBe("failed");
    expect(orchestrationTaskLabelCode(task("blocked"), live)).toBe("needsReview");
    expect(orchestrationTaskLabelCode(task("interrupted"), live)).toBe("interrupted");
    expect(orchestrationTaskLabelCode(task("cancelled"), live)).toBe("cancelled");
  });

  it("prefers needs-input over every status", () => {
    const live: OrchestrationSummary = { status: "running", live: true, tasks: [] };
    expect(orchestrationTaskLabelCode(task("running", { needsInput: true }), live)).toBe(
      "needsInput",
    );
  });

  it("marks unfinished work from a saved run as saved, not working", () => {
    const saved: OrchestrationSummary = { status: "running", tasks: [] };
    expect(orchestrationTaskLabelCode(task("running"), saved)).toBe("saved");
    expect(orchestrationTaskLabelCode(task("queued"), saved)).toBe("saved");
    expect(orchestrationTaskLabelCode(task("cancelling"), saved)).toBe("saved");
  });

  it("marks queued work of a paused live run as paused", () => {
    const paused: OrchestrationSummary = { status: "paused", live: true, tasks: [] };
    expect(orchestrationTaskLabelCode(task("queued"), paused)).toBe("paused");
    expect(orchestrationTaskLabelCode(task("running"), paused)).toBe("working");
  });
});
