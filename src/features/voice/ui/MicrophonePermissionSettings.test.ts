// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ capture: vi.fn(), open: vi.fn(), canOpen: true }));
vi.mock("../../../platform/tauri/privacySettings", () => ({ openPrivacySettings: mock.open }));
vi.mock("../model/microphoneAccess", () => ({
  openMicrophone: mock.capture,
  microphoneBlockedMessage: () => "Microphone blocked",
  webviewMicrophoneBlockedMessage: () => "Webview blocked",
  isMicrophoneBlocked: (message: string) => message === "Microphone blocked",
  canOpenMicrophoneSettings: () => mock.canOpen,
}));
import { MicrophonePermissionSettings } from "./MicrophonePermissionSettings";
import { loadVoiceSettings, saveVoiceSettings } from "../model/voiceSettings";

let root: Root | undefined;
let element: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.canOpen = true;
  Object.defineProperty(navigator, "permissions", { configurable: true, value: undefined });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  element?.remove();
  localStorage.clear();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  await act(async () => root!.render(createElement(MicrophonePermissionSettings)));
}
function button(label: string) {
  return [...element.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
}
async function click(label: string) {
  expect(button(label)).toBeDefined();
  await act(async () => button(label)!.click());
}

it("leaves permission unknown without prompting and checks only after an explicit action", async () => {
  const stop = vi.fn();
  mock.capture.mockResolvedValue({ getTracks: () => [{ stop }] });
  saveVoiceSettings({ ...loadVoiceSettings(), microphoneId: "selected-device" });
  await render();
  expect(mock.capture).not.toHaveBeenCalled();
  expect(element.textContent).toContain("Not checked");
  await click("Check microphone access");
  expect(mock.capture).toHaveBeenCalledExactlyOnceWith({
    audio: { deviceId: { exact: "selected-device" } },
    video: false,
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(element.textContent).toContain("Microphone allowed");
});

it("stops a late permission grant after cancellation, prevents duplicate capture and permits a fresh check", async () => {
  let grant!: (value: unknown) => void;
  const stop = vi.fn();
  mock.capture.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  await render();
  await click("Check microphone access");
  await click("Cancel");
  expect(button("Check microphone access")?.disabled).toBe(true);
  expect(element.textContent).toContain("Finish or dismiss");
  await click("Check microphone access");
  expect(mock.capture).toHaveBeenCalledOnce();
  await act(async () => grant({ getTracks: () => [{ stop }] }));
  expect(stop).toHaveBeenCalledOnce();
  expect(element.textContent).not.toContain("Microphone allowed");
  expect(button("Check microphone access")?.disabled).toBe(false);
});

it("releases a grant arriving after the owning settings row closes", async () => {
  let grant!: (value: unknown) => void;
  const stop = vi.fn();
  mock.capture.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  await render();
  await click("Check microphone access");
  await act(async () => root!.unmount());
  root = undefined;
  await act(async () => grant({ getTracks: () => [{ stop }] }));
  expect(stop).toHaveBeenCalledOnce();
});

it("shows denial recovery without treating opening settings as a grant", async () => {
  mock.capture.mockRejectedValue(new Error("Microphone blocked"));
  mock.open.mockRejectedValue(new Error("cannot launch"));
  await render();
  await click("Check microphone access");
  expect(element.textContent).toContain("Microphone blocked");
  await click("Review access");
  expect(mock.open).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Check access");
  expect(element.textContent).not.toContain("Microphone allowed");
});

it("observes permission changes without capture and removes its listener on close", async () => {
  const status = Object.assign(new EventTarget(), { state: "denied" as PermissionState });
  const query = vi.fn().mockResolvedValue(status);
  const remove = vi.spyOn(status, "removeEventListener");
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query } });
  await render();
  expect(query).toHaveBeenCalledWith({ name: "microphone" });
  expect(element.textContent).toContain("Microphone blocked");
  await act(async () => {
    status.state = "granted";
    status.dispatchEvent(new Event("change"));
  });
  expect(element.textContent).toContain("Microphone allowed");
  expect(mock.capture).not.toHaveBeenCalled();
  await act(async () => root!.unmount());
  root = undefined;
  expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
});

it("keeps unsupported synchronous permission queries unknown without opening the microphone", async () => {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: {
      query: () => {
        throw new TypeError("unsupported permission");
      },
    },
  });
  await render();
  expect(element.textContent).toContain("Not checked");
  expect(mock.capture).not.toHaveBeenCalled();
  expect(button("Check microphone access")?.disabled).toBe(false);
});

it("clears a stale denial when permission resets to prompt without claiming access is granted", async () => {
  const status = Object.assign(new EventTarget(), { state: "denied" as PermissionState });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue(status) },
  });
  mock.capture.mockRejectedValue(new Error("Microphone blocked"));
  await render();
  await click("Check microphone access");
  expect(button("Review access")).toBeDefined();
  await act(async () => {
    status.state = "prompt";
    status.dispatchEvent(new Event("change"));
  });
  expect(element.textContent).not.toContain("Microphone blocked");
  expect(element.textContent).not.toContain("Microphone allowed");
  expect(button("Review access")).toBeUndefined();
  expect(mock.capture).toHaveBeenCalledOnce();
});

it("keeps routine microphone lifetime guidance in help without starting capture", async () => {
  await render();
  expect(element.textContent).not.toContain("requested only when");
  const help = element.querySelector<HTMLButtonElement>(
    'button[aria-label="Microphone access: Help"]',
  )!;
  await act(async () => help.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("requested only when");
  expect(mock.capture).not.toHaveBeenCalled();
});

it("keeps a webview denial out of OS settings even when browser permission says denied", async () => {
  const status = Object.assign(new EventTarget(), { state: "denied" as PermissionState });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue(status) },
  });
  mock.capture.mockRejectedValue(new Error("Webview blocked"));
  await render();
  await click("Check microphone access");
  expect(element.textContent).toContain("Webview blocked");
  expect(button("Review access")).toBeUndefined();
  expect(button("Check microphone access")).toBeDefined();
});
