import { useSyncExternalStore } from "react";
import { getSyncStatus, subscribeSyncStatus } from "./syncClient";
import type { SyncStatus } from "./syncClient";

export function useSyncStatus(machineId: string): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, () => getSyncStatus(machineId));
}
