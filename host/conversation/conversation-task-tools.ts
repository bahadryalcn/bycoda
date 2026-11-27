import { hasUnmergedBranch, type HostTask } from "../../src/features/tasks/model/hostTasks";
import type {
  WorkExecutor,
  WorkHelpers,
} from "../../src/shared/model/host-contracts/work-executor";

export function assertConversationWorkspaceIntent(input: Record<string, unknown>): void {
  if (input.isolate !== undefined && typeof input.isolate !== "boolean")
    throw new Error("Workspace isolation must be a boolean.");
  if (
    [
      "autoMerge",
      "deliveryRequested",
      "integrationDelivery",
      "merge",
      "push",
      "pr",
      "createPr",
      "publish",
    ].some((key) => input[key] !== undefined && input[key] !== false)
  )
    throw new Error(
      "Agent tools cannot request integration delivery, push or PR publication. Use the owner UI.",
    );
}

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
  isolate: {
    type: "boolean",
    description:
      "Use an owned worktree when true or the current checkout when false. Omit to follow project workspace policy.",
  },
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

/** Who runs a new task, its helpers and its model; the same words on every surface that creates work. */
export const WORK_CHOICE_FIELDS = {
  executor: {
    enum: ["agent", "crew", "auto"],
    description:
      "Who runs it: one agent (default), a crew (also give crewDefinitionId), or auto to let the host choose. Only say crew or auto when the owner asked for it.",
  },
  crewDefinitionId: { type: "string", maxLength: 64 },
  helpers: {
    enum: ["settings", "off", "use"],
    description:
      "Subagents and advisor: settings (default, follow Settings > Models), off (the owner wants it done alone) or use (the owner asked for helpers).",
  },
  useSessionModel: {
    type: "boolean",
    description:
      "Run with this conversation's own model instead of Settings > Models. Only when the owner asked for that model.",
  },
};

/** The executor and helpers a create call asked for; nothing here grants authority. */
export function conversationWorkChoices(input: Record<string, unknown>): {
  executor?: WorkExecutor;
  helpers?: WorkHelpers;
  useSessionModel: boolean;
} {
  const crewId = typeof input.crewDefinitionId === "string" ? input.crewDefinitionId : undefined;
  const kind = input.executor ?? (crewId ? "crew" : undefined);
  if (kind !== undefined && kind !== "agent" && kind !== "crew" && kind !== "auto")
    throw new Error("executor must be agent, crew or auto.");
  if (kind === "crew" && !crewId) throw new Error("A crew executor needs crewDefinitionId.");
  if (kind !== "crew" && crewId) throw new Error("crewDefinitionId needs executor crew.");
  const helpers = input.helpers;
  if (helpers !== undefined && helpers !== "settings" && helpers !== "off" && helpers !== "use")
    throw new Error("helpers must be settings, off or use.");
  if (input.useSessionModel !== undefined && typeof input.useSessionModel !== "boolean")
    throw new Error("useSessionModel must be a boolean.");
  return {
    ...(kind === "crew"
      ? { executor: { kind, crewDefinitionId: crewId! } }
      : kind
        ? { executor: { kind } }
        : {}),
    ...(helpers && helpers !== "settings" ? { helpers: { mode: helpers } } : {}),
    useSessionModel: input.useSessionModel === true,
  };
}

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
): Pick<HostTask, "dependsOn" | "verifyCommand" | "isolate"> {
  assertConversationWorkspaceIntent(input);
  const patch: Pick<HostTask, "dependsOn" | "verifyCommand" | "isolate"> = {};
  if (typeof input.isolate === "boolean") patch.isolate = input.isolate;
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
            blocking: dependency.status !== "done" || hasUnmergedBranch(dependency),
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
