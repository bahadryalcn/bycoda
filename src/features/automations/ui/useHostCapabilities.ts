import { useQuery } from "@tanstack/react-query";
import type { RemoteMachine } from "../../connections/public/protocol";
import { machineCapabilities } from "../model/machineSnapshot";

/** What the machine's Host advertises; empty until it answers, and an error keeps the choices off. */
export function useHostCapabilities(machine: RemoteMachine | undefined) {
  return useQuery({
    queryKey: ["automation-host-capabilities", machine?.id],
    queryFn: () => machineCapabilities(machine!),
    enabled: !!machine,
    staleTime: 30_000,
    retry: false,
  });
}
