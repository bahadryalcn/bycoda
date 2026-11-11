import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import type { RemoteMachine } from "../../connections/model/protocol";
import { automationKey } from "../model/automationKey";
import type { Automation } from "../model/automations";
import { listHostAutomationResults, probeMachines } from "../model/hostAutomationClient";
import { failedMachineNames } from "../model/machineResults";
import { HOST_AUTOMATIONS } from "../model/hostAutomations";

export const HOST_AUTOMATIONS_QUERY_KEY = ["automations", "hosts"] as const;

export type HostAutomationsSnapshot = {
  machines: RemoteMachine[];
  /** Machines that did not answer; their automations are last-known ones. */
  unreachable: string[];
  /** Why each of them did not answer, one line per machine. */
  unreachableDetail?: string;
  automations: Automation[];
};

const NO_MACHINES: RemoteMachine[] = [];
const NO_NAMES: string[] = [];
const NO_AUTOMATIONS: Automation[] = [];

type ConfirmedChange = {
  /** Mutation order; a read that started before it may predate the change. */
  epoch: number;
  /** The confirmed automation, or null when the host confirmed its deletion. */
  automation: Automation | null;
};

function applyConfirmed(
  automations: readonly Automation[],
  key: string,
  automation: Automation | null,
): Automation[] {
  const rest = automations.filter((entry) => automationKey(entry) !== key);
  return automation ? [...rest, automation] : rest;
}

/**
 * Owns the machine-host Automations collection.
 *
 * The `["automations", "hosts"]` query is the only copy: machines, unreachable
 * names and automations are derived from it. Host saves/deletes confirmed by the
 * Host are patched into that cache and remembered until a read that started after
 * them completes, so a poll that was already in flight cannot roll a confirmed
 * mutation back. Drafts and selection stay with the caller.
 */
export function useHostAutomations(enabled: boolean) {
  const queryClient = useQueryClient();
  const epoch = useRef(0);
  const confirmed = useRef(new Map<string, ConfirmedChange>());
  const forceProbe = useRef(false);

  const query = useQuery({
    queryKey: HOST_AUTOMATIONS_QUERY_KEY,
    queryFn: async (): Promise<HostAutomationsSnapshot> => {
      const startedAt = epoch.current;
      const fresh = forceProbe.current;
      forceProbe.current = false;
      const reach = await probeMachines(HOST_AUTOMATIONS, fresh);
      const results = await listHostAutomationResults(reach.capable, reach.unreachableMachines);
      let automations = results.flatMap((result) => result.data);
      for (const [key, change] of confirmed.current) {
        if (change.epoch <= startedAt) {
          // This read began after the change, so it already reflects it.
          confirmed.current.delete(key);
        } else {
          automations = applyConfirmed(automations, key, change.automation);
        }
      }
      return {
        machines: reach.capable,
        unreachable: failedMachineNames(results),
        unreachableDetail:
          results
            .filter((result) => result.status === "error")
            // The probe keeps the actual transport failure; the list result only says "not reachable".
            .map((result) => [
              result.machineName,
              reach.unreachableErrors?.[result.machineId] ?? result.error,
            ])
            .filter(([, reason]) => reason)
            .map(([name, reason]) => `${name}: ${reason}`)
            .join("\n") || undefined,
        automations,
      };
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  const remember = useCallback(
    (key: string, automation: Automation | null) => {
      confirmed.current.set(key, { epoch: ++epoch.current, automation });
      queryClient.setQueryData<HostAutomationsSnapshot>(HOST_AUTOMATIONS_QUERY_KEY, (current) =>
        current
          ? { ...current, automations: applyConfirmed(current.automations, key, automation) }
          : current,
      );
    },
    [queryClient],
  );
  /** The Host confirmed this save; show it without waiting for the next poll. */
  const confirmSaved = useCallback(
    (saved: Automation) => remember(automationKey(saved), saved),
    [remember],
  );
  /** The Host confirmed this delete; drop it without waiting for the next poll. */
  const confirmDeleted = useCallback(
    (deleted: Automation) => remember(automationKey(deleted), null),
    [remember],
  );
  const { refetch } = query;
  const refresh = useCallback(
    async (fresh = false) => {
      forceProbe.current = fresh;
      await refetch();
    },
    [refetch],
  );

  const data = query.data;
  return {
    machines: data?.machines ?? NO_MACHINES,
    unreachable: data?.unreachable ?? NO_NAMES,
    unreachableDetail: data?.unreachableDetail,
    automations: data?.automations ?? NO_AUTOMATIONS,
    /** False until the first host read lands (or while hidden/failed with no data). */
    loaded: data !== undefined,
    error: query.error,
    fetching: query.isFetching,
    confirmSaved,
    confirmDeleted,
    refresh,
  };
}
