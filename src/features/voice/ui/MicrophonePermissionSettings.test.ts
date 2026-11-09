// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ capture: vi.fn(), open: vi.fn(), canOpen: true }));
vi.mock("../../../platform/tauri/privacySettings", () => ({ openPrivacySettings: mock.open }));
vi.mock("../model/microphoneAccess", () => ({
  openMicrophone: mock.capture,
  microphoneBlockedMessage: () => "Microphone blocked",
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
  expect(element.textContent).toContain("requested only when");
  await click("Check microphone access");
  expect(mock.capture).toHaveBeenCalledExactlyOnceWith({
    audio: { deviceId: { exact: "selected-device" } },
    video: false,
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(element.textContent).toContain("Microphone permission is allowed.");
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
  expect(element.textContent).not.toContain("Microphone permission is allowed.");
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
  await click("Open Privacy Settings");
  expect(mock.open).toHaveBeenCalledWith("microphone");
  expect(element.textContent).toContain("Could not open microphone settings.");
  expect(element.textContent).not.toContain("Microphone permission is allowed.");
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
  expect(element.textContent).toContain("Microphone permission is allowed.");
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
  expect(element.textContent).toContain("requested only when");
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
  expect(button("Open Privacy Settings")).toBeDefined();
  await act(async () => {
    status.state = "prompt";
    status.dispatchEvent(new Event("change"));
  });
  expect(element.textContent).not.toContain("Microphone blocked");
  expect(element.textContent).not.toContain("Microphone permission is allowed.");
  expect(button("Open Privacy Settings")).toBeUndefined();
  expect(mock.capture).toHaveBeenCalledOnce();
});
