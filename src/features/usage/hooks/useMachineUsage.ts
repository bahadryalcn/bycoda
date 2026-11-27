import { keepPreviousData, useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useRemoteMachines } from "../../connections/public/connections";
import type { AccountUsage } from "../../providers/model/providerUsage";
import { loadMachineUsage, otherUsageMachines } from "../data/usageSources";

export type MachineUsage = {
  /** Every other saved machine, read or not. */
  machines: { id: string; label: string }[];
  /** Rows of the machines that answered, tagged with their machine. */
  usage: AccountUsage[];
  /** Machines whose latest read failed; they add nothing to the figures. */
  unavailable: { id: string; label: string }[];
  /** Latest start a machine actually read; later than the requested start when a Host clamped it. */
  coveredSince: number | null;
  truncated: boolean;
  loading: boolean;
};

/**
 * Usage rows of the other saved machines for the dashboard interval, one query per machine, so a
 * slow or offline machine never delays this computer's figures or the other machines. While a new
 * interval loads, each machine keeps its previous rows. A change of `reload` forces a fresh read.
 */
export function useMachineUsage(sinceMs: number, reload: string, enabled: boolean): MachineUsage {
  const { machines: saved } = useRemoteMachines(enabled);
  const machines = useMemo(() => (enabled ? otherUsageMachines(saved) : []), [enabled, saved]);
  const queries = useQueries({
    queries: machines.map((machine) => ({
      queryKey: ["usage", "machine-rows", machine.id, machine.label, sinceMs, reload],
      queryFn: async () => {
        const [read] = await loadMachineUsage([machine], sinceMs);
        if (read.status !== "ok") throw new Error(`${machine.label} is unavailable`);
        return read;
      },
      placeholderData: keepPreviousData,
      staleTime: 60_000,
      retry: false,
    })),
  });
  // One derived value per answer, so the dashboard's sample memos keep their inputs between renders.
  const answers = queries
    .map((query) => `${query.status}/${query.dataUpdatedAt}/${query.isPlaceholderData}`)
    .join("|");
  const derived = useMemo(() => {
    const usage: AccountUsage[] = [];
    const unavailable: MachineUsage["unavailable"] = [];
    let coveredSince: number | null = null;
    let truncated = false;
    machines.forEach((machine, index) => {
      const query = queries[index];
      if (query?.isError) {
        unavailable.push(machine);
        return;
      }
      const read = query?.data;
      if (read?.status !== "ok") return;
      for (const { account, rows } of read.accounts) usage.push({ account, rows, machine });
      coveredSince = Math.max(coveredSince ?? 0, read.sinceMs);
      truncated ||= read.truncated;
    });
    return { usage, unavailable, coveredSince, truncated };
    // `answers` stands for the query results; `queries` is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [answers, machines]);
  return {
    ...derived,
    machines,
    loading: queries.some((query) => query.isFetching),
  };
}
