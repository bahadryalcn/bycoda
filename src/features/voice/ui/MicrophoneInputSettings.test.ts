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
});
it("survives a browser without device enumeration", async () => {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
  await render();
  expect(container.textContent).toContain("Test microphone");
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
