import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function mockAudio(state = "running", resume = vi.fn().mockResolvedValue(undefined)) {
  const oscillators: Array<{ stop: ReturnType<typeof vi.fn>; onended?: () => void }> = [];
  const gain = {
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  const createOscillator = vi.fn(() => {
    const oscillator = {
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: undefined as (() => void) | undefined,
    };
    oscillators.push(oscillator);
    return oscillator;
  });
  const Constructor = vi.fn(function () {
    return {
      state,
      currentTime: 1,
      destination: {},
      resume,
      createOscillator,
      createGain: () => ({ gain, connect: vi.fn(), disconnect: vi.fn() }),
    };
  });
  vi.stubGlobal("AudioContext", Constructor);
  return { Constructor, oscillators, gain, createOscillator };
}

it("initializes silently and supports environments without audio", async () => {
  vi.stubGlobal("AudioContext", undefined);
  const engine = await import("./bycodaSoundEngine");
  engine.setEnabled(true);
  engine.setVolume(0.55);
  await expect(engine.play("settle")).resolves.toBeUndefined();
});

it("limits simultaneous voices, clamps gain, and releases ended notes", async () => {
  const audio = mockAudio();
  const engine = await import("./bycodaSoundEngine");
  engine.setVolume(8);
  expect(audio.Constructor).not.toHaveBeenCalled();
  await engine.play("settle");
  await engine.play("welcome");
  await engine.play("touch");
  expect(audio.createOscillator).toHaveBeenCalledTimes(6);
  expect(audio.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.075, expect.any(Number));
  audio.oscillators.forEach((voice) => voice.onended?.());
  await engine.play("touch");
  expect(audio.createOscillator).toHaveBeenCalledTimes(7);
  engine.setEnabled(false);
  expect(audio.oscillators[6].stop).toHaveBeenCalledTimes(2);
  await engine.play("stamp");
  expect(audio.createOscillator).toHaveBeenCalledTimes(7);
});

it("swallows resume failures and never plays a suspended context", async () => {
  const audio = mockAudio("suspended", vi.fn().mockRejectedValue(new Error("blocked")));
  const engine = await import("./bycodaSoundEngine");
  await expect(engine.play("knock")).resolves.toBeUndefined();
  expect(audio.createOscillator).not.toHaveBeenCalled();
});

it("does not create audio when muted or volume is invalid", async () => {
  const audio = mockAudio();
  const engine = await import("./bycodaSoundEngine");
  engine.setVolume(Number.NaN);
  await engine.play("touch");
  engine.setVolume(1);
  engine.setEnabled(false);
  await engine.play("touch");
  expect(audio.Constructor).not.toHaveBeenCalled();
});
