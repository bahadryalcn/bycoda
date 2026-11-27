import { useState, useSyncExternalStore } from "react";
import { localMachineId } from "../model/syncMachineId";
import {
  localHostEnvironmentId,
  projectIdOn,
  subscribeLocalHostEnvironment,
} from "../model/syncProjects";

/** Project ids for render; they follow the local host once it becomes known. */
export function useProjectIdForPath() {
  const environmentId = useSyncExternalStore(subscribeLocalHostEnvironment, localHostEnvironmentId);
  const [machineId] = useState(localMachineId);
  return (path: string) => projectIdOn(path, environmentId, () => machineId);
}
