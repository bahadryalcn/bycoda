import { expect, it } from "vitest";
import {
  isVoiceOverlayCommand,
  pointerOutsideWindow,
  readVoiceOverlayOwner,
  voiceOverlayLabel,
  voiceSummaryLine,
} from "./voiceOverlay";

it("accepts only known commands from the floating window", () => {
  expect(isVoiceOverlayCommand("toggleMute")).toBe(true);
  expect(isVoiceOverlayCommand("toggleSpeaker")).toBe(true);
  expect(isVoiceOverlayCommand("manualTurnEnd")).toBe(true);
  expect(isVoiceOverlayCommand("automaticTurnEnd")).toBe(true);
  expect(isVoiceOverlayCommand({ manualTurnEnd: true })).toBe(false);
  expect(isVoiceOverlayCommand("submit_work")).toBe(false);
  expect(isVoiceOverlayCommand({ command: "start" })).toBe(false);
});

it("reads a safe owner label and pairs it with the native overlay label", () => {
  expect(readVoiceOverlayOwner("?owner=main")).toBe("main");
  expect(readVoiceOverlayOwner("?owner=window-2_b")).toBe("window-2_b");
  expect(readVoiceOverlayOwner("?owner=a%26b")).toBeNull();
  expect(readVoiceOverlayOwner("")).toBeNull();
  expect(voiceOverlayLabel("main")).toBe("voice-overlay-main");
});

it("detects a drag that left the window on any edge", () => {
  expect(pointerOutsideWindow(10, 10, 800, 600)).toBe(false);
  expect(pointerOutsideWindow(-1, 10, 800, 600)).toBe(true);
  expect(pointerOutsideWindow(10, 600, 800, 600)).toBe(true);
  expect(pointerOutsideWindow(800, 10, 800, 600)).toBe(true);
});

it("summarizes the newest spoken line, keeping errors first", () => {
  const base = { message: "", transcript: "", error: "", statusText: "Listening" };
  expect(voiceSummaryLine(base)).toBe("Listening");
  expect(voiceSummaryLine({ ...base, transcript: "open the\nnotes" })).toBe("open the notes");
  expect(voiceSummaryLine({ ...base, transcript: "hi", message: "Done." })).toBe("Done.");
  expect(voiceSummaryLine({ ...base, message: "Done.", error: "Mic blocked" })).toBe("Mic blocked");
});
