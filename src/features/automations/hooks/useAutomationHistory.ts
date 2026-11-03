import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { listAutomationRuns, type Automation, type AutomationRun } from "../model/automations";
import { listHostAutomationRuns } from "../model/hostAutomationClient";

const NO_RUNS: AutomationRun[] = [];

/**
 * Run history of the selected automation, derived straight from its query. The
 * key carries the selection and the owning machine, so switching selection
 * never shows another automation's runs.
 */
export function useAutomationHistory({
  selectedId,
  target,
  enabled,
}: {
  selectedId: string | null;
  target: Automation | undefined;
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const machineId = target?.host?.machineId ?? "local";
  const queryKey = useMemo(
    () => ["automations", "runs", selectedId, machineId] as const,
    [selectedId, machineId],
  );
  const query = useQuery({
    queryKey,
    queryFn: () => (target?.host ? listHostAutomationRuns(target) : listAutomationRuns(target!.id)),
    enabled: enabled && !!selectedId && !!target,
    staleTime: 10_000,
    retry: false,
  });
  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  );
  return {
    id: selectedId,
    runs: query.data ?? NO_RUNS,
    loading: !!target && query.isPending,
    error: query.error?.message ?? null,
    refresh,
  };
}
