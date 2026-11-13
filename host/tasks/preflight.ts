import { parseHostTask } from "./routing-input";
import type { TaskPreflightItem } from "../../src/features/tasks/model/taskPreflight";
import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import { type HostTask, type HostTaskInput } from "../../src/features/tasks/model/hostTasks";
import { taskWorkspace } from "./task-workspace";
import { checkTaskPreflight } from "./task-preflight";
import { evaluateTaskPreflight } from "../../src/features/tasks/model/taskPreflight";
import { parseTaskEvaluation } from "../../src/features/tasks/model/taskMetrics";
import type { TaskContext } from "./context";
export async function preflight(
  context: TaskContext,
  raw: unknown,
): Promise<{
  items: TaskPreflightItem[];
  state: "ready" | "blocked" | "unknown";
  checkedAt: number;
}> {
  await context.ready;

  const task = parseHostTask(raw);
  const project = await context.store.project(task.projectId);
  const cwd = task.workspace ? (await taskWorkspace(project.cwd, task.workspace)).cwd : project.cwd;
  return await context.preflightAt(task, cwd);
}

export async function preflightAt(
  context: TaskContext,
  task: HostTaskInput,
  cwd: string,
): Promise<{
  items: TaskPreflightItem[];
  state: "ready" | "blocked" | "unknown";
  checkedAt: number;
}> {
  const resources = await checkTaskPreflight(cwd, task.preflightRequirements ?? [], {
    now: context.now,
  });
  let readableProject = false;
  try {
    await access(cwd, constants.R_OK);
    readableProject = (await lstat(cwd)).isDirectory();
  } catch {
    /* Keep failed reads visible. */
  }
  const now = context.now();
  const report = evaluateTaskPreflight(
    task.preflightRequirements ?? [],
    {
      host: { state: "ready", origin: "runtime", checkedAt: now },
      project: {
        state: readableProject ? "ready" : "missing",
        origin: "runtime",
        checkedAt: now,
      },
      provider: {
        state: "unknown",
        origin: "configuration",
        checkedAt: now,
        detail: "Provider authentication is checked when its run starts.",
      },
      model: {
        state: "unknown",
        origin: "configuration",
        checkedAt: now,
        detail: "The selected model has not been contacted by this preparation check.",
      },
      resources,
    },
    now,
  );
  // These checks are deferred to provider execution, never inferred from inventory.
  const items = report.items.map((item) =>
    item.key === "provider" || item.key === "model" ? { ...item, required: false } : item,
  );
  const required = items.filter((item) => item.required);
  return {
    ...report,
    items,
    state: required.some((item) => item.state === "blocked")
      ? ("blocked" as const)
      : required.some((item) => item.state === "unknown")
        ? ("unknown" as const)
        : ("ready" as const),
  };
}

export async function recordEvaluation(
  context: TaskContext,
  id: string,
  raw: unknown,
  expectedUpdatedAt: unknown,
): Promise<HostTask> {
  await context.ready;
  return context.store.db.scope(async () => {
    await context.ready;

    const task = await context.get(id);
    if (!task || task.updatedAt !== expectedUpdatedAt)
      throw new Error("Task changed. Refresh before recording the outcome.");
    if (task.status !== "done" && task.status !== "review")
      throw new Error("Record an outcome after task checks finish.");
    const evaluation = parseTaskEvaluation(raw);
    return await context.write({
      ...task,
      evaluation: { ...evaluation, recordedAt: context.now() },
      updatedAt: Math.max(context.now(), task.updatedAt + 1),
    });
  });
}
