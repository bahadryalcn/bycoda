// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn(), request: vi.fn() }));
vi.mock("../../../platform/tauri/privacySettings", () => ({ openPrivacySettings: native.open }));
vi.mock("../../../platform/tauri/systemPermissions", () => ({
  systemPermissionsStatus: async () => ({
    version: 1,
    platform: "windows",
    signing: "unknown",
    elevated: false,
    entries: [{ id: "microphone", state: "denied", canRequest: false, canOpenSettings: true }],
  }),
  listenSystemPermissionsChanged: () => () => {},
  closePermissionHelper: async () => native.close(),
  requestSystemPermission: native.request,
  showPermissionHelper: vi.fn(),
}));
vi.mock("../model/microphoneAccess", () => ({
  canOpenMicrophoneSettings: () => true,
  isMicrophoneBlocked: (message: string) => message === "OS denied",
}));
import { MicrophoneRecoveryAction } from "./MicrophoneRecoveryAction";
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function render(message: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(MicrophoneRecoveryAction, { message })));
}
const button = (name: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === name,
  );
it("opens a guide without prompting, then opens settings only on an explicit action", async () => {
  native.open.mockResolvedValue(undefined);
  await render("OS denied");
  expect(native.request).not.toHaveBeenCalled();
  await act(async () => button("Review access")!.click());
  expect(native.open).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Let desktop apps access your microphone");
  await act(async () => button("Open Settings")!.click());
  expect(native.open).toHaveBeenCalledExactlyOnceWith("microphone");
  expect(document.body.textContent).toContain("Waiting for access");
});
it("shows a settings failure and allows retry without claiming access", async () => {
  native.open.mockRejectedValueOnce(new Error("settings failed")).mockResolvedValue(undefined);
  await render("OS denied");
  await act(async () => button("Review access")!.click());
  await act(async () => button("Open Settings")!.click());
  expect(document.body.textContent).toContain("Could not open the permission prompt or settings.");
  await act(async () => button("Open Settings")!.click());
  expect(native.open).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).not.toContain("Access is ready");
});
it.each(["webview denied", "No microphone was found."])(
  "does not send %s to OS settings",
  async (message) => {
    await render(message);
    expect(container.querySelector("button")).toBeNull();
  },
);
