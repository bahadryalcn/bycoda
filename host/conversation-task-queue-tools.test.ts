import { describe, expect, it, vi } from "vitest";
import { ConversationTaskQueueTools } from "./conversation-task-queue-tools";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
const principal = {
  projectId: "project",
  sessionId: "caller",
  provider: "codex",
  kind: "session" as const,
};
function setup() {
  const rows = ["first", "second"].map(
    (id) => ({ id, projectId: "project", status: "queued", updatedAt: 1 }) as HostTask,
  );
  const tasks = {
    get: (id: string) => rows.find((task) => task.id === id),
    move: vi.fn(async () => rows[0]),
    reorder: vi.fn(() => rows),
  };
  const helper = new ConversationTaskQueueTools(tasks);
  return {
    rows,
    tasks,
    call: (action: "tasks.queue.pause" | "tasks.reorder", input: Record<string, unknown>) =>
      helper.call(action, input, principal, () => true),
  };
}
describe("conversation task queue", () => {
  it("pauses only a never-started queued task with a current revision", async () => {
    const f = setup();
    await f.call("tasks.queue.pause", { taskId: "first", expectedUpdatedAt: 1 });
    expect(f.tasks.move).toHaveBeenCalledWith("first", "todo");
    f.tasks.move.mockClear();
    for (const patch of [
      { status: "running" },
      { sessionId: "previous" },
      { startedAt: 10 },
      { reviewer: { sessionId: "caller" } },
      { projectId: "other" },
      { updatedAt: 2 },
    ]) {
      const original = { ...f.rows[0] };
      Object.assign(f.rows[0], patch);
      await expect(
        f.call("tasks.queue.pause", { taskId: "first", expectedUpdatedAt: 1 }),
      ).rejects.toThrow();
      f.rows[0] = original;
    }
    expect(f.tasks.move).not.toHaveBeenCalled();
  });
  it("checks every selected task before reordering", async () => {
    const f = setup();
    const order = [
      { taskId: "second", expectedUpdatedAt: 1 },
      { taskId: "first", expectedUpdatedAt: 1 },
    ];
    await f.call("tasks.reorder", { order });
    expect(f.tasks.reorder).toHaveBeenCalledWith(["second", "first"]);
    f.tasks.reorder.mockClear();
    for (const bad of [
      [],
      [order[0], order[0]],
      [{ taskId: "foreign", expectedUpdatedAt: 1 }],
      [order[0], { taskId: "first", expectedUpdatedAt: 0 }],
    ])
      await expect(f.call("tasks.reorder", { order: bad })).rejects.toThrow();
    f.rows[0].status = "done";
    await expect(f.call("tasks.reorder", { order })).rejects.toThrow("reordered");
    expect(f.tasks.reorder).not.toHaveBeenCalled();
  });
});
