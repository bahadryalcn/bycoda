// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { loadVoiceSettings, saveVoiceSettings } from "./voiceSettings";
import { saveVoiceSettingsPatch, voiceSaveFailures } from "./voiceSettingsSave";
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  voiceSaveFailures.clear();
});
it("retries only the failed nested field while preserving sibling edits", () => {
  const before = loadVoiceSettings();
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("QuotaExceededError");
  });
  expect(
    saveVoiceSettingsPatch({
      dictationCleanup: { ...before.dictationCleanup, instructions: "Keep wording" },
    }),
  ).toBe(false);
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationCleanup: { ...before.dictationCleanup, model: "external-model" },
    dictationLanguage: "tr",
  });
  voiceSaveFailures.get()["dictation-cleanup-instructions"].retry();
  expect(loadVoiceSettings().dictationCleanup).toMatchObject({
    instructions: "Keep wording",
    model: "external-model",
  });
  expect(loadVoiceSettings().dictationLanguage).toBe("tr");
  expect(voiceSaveFailures.get()).toEqual({});
});
it("compares normalized optional fields and clears an older failure on a later successful edit", () => {
  saveVoiceSettings({ ...loadVoiceSettings(), wakeEnabled: true });
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("QuotaExceededError");
  });
  expect(saveVoiceSettingsPatch({ wakeEnabled: false })).toBe(false);
  expect(voiceSaveFailures.get()["voice-wake"]).toBeTruthy();
  expect(saveVoiceSettingsPatch({ wakeEnabled: false })).toBe(true);
  expect(loadVoiceSettings().wakeEnabled).toBeUndefined();
  expect(voiceSaveFailures.get()).toEqual({});
});
