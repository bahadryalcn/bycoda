import { invoke } from "@tauri-apps/api/core";

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
  /** `restart-required`: switched on in the OS, applied after the app restarts. */
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
/** Same save-and-confirm run as a manual quit, then relaunch. macOS applies some grants only then. */
export async function restartToApplyPermission(): Promise<void> {
  return invoke<void>("request_app_restart");
}
export async function revealPermissionApp(): Promise<void> {
  return invoke<void>("reveal_permission_app");
}
export function dragPermissionApp(): Promise<void> {
  return invoke<void>("drag_permission_app");
}
export function showPermissionHelper(id: PermissionId): Promise<number | null> {
  return invoke<number | null>("show_permission_helper", { id });
}
export function closePermissionHelper(generation: number): Promise<void> {
  return invoke<void>("close_permission_helper", { generation });
}
