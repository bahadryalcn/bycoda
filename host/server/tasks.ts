import { HostAutomations } from "../automations/automations";
import { HostGoals } from "../goals/goals";
import { HostSprints } from "../sprints/sprints";
import { HostTasks } from "../tasks/tasks";
import type { ServerBindings } from "./bindings";
export async function createTasksRuntime(
  dependencies: Pick<
    ServerBindings,
    "automationsOverride" | "engine" | "managed" | "tasksOverride" | "goalsOverride"
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
    });
  await tasks.ready;
  const sprints = new HostSprints(dependencies.engine.store);
  await sprints.ready;
  const goals =
    dependencies.goalsOverride ??
    new HostGoals(dependencies.engine.store, dependencies.engine, tasks);
  await goals.ready;
  return { automations, tasks, sprints, goals };
}
