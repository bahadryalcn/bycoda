import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import type { RemoteMachine } from "../../connections/model/protocol";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import {
  machineCapabilities,
  invalidateMachineSnapshot,
} from "../../automations/model/machineSnapshot";
import {
  type MachineResult,
  failedMachineNames,
  staleMachineNames,
} from "../../automations/model/machineResults";
import {
  listBoardTaskResults,
  missingMachinesNotice,
  subscribeBoardTaskChanges,
  type BoardTask,
} from "./taskClient";
import { listBoardGoalResults } from "./goalClient";
import { listBoardStewardResults } from "./stewardClient";
import { listMachineLimits } from "./settingsClient";
import { HOST_TASKS, HOST_TASKS_TODO } from "./hostTasks";
import { HOST_GOALS } from "./hostGoals";
import { HOST_STEWARDS } from "./hostStewards";
import { HOST_SETTINGS } from "./hostSettings";

const EMPTY_MACHINES: RemoteMachine[] = [];
const identity = (machine: RemoteMachine) =>
  [machine.id, machine.environmentId, machine.endpoint, isLocalSyncMachine(machine)] as const;
type Description = { capabilities: string[]; error?: string };
// Combine tracks data rather than polling timestamps/fetchStatus. Unchanged host
// answers keep the combined result reference through Query's structural sharing.
function combine<T>(results: { data: T | undefined; isPending: boolean; error: Error | null }[]) {
  return results.map(({ data, isPending, error }) => ({ data, isPending, error }));
}
function useMachineReads<T>(
  machines: RemoteMachine[],
  descriptions: { data: Description | undefined }[],
  capability: string,
  kind: string,
  visible: boolean,
  read: (machine: RemoteMachine, reachable: boolean) => Promise<T>,
) {
  return useQueries({
    queries: machines.map((machine, index) => {
      const description = descriptions[index]?.data;
      return {
        queryKey: [
          "task-board",
          ...identity(machine),
          kind,
          description?.error ? "unreachable" : "reachable",
        ],
        queryFn: () => read(machine, !description?.error),
        enabled:
          visible &&
          !!description &&
          (!!description.error || description.capabilities.includes(capability)),
        staleTime: 15_000,
        refetchInterval: 15_000,
        retry: false,
      };
    }),
    combine: combine<T>,
  });
}

/** Independent machine/list keys let a fast host publish before a slow peer.
 * Reads retain taskClient's etags, last-good data and machine identity guards. */
