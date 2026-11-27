import { useEffect, useRef } from "react";
import { useQueries, type QueryFilters } from "@tanstack/react-query";
import {
  useForegroundQueryFamilyPolling,
  useQueryVisible,
} from "../../../shared/hooks/useQueryVisible";
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
const MANAGED_FEED_QUERY_KEY = [HOST_CREWS, "managed"] as const;
/** Poll cadence while a project may own crew-managed sessions, or has not answered yet. */
const FEED_REFRESH_MS = 10_000;
/**
 * Poll cadence once a project answered with no managed session. A run that starts later is found
 * within this window, or at once after this app's own Crew calls invalidate the feed.
 */
const IDLE_FEED_REFRESH_MS = 30_000;

/** Refetch interval for one project's feed: slow only once it has confirmed no managed session. */
export function feedRefetchInterval(data: readonly CrewManagedSession[] | undefined): number {
  return data?.length === 0 ? IDLE_FEED_REFRESH_MS : FEED_REFRESH_MS;
}
const needsFastPoll: NonNullable<QueryFilters["predicate"]> = (query) =>
  feedRefetchInterval(query.state.data as CrewManagedSession[] | undefined) === FEED_REFRESH_MS;
const confirmedIdle: NonNullable<QueryFilters["predicate"]> = (query) => !needsFastPoll(query);
const feedData = (results: { data?: CrewManagedSession[] }[]) =>
  results.map((result) => result.data);

/**
 * Keeps the managed-session index current for the projects the window shows. Mount once. Projects
 * that have work or have yet to answer use the fast clock; confirmed-idle projects share the
 * clock that backs off with user inactivity.
 */
export function useCrewManagedSessionsFeed(cwds: readonly string[], enabled = true) {
  const visible = useQueryVisible();
  const keys = [...new Set(cwds.filter((cwd) => cwd && cwd !== "~"))].slice(0, MAX_FEED_PROJECTS);
  const data = useQueries({
    queries: keys.map((cwd) => ({
      queryKey: [...MANAGED_FEED_QUERY_KEY, cwd],
      enabled: enabled && visible,
      staleTime: IDLE_FEED_REFRESH_MS,
      refetchOnWindowFocus: false,
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
    combine: feedData,
  });
  useForegroundQueryFamilyPolling(MANAGED_FEED_QUERY_KEY, FEED_REFRESH_MS, {
    predicate: needsFastPoll,
    enabled: enabled && data.some((items) => feedRefetchInterval(items) === FEED_REFRESH_MS),
    urgent: true,
  });
  useForegroundQueryFamilyPolling(MANAGED_FEED_QUERY_KEY, IDLE_FEED_REFRESH_MS, {
    predicate: confirmedIdle,
    enabled: enabled && data.some((items) => items?.length === 0),
  });
  // Last data pushed per project: a poll that returns the same (structurally shared) data must
  // not rebuild the index, or every subscriber re-renders for nothing.
  const pushed = useRef(new Map<string, CrewManagedSession[]>());
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps the managed-session index in step with this workspace's project queries.
  useEffect(() => {
    pruneCrewManagedSources(new Set(keys));
    for (const key of pushed.current.keys()) if (!keys.includes(key)) pushed.current.delete(key);
    data.forEach((items, index) => {
      const key = keys[index]!;
      if (!items || pushed.current.get(key) === items) return;
      pushed.current.set(key, items);
      setCrewManagedSource(key, new Map(items.map((item) => [item.sessionId, item])));
    });
  }, [data, keys]);
}

/**
 * Applies changed feed data outside the root component; there is no visible output.
 */
export function CrewManagedSessionsFeed({ cwds }: { cwds: readonly string[] }) {
  useCrewManagedSessionsFeed(cwds);
  return null;
}
