import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionTask, sessionTaskDraft, taskTitleFromRequest } from "./sessionTask";

const saveTask = vi.hoisted(() => vi.fn());
vi.mock("./taskClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./taskClient")>()),
  taskMachines: async () => [{ id: "local" }],
  saveTask,
}));

const session = {
  id: "session-a",
  cwd: "/repo",
  harness: "claude" as const,
  model: "claude:test",
  modelSettings: { effort: "high" },
  runtimeMode: "auto" as const,
};

beforeEach(() => saveTask.mockReset());

describe("sessionTaskDraft", () => {
  it("keeps the request exactly as typed and titles the task from its first line", () => {
    const request = "Fix the login button label.\nIt says Sing in.";
    const draft = sessionTaskDraft(session, request);
    expect(draft.request).toBe(request);
    expect(draft.prompt).toBe(request);
    expect(draft.title).toBe("Fix the login button label.");
    expect(draft.origin).toEqual({ kind: "session", sessionId: "session-a" });
    expect(draft).toMatchObject({ review: true, autoMerge: false, continueUntilDone: false });
  });

  it("shortens a long first line to a title", () => {
    expect(taskTitleFromRequest("x".repeat(300)).length).toBeLessThanOrEqual(80);
    expect(taskTitleFromRequest("\n\n  Second line wins\nthird")).toBe("Second line wins");
  });
});

describe("createSessionTask", () => {
  it("sends one create for the same request delivered twice at once", async () => {
    saveTask.mockResolvedValue({ id: "task-a", title: "Do it" });
    const [first, second] = await Promise.all([
      createSessionTask(session, "Do it"),
      createSessionTask(session, "Do it"),
    ]);
    expect(saveTask).toHaveBeenCalledTimes(1);
    expect(saveTask.mock.calls[0][1]).toMatchObject({ request: "Do it" });
    expect(saveTask.mock.calls[0][2]).toBe("todo");
    expect(second).toBe(first);
  });

  it("retries with the same creation receipt after a failure", async () => {
    saveTask.mockRejectedValueOnce(new Error("lost reply")).mockResolvedValue({ id: "t" });
    await expect(createSessionTask(session, "Retry me")).rejects.toThrow("lost reply");
    await createSessionTask(session, "Retry me");
    expect(saveTask.mock.calls[1][1]).toBe(saveTask.mock.calls[0][1]);
  });
});
