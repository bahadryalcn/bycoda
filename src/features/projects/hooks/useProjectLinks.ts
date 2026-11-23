import { useEffect, useSyncExternalStore } from "react";
import { subscribeRemoteConnections } from "../../connections/public/remoteHealth";
import {
  loadProjectRepositories,
  loadSeparatedProjects,
  projectLinks,
  refreshProjectRepositories,
  subscribeProjectRepositories,
  type ProjectLinks,
} from "../model/projectRepositories";
import type { RecentProject } from "../model/recents";

/** Which rail projects are one repository on several machines, kept current as machines connect. */
export function useProjectLinks(recents: readonly RecentProject[]): ProjectLinks {
  const repositories = useSyncExternalStore(subscribeProjectRepositories, loadProjectRepositories);
  const separated = useSyncExternalStore(subscribeProjectRepositories, loadSeparatedProjects);
  const paths = recents.map((item) => item.path);
  const pathList = paths.join("\n");
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps the saved repository identities in step with each project's git remote, read again when the rail's projects change and when a machine connects, since only then can it be asked.
  useEffect(() => {
    const refresh = () => {
      refreshProjectRepositories(pathList ? pathList.split("\n") : []).catch(() => undefined);
    };
    refresh();
    return subscribeRemoteConnections(refresh);
  }, [pathList]);
  return projectLinks(paths, repositories, separated);
}
