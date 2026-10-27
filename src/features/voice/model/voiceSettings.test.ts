// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  subscribeVoiceSettings,
  voiceRuntimeSettings,
} from "./voiceSettings";

afterEach(() => localStorage.clear());

it("defaults older settings to mark and expanded while preserving runtime configuration", () => {
  localStorage.setItem(
    "bycoda.voice",
    JSON.stringify({ enabled: true, natural: false, python: " custom-python " }),
  );
  expect(loadVoiceSettings()).toMatchObject({
    enabled: true,
    natural: false,
    visual: "mark",
    compact: false,
  });
  expect(voiceRuntimeSettings(loadVoiceSettings())).toEqual({
    natural: false,
    python: "custom-python",
  });
});

it.each([null, false, 3, "unknown", {}, ["wave"]])(
  "rejects invalid visual values: %j",
  (visual) => {
    localStorage.setItem("bycoda.voice", JSON.stringify({ visual, compact: "true" }));
    expect(loadVoiceSettings()).toMatchObject({ visual: "mark", compact: false });
  },
);

it.each(["mark", "wave", "dots", "orb"] as const)(
  "persists %s and compact mode and broadcasts the change",
  (visual) => {
    const listener = vi.fn();
    const stop = subscribeVoiceSettings(listener);
    const previous = loadVoiceSettings();
    saveVoiceSettings({ ...previous, visual, compact: true });
    expect(loadVoiceSettings()).toEqual({ ...previous, visual, compact: true });
    expect(listener).toHaveBeenCalledOnce();
    expect(voiceRuntimeSettings(loadVoiceSettings())).toEqual(voiceRuntimeSettings(previous));
    stop();
  },
);
