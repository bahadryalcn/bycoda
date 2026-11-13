import { invoke, isTauri } from "@tauri-apps/api/core";
import { listenWindow } from "./listenWindow";

export type PermissionId =
  | "microphone"
  | "camera"
  | "screen-recording"
  | "accessibility"
  | "notifications"
  | "full-disk-access";
export type PermissionState =
  | "granted"
  | "denied"
  | "not-determined"
  | "restricted"
  | "not-required"
  | "unknown";
export type PermissionEntry = {
  id: PermissionId;
  state: PermissionState;
  canRequest: boolean;
  canOpenSettings: boolean;
  detail?: string;
};
export type SystemPermissionsReport = {
  version: 1;
  platform: "macos" | "windows" | "linux";
  entries: PermissionEntry[];
  signing: "stable" | "ad-hoc" | "unknown";
  elevated: boolean | null;
};

/** Read only. Missing native commands reject; consumers clear stale grants. */
export async function systemPermissionsStatus(): Promise<SystemPermissionsReport> {
  return invoke<SystemPermissionsReport>("system_permissions_status");
}
export async function requestSystemPermission(id: PermissionId): Promise<PermissionEntry> {
  return invoke<PermissionEntry>("system_permission_request", { id });
}
export async function showPermissionHelper(id: PermissionId): Promise<void> {
  return invoke<void>("system_permission_helper_show", { id });
}
export async function closePermissionHelper(): Promise<void> {
  return invoke<void>("system_permission_helper_close");
}
export async function revealPermissionApp(): Promise<void> {
  return invoke<void>("system_permission_helper_reveal_app");
}
export function listenSystemPermissionsChanged(
  onChange: (report: SystemPermissionsReport) => void,
) {
  return isTauri()
    ? listenWindow<SystemPermissionsReport>("system-permissions-changed", (event) =>
        onChange(event.payload),
      )
    : () => {};
}
