import { expect, it, vi } from "vitest";
import { VoiceVad, pcmBase64, resamplePcm } from "./voiceVad";
it("binds on local speech onset and emits one utterance after silence", () => {
  const start = vi.fn(),
    end = vi.fn();
  const vad = new VoiceVad(16000, start, end);
  const silence = new Int16Array(1024),
    speech = new Int16Array(1024).fill(4000);
  vad.push(silence);
  for (let i = 0; i < 5; i++) vad.push(speech);
  expect(start).toHaveBeenCalledTimes(1);
  expect(end).not.toHaveBeenCalled();
  for (let i = 0; i < 10; i++) vad.push(silence);
  expect(end).toHaveBeenCalledTimes(1);
  expect(end.mock.calls[0][0].length).toBeLessThanOrEqual(16000 * 2);
});
it("discards brief noise and paused partial utterances", () => {
  const end = vi.fn(),
    vad = new VoiceVad(16000, vi.fn(), end);
  vad.push(new Int16Array(1024).fill(4000));
  for (let i = 0; i < 10; i++) vad.push(new Int16Array(1024));
  expect(end).not.toHaveBeenCalled();
  for (let i = 0; i < 5; i++) vad.push(new Int16Array(1024).fill(4000));
  vad.reset();
  for (let i = 0; i < 10; i++) vad.push(new Int16Array(1024));
  expect(end).not.toHaveBeenCalled();
});
it("encodes explicit little-endian PCM and resamples hardware rates", () => {
  expect([...Buffer.from(pcmBase64(new Int16Array([1, -1, 32767, -32768])), "base64")]).toEqual([
    1, 0, 255, 255, 255, 127, 0, 128,
  ]);
  expect(resamplePcm(new Int16Array(48000), 48000)).toHaveLength(16000);
});
