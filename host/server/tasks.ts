import { createHash } from "node:crypto";
import { HostAutomations } from "../automations/automations";
import { HostGoals } from "../goals/goals";
import { HostSprints } from "../sprints/sprints";
import { HostTasks } from "../tasks/tasks";
import type { ServerBindings } from "./bindings";
export async function createTasksRuntime(
  dependencies: Pick<
    ServerBindings,
    | "automationsOverride"
    | "engine"
    | "managed"
    | "tasksOverride"
    | "goalsOverride"
    | "executeBackgroundEffect"
  >,
  publish: (runtime: Awaited<ReturnType<typeof createTasksRuntime>>) => void,
) {
  publish({
    get automations() {
      return automations;
    },
    get tasks() {
      return tasks;
    },
    get sprints() {
      return sprints;
    },
    get goals() {
      return goals;
    },
  });

  const automations =
    dependencies.automationsOverride ??
    new HostAutomations(dependencies.engine.store, dependencies.engine, undefined, {
      ...dependencies.managed.services,
      policy: dependencies.managed.policy,
    });
  await automations.ready;
  const tasks =
    dependencies.tasksOverride ??
    new HostTasks(dependencies.engine.store, dependencies.engine, undefined, undefined, {
      ...dependencies.managed.services,
      policy: dependencies.managed.policy,
      automaticDelivery: async (task, plan, execute, fence) => {
        const operationId = `task-delivery:${createHash("sha256").update(`${task.id}:${plan.token}`).digest("hex")}`;
        await dependencies.executeBackgroundEffect({
          operationId,
          projectId: task.projectId,
          operation: {
            action: "git.merge",
            input: {
              projectId: task.projectId,
              taskId: task.id,
              taskUpdatedAt: task.updatedAt,
              plan,
              review: { currentBranch: plan.targetBranchRef.replace(/^refs\/heads\//, "") },
            },
          },
          execute: async (actor) =>
            dependencies.engine.store.db.withAuthorization(
              async () =>
                !fence.signal.aborted &&
                fence.valid() &&
                (await actor.authorized()) &&
                !fence.signal.aborted &&
                fence.valid(),
              () => dependencies.managed.withOwner(actor.deviceHash, execute, fence.valid),
            ),
        });
      },
    });
  await tasks.ready;
  automations.bindTasks(tasks);
  const sprints = new HostSprints(dependencies.engine.store);
  await sprints.ready;
  const goals =
    dependencies.goalsOverride ??
    new HostGoals(dependencies.engine.store, dependencies.engine, tasks);
  await goals.ready;
  return { automations, tasks, sprints, goals };
}
