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
it("showing the away settings leaves the saved microphone preferences untouched", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    wakeEnabled: true,
    wakePhrase: "Hello there",
    returnCall: false,
  });
  const saved = localStorage.getItem("bycoda.voice");
  await act(async () => root.render(createElement(Fixture)));
  expect(
    host.querySelector('[data-setting-id="voice-idle-sleep"]')?.closest("[hidden]"),
  ).toBeNull();
  expect(host.querySelector('[data-setting-id="voice-wake-phrase"]')).toBeNull();
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
  expect(host.querySelector('[data-setting-id="voice-semantic-vad"]')).not.toBeNull();
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
