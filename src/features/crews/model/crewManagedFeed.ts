import { useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  backgroundMachineFor,
  backgroundMachines,
  hostProjectCwd,
  machineCapabilities,
  machineProjects,
} from "../../automations/public/hostMachines";
import { remoteRequest } from "../../connections/public/connections";
import { pathKey } from "../../../shared/lib/paths";
import { HOST_CREWS } from "./crew";
import type { CrewRunView } from "./crewClient";
import {
  crewManagedSessions,
  pruneCrewManagedSources,
  setCrewManagedSource,
  type CrewManagedSession,
} from "./crewManagedSessions";

const MAX_FEED_PROJECTS = 12;
const FEED_REFRESH_MS = 10_000;

/**
 * Keeps the managed-session index current for the projects the window shows. Mount once; each
 * project costs one lightweight `crews.list` every ten seconds and nothing when no host has Crews.
 */
export function useCrewManagedSessionsFeed(cwds: readonly string[], enabled = true) {
  const keys = [...new Set(cwds.filter((cwd) => cwd && cwd !== "~"))].slice(0, MAX_FEED_PROJECTS);
  const results = useQueries({
    queries: keys.map((cwd) => ({
      queryKey: [HOST_CREWS, "managed", cwd],
      enabled,
      staleTime: 5000,
      refetchInterval: FEED_REFRESH_MS,
      retry: false,
      queryFn: async () => {
        const machine = backgroundMachineFor(await backgroundMachines(HOST_CREWS), cwd);
        // A host without Crews has nothing to manage.
        if (!machine || !(await machineCapabilities(machine)).includes(HOST_CREWS))
          return [] as CrewManagedSession[];
        // Only a project the host already knows can have runs; never open one just to ask.
        const project = (await machineProjects(machine)).find(
          (entry) => pathKey(hostProjectCwd(machine, entry)) === pathKey(cwd),
        );
        if (!project) return [] as CrewManagedSession[];
        const state = await remoteRequest<{ runs: CrewRunView[] }>(machine.id, "crews.list", {
          projectId: project.id,
          historyLimit: 1,
        });
        return [...crewManagedSessions(state.runs, machine.id).values()];
      },
    })),
  });
  const signature = results
    .map((result, index) => `${keys[index]}=${result.dataUpdatedAt}`)
    .join("|");
  useEffect(() => {
    pruneCrewManagedSources(new Set(keys));
    results.forEach((result, index) => {
      if (!result.data) return;
      setCrewManagedSource(
        keys[index]!,
        new Map(result.data.map((item) => [item.sessionId, item])),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` tracks the query results
  }, [signature, enabled]);
}
