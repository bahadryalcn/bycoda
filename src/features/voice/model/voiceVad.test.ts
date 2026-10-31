import { expect, it, vi } from "vitest";
import { VoiceVad, frameFeatures, pcmBase64, resamplePcm } from "./voiceVad";
/** A voiced (150 Hz) speech-like frame: the VAD requires pitch, not just level. */
const voicedFrame = () =>
  Int16Array.from({ length: 1024 }, (_, i) =>
    Math.round(4000 * Math.sin((2 * Math.PI * 150 * i) / 16000)),
  );
it("binds on local speech onset and emits one utterance after silence", () => {
  const start = vi.fn(),
    end = vi.fn();
  const vad = new VoiceVad(16000, start, end);
  const silence = new Int16Array(1024),
    speech = voicedFrame();
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
  vad.push(voicedFrame());
  for (let i = 0; i < 10; i++) vad.push(new Int16Array(1024));
  expect(end).not.toHaveBeenCalled();
  for (let i = 0; i < 5; i++) vad.push(voicedFrame());
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
    speech = voicedFrame();
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
  for (let i = 0; i < 5; i++) vad.push(voicedFrame());
  for (let i = 0; i < 15; i++) vad.push(new Int16Array(1024)); // 0.96 s
  expect(end).not.toHaveBeenCalled();
  for (let i = 0; i < 6; i++) vad.push(new Int16Array(1024)); // 1.34 s
  expect(end).toHaveBeenCalledOnce();
});

/** Breath-like frame: loud band-limited noise without pitch. */
function breathFrame(seed: number, level = 6000) {
  let state = seed;
  let low = 0;
  return Int16Array.from({ length: 1024 }, () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    low = 0.6 * low + 0.4 * (state / 1073741824 - 1);
    return Math.round(level * low);
  });
}

it("rejects breath and other loud unvoiced noise, however long", () => {
  const start = vi.fn();
  const vad = new VoiceVad(16000, start, vi.fn());
  for (let i = 0; i < 40; i++) vad.push(breathFrame(i + 1)); // 2.5 s of breathing
  expect(start).not.toHaveBeenCalled();
});

it("starts on sustained voiced speech and keeps the audio from before the onset", () => {
  const start = vi.fn(),
    end = vi.fn();
  const vad = new VoiceVad(16000, start, end);
  for (let i = 0; i < 6; i++) vad.push(new Int16Array(1024));
  vad.push(voicedFrame());
  expect(start).not.toHaveBeenCalled(); // one voiced frame is not yet a turn
  vad.push(voicedFrame());
  expect(start).toHaveBeenCalledOnce(); // ~0.13 s of voiced speech
  vad.push(voicedFrame());
  vad.push(voicedFrame());
  for (let i = 0; i < 10; i++) vad.push(new Int16Array(1024));
  // The utterance includes ~0.5 s of pre-roll before the onset, so no word is cut.
  expect(end.mock.calls[0][0].length).toBeGreaterThanOrEqual(8 * 1024);
});

it("adapts to background noise: speech must clear the room's level", () => {
  const start = vi.fn();
  const vad = new VoiceVad(16000, start, vi.fn());
  const voiced = (amplitude: number) =>
    Int16Array.from({ length: 1024 }, (_, i) =>
      Math.round(amplitude * Math.sin((2 * Math.PI * 150 * i) / 16000)),
    );
  // Soft speech (RMS ~0.017) starts a turn in a quiet room...
  vad.push(voiced(800));
  vad.push(voiced(800));
  expect(start).toHaveBeenCalledOnce();
  // ...but not over a steady fan (RMS ~0.02): the floor has risen with the noise.
  const noisy = new VoiceVad(16000, start, vi.fn());
  for (let i = 0; i < 60; i++) noisy.push(breathFrame(i + 7, 3500));
  const mixed = () => {
    const fan = breathFrame(99, 3500);
    return voiced(800).map((v, i) => v + fan[i]);
  };
  for (let i = 0; i < 4; i++) noisy.push(mixed());
  expect(start).toHaveBeenCalledOnce();
  // Clearly louder speech over the same fan does.
  for (let i = 0; i < 2; i++) noisy.push(voiced(8000));
  expect(start).toHaveBeenCalledTimes(2);
});

it("needs longer speech to interrupt while the assistant is speaking", () => {
  const start = vi.fn();
  const vad = new VoiceVad(16000, start, vi.fn());
  vad.setStrict(true);
  for (let i = 0; i < 3; i++) vad.push(voicedFrame());
  expect(start).not.toHaveBeenCalled(); // ~0.19 s is not enough to barge in
  vad.push(voicedFrame());
  expect(start).toHaveBeenCalledOnce(); // ~0.26 s is
  vad.reset();
  vad.setStrict(false);
  vad.push(voicedFrame());
  vad.push(voicedFrame());
  expect(start).toHaveBeenCalledTimes(2);
});

it("measures pitch periodicity: voiced speech high, breath noise low", () => {
  expect(frameFeatures(voicedFrame(), 16000).periodicity).toBeGreaterThan(0.9);
  expect(frameFeatures(breathFrame(3), 16000).periodicity).toBeLessThan(0.35);
});
