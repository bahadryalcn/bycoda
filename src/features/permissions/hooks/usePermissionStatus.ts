import { useEffect, useSyncExternalStore } from "react";
import { type PermissionId } from "../../../platform/tauri/systemPermissions";
import { PERMISSION_IDS, unknownPermission } from "../model/permissions";
import {
  getPermissionStatusSnapshot,
  readPermissionStatus,
  subscribePermissionStatus,
  watchPermissionSetup,
} from "./permissionStatusStore";

/**
 * Reads never prompt. Every consumer shares one report, one focus listener and
 * one native-change subscription, so a focus is a single native read.
 * Polling belongs only to a mounted setup sheet. `refresh` is an explicit
 * recheck and always reads again.
 */
export function usePermissionStatus(
  ids: readonly PermissionId[] = PERMISSION_IDS,
  setupOpen = false,
) {
  const { report, loading, failed } = useSyncExternalStore(
    subscribePermissionStatus,
    getPermissionStatusSnapshot,
  );
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- registers this setup sheet with the shared store so it polls only while the sheet is mounted
  useEffect(() => {
    // Only a mounted setup sheet may keep the one-second grant poll alive.
    return setupOpen ? watchPermissionSetup() : undefined;
  }, [setupOpen]);
  return {
    report,
    loading,
    failed,
    refresh: () => readPermissionStatus(true),
    entries: ids.map(
      (id) => report?.entries.find((entry) => entry.id === id) ?? unknownPermission(id),
    ),
  };
}
