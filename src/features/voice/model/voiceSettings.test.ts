// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  dictationLanguage,
  loadVoiceSettings,
  saveVoiceSettings,
  subscribeVoiceSettings,
  voiceRuntimeSettings,
} from "./voiceSettings";

afterEach(() => localStorage.clear());

it("bounds dictation preferences without splitting UTF-16 and preserves dynamic cloud models", () => {
  localStorage.setItem(
    "bycoda.voice",
    JSON.stringify({
      dictationModels: { openrouter: "vendor/new-transcription-model" },
      dictationDictionary: [
        { term: `${"x".repeat(199)}🦊`, aliases: ["by coda"], projectId: "project-a" },
        null,
      ],
      dictationCleanup: {
        enabled: true,
        model: "model",
        instructions: "x".repeat(5000),
        translateToEnglish: true,
      },
      dictationShortcutMode: "invalid",
      dictationIdleUnloadMinutes: -1,
    }),
  );
  const settings = loadVoiceSettings();
  expect(settings.dictationModels.openrouter).toBe("vendor/new-transcription-model");
  expect(settings.dictationDictionary).toEqual([
    { term: "x".repeat(199), aliases: ["by coda"], projectId: "project-a" },
  ]);
  expect(settings.dictationCleanup.instructions).toHaveLength(4000);
  expect(settings.dictationShortcutMode).toBe("auto");
  expect(settings.dictationIdleUnloadMinutes).toBe(5);
});

it("keeps both voice and dictation off for a fresh preference", () => {
  expect(loadVoiceSettings()).toMatchObject({ enabled: false, dictationEnabled: false });
});

it.each([true, false])("inherits legacy dictation visibility from voice enabled=%s", (enabled) => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ enabled }));
  expect(loadVoiceSettings()).toMatchObject({ enabled, dictationEnabled: enabled });
});

it.each([
  [true, false],
  [false, true],
])("persists independent voice=%s and dictation=%s choices", (enabled, dictationEnabled) => {
  saveVoiceSettings({ ...loadVoiceSettings(), enabled, dictationEnabled });
  expect(loadVoiceSettings()).toMatchObject({ enabled, dictationEnabled });
  saveVoiceSettings({ ...loadVoiceSettings(), enabled: !enabled });
  expect(loadVoiceSettings()).toMatchObject({ enabled: !enabled, dictationEnabled });
});

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

it("keeps a valid speaker per engine and sends only a non-default Supertonic speaker", () => {
  localStorage.setItem(
    "bycoda.voice",
    JSON.stringify({ speakers: { supertonic: "F2", grok: "rex", openai: "nope" } }),
  );
  const settings = loadVoiceSettings();
  expect(settings.speakers).toEqual({ supertonic: "F2", grok: "rex", openai: "marin" });
  expect(voiceRuntimeSettings(settings)).toMatchObject({ natural: true, voiceId: "F2" });
  expect(
    voiceRuntimeSettings({ ...settings, speakers: { ...settings.speakers, supertonic: "M1" } }),
  ).not.toHaveProperty("voiceId");
  expect(voiceRuntimeSettings({ ...settings, engine: "voxcpm2" })).not.toHaveProperty("voiceId");
  localStorage.removeItem("bycoda.voice");
});

it("never forces the interface language on cloud dictation, which would translate speech", () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ dictationLanguage: "xx" }));
  const settings = loadVoiceSettings();
  expect(settings.dictationLanguage).toBe("auto");
  // Automatic: cloud providers detect the language; local Whisper keeps the hint.
  expect(dictationLanguage({ ...settings, dictationEngine: "xai" }, "en-US")).toBe("");
  expect(dictationLanguage({ ...settings, dictationEngine: "local" }, "en-US")).toBe("en");
  // A chosen language is sent to every recognizer.
  localStorage.setItem("bycoda.voice", JSON.stringify({ dictationLanguage: "tr" }));
  const chosen = loadVoiceSettings();
  expect(dictationLanguage({ ...chosen, dictationEngine: "xai" }, "en-US")).toBe("tr");
  expect(dictationLanguage({ ...chosen, dictationEngine: "local" }, "en-US")).toBe("tr");
});

it("parses the return call settings backward compatibly", async () => {
  const { loadVoiceSettings } = await import("./voiceSettings");
  const save = (value: unknown) => localStorage.setItem("bycoda.voice", JSON.stringify(value));
  localStorage.removeItem("bycoda.voice");
  expect(loadVoiceSettings().returnCall).toBeUndefined();
  save({ enabled: true });
  expect(loadVoiceSettings()).not.toHaveProperty("returnCall");
  save({ returnCall: true, returnCallSeconds: 45 });
  expect(loadVoiceSettings()).toMatchObject({ returnCall: true, returnCallSeconds: 45 });
  save({ returnCall: "yes", returnCallSeconds: 3 });
  const bad = loadVoiceSettings();
  expect(bad).not.toHaveProperty("returnCall");
  expect(bad).not.toHaveProperty("returnCallSeconds");
});
