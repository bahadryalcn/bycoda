import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Voice = {
  src: string;
  volume: number;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  removeAttribute: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  onerror: (() => void) | null;
};
type FakeContext = {
  state: string;
  close: ReturnType<typeof vi.fn>;
  suspend: ReturnType<typeof vi.fn>;
};

let voices: Voice[];
let contexts: FakeContext[];

function stubAudio(play: () => Promise<void> = () => Promise.resolve()) {
  vi.stubGlobal(
    "Audio",
    vi.fn(function (src: string) {
      const voice: Voice = {
        src,
        volume: 1,
        play: vi.fn(play),
        pause: vi.fn(),
        removeAttribute: vi.fn(),
        load: vi.fn(),
        onended: null,
        onerror: null,
      };
      voices.push(voice);
      return voice;
    }),
  );
}
function stubAudioContext() {
  const make = vi.fn(function () {
    const context: FakeContext = {
      state: "running",
      close: vi.fn(async () => {
        context.state = "closed";
      }),
      suspend: vi.fn(async () => {
        context.state = "suspended";
      }),
    };
    contexts.push(context);
    return context;
  });
  vi.stubGlobal("AudioContext", make);
  vi.stubGlobal("webkitAudioContext", make);
}
const load = () => import("./bycodaSoundEngine");

beforeEach(() => {
  voices = [];
  contexts = [];
  vi.useFakeTimers();
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sound engine idle cost", () => {
  it("leaves no running AudioContext once every cue has finished", async () => {
    stubAudio();
    stubAudioContext();
    const engine = await load();
    for (const cue of ["settle", "knock", "thread"] as const) await engine.play(cue);
    for (const voice of voices) voice.onended?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(contexts.filter((context) => context.state === "running")).toEqual([]);
  });

  it("creates no audio graph at import time, before any cue is requested", async () => {
    stubAudio();
    stubAudioContext();
    await load();
    expect(contexts).toHaveLength(0);
    expect(voices).toHaveLength(0);
  });

  it("releases a finished cue's media element so nothing stays attached to the output", async () => {
    stubAudio();
    const engine = await load();
    await engine.play("settle");
    const [voice] = voices;
    voice.onended?.();
    expect(voice.pause).toHaveBeenCalled();
    expect(voice.removeAttribute).toHaveBeenCalledWith("src");
    expect(voice.load).toHaveBeenCalled();
  });

  it("releases a cue whose playback is rejected", async () => {
    stubAudio(() => Promise.reject(new Error("blocked")));
    const engine = await load();
    await expect(engine.play("knock")).resolves.toBeUndefined();
    expect(voices[0].removeAttribute).toHaveBeenCalledWith("src");
  });

  it("keeps accepting cues after earlier ones ended, instead of leaking voice slots", async () => {
    stubAudio();
    const engine = await load();
    for (let round = 0; round < 20; round++) {
      await engine.play("touch");
      voices.at(-1)?.onended?.();
    }
    expect(voices).toHaveLength(20);
  });

  it("holds no timers while idle", async () => {
    stubAudio();
    const engine = await load();
    await engine.play("settle");
    voices[0].onended?.();
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
