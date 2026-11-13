// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceConversationStyle } from "./VoiceConversationStyle";
import { loadVoiceSettings, saveVoiceSettings, useVoiceSettings } from "../model/voiceSettings";
let host: HTMLDivElement, root: Root;
const change = vi.fn();
function Fixture() {
  const settings = useVoiceSettings();
  return createElement(VoiceConversationStyle, { settings, change });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  change.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  )!;

it("opening sleep and wake keeps opt-ins untouched and preserves an uncommitted phrase draft", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    wakeEnabled: true,
    wakePhrase: "Hello there",
    returnCall: false,
  });
  const saved = localStorage.getItem("bycoda.voice");
  await act(async () => root.render(createElement(Fixture)));
  const disclosure = button("Sleep and wake");
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  await act(async () => disclosure.click());
  const input = host.querySelector<HTMLInputElement>(
    '[data-setting-id="voice-wake-phrase"] input',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "x");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => disclosure.click());
  await act(async () => disclosure.click());
  expect(host.querySelector('[data-setting-id="voice-wake-phrase"] input')).toBe(input);
  expect(input.value).toBe("x");
  expect(localStorage.getItem("bycoda.voice")).toBe(saved);
  expect(change).not.toHaveBeenCalled();
});

it("keeps manual turn acknowledgement and its dependent controls intact", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    mode: "openai",
    manualTurnEnd: false,
    manualTurnEndRevision: 4,
    experimentalSemanticVad: true,
    turnEndSilence: 4,
  });
  await act(async () => root.render(createElement(Fixture)));
  expect(button("Advanced turn detection").getAttribute("aria-expanded")).toBe("true");
  const manual = host.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="I decide when my turn ends"]',
  )!;
  await act(async () => manual.click());
  expect(loadVoiceSettings()).toMatchObject({
    manualTurnEnd: true,
    manualTurnEndRevision: 5,
    turnEndSilence: 4,
    experimentalSemanticVad: true,
  });
  expect(host.querySelector('[data-setting-id="voice-turn-silence"] [disabled]')).not.toBeNull();
  expect(host.querySelector('[data-setting-id="voice-semantic-vad"] [disabled]')).not.toBeNull();
  expect(change).not.toHaveBeenCalled();
});
