import { expect, it } from "vitest";
import { LocalVoiceService, validateVoiceAudio } from "./voice-local";
it("validates bounded PCM16 and language before starting any worker", () => {
  const audio = Buffer.alloc(6400).toString("base64");
  expect(validateVoiceAudio(audio, "tr")).toEqual({ audio, language: "tr" });
  for (const invalid of [
    "",
    "../../shell",
    Buffer.alloc(6401).toString("base64"),
    "A".repeat(1_280_004),
  ])
    expect(() => validateVoiceAudio(invalid, "tr")).toThrow();
  expect(() => validateVoiceAudio(audio, "tr;command")).toThrow();
});
it("rejects transcription without a lease and releases idempotently", async () => {
  const service = new LocalVoiceService();
  await expect(
    service.transcribe("unknown", Buffer.alloc(6400).toString("base64")),
  ).rejects.toThrow("expired");
  expect(service.release("unknown")).toEqual({ released: true });
  service.close();
});
