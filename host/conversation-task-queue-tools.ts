import type { HostTasks } from "./tasks";
import type { RuntimeLogPrincipal } from "./runtime-log-tools";

const id = { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" };
const version = { type: "integer", minimum: 0 };
const revision = {
  type: "object",
  properties: { taskId: id, expectedUpdatedAt: version },
  required: ["taskId", "expectedUpdatedAt"],
  additionalProperties: false,
};
export const TASK_QUEUE_TOOLS = {
  "tasks.queue.pause": revision,
  "tasks.reorder": {
    type: "object",
    properties: { order: { type: "array", minItems: 1, maxItems: 100, items: revision } },
    required: ["order"],
    additionalProperties: false,
  },
};
export type TaskQueueTool = keyof typeof TASK_QUEUE_TOOLS;
export const isTaskQueueTool = (action: string): action is TaskQueueTool =>
  Object.hasOwn(TASK_QUEUE_TOOLS, action);
export const describeTaskQueueTool = (action: string): string | undefined =>
  isTaskQueueTool(action)
    ? "Manage this project's pending task order using versions read from tasks.get/list. queue.pause returns only a never-started queued task to To do. reorder sets relative order of up to 100 To do/queued tasks. The calling task/reviewer cannot manage itself. Does not start, complete, merge, delete or discard task work."
    : undefined;

export class ConversationTaskQueueTools {
  constructor(private readonly tasks: Pick<HostTasks, "get" | "reorder" | "move">) {}
  async call(
    action: TaskQueueTool,
    input: Record<string, unknown>,
    principal: RuntimeLogPrincipal,
    authorized: () => boolean,
  ): Promise<unknown> {
    const check = () => {
      if (!authorized()) throw new Error("Session authority revoked.");
    };
    check();
    const selected = action === "tasks.queue.pause" ? [input] : input.order;
    if (!Array.isArray(selected) || !selected.length || selected.length > 100)
      throw new Error("Provide 1 to 100 task revisions.");
    const seen = new Set<string>();
    const tasks = selected.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw new Error("Invalid task revision.");
      const { taskId, expectedUpdatedAt } = entry as Record<string, unknown>;
      if (typeof taskId !== "string" || seen.has(taskId))
        throw new Error("Provide unique task IDs.");
      seen.add(taskId);
      const task = this.tasks.get(taskId);
      if (!task || task.projectId !== principal.projectId)
        throw new Error("Task is not in this project.");
      if (!Number.isSafeInteger(expectedUpdatedAt) || task.updatedAt !== expectedUpdatedAt)
        throw new Error("Task changed. Read it before changing it.");
      if (
        task.sessionId === principal.sessionId ||
        task.reviewer?.sessionId === principal.sessionId
      )
        throw new Error("An agent cannot change its own active task.");
      return task;
    });
    check();
    if (action === "tasks.queue.pause") {
      if (tasks[0].status !== "queued" || tasks[0].sessionId || tasks[0].startedAt)
        throw new Error("Only a never-started queued task can be paused.");
      return this.tasks.move(tasks[0].id, "todo");
    }
    if (action === "tasks.reorder") {
      if (tasks.some((task) => task.status !== "todo" && task.status !== "queued"))
        throw new Error("Only To do and queued tasks can be reordered.");
      return this.tasks.reorder(tasks.map((task) => task.id));
    }
    throw new Error("Unknown task queue action");
  }
}
