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

it("asks at a short pause and ends the turn only when the owner commits that pause", () => {
  const end = vi.fn(),
    pause = vi.fn();
  const vad = new VoiceVad(16000, vi.fn(), end, undefined, { pause, endSilence: 1.3 });
  const silence = new Int16Array(1024),
    speech = new Int16Array(1024).fill(4000);
  for (let i = 0; i < 5; i++) vad.push(speech);
  for (let i = 0; i < 4; i++) vad.push(silence); // 0.256 s: one check, no fixed-pause end
  expect(pause).toHaveBeenCalledOnce();
  expect(end).not.toHaveBeenCalled();
  const [audio, firstPause] = pause.mock.calls[0];
  expect(audio.length).toBe(9 * 1024);
  // The speaker continued: that pause can no longer end the turn.
  vad.push(speech);
  expect(vad.commit(firstPause)).toBe(false);
  for (let i = 0; i < 4; i++) vad.push(silence);
  expect(pause).toHaveBeenCalledTimes(2);
  expect(vad.commit(pause.mock.calls[1][1])).toBe(true);
  for (let i = 0; i < 30; i++) vad.push(silence);
  expect(end).not.toHaveBeenCalled(); // Committed turns are not transcribed again.
});

it("falls back to the longer silence when no pause is committed", () => {
  const end = vi.fn();
  const vad = new VoiceVad(16000, vi.fn(), end, undefined, { pause: vi.fn(), endSilence: 1.3 });
  for (let i = 0; i < 5; i++) vad.push(new Int16Array(1024).fill(4000));
  for (let i = 0; i < 15; i++) vad.push(new Int16Array(1024)); // 0.96 s
  expect(end).not.toHaveBeenCalled();
  for (let i = 0; i < 6; i++) vad.push(new Int16Array(1024)); // 1.34 s
  expect(end).toHaveBeenCalledOnce();
});
