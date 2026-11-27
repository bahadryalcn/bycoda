// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ open: vi.fn(), request: vi.fn() }));
vi.mock("../../../platform/tauri/privacySettings", () => ({ openPrivacySettings: native.open }));
vi.mock("../../../platform/tauri/systemPermissions", () => ({
  systemPermissionsStatus: async () => ({
    version: 1,
    platform: "windows",
    signing: "unknown",
    elevated: false,
    entries: [{ id: "microphone", state: "denied", canRequest: false, canOpenSettings: true }],
  }),
  requestSystemPermission: native.request,
}));
vi.mock("../model/microphoneAccess", () => ({
  canOpenMicrophoneSettings: () => true,
  isMicrophoneBlocked: (message: string) => message === "OS denied",
}));
import { VoiceRecoveryAction } from "./MicrophoneRecoveryAction";
import { OPEN_SETTINGS_EVENT } from "../../settings/public/settingsLink";
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
  await act(async () => root!.render(createElement(VoiceRecoveryAction, { message })));
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
  await act(async () => button("Open settings")!.click());
  expect(native.open).toHaveBeenCalledExactlyOnceWith("microphone");
  expect(document.body.textContent).toContain("Waiting for access");
});
it("shows a settings failure and allows retry without claiming access", async () => {
  native.open.mockRejectedValueOnce(new Error("settings failed")).mockResolvedValue(undefined);
  await render("OS denied");
  await act(async () => button("Review access")!.click());
  await act(async () => button("Open settings")!.click());
  expect(document.body.textContent).toContain("Couldn’t open the permission prompt or settings.");
  await act(async () => button("Open settings")!.click());
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

it("takes a Host setup refusal to voice settings", async () => {
  const opened = vi.fn();
  window.addEventListener(OPEN_SETTINGS_EVENT, opened, { once: true });
  try {
    await render(
      "Host rejected request: Voice setup is incomplete: Whisper model. Open Settings → Chat → Voice companion.",
    );
    const details = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Technical details"]',
    );
    expect(details).not.toBeNull();
    await act(async () => details!.click());
    expect(document.body.textContent).toContain("Whisper model");
    expect(document.body.textContent).not.toContain("Chat → Voice companion");
    await act(async () => button("Voice settings")!.click());
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ detail: "voice" }));
    expect(native.open).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(OPEN_SETTINGS_EVENT, opened);
  }
});
