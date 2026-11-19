import { useQueries } from "@tanstack/react-query";
import { t } from "../../../shared/i18n";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { machineCapabilities } from "../../automations/public/hostMachines";
import { remoteRequest } from "../../connections/public/connections";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import type { RemoteMachine } from "../../connections";
import { HOST_SPRINTS, type HostSprint, type SprintBoard } from "./hostSprints";

export type SprintCatalogSource = {
  machine: RemoteMachine;
  sprints: HostSprint[];
  /** The read did not succeed, so these sprints may be stale or missing. */
  failed: boolean;
  /** What to show for the failure; null for a success or a passing transport blip the shared connection notice already covers. */
  error: string | null;
};

export const SPRINT_CATALOG_QUERY_KEY = ["sprint-catalog"] as const;

/** Catalog reads retain original planning authority and never ingest into another Host. */
export async function readSprintCatalogSource(
  machine: RemoteMachine,
): Promise<SprintCatalogSource> {
  try {
    if (!(await machineCapabilities(machine)).includes(HOST_SPRINTS))
      return {
        machine,
        sprints: [],
        failed: true,
        error: t("Update this server to view its sprints."),
      };
    const board = await remoteRequest<SprintBoard>(machine.id, "sprints.list");
    return { machine, sprints: board.sprints, failed: false, error: null };
  } catch (reason) {
    // A transient transport error stays a failure (the sprints stay unavailable and the
    // query keeps its stale answer) but shows no text of its own.
    return { machine, sprints: [], failed: true, error: presentRemoteError(reason) ?? null };
  }
}

export function sprintCatalogKey(
  machine: Pick<RemoteMachine, "environmentId">,
  sprint: Pick<HostSprint, "id">,
): string {
  return JSON.stringify([machine.environmentId, sprint.id]);
}

/** Query-owned server snapshots survive view changes; route identities never share cached records. */
export function useSprintCatalog(machines: readonly RemoteMachine[]) {
  const visible = useQueryVisible();
  const routes = [...new Map(machines.map((machine) => [machine.environmentId, machine])).values()];
  const answers = useQueries({
    queries: routes.map((machine) => ({
      queryKey: [...SPRINT_CATALOG_QUERY_KEY, machine.id, machine.environmentId, machine.endpoint],
      queryFn: async () => {
        const source = await readSprintCatalogSource(machine);
        if (source.failed) throw new Error(source.error ?? "");
        return source;
      },
      enabled: visible,
      retry: false,
      staleTime: 15_000,
      refetchInterval: visible ? 15_000 : false,
      refetchIntervalInBackground: true,
    })),
  });
  return {
    sources: answers.flatMap((answer, index) =>
      answer.isPending
        ? []
        : [
            {
              machine: routes[index]!,
              sprints: answer.data?.sprints ?? [],
              failed: !!answer.error,
              error: answer.error?.message || null,
            },
          ],
    ),
    loading: visible && answers.some((answer) => answer.isPending),
  };
}
