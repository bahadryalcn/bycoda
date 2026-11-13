// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PermissionEntry } from "../../../platform/tauri/systemPermissions";
const state = vi.hoisted(() => ({
  entry: {
    id: "microphone",
    state: "unknown",
    canRequest: false,
    canOpenSettings: false,
  } as PermissionEntry,
  loading: true,
  failed: false,
  refresh: vi.fn(async () => {}),
  request: vi.fn(async () => {}),
  open: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
}));
vi.mock("../hooks/usePermissionStatus", () => ({
  usePermissionStatus: () => ({
    report: { platform: "windows" },
    entries: [state.entry],
    loading: state.loading,
    failed: state.failed,
    refresh: state.refresh,
  }),
}));
vi.mock("../../../platform/tauri/privacySettings", () => ({ openPrivacySettings: state.open }));
vi.mock("../../../platform/tauri/systemPermissions", () => ({
  requestSystemPermission: state.request,
  closePermissionHelper: state.close,
  showPermissionHelper: vi.fn(),
}));
import { PermissionSetupSheet } from "./PermissionSetupSheet";
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.entry = { id: "microphone", state: "unknown", canRequest: false, canOpenSettings: false };
  state.loading = true;
  state.failed = false;
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () =>
    root.render(createElement(PermissionSetupSheet, { id: "microphone", onClose: vi.fn() })),
  );
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
it("shows initial checking without promising access or requesting it", async () => {
  await render();
  expect(document.body.textContent).toContain("Checking permission status…");
  expect(document.body.textContent).not.toContain("Waiting for access");
  expect(state.request).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
});
it("explains restricted policy without offering an impossible request", async () => {
  state.loading = false;
  state.entry.state = "restricted";
  await render();
  expect(document.body.textContent).toContain(
    "Access is restricted by system policy. Contact your administrator.",
  );
  expect(button("Allow")).toBeUndefined();
});
it("owns one manual check and keeps failure visible", async () => {
  state.loading = false;
  state.failed = true;
  let finish!: () => void;
  state.refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  const check = button("Check again");
  await act(async () => {
    check.click();
    check.click();
  });
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(check.getAttribute("aria-disabled")).toBe("true");
  expect(check.getAttribute("aria-label")).toBe("Checking…");
  await act(async () => finish());
  expect(check.disabled).toBe(false);
  expect(document.body.textContent).toContain("Permission status is unavailable.");
});
it("opens OS settings only from explicit sheet action and cleans up helper", async () => {
  state.loading = false;
  state.entry = { ...state.entry, state: "denied", canOpenSettings: true };
  await render();
  expect(state.open).not.toHaveBeenCalled();
  await act(async () => button("Open Settings").click());
  expect(state.open).toHaveBeenCalledExactlyOnceWith("microphone");
  expect(state.request).not.toHaveBeenCalled();
});