export function useTaskBoardQueries() {
  const client = useQueryClient();
  const visible = useQueryVisible();
  const forceCapabilities = useRef(new Set<string>());
  const forceTasks = useRef(new Set<string>());
  const inventory = useQuery({
    queryKey: ["task-board", "inventory"],
    queryFn: async () => {
      const result = await invoke<RemoteMachine[]>("remote_machines");
      if (!Array.isArray(result)) throw new Error("The machine inventory could not be read.");
      return result;
    },
    enabled: visible,
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: false,
  });
  const machines = inventory.data ?? EMPTY_MACHINES;
  const descriptions = useQueries({
    queries: machines.map((machine) => ({
      queryKey: ["task-board", ...identity(machine), "capabilities"],
      queryFn: async (): Promise<Description> => {
        try {
          return {
            capabilities: await machineCapabilities(
              machine,
              forceCapabilities.current.delete(machine.id),
            ),
          };
        } catch (reason) {
          return {
            capabilities: [],
            error: reason instanceof Error ? reason.message : String(reason),
          };
        }
      },
      enabled: visible,
      staleTime: 15_000,
      refetchInterval: 15_000,
      retry: false,
    })),
    combine: combine<Description>,
  });
  const tasks = useMachineReads(
    machines,
    descriptions,
    HOST_TASKS,
    "tasks",
    visible,
    (machine, reachable) => {
      const force = forceTasks.current.delete(machine.id);
      return listBoardTaskResults(reachable ? [machine] : [], reachable ? [] : [machine], force);
    },
  );
  const goals = useMachineReads(
    machines,
    descriptions,
    HOST_GOALS,
    "goals",
    visible,
    (machine, reachable) =>
      listBoardGoalResults(reachable ? [machine] : [], reachable ? [] : [machine]),
  );
  const stewards = useMachineReads(
    machines,
    descriptions,
    HOST_STEWARDS,
    "stewards",
    visible,
    (machine, reachable) =>
      listBoardStewardResults(reachable ? [machine] : [], reachable ? [] : [machine]),
  );
  const limits = useMachineReads(
    machines,
    descriptions,
    HOST_SETTINGS,
    "limits",
    visible,
    (machine, reachable) => (reachable ? listMachineLimits([machine]) : Promise.resolve([])),
  );
  const subscriptionKey = JSON.stringify(machines.map(identity));
  useEffect(() => {
    const changed = () => void client.invalidateQueries({ queryKey: ["task-board"] });
    window.addEventListener("bycoda:remote-machines", changed);
    return () => window.removeEventListener("bycoda:remote-machines", changed);
  }, [client]);
  const refresh = useCallback(
    async (force = false) => {
      if (force) {
        invalidateMachineSnapshot();
        machines.forEach((machine) => {
          forceTasks.current.add(machine.id);
          forceCapabilities.current.add(machine.id);
        });
      }
      await client.invalidateQueries({ queryKey: ["task-board"] });
    },
    [client, machines],
  );
  const taskResults = useMemo(() => tasks.flatMap((result) => result.data ?? []), [tasks]);
  const goalResults = useMemo(() => goals.flatMap((result) => result.data ?? []), [goals]);
  const stewardResults = useMemo(() => stewards.flatMap((result) => result.data ?? []), [stewards]);
  const taskData = useMemo(() => taskResults.flatMap((result) => result.data), [taskResults]);
  const goalData = useMemo(() => goalResults.flatMap((result) => result.data), [goalResults]);
  const stewardData = useMemo(
    () => stewardResults.flatMap((result) => result.data),
    [stewardResults],
  );
  const limitData = useMemo(() => limits.flatMap((result) => result.data ?? []), [limits]);
  const board = useMemo(() => {
    const capable = (capability: string) =>
      machines.filter((_, index) => descriptions[index]?.data?.capabilities.includes(capability));
    const results: MachineResult<unknown>[] = [...taskResults, ...goalResults, ...stewardResults];
    const pending =
      inventory.isPending ||
      descriptions.some((result) => result.isPending) ||
      machines.some((_, index) => {
        const caps = descriptions[index]?.data?.capabilities ?? [];
        return [
          [HOST_TASKS, tasks],
          [HOST_GOALS, goals],
          [HOST_STEWARDS, stewards],
          [HOST_SETTINGS, limits],
        ].some(
          ([cap, reads]) =>
            caps.includes(cap as string) && (reads as { isPending: boolean }[])[index]?.isPending,
        );
      });
    const unreachable = machines
      .filter((_, index) => descriptions[index]?.data?.error)
      .map((machine) => (isLocalSyncMachine(machine) ? "this computer" : machine.name));
    const outdated = machines
      .filter(
        (_, index) =>
          descriptions[index]?.data &&
          !descriptions[index].data!.error &&
          !descriptions[index].data!.capabilities.includes(HOST_TASKS),
      )
      .map((machine) => (isLocalSyncMachine(machine) ? "this computer" : machine.name));
    const problems = results
      .filter((result) => result.status === "error")
      .map(
        (result) =>
          `${result.machineName}: ${descriptions[machines.findIndex((machine) => machine.id === result.machineId)]?.data?.error ?? result.error ?? "request failed"}`,
      );
    for (const name of outdated)
      problems.push(`${name}: update ${PRODUCT_IDENTITY.displayName} Host to refresh its board`);
    const error =
      inventory.error?.message ??
      (problems.length
        ? `Some machine data could not be refreshed: ${[...new Set(problems)].join("; ")}`
        : undefined);
    return {
      machines: capable(HOST_TASKS),
      todoCapable: capable(HOST_TASKS_TODO),
      goalCapable: capable(HOST_GOALS),
      stewardCapable: capable(HOST_STEWARDS),
      limitCapable: capable(HOST_SETTINGS),
      tasks: taskData,
      goals: goalData,
      stewards: stewardData,
      limits: limitData,
      pending,
      error,
      hasTaskAnswer: taskResults.length > 0,
      notice: missingMachinesNotice(
        { outdated, unreachable: [...new Set([...unreachable, ...failedMachineNames(results)])] },
        staleMachineNames(results),
      ),
    };
  }, [
    machines,
    descriptions,
    tasks,
    goals,
    stewards,
    limits,
    inventory.isPending,
    inventory.error,
    taskResults,
    goalResults,
    stewardResults,
    taskData,
    goalData,
    stewardData,
    limitData,
  ]);
  const initialReadReady = useRef(false);
  useEffect(() => {
    if (!initialReadReady.current && board.pending) return;
    initialReadReady.current = true;
    const releases = machines.map((machine) =>
      subscribeBoardTaskChanges([machine], () => {
        void client.invalidateQueries({ queryKey: ["task-board", ...identity(machine), "tasks"] });
      }),
    );
    return () => releases.forEach((release) => release());
  }, [client, subscriptionKey, board.pending]);
  const putTask = useCallback(
    (saved: BoardTask) => {
      const machine = machines.find((machine) => machine.id === saved.machineId);
      if (!machine) return;
      const scope = ["task-board", ...identity(machine), "tasks"];
      client.setQueriesData<MachineResult<BoardTask>[]>(
        {
          predicate: (query) => scope.every((part, index) => query.queryKey[index] === part),
        },
        (results) =>
          results?.map((result) => ({
            ...result,
            data: [...result.data.filter((task) => task.id !== saved.id), saved],
          })),
      );
    },
    [client, machines],
  );
  return { board, refresh, putTask };
}
