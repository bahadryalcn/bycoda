// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  start: vi.fn(async () => ({ lease: "wake", model: "tiny", device: "cpu" })),
  release: vi.fn(async () => {}),
  transcribe: vi.fn(),
  keepAlive: vi.fn(async () => ({ ready: true })),
  cloudTranscribe: vi.fn(),
}));
vi.mock("./localVoiceClient", () => ({ localVoiceBackend: backend }));
import { WAKE_LIMITS, WakeGuard } from "./voiceWakeGuard";
import { WakeListener, type WakeDeps } from "./voiceWakeListener";
import { localWakeDeps } from "./voiceWakeAdapters";

const voiced = () =>
  Int16Array.from({ length: 1024 }, (_, i) =>
    Math.round(4000 * Math.sin((2 * Math.PI * 150 * i) / 16000)),
  );
let onFrame: (frame: Int16Array) => void;
const close = vi.fn();
const closeRecognizer = vi.fn();
const recognize = vi.fn<WakeDeps["recognize"]>();
const deps: WakeDeps = {
  openCapture: vi.fn(async (callback) => {
    onFrame = callback;
    return { rate: 16000, close };
  }),
  recognize,
  closeRecognizer,
};
/** One burst: voiced frames then enough silence for the VAD to end the phrase. */
const burst = (frames = 5) => {
  for (let i = 0; i < frames; i++) onFrame(voiced());
  for (let i = 0; i < 40; i++) onFrame(new Int16Array(1024));
};
function make(
  extra: Partial<ConstructorParameters<typeof WakeListener>[1]> = {},
  guard?: WakeGuard,
) {
  const events = { match: vi.fn(), state: vi.fn(), error: vi.fn() };
  const listener = new WakeListener(deps, {
    phrase: "Hey bycoda",
    onMatch: events.match,
    onState: events.state,
    onError: events.error,
    guard,
    ...extra,
  });
  return { listener, events };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  recognize.mockReset();
});

it("listens, ignores other speech and starts Talk once after releasing the capture", async () => {
  recognize.mockResolvedValueOnce("what a nice day").mockResolvedValueOnce("Hey, bycoda!");
  let now = 0;
  const { listener, events } = make({}, new WakeGuard(() => now));
  await listener.start();
  expect(events.state).toHaveBeenLastCalledWith("listening");
  burst();
  await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  expect(events.match).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  now += WAKE_LIMITS.minGapMs + 1;
  burst();
  await vi.waitFor(() => expect(events.match).toHaveBeenCalledTimes(1));
  expect(close).toHaveBeenCalledTimes(1);
  expect(closeRecognizer).toHaveBeenCalled();
  expect(events.state).toHaveBeenLastCalledWith("stopped");
  // The match stops everything: more speech reaches nothing.
  now += 1000;
  burst();
  expect(recognize).toHaveBeenCalledTimes(2);
  expect(events.match).toHaveBeenCalledTimes(1);
});

it("drops bursts longer than a wake phrase and bursts that arrive while busy", async () => {
  let finish!: (text: string) => void;
  recognize.mockImplementationOnce(() => new Promise<string>((resolve) => (finish = resolve)));
  const { listener, events } = make();
  await listener.start();
  burst(5);
  await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
  burst(5);
  burst(5);
  expect(recognize).toHaveBeenCalledTimes(1);
  finish("no");
  await vi.waitFor(() => expect(events.match).not.toHaveBeenCalled());
  listener.stop();
  const long = make();
  await long.listener.start();
  recognize.mockClear();
  burst(80);
  expect(recognize).not.toHaveBeenCalled();
  long.listener.stop();
});

it("pauses in a noisy room for five minutes, releases the microphone, then listens again", async () => {
  let now = 0;
  const guard = new WakeGuard(() => now);
  const { listener, events } = make({}, guard);
  await listener.start();
  // 21 bursts a minute for three minutes.
  const verdicts: string[] = [];
  for (let minute = 0; minute < 8 && !verdicts.includes("noisy"); minute++)
    for (let n = 0; n < 22; n++) {
      now += 2000;
      const verdict = guard.admit();
      verdicts.push(verdict);
      if (verdict === "run") guard.done();
    }
  expect(verdicts).toContain("noisy");
  expect(guard.admit()).toBe("paused");
  now += WAKE_LIMITS.pauseMs;
  expect(guard.admit()).not.toBe("paused");
  listener.stop();
  expect(events.error).not.toHaveBeenCalled();
});

it("a noisy burst pauses the listener and resumes it after the pause", async () => {
  const guard = new WakeGuard();
  vi.spyOn(guard, "admit").mockReturnValueOnce("noisy");
  const { listener, events } = make({}, guard);
  await listener.start();
  burst();
  await vi.waitFor(() => expect(events.state).toHaveBeenLastCalledWith("paused"));
  expect(close).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(WAKE_LIMITS.pauseMs);
  await vi.waitFor(() => expect(events.state).toHaveBeenLastCalledWith("listening"));
  expect(deps.openCapture).toHaveBeenCalledTimes(2);
  listener.stop();
  expect(close).toHaveBeenCalledTimes(2);
});

it("releases the capture on stop and ignores a stop before the microphone opened", async () => {
  const { listener } = make();
  await listener.start();
  listener.stop();
  listener.stop();
  expect(close).toHaveBeenCalledTimes(1);
  expect(closeRecognizer).toHaveBeenCalledTimes(1);
});

it("reports a recognizer failure and stops listening", async () => {
  recognize.mockRejectedValueOnce(new Error("offline"));
  const { listener, events } = make();
  await listener.start();
  burst();
  await vi.waitFor(() => expect(events.error).toHaveBeenCalledTimes(1));
  expect(close).toHaveBeenCalledTimes(1);
});

it("guards one recognition at a time with a minimum gap", () => {
  let now = 1000;
  const guard = new WakeGuard(() => now);
  expect(guard.admit()).toBe("run");
  expect(guard.admit()).toBe("busy");
  guard.done();
  now += 100;
  expect(guard.admit()).toBe("gap");
  now += 300;
  expect(guard.admit()).toBe("run");
});

it("recognizes only through the local lease and never reaches cloud transcription", async () => {
  backend.transcribe.mockResolvedValue({ text: "hey bycoda", language: "en", inferenceMs: 5 });
  const real = localWakeDeps({ config: { natural: false }, language: "en" });
  await expect(real.recognize("AAAA")).resolves.toBe("hey bycoda");
  await expect(real.recognize("AAAA")).resolves.toBe("hey bycoda");
  // One shared recognition-only lease, language hint passed, released on close.
  expect(backend.start).toHaveBeenCalledTimes(1);
  expect(backend.start).toHaveBeenCalledWith({ natural: false }, true);
  expect(backend.transcribe).toHaveBeenCalledWith("wake", "AAAA", "en");
  real.closeRecognizer();
  await vi.waitFor(() => expect(backend.release).toHaveBeenCalledWith("wake"));
  expect(backend.cloudTranscribe).not.toHaveBeenCalled();
});
