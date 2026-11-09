import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function mockAudio(play = vi.fn().mockResolvedValue(undefined)) {
  type Voice = {
    src: string;
    volume: number;
    play: typeof play;
    pause: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
    onerror: (() => void) | null;
  };
  const voices: Voice[] = [];
  const Constructor = vi.fn(function (src: string) {
    const voice: Voice = {
      src,
      volume: 1,
      play,
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
      onended: null,
      onerror: null,
    };
    voices.push(voice);
    return voice;
  });
  vi.stubGlobal("Audio", Constructor);
  return { voices, Constructor };
}

it("initializes silently and tolerates environments without audio", async () => {
  vi.stubGlobal("Audio", undefined);
  const engine = await import("./bycodaSoundEngine");
  engine.setEnabled(true);
  engine.setVolume(0.55);
  await expect(engine.play("settle")).resolves.toBeUndefined();
});

it("plays all six packaged approved WAVs at the configured volume", async () => {
  const audio = mockAudio();
  const engine = await import("./bycodaSoundEngine");
  expect(audio.Constructor).not.toHaveBeenCalled();
  for (const cue of ["settle", "knock", "thread", "welcome", "touch", "stamp"] as const)
    await engine.play(cue);
  expect(audio.voices.map((v) => v.src)).toEqual(
    ["complete", "inbox", "activity", "update", "toggle", "copy"].map(
      (name) => `/sounds/bycoda-v2/${name}.wav`,
    ),
  );
  for (const voice of audio.voices) {
    expect(voice.volume).toBe(0.55);
    const wav = readFileSync(resolve("public", voice.src.slice(1)));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.length).toBeGreaterThan(44);
  }
});

it("bounds overlapping cues, releases ended audio and stops every voice on mute", async () => {
  const audio = mockAudio();
  const engine = await import("./bycodaSoundEngine");
  engine.setVolume(8);
  for (let i = 0; i < 7; i++) await engine.play("touch");
  expect(audio.voices).toHaveLength(6);
  expect(audio.voices[0].volume).toBe(1);
  audio.voices[0].onended?.();
  expect(audio.voices[0].removeAttribute).toHaveBeenCalledWith("src");
  await engine.play("stamp");
  expect(audio.voices).toHaveLength(7);
  engine.setEnabled(false);
  for (const voice of audio.voices) expect(voice.pause).toHaveBeenCalled();
  await engine.play("stamp");
  expect(audio.voices).toHaveLength(7);
});

it("cleans up rejected playback and asset errors so later cues can play", async () => {
  const play = vi.fn().mockRejectedValue(new Error("blocked"));
  const audio = mockAudio(play);
  const engine = await import("./bycodaSoundEngine");
  await expect(engine.play("knock")).resolves.toBeUndefined();
  expect(audio.voices[0].pause).toHaveBeenCalled();
  play.mockResolvedValue(undefined);
  await engine.play("knock");
  audio.voices[1].onerror?.();
  expect(audio.voices[1].load).toHaveBeenCalled();
  await engine.play("knock");
  expect(audio.voices).toHaveLength(3);
});

it("never resumes an outstanding cue after mute and unmute", async () => {
  let resume!: () => void;
  const audio = mockAudio(
    vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resume = resolve;
        }),
    ),
  );
  const engine = await import("./bycodaSoundEngine");
  const pending = engine.play("settle");
  engine.setEnabled(false);
  engine.setEnabled(true);
  resume();
  await pending;
  expect(audio.voices[0].pause).toHaveBeenCalledTimes(2);
});

it("does not create muted audio and applies volume changes to active voices", async () => {
  const audio = mockAudio();
  const engine = await import("./bycodaSoundEngine");
  engine.setVolume(Number.NaN);
  await engine.play("touch");
  expect(audio.Constructor).not.toHaveBeenCalled();
  engine.setVolume(1);
  await engine.play("touch");
  engine.setVolume(0.2);
  expect(audio.voices[0].volume).toBe(0.2);
  engine.setEnabled(false);
  await engine.play("touch");
  expect(audio.Constructor).toHaveBeenCalledTimes(1);
});
