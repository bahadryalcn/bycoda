import { describe, expect, it } from "vitest";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { mergeQueueAdmission } from "./queue-admission-merge";

const original = {
  id: "main", title: "Report", prompt: "Write report", projectId: "project",
  harness: "claude", model: "claude:test", modelSettings: {}, runtimeMode: "auto",
  maxRunMinutes: 0, isolate: false, review: false, status: "todo", createdAt: 1,
  updatedAt: 1, reviewNotes: [],
} as HostTask;
const prepared = { ...original, status: "queued", updatedAt: 2 } as HostTask;

describe("queue admission merge", () => {
  it("preserves unrelated concurrent metadata", () => {
    const current = { ...original, reviewNotes: [{ text: "Concurrent note" }] } as unknown as HostTask;
    expect(mergeQueueAdmission(prepared, original, current)).toMatchObject({
      status: "queued", reviewNotes: current.reviewNotes,
    });
  });
  it("refuses changed configuration or transition fields", () => {
    expect(() => mergeQueueAdmission(prepared, original, { ...original, prompt: "Changed" })).toThrow();
    expect(() => mergeQueueAdmission(prepared, original, { ...original, status: "blocked" })).toThrow();
  });
  it("refuses a concurrent edit to a field the transition clears", () => {
    const before = { ...original, error: "First" };
    const after = { ...prepared, error: undefined };
    expect(() => mergeQueueAdmission(after, before, { ...before, error: "Second" })).toThrow();
  });
});
