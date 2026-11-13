import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import "../../../src/styles/index.css";

// Isolated synthetic data and native mocks. No real permissions, credentials or files.
const query = new URLSearchParams(location.search);
const surface = query.get("surface") ?? "privacy";
if (surface === "file-error") {
  mockWindows("main");
  Object.assign(globalThis, { isTauri: true });
}
const theme = query.get("theme") ?? "light";
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.dataset.theme = theme;
localStorage.clear();
localStorage.setItem(
  "bycoda.projectGroups",
  JSON.stringify([
    { id: "work", name: "Example work", lockable: surface === "protected", collapsed: false },
    { id: "personal", name: "Example personal", collapsed: false },
  ]),
);
localStorage.setItem("bycoda.groupLock.hiddenGroups.v1", '["personal"]');
if (surface === "corrupt" || surface === "gate")
  localStorage.setItem("bycoda.groupLock", "{broken");
if (surface === "protected") {
  const { createPasswordRecord } =
    await import("../../../src/features/group-lock/model/passwordRecord");
  localStorage.setItem(
    "bycoda.groupLock",
    JSON.stringify({ record: await createPasswordRecord("synthetic-fixture-password") }),
  );
}
const ids = [
  "microphone",
  "screen-recording",
  "accessibility",
  "notifications",
  "camera",
  "full-disk-access",
];
const permissionState = query.get("state") ?? "denied";
let permissionReads = 0;
mockIPC(async (command) => {
  if (command === "system_permissions_status") {
    permissionReads++;
    if (permissionState === "unavailable") throw new Error("Synthetic status failure");
    if (permissionState === "pending" || (permissionReads > 1 && permissionState === "manual"))
      await new Promise((resolve) => setTimeout(resolve, 3000));
    return {
      version: 1,
      platform: "macos",
      signing: "stable",
      elevated: null,
      entries: ids.map((id) => ({
        id,
        state:
          permissionState === "pending" || permissionState === "manual"
            ? "denied"
            : permissionState,
        canRequest: false,
        canOpenSettings: permissionState !== "restricted",
      })),
    };
  }
  if (command === "get_file_access_mode") {
    if (surface === "file-error") throw new Error("Synthetic file status failure");
    return "selected-folders";
  }
  if (
    command === "system_permission_helper_close" ||
    command === "system_permission_helper_reveal_app"
  )
    return;
  throw new Error(`Unconfigured fixture command: ${command}`);
});
const { PrivacyStartupSettings } =
  await import("../../../src/features/settings/ui/PrivacyStartupSettings");
const { GroupLockSettings } = await import("../../../src/features/group-lock/ui/GroupLockSettings");
const controls = await import("../../../src/features/settings/ui/settingsControls");
const { PermissionsSettings } =
  await import("../../../src/features/permissions/ui/PermissionsSettings");
const { PermissionSetupSheet } =
  await import("../../../src/features/permissions/ui/PermissionSetupSheet");
const { PermissionHelper } = await import("../../../src/features/permissions/ui/PermissionHelper");
const { SetLockPasswordDialog } =
  await import("../../../src/features/group-lock/ui/SetLockPasswordDialog");
const { PasswordPromptDialog } =
  await import("../../../src/features/group-lock/ui/PasswordPromptDialog");
const { PrivacyLaunchGate } = await import("../../../src/features/group-lock/ui/PrivacyLaunchGate");
const { applyThemePreference } = await import("../../../src/features/settings/model/appearance");
applyThemePreference(theme === "light" ? "light" : "dark");
if (surface === "failed-save") {
  const { setStartInPrivacyMode, setRelockOnLaunch } =
    await import("../../../src/features/group-lock/model/groupLock");
  const { saveMaskEmails } = await import("../../../src/features/settings/model/displayPrefs");
  Storage.prototype.setItem = () => {
    throw new Error("Synthetic quota failure");
  };
  setStartInPrivacyMode(true);
  setRelockOnLaunch(false);
  saveMaskEmails(false);
}
function Fixture() {
  if (surface === "guide")
    return createElement(PermissionSetupSheet, { id: "microphone", onClose() {} });
  if (surface === "helper") return createElement(PermissionHelper);
  if (surface === "password")
    return createElement(SetLockPasswordDialog, { mode: "change", onClose() {} });
  if (surface === "password-set")
    return createElement(SetLockPasswordDialog, { mode: "set", onClose() {} });
  if (surface === "password-prompt")
    return createElement(PasswordPromptDialog, {
      title: "Unlock group",
      description: "Synthetic password prompt",
      submitLabel: "Unlock",
      onClose() {},
      onDone() {},
      verify: async () => ({ ok: false, reason: "wrong", retryAfterMs: 0 }),
    });
  if (surface === "gate")
    return createElement(PrivacyLaunchGate, null, "Workspace must stay unmounted");
  return createElement(
    "main",
    { className: "bycoda-settings bycoda-settings-workbench settings-topics p-6" },
    surface === "permissions"
      ? createElement(PermissionsSettings)
      : [
          createElement(PrivacyStartupSettings, { key: "privacy" }),
          createElement(GroupLockSettings, { key: "groups", controls }),
        ],
  );
}
createRoot(document.getElementById("root")!).render(createElement(Fixture));
