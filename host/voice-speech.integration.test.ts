import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { voiceRuntimeConfig } from "./voice-runtime";
import { VoiceSpeechService } from "./voice-speech";

// Explicit opt-in: uses an existing local model/environment, never downloads or
// installs anything. Package discovery alone cannot validate the inference API.
const configPath = process.env.BYCODA_VOICE_TEST_CONFIG;
it.skipIf(!configPath)(
  "generates non-silent PCM with the installed VoxCPM API",
  async () => {
    const config = voiceRuntimeConfig(JSON.parse(await readFile(configPath!, "utf8")));
    const service = new VoiceSpeechService();
    try {
      await service.start(config);
      for (const text of [
        "Hello. The local voice test is working.",
        "Merhaba. Sesli sohbet çalışıyor.",
      ]) {
        const { id } = service.speak("integration-test", text);
        let bytes = 0;
        let peak = 0;
        for (;;) {
          const chunk = await service.next("integration-test", id);
          expect(chunk.error).toBeUndefined();
          if (chunk.audio) {
            expect(chunk.sampleRate).toBeGreaterThanOrEqual(16000);
            const pcm = Buffer.from(chunk.audio, "base64");
            expect(pcm.length % 2).toBe(0);
            bytes += pcm.length;
            for (let offset = 0; offset < pcm.length; offset += 2)
              peak = Math.max(peak, Math.abs(pcm.readInt16LE(offset)));
          }
          if (chunk.done) break;
        }
        expect(bytes).toBeGreaterThan(3200);
        expect(peak).toBeGreaterThan(32);
      }
    } finally {
      service.close();
    }
  },
  180_000,
);
