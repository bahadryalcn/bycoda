import { useState, useSyncExternalStore } from "react";
import { localMachineId } from "./syncMachineId";
import {
  localHostEnvironmentId,
  projectIdFrom,
  subscribeLocalHostEnvironment,
} from "./syncProjects";

/** `projectIdForPath` for render: the host id is subscribed state and the session's machine id
 * is read once, so a memoized caller follows a host change. */
export function useProjectIdForPath(): (path: string) => string | undefined {
  const environmentId = useSyncExternalStore(subscribeLocalHostEnvironment, localHostEnvironmentId);
  const [machineId] = useState(localMachineId);
  return (path) => projectIdFrom(path, environmentId, () => machineId);
}
