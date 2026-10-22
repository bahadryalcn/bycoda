import { useQuery, useQueryClient } from "@tanstack/react-query";
import { machineCapabilities } from "../../automations/model/machineSnapshot";
import {
  backgroundMachineFor,
  backgroundMachines,
  hostProjectFor,
} from "../../automations/model/hostAutomationClient";
import { remoteRequest } from "../../connections/model/connections";
import type {
  HostModelCatalog,
  HostProject,
  RemoteMachine,
} from "../../connections/model/protocol";
import type { HostTask } from "../../tasks/model/hostTasks";
import {
  HOST_CREWS,
  HOST_CREW_TASKS,
  HOST_CREW_DELETE,
  HOST_CREW_AGENT_GROUPS,
  type CrewDefinition,
  type CrewRun,
  type SavedCrewAgent,
} from "./crew";

export type CrewRunView = CrewRun & {
  tasks: HostTask[];
  coordinatorStatus?: "idle" | "running" | "interrupted";
};
export type ProjectCrews = {
  taskExecutionSupported?: boolean;
  /** Older hosts keep every saved crew; delete needs this host capability. */
  deleteSupported?: boolean;
  /** Older hosts drop member groups and library sources, so their controls stay hidden. */
  groupsSupported?: boolean;
  machine: RemoteMachine;
  project: HostProject;
  definitions: CrewDefinition[];
  agents: SavedCrewAgent[];
  runs: CrewRunView[];
  catalog: HostModelCatalog;
};
export function useProjectCrews(cwd: string, enabled = true) {
  const client = useQueryClient();
  const key = [HOST_CREWS, cwd];
  const query = useQuery({
    queryKey: key,
    enabled: enabled && !!cwd && cwd !== "~",
    queryFn: async (): Promise<ProjectCrews> => {
      const machines = await backgroundMachines(HOST_CREWS);
      const machine = backgroundMachineFor(machines, cwd);
      if (!machine) throw new Error("Update and connect this project's host to use Crews.");
      const project = await hostProjectFor(machine, cwd);
      const [state, catalog] = await Promise.all([
        remoteRequest<Pick<ProjectCrews, "definitions" | "runs" | "agents">>(
          machine.id,
          "crews.list",
          { projectId: project.id },
        ),
        remoteRequest<HostModelCatalog>(machine.id, "models.list", { projectId: project.id }),
      ]);
      const capabilities = await machineCapabilities(machine);
      return {
        machine,
        project,
        ...state,
        catalog,
        taskExecutionSupported: capabilities.includes(HOST_CREW_TASKS),
        deleteSupported: capabilities.includes(HOST_CREW_DELETE),
        groupsSupported: capabilities.includes(HOST_CREW_AGENT_GROUPS),
      };
    },
    staleTime: 3000,
    refetchInterval: 5000,
    retry: false,
  });
  const call = async <T = unknown>(action: string, input: Record<string, unknown>): Promise<T> => {
    const data = query.data;
    if (!data) throw new Error("Crew host is not connected");
    const result = await remoteRequest<T>(
      data.machine.id,
      action,
      { ...input, projectId: data.project.id },
      false,
      true,
    );
    await client.invalidateQueries({ queryKey: key });
    return result;
  };
  return { ...query, call };
}
