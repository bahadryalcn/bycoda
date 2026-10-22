import type { HostTask } from "../src/features/tasks/model/hostTasks";

const id = { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" };
const pageFields = {
  offset: { type: "integer", minimum: 0 },
  limit: { type: "integer", minimum: 1, maximum: 100 },
};
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: ["taskId"],
  additionalProperties: false,
});

export const TASK_CONFIGURATION_FIELDS = {
  dependsOn: {
    type: "array",
    maxItems: 20,
    items: id,
    description:
      "Existing tasks in this project that must finish first. Empty clears dependencies.",
  },
  verifyCommand: {
    type: "string",
    maxLength: 4000,
    description: "Local check command run by the host before review. Empty clears the check.",
  },
};

export const TASK_READ_TOOLS = {
  "tasks.artifacts.list": object({ taskId: id, ...pageFields }),
  "tasks.dependencies.list": object({ taskId: id, ...pageFields }),
};

/** Adds only scheduler configuration; runtime identity and approval stay host-owned.
 * HostTasks.save remains responsible for dependency cycle and edit-state checks. */
export function normalizeConversationTaskConfiguration(
  input: Record<string, unknown>,
  taskId: string,
  projectId: string,
  tasks: readonly Pick<HostTask, "id" | "projectId">[],
): Pick<HostTask, "dependsOn" | "verifyCommand"> {
  const patch: Pick<HostTask, "dependsOn" | "verifyCommand"> = {};
  if (input.dependsOn !== undefined) {
    const dependencies = input.dependsOn;
    if (
      !Array.isArray(dependencies) ||
      dependencies.length > 20 ||
      dependencies.some(
        (value) =>
          typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value) || value === taskId,
      )
    )
      throw new Error("Provide at most 20 task dependencies without self references");
    for (const dependency of dependencies)
      if (!tasks.some((task) => task.id === dependency && task.projectId === projectId))
        throw new Error("Dependencies must be existing tasks in this project");
    patch.dependsOn = [...new Set(dependencies as string[])];
  }
  if (input.verifyCommand !== undefined) {
    if (
      typeof input.verifyCommand !== "string" ||
      input.verifyCommand.length > 4000 ||
      input.verifyCommand.includes("\0")
    )
      throw new Error("Provide a bounded check command");
    patch.verifyCommand = input.verifyCommand.trim();
  }
  return patch;
}

function page<T>(items: T[], input: Record<string, unknown>) {
  const offset = input.offset ?? 0,
    limit = input.limit ?? 20;
  if (
    !Number.isSafeInteger(offset) ||
    Number(offset) < 0 ||
    !Number.isSafeInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 100
  )
    throw new Error("Provide bounded task pagination");
  const next = Number(offset) + Number(limit);
  return {
    items: items.slice(Number(offset), next),
    total: items.length,
    offset,
    ...(next < items.length ? { nextOffset: next } : {}),
  };
}

/** Metadata only: never opens, transfers or executes artifact paths. */
export function callConversationTaskRead(
  action: string,
  input: Record<string, unknown>,
  task: HostTask,
  projectTasks: readonly HostTask[],
): unknown {
  if (action === "tasks.artifacts.list")
    return {
      taskId: task.id,
      ...page(
        (task.artifactPaths ?? []).map((path) => ({
          path,
          ...(task.artifactHashes?.[path] ? { hash: task.artifactHashes[path] } : {}),
        })),
        input,
      ),
      deliveredCommit: task.deliveredCommit,
      merged: task.merged === true,
    };
  if (action === "tasks.dependencies.list") {
    const visible = projectTasks.filter((entry) => entry.projectId === task.projectId);
    const items = (task.dependsOn ?? []).map((taskId) => {
      const dependency = visible.find((entry) => entry.id === taskId);
      return dependency
        ? {
            taskId,
            title: dependency.title,
            status: dependency.status,
            blocking: dependency.status !== "done",
          }
        : { taskId, status: "unavailable", blocking: false };
    });
    return {
      taskId: task.id,
      ...page(items, input),
      blockingCount: items.filter((item) => item.blocking).length,
    };
  }
  throw new Error("Unknown task read action");
}
