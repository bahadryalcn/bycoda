// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { voiceSaveFailures } from "../model/voiceSettingsSave";
import { MicrophoneInputSettings } from "./MicrophoneInputSettings";
import { loadVoiceSettings, saveVoiceSettings } from "../model/voiceSettings";
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  localStorage.clear();
  voiceSaveFailures.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(MicrophoneInputSettings)));
}
it("never requests microphone access when opening settings", async () => {
  const capture = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: capture, enumerateDevices: vi.fn(async () => []) },
  });
  await render();
  expect(capture).not.toHaveBeenCalled();
  expect(container.textContent).toContain("System default");
  expect(container.textContent).toContain("Record test");
  // Permission is shown only when something is wrong.
  expect(container.textContent).not.toContain("Not checked");
  expect(container.textContent).not.toContain("Check microphone access");
});
it("keeps the Delete recording action in place but inert until something is recorded", async () => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { enumerateDevices: vi.fn(async () => []) },
  });
  await render();
  const remove = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Delete recording"]',
  )!;
  expect(remove.disabled).toBe(true);
});
it("survives a browser without device enumeration", async () => {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
  await render();
  expect(container.textContent).toContain("Record test");
});
it("shows a passive denial with its recovery, and clears it when permission is granted", async () => {
  const status = Object.assign(new EventTarget(), { state: "denied" as PermissionState });
  const query = vi.fn().mockResolvedValue(status);
  const capture = vi.fn();
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query } });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { enumerateDevices: vi.fn(async () => []), getUserMedia: capture },
  });
  await render();
  expect(query).toHaveBeenCalledWith({ name: "microphone" });
  expect(container.textContent).toContain("Microphone access is blocked");
  await act(async () => {
    status.state = "granted";
    status.dispatchEvent(new Event("change"));
  });
  expect(container.textContent).not.toContain("Microphone access is blocked");
  expect(capture).not.toHaveBeenCalled();
  await act(async () => root!.unmount());
  root = undefined;
});
it("cancels a pending permission request and releases a late grant", async () => {
  const stop = vi.fn();
  let grant!: (stream: unknown) => void;
  const capture = vi.fn(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  vi.stubGlobal("MediaRecorder", class {});
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { enumerateDevices: vi.fn(async () => []), getUserMedia: capture },
  });
  await render();
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  await act(async () => button("Record test")!.click());
  expect(capture).toHaveBeenCalledOnce();
  expect(button("Cancel")).toBeDefined();
  await act(async () => button("Cancel")!.click());
  expect(button("Cancel")).toBeUndefined();
  expect(button("Record test")?.disabled).toBe(false);
  await act(async () => grant({ getTracks: () => [{ stop, addEventListener() {} }] }));
  expect(stop).toHaveBeenCalled();
});
it("shows a failed test once, with raw text and no second permission row", async () => {
  vi.stubGlobal("MediaRecorder", class {});
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: vi.fn(async () => []),
      getUserMedia: vi.fn().mockRejectedValue(new Error("device busy")),
    },
  });
  await render();
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((item) => item.textContent?.trim() === "Record test")!
      .click(),
  );
  expect(container.textContent?.match(/device busy/g)).toHaveLength(1);
  expect(container.querySelector('[data-setting-id="speech-microphone"]')).toBeNull();
});
it("preserves an unplugged microphone and blocks recording until selection changes", async () => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { enumerateDevices: vi.fn(async () => []) },
  });
  saveVoiceSettings({ ...loadVoiceSettings(), microphoneId: "unplugged-usb-mic" });
  await render();
  expect(container.textContent).toContain("Selected microphone unavailable");
  const record = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Record test",
  )!;
  expect(record.disabled || record.getAttribute("aria-disabled") === "true").toBe(true);
  expect(loadVoiceSettings().microphoneId).toBe("unplugged-usb-mic");
});

it("keeps saved microphone on failed selection and retries without requesting capture", async () => {
  const capture = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { enumerateDevices: vi.fn(async () => []), getUserMedia: capture },
  });
  saveVoiceSettings({ ...loadVoiceSettings(), microphoneId: "unplugged-usb-mic" });
  await render();
  const row = container.querySelector('[data-setting-id="voice-microphone-input"]')!;
  await act(async () => row.querySelector<HTMLButtonElement>("button")!.click());
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("QuotaExceededError");
  });
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent === "System default")!
      .click(),
  );
  expect(loadVoiceSettings().microphoneId).toBe("unplugged-usb-mic");
  expect(row.textContent).toContain("could not be saved");
  await act(async () =>
    [...row.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click(),
  );
  expect(loadVoiceSettings().microphoneId).toBe("");
  expect(capture).not.toHaveBeenCalled();
});

it("lets the owner grant capture when browsers hide microphone ids before permission", async () => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: vi.fn(async () => [{ kind: "audioinput", deviceId: "", label: "" }]),
    },
  });
  saveVoiceSettings({ ...loadVoiceSettings(), microphoneId: "saved-usb-mic" });
  await render();
  expect(container.textContent).not.toContain("Selected microphone unavailable");
  const record = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Record test",
  )!;
  expect(record.disabled).toBe(false);
});
