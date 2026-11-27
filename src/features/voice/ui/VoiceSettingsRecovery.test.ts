// @vitest-environment happy-dom
// Regression coverage derived from the independent audit probes.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ cloudStatus: vi.fn(), setCloudKey: vi.fn() }));
vi.mock("../model/localVoiceClient", () => ({ localVoiceBackend: backend }));
import { DictationDictionarySettings } from "./DictationDictionarySettings";
import { VoiceCloudKey } from "./VoiceCloudKey";
import { VoiceConversationStyle } from "./VoiceConversationStyle";
import { clearRetainedVoiceDrafts } from "../model/voiceSettingsDrafts";
import { loadVoiceSettings, saveVoiceSettings } from "../model/voiceSettings";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  clearRetainedVoiceDrafts();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === text,
  )!;
  expect(button, text).toBeTruthy();
  await act(async () => button.click());
}
async function term(value: string) {
  const field = [...host.querySelectorAll("input")].find(
    (x) => document.querySelector(`label[for="${x.id}"]`)?.textContent === "Preferred spelling",
  )!;
  expect(field).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function dictionary() {
  return createElement(DictationDictionarySettings, {
    settings: loadVoiceSettings(),
    change: (patch) => saveVoiceSettings({ ...loadVoiceSettings(), ...patch }),
  });
}
it("retains dictionary fields on failed save and closes only after retry", async () => {
  await act(async () => root.render(dictionary()));
  await click("Add term");
  await term("Audit unsaved term");
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("QuotaExceededError");
  });
  await click("Save");
  expect(loadVoiceSettings().dictationDictionary).toEqual([]);
  expect([...host.querySelectorAll("input")].some((x) => x.value === "Audit unsaved term")).toBe(
    true,
  );
  expect(host.textContent).toContain("could not be saved");
  await click("Save");
  expect(loadVoiceSettings().dictationDictionary[0]?.term).toBe("Audit unsaved term");
});
it("retains dictionary draft across Settings unmount/remount", async () => {
  await act(async () => root.render(dictionary()));
  await click("Add term");
  await term("Audit retained draft");
  await act(async () => root.render(null));
  await act(async () => root.render(dictionary()));
  expect([...host.querySelectorAll("input")].some((x) => x.value === "Audit retained draft")).toBe(
    true,
  );
  await click("Cancel");
});
it("shows unknown credential status with retry after read failure", async () => {
  backend.cloudStatus.mockRejectedValue(new Error("Audit host unavailable"));
  await act(async () => root.render(createElement(VoiceCloudKey, { provider: "elevenlabs" })));
  expect(host.textContent).toContain("Retry status");
  expect(host.textContent).toContain("Could not check");
});
it.each([0.5, 2, 3.25, 5])("labels saved custom pause %s with seconds", async (pause) => {
  saveVoiceSettings({ ...loadVoiceSettings(), turnEndSilence: pause });
  await act(async () =>
    root.render(
      createElement(VoiceConversationStyle, { settings: loadVoiceSettings(), change: vi.fn() }),
    ),
  );
  expect(
    host
      .querySelector('[data-setting-id="voice-turn-silence"] button:not(.settings-reset)')
      ?.getAttribute("aria-label"),
  ).toBe(`Wait before replying: ${pause} seconds`);
  expect(loadVoiceSettings().turnEndSilence).toBe(pause);
});
