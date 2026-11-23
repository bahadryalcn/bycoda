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
async function choose(option: string) {
  const trigger = host.querySelector<HTMLButtonElement>(
    '[data-setting-id="voice-turn-silence"] button[aria-label^="Wait before replying:"]',
  )!;
  await act(async () => trigger.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent === option,
  )!;
  expect(item, option).toBeDefined();
  await act(async () => item.click());
}

it("opening More options leaves the saved microphone preferences untouched", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    wakeEnabled: true,
    wakePhrase: "Hello there",
    returnCall: false,
  });
  const saved = localStorage.getItem("bycoda.voice");
  await act(async () => root.render(createElement(Fixture)));
  const disclosure = button("More options");
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  await act(async () => disclosure.click());
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  expect(
    host.querySelector('[data-setting-id="voice-idle-sleep"]')?.closest("[hidden]"),
  ).toBeNull();
  expect(host.querySelector('[data-setting-id="voice-wake-phrase"]')).toBeNull();
  expect(localStorage.getItem("bycoda.voice")).toBe(saved);
  expect(change).not.toHaveBeenCalled();
});

it("keeps the visible conversation to one pause choice and the memory switch", async () => {
  await act(async () => root.render(createElement(Fixture)));
  for (const id of ["voice-turn-silence", "voice-memory"])
    expect(host.querySelector(`[data-setting-id="${id}"]`)?.closest("[hidden]"), id).toBeNull();
  for (const id of [
    "voice-barge-in",
    "voice-remove-fillers",
    "voice-hold-announcements",
    "voice-idle-sleep",
    "voice-return-call",
  ])
    expect(host.querySelector(`[data-setting-id="${id}"]`)?.closest("[hidden]"), id).not.toBeNull();
  // The old separate switch, the listening window and the preset are gone.
  expect(host.querySelector('[data-setting-id="voice-manual-turn-end"]')).toBeNull();
  expect(host.querySelector('[data-setting-id="voice-return-call-seconds"]')).toBeNull();
  expect(host.textContent).not.toContain("Apply professional preset");
});

it("ends the turn manually through the same acknowledged save and keeps the saved pause", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    mode: "openai",
    manualTurnEnd: false,
    manualTurnEndRevision: 4,
    experimentalSemanticVad: true,
    turnEndSilence: 4,
  });
  await act(async () => root.render(createElement(Fixture)));
  expect(button("More options").getAttribute("aria-expanded")).toBe("true");
  await choose("I end my turn");
  expect(loadVoiceSettings()).toMatchObject({
    manualTurnEnd: true,
    manualTurnEndRevision: 5,
    turnEndSilence: 4,
    experimentalSemanticVad: true,
  });
  expect(host.querySelector('[data-setting-id="voice-semantic-vad"] [disabled]')).not.toBeNull();
  expect(host.textContent).toContain("Choose Finish turn to send your speech");
  expect(change).not.toHaveBeenCalled();
});

it("returns to automatic replies with the chosen pause and a fresh revision", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    manualTurnEnd: true,
    manualTurnEndRevision: 9,
    turnEndSilence: 1.2,
  });
  await act(async () => root.render(createElement(Fixture)));
  await choose("Longer pause");
  expect(loadVoiceSettings()).toMatchObject({ manualTurnEnd: false, manualTurnEndRevision: 10 });
  expect(change).toHaveBeenCalledExactlyOnceWith({ turnEndSilence: 2.5 });
});

it("reaches Assistant settings with one link", async () => {
  const open = vi.fn();
  window.addEventListener("bycoda:open-assistant", open);
  try {
    await act(async () => root.render(createElement(Fixture)));
    await act(async () => button("Assistant settings").click());
    expect((open.mock.calls[0]![0] as CustomEvent).detail).toEqual({ tab: "settings" });
    expect(
      [...host.querySelectorAll("button")].filter(
        (node) => node.textContent?.trim() === "Assistant settings",
      ),
    ).toHaveLength(1);
  } finally {
    window.removeEventListener("bycoda:open-assistant", open);
  }
});
