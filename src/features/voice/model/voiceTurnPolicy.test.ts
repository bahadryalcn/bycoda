// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { loadVoiceSettings, saveVoiceSettings } from "./voiceSettings";
import { chooseVoiceTurnEnd, saveVoiceTurnEndChoice, VOICE_TURN_CHOICE_FAILED } from "./voiceTurnPolicy";
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();});

it("keeps the automatic default until an explicit owner choice", () => {
  const defaults = loadVoiceSettings();
  expect(defaults.manualTurnEnd).toBeUndefined();
  const manual = chooseVoiceTurnEnd(defaults, true);
  expect(manual).toMatchObject({ manualTurnEnd: true, manualTurnEndRevision: 1 });
  expect(defaults.manualTurnEnd).toBeUndefined();
});

it("reports storage failure instead of changing the runtime policy without a saved control",()=>{
  saveVoiceSettings({...loadVoiceSettings(),manualTurnEnd:false,manualTurnEndRevision:4});
  vi.spyOn(localStorage,"setItem").mockImplementation(()=>{throw new Error("quota");});
  expect(()=>saveVoiceTurnEndChoice(true)).toThrow(VOICE_TURN_CHOICE_FAILED);
  expect(loadVoiceSettings()).toMatchObject({manualTurnEnd:false,manualTurnEndRevision:4});
});

it("retains unrelated preferences and increments the latest owner revision", () => {
  const original = { ...loadVoiceSettings(), manualTurnEnd: true, manualTurnEndRevision: 7, turnEndSilence: 4, microphoneId: "owner-device", compact: true };
  const changed = chooseVoiceTurnEnd(original, false);
  expect(changed).toEqual({ ...original, manualTurnEnd: false, manualTurnEndRevision: 8 });
  expect(chooseVoiceTurnEnd(changed, false).manualTurnEndRevision).toBe(9);
});
