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
 * Reads never prompt. Every consumer shares one report and one focus listener,
 * so a focus is a single native read. Polling belongs to a mounted setup dialog.
 * `refresh` is an explicit
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
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- registers the mounted dialog with the shared poll
  useEffect(() => {
    // Keep the one-second grant poll alive while a setup dialog is open.
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
