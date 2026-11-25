import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  TasksHelpersResultSchema,
  type TaskHelper,
} from "../../../shared/model/host-contracts/tasks";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { remoteRequest } from "../../connections/public/connections";
import type { BoardTask } from "./taskClient";

export type { TaskHelper };

const NO_HELPERS: readonly TaskHelper[] = [];

/** Delegation records of one task. A Host without the read answers with an error: no helpers. */
export async function readTaskHelpers(machineId: string, taskId: string): Promise<TaskHelper[]> {
  try {
    return TasksHelpersResultSchema.parse(
      await remoteRequest<unknown>(machineId, "tasks.helpers", { taskId }),
    );
  } catch {
    return [];
  }
}

/** Failed helpers of every task on one machine. */
export async function readFailedHelpers(machineId: string): Promise<TaskHelper[]> {
  try {
    return TasksHelpersResultSchema.parse(
      await remoteRequest<unknown>(machineId, "tasks.helpers", { failedOnly: true }),
    );
  } catch {
    return [];
  }
}

/** The helpers a task's worker and reviewer started; re-read whenever the task changes. */
export function useTaskHelpers(task: Pick<BoardTask, "machineId" | "id" | "updatedAt">) {
  const visible = useQueryVisible();
  const query = useQuery({
    queryKey: ["task-helpers", task.machineId, task.id, task.updatedAt],
    queryFn: () => readTaskHelpers(task.machineId, task.id),
    enabled: visible,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return query.data ?? NO_HELPERS;
}

/**
 * Why a helper failed, by `machineId:taskId`, for the tasks that have a failed helper; an empty
 * string when the record has no error text. The board marks those cards.
 */
export function useHelperFailures(
  tasks: readonly Pick<BoardTask, "machineId" | "id" | "updatedAt">[],
): ReadonlyMap<string, string> {
  const visible = useQueryVisible();
  const latest = new Map<string, number>();
  for (const task of tasks)
    latest.set(task.machineId, Math.max(latest.get(task.machineId) ?? 0, task.updatedAt));
  const machineIds = [...latest.keys()];
  const results = useQueries({
    queries: [...latest].map(([machineId, updatedAt]) => ({
      queryKey: ["task-helpers", "failed", machineId, updatedAt],
      queryFn: () => readFailedHelpers(machineId),
      enabled: visible,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: false,
    })),
  });
  const stamp = results.map((result) => result.dataUpdatedAt).join(",");
  return useMemo(
    () =>
      new Map(
        [
          ...failuresByTask(
            machineIds,
            results.map((result) => result.data ?? []),
          ),
        ].map(([key, helper]) => [key, helper.error ?? ""]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stamp` changes exactly when a result's data does.
    [machineIds.join(","), stamp],
  );
}

/** Newest failure per task; the machine id keeps equal task ids on two machines apart. */
export function failuresByTask(
  machineIds: readonly string[],
  rows: readonly (readonly TaskHelper[])[],
): Map<string, TaskHelper> {
  const failures = new Map<string, TaskHelper>();
  rows.forEach((helpers, index) => {
    for (const helper of helpers) {
      const key = `${machineIds[index]}:${helper.taskId}`;
      const known = failures.get(key);
      if (helper.status === "failed" && (!known || helper.startedAt > known.startedAt))
        failures.set(key, helper);
    }
  });
  return failures;
}
