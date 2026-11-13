import { t } from "../../../shared/i18n/core";
import type {
  PermissionEntry,
  PermissionId,
  PermissionState,
  SystemPermissionsReport,
} from "../../../platform/tauri/systemPermissions";

export const PERMISSION_IDS: readonly PermissionId[] = [
  "microphone",
  "screen-recording",
  "accessibility",
  "notifications",
  "camera",
  "full-disk-access",
];
export function permissionInfo(id: PermissionId) {
  switch (id) {
    case "microphone":
      return {
        label: t("Microphone"),
        usedBy: t("Dictation, voice and wake word"),
        toggle: "Microphone",
      };
    case "screen-recording":
      return {
        label: t("Screen recording"),
        usedBy: t("Quick composer screenshots and desktop control"),
        toggle: "Screen & System Audio Recording",
      };
    case "accessibility":
      return { label: t("Accessibility"), usedBy: t("Desktop control"), toggle: "Accessibility" };
    case "notifications":
      return { label: t("Notifications"), usedBy: t("Attention alerts"), toggle: "Notifications" };
    case "camera":
      return { label: t("Camera"), usedBy: t("Tools run in terminals"), toggle: "Camera" };
    case "full-disk-access":
      return {
        label: t("Full Disk Access"),
        usedBy: t("Agents that read protected folders"),
        toggle: "Full Disk Access",
      };
  }
}
export function permissionBadge(state: PermissionState) {
  switch (state) {
    case "granted":
      return { label: t("Allowed"), tone: "success" as const };
    case "denied":
      return { label: t("Not allowed"), tone: "warning" as const };
    case "restricted":
      return { label: t("Restricted by policy"), tone: "warning" as const };
    case "not-required":
      return { label: t("Not required"), tone: "neutral" as const };
    case "not-determined":
      return { label: t("Not requested"), tone: "neutral" as const };
    case "unknown":
      return { label: t("Unknown"), tone: "neutral" as const };
  }
}
export function unknownPermission(id: PermissionId): PermissionEntry {
  return { id, state: "unknown", canRequest: false, canOpenSettings: false };
}
export function permissionReady(state: PermissionState) {
  return state === "granted" || state === "not-required";
}
export function permissionInstructions(
  id: PermissionId,
  platform?: SystemPermissionsReport["platform"],
) {
  if (platform === "macos") {
    if (id === "notifications")
      return t("Open System Settings > Notifications > bycoda. Turn on Allow notifications.");
    return t(
      "Open System Settings > Privacy & Security > {p0}. Turn on bycoda. If it is missing, add bycoda with the + button.",
      { p0: permissionInfo(id).toggle },
    );
  }
  if (platform === "windows") {
    if (id === "microphone")
      return t(
        "Open Settings > Privacy & security > Microphone. Turn on Microphone access and Let desktop apps access your microphone.",
      );
    if (id === "camera")
      return t(
        "Open Settings > Privacy & security > Camera. Turn on Camera access and Let desktop apps access your camera.",
      );
    if (id === "notifications")
      return t("Open Settings > System > Notifications. Turn on Notifications and bycoda.");
    return t(
      "Windows has no separate privacy toggle for this access. Desktop control cannot control an elevated app from a non-elevated process.",
    );
  }
  if (platform === "linux")
    return t(
      "Linux asks through your desktop portal when a tool starts. Choose the screen or device in that dialog. Check your desktop privacy settings and sandbox permissions if access fails.",
    );
  return t("Permission status is unavailable. Check again from the desktop app.");
}
