import type { HostStore } from "../store";
import type { HostTasks } from "../tasks/tasks";
import type { CrewDefinition, CrewRun } from "../../src/features/crews/model/crew";
import { readCrewDefinitions, readCrewRun } from "./crew-scheduler-projection";
import { crewCoordinatorLaunchPending, crewCoordinatorWorkWait } from "./coordinator-work";
import { CrewRoutingWait, CrewWorkWait } from "./crew-routing";
import { workCrewId } from "../../src/shared/model/host-contracts/work-executor";

type TaskCrewRunner = NonNullable<HostTasks["crewRunner"]>;
type CrewTask = Parameters<TaskCrewRunner["start"]>[0];
type CrewTaskRunnerPorts = {
  store: HostStore;
  startRun(
    projectId: string,
    definitionId: string,
    prompt: string,
    requestId: string,
    runtimeMode: CrewTask["runtimeMode"],
    principal: undefined,
    newConversation: boolean,
    sourceTaskId: string,
  ): Promise<CrewRun>;
  readRun(id: string, projectId: string): Promise<CrewRun>;
  call(action: "crews.stop", input: { runId: string }, projectId: string): Promise<unknown>;
};

/** A crew that has a coordinator and room to assign work can take a task. */
const crewCanRun = (definition: CrewDefinition) =>
  definition.agents.some((agent) => agent.role === "coordinator") &&
  definition.policy.maxParallel > 0 &&
  definition.policy.maxAssignments > 0;

/** Task-owned Crew worker lifecycle adapter; coordinator admission and execution metadata stay canonical. */
export function createCrewTaskRunner(ports: CrewTaskRunnerPorts): TaskCrewRunner {
  return {
    choices: async (projectId) =>
      (await readCrewDefinitions(ports.store)).definitions
        .filter((d) => (!d.projectId || d.projectId === projectId) && crewCanRun(d))
        .map((d) => ({
          id: d.id,
          name: d.name,
          summary: d.agents.map((agent) => `${agent.name} (${agent.role})`).join(", "),
        })),
    validate: async (task) => {
      if (
        !(await readCrewDefinitions(ports.store)).definitions.some(
          (d) => d.id === workCrewId(task) && (!d.projectId || d.projectId === task.projectId),
        )
      )
        throw new Error("Choose a crew available to this task's project.");
    },
    start: async (task) => {
      const run = await ports.startRun(
        task.projectId,
        workCrewId(task)!,
        `Task: ${task.title}\n\n${task.prompt}${task.verifyCommand ? `\n\nThe final assignment must pass this exact check command: ${task.verifyCommand}` : ""}`,
        task.crewExecutionId!,
        task.runtimeMode,
        undefined,
        false,
        task.id,
      );
      if (run.routingWait) throw new CrewRoutingWait(run.routingWait.nextResetAt);
      if (run.error) throw new Error(run.error);
      if (!run.coordinatorSessionId || (await crewCoordinatorLaunchPending(ports.store, run))) {
        const wait = await crewCoordinatorWorkWait(ports.store, run);
        if (wait) throw new CrewWorkWait(wait.reason, wait.unstarted);
        throw new Error("Crew coordinator could not start.");
      }
      const session = (await ports.store.session(run.coordinatorSessionId)).session;
      return {
        sessionId: run.coordinatorSessionId,
        harness: session.harness,
        model: session.model,
        modelSettings: session.modelSettings,
      };
    },
    state: async (task) => {
      const run = await ports.readRun(task.crewExecutionId!, task.projectId);
      return { status: run.status, error: run.error };
    },
    stop: async (task) => {
      if (!task.crewExecutionId) return;
      const run = await readCrewRun(ports.store, task.crewExecutionId);
      if (run && run.projectId === task.projectId && run.status !== "finished")
        await ports.call("crews.stop", { runId: run.id }, task.projectId);
    },
  };
}
