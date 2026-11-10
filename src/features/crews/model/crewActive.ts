import { useQuery } from "@tanstack/react-query";
import type { ActiveCrewMember } from "../../../shared/model/host-contracts/crews";
import { backgroundMachines } from "../../automations/public/hostMachines";
import { HOST_CREW_ACTIVE } from "./crew";
import { requestCrewHosts } from "./crewClient";

export type { ActiveCrewMember };
/** A member plus the machine whose host reported it. */
export type ActiveCrewMemberView = ActiveCrewMember & { machineId: string };
export type ActiveCrewMembers = { items: ActiveCrewMemberView[]; truncated: boolean };

export const ACTIVE_CREW_BUSY_POLL_MS = 2000;
export const ACTIVE_CREW_IDLE_POLL_MS = 10_000;
const ACTIVE_CREW_LIMIT = 200;

/** Poll fast while anyone is working, slowly otherwise. */
export function activeCrewPollInterval(items: readonly unknown[] | undefined): number {
  return items?.length ? ACTIVE_CREW_BUSY_POLL_MS : ACTIVE_CREW_IDLE_POLL_MS;
}

/** Merge per-host results; any truncated host marks the whole list truncated. */
export function mergeActiveCrewMembers(
  results: ReadonlyArray<{
    machineId: string;
    result: { items: ActiveCrewMember[]; truncated?: true };
  }>,
): ActiveCrewMembers {
  return {
    items: results.flatMap(({ machineId, result }) =>
      result.items.map((item) => ({ ...item, machineId })),
    ),
    truncated: results.some(({ result }) => result.truncated === true),
  };
}

/** Crew members currently working on every connected host that supports `crews.active.v1`. */
export function useActiveCrewMembers(enabled: boolean) {
  return useQuery({
    queryKey: [HOST_CREW_ACTIVE],
    enabled,
    queryFn: async (): Promise<ActiveCrewMembers> =>
      mergeActiveCrewMembers(
        await requestCrewHosts<{ items: ActiveCrewMember[]; truncated?: true }>(
          HOST_CREW_ACTIVE,
          "crews.active.list",
          { limit: ACTIVE_CREW_LIMIT },
        ),
      ),
    staleTime: 1000,
    refetchInterval: (query) => activeCrewPollInterval(query.state.data?.items),
    retry: false,
  });
}

/** Whether any connected host reports `crews.active.v1`; the Active tab and rail strip need it. */
export function useActiveCrewSupported(): boolean {
  const { data } = useQuery({
    queryKey: [HOST_CREW_ACTIVE, "supported"],
    queryFn: async () => (await backgroundMachines(HOST_CREW_ACTIVE)).length > 0,
    staleTime: 10_000,
    retry: false,
  });
  return data === true;
}
