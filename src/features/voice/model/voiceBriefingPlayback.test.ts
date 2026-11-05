import { expect, it, vi } from "vitest";
import { briefingChunks, previewBriefing } from "./voiceBriefingPlayback";
import { previewVoice } from "./voicePreview";
import type { VoiceSettings } from "./voiceSettings";

vi.mock("./voicePreview", () => ({ previewVoice: vi.fn() }));

it("splits long briefings without losing or reordering text", () => {
  const text = `${"A long briefing sentence. ".repeat(300)}${"x".repeat(4000)}`;
  const chunks = briefingChunks(text);
  expect(chunks.join("")).toBe(text);
  expect(chunks.every((chunk) => chunk.length <= 3000)).toBe(true);
  expect(chunks.length).toBeGreaterThan(2);
});

it("stops before the next chunk when playback is cancelled", async () => {
  const controller = new AbortController();
  const speak = vi.mocked(previewVoice);
  speak.mockReset().mockImplementation(async () => { controller.abort(); });
  await previewBriefing({} as VoiceSettings, "en", "", controller.signal, () => {},
    "x".repeat(7000), () => {}, { complete: true });
  expect(speak).toHaveBeenCalledTimes(1);
  expect(speak.mock.calls[0][5]).toHaveLength(3000);
});
