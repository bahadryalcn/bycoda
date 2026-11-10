import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { machineCapabilities } from "../../automations/model/machineSnapshot";
import {
  backgroundMachineFor,
  backgroundMachines,
  hostProjectFor,
} from "../../automations/model/hostAutomationClient";
import { remoteRequest } from "../../connections/model/connections";
import { crewHasRunningWork } from "./crewPresentation";
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
  HOST_CREW_RUN_DELETE,
  HOST_CREW_AGENT_GROUPS,
  HOST_CREW_ACCESS,
  HOST_CREW_IDENTITY,
  HOST_CREW_TOOLS,
  type CrewDefinition,
  type CrewRun,
  type SavedCrewAgent,
} from "./crew";

/**
 * A run as `crews.list` returns it. The list is deliberately lightweight: `launch`
 * and `pendingDelivery` are omitted, member instructions are blank, message text
 * is clipped (`CREW_LIST_MESSAGE_LIMIT`) and `title` is the request's first line.
 * Code that needs the full request must treat it as unavailable.
 * `definition` is the team snapshot taken when the work started.
 */
export type CrewRunView = CrewRun & {
  tasks: HostTask[];
  coordinatorStatus?: "idle" | "running" | "interrupted";
};
export type ProjectCrews = {
  taskExecutionSupported?: boolean;
  /** Older hosts keep every saved crew; delete needs this host capability. */
  deleteSupported?: boolean;
  runDeleteSupported?: boolean;
  /** Older hosts drop member groups and library sources, so their controls stay hidden. */
  groupsSupported?: boolean;
  accessSupported?: boolean;
  /** Older hosts drop member handles and avatar choices, so their controls stay hidden. */
  identitySupported?: boolean;
  /** Older hosts drop member tool profiles, so the Tools section stays hidden. */
  toolsSupported?: boolean;
  machine: RemoteMachine;
  project: HostProject;
  definitions: CrewDefinition[];
  agents: SavedCrewAgent[];
  runs: CrewRunView[];
  historyNextCursor?: string;
  catalog: HostModelCatalog;
  catalogError?: string;
};
/** Calls `method` on every connected host that advertises `capability`; a failing host is skipped unless all fail. */
export async function requestCrewHosts<T>(
  capability: string,
  method: string,
  params: Record<string, unknown>,
): Promise<Array<{ machineId: string; result: T }>> {
  const machines = await backgroundMachines(capability);
  const settled = await Promise.allSettled(
    machines.map(async (machine) => ({
      machineId: machine.id,
      result: await remoteRequest<T>(machine.id, method, params),
    })),
  );
  const done = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
  const failed = settled.find((entry) => entry.status === "rejected");
  if (!done.length && failed) throw (failed as PromiseRejectedResult).reason;
  return done;
}
export function useProjectCrews(cwd: string, enabled = true) {
  const [older, setOlder] = useState<CrewRunView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const historyGeneration = useRef(0);
  const firstCursor = useRef<string | undefined>(undefined);
  useEffect(() => {
    historyGeneration.current++;
    firstCursor.current = undefined;
    setOlder((previous) => (previous.length ? [] : previous));
    setNextCursor(undefined);
    setHistoryError(undefined);
  }, [cwd]);
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
      const [state, modelState] = await Promise.all([
        remoteRequest<Pick<ProjectCrews, "definitions" | "runs" | "agents" | "historyNextCursor">>(
          machine.id,
          "crews.list",
          { projectId: project.id, historyLimit: 40 },
        ),
        remoteRequest<HostModelCatalog>(machine.id, "models.list", {
          projectId: project.id,
          progressive: true,
        })
          .then((catalog) => ({ catalog, catalogError: undefined as string | undefined }))
          .catch((reason: unknown) => ({
            catalog: { models: {}, errors: {} } as HostModelCatalog,
            catalogError: reason instanceof Error ? reason.message : String(reason),
          })),
      ]);
      const capabilities = await machineCapabilities(machine);
      return {
        machine,
        project,
        ...state,
        ...modelState,
        taskExecutionSupported: capabilities.includes(HOST_CREW_TASKS),
        deleteSupported: capabilities.includes(HOST_CREW_DELETE),
        runDeleteSupported: capabilities.includes(HOST_CREW_RUN_DELETE),
        groupsSupported: capabilities.includes(HOST_CREW_AGENT_GROUPS),
        accessSupported: capabilities.includes(HOST_CREW_ACCESS),
        identitySupported: capabilities.includes(HOST_CREW_IDENTITY),
        toolsSupported: capabilities.includes(HOST_CREW_TOOLS),
      };
    },
    staleTime: 3000,
    // Active runs change quickly. Without one, this app's own calls invalidate the
    // query, and a slower poll still picks up runs that agents start through the host.
    refetchInterval: (query) =>
      query.state.data?.catalog.pending?.length
        ? 1000
        : query.state.data?.runs.some((run) => run.status === "active" || crewHasRunningWork(run))
          ? 5000
          : 15_000,
    retry: false,
  });
  useEffect(() => {
    if (firstCursor.current === query.data?.historyNextCursor) return;
    firstCursor.current = query.data?.historyNextCursor;
    historyGeneration.current++;
    setNextCursor(undefined);
    setHistoryLoading(false);
    setHistoryError(undefined);
  }, [query.data?.historyNextCursor]);
  const call = async <T = unknown>(action: string, input: Record<string, unknown>): Promise<T> => {
    const data = query.data;
    if (!data) throw new Error("Crew host is not connected");
    try {
      return await remoteRequest<T>(
        data.machine.id,
        action,
        { ...input, projectId: data.project.id },
        false,
        true,
      );
    } finally {
      // Stop can pause the crew before a provider cancellation fails.
      // Refresh that authoritative partial result without retrying the mutation.
      await client.invalidateQueries({ queryKey: key });
    }
  };
  const loadMoreHistory = async () => {
    const data = query.data;
    const cursor = nextCursor === undefined ? data?.historyNextCursor : nextCursor;
    if (!data || !cursor || historyLoading) return;
    const generation = historyGeneration.current;
    setHistoryLoading(true);
    setHistoryError(undefined);
    try {
      const page = await remoteRequest<Pick<ProjectCrews, "runs" | "historyNextCursor">>(
        data.machine.id,
        "crews.list",
        { projectId: data.project.id, historyLimit: 40, historyCursor: cursor },
      );
      if (generation !== historyGeneration.current) return;
      setOlder((previous) => {
        const rows = new Map(previous.map((run) => [run.id, run]));
        for (const run of page.runs) if (run.status === "finished") rows.set(run.id, run);
        return [...rows.values()];
      });
      setNextCursor(page.historyNextCursor ?? null);
    } catch (reason) {
      if (generation === historyGeneration.current) setHistoryError(String(reason));
    } finally {
      if (generation === historyGeneration.current) setHistoryLoading(false);
    }
  };
  // Keep this memo: one object per fetched result. Effects keyed on `data` must not
  // run on every render; on a remote project that re-rendered the sidebar forever
  // (React #185, the Mac crash). crewClient.test.ts guards it.
  const fresh = query.data;
  const data = useMemo(
    () =>
      fresh && {
        ...fresh,
        runs: [
          ...fresh.runs,
          ...older.filter((run) => !fresh.runs.some((current) => current.id === run.id)),
        ],
      },
    [fresh, older],
  );
  return {
    ...query,
    data,
    call,
    loadMoreHistory,
    historyLoading,
    historyError,
    hasMoreHistory: !!(nextCursor === undefined ? query.data?.historyNextCursor : nextCursor),
  };
}
