import { useQuery } from "@tanstack/react-query";
import { automationRoutingHost } from "../model/automationRouting";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";

/** A failed capability read keeps legacy fixed-only editing available. */
export function useAutomationRoutingHost(machineId?: string) {
  const visible = useQueryVisible();
  const query = useQuery({
    queryKey: ["automation-routing-host", machineId ?? "local"],
    queryFn: () => automationRoutingHost(machineId),
    staleTime: 30_000,
    retry: false,
    enabled: visible,
  });
  return query.data ?? { machineId: undefined, supported: false };
}
