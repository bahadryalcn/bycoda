// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({
  start: vi.fn(),
  release: vi.fn().mockResolvedValue(undefined),
  keepAlive: vi.fn().mockResolvedValue(undefined),
  transcribe: vi.fn(),
}));
vi.mock("./localVoiceClient", () => ({ localVoiceBackend: backend }));
vi.mock("./microphoneAccess", () => ({
  openMicrophone: async () => ({ getTracks: () => [{ stop }] }),
}));
const stop = vi.fn();
import { localWakeDeps } from "./voiceWakeAdapters";
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("releases rejected transcription and clears heartbeat", async () => {
  vi.useFakeTimers();
  backend.start.mockResolvedValue({ lease: "one" });
  backend.transcribe.mockRejectedValue(new Error("ASR failed"));
  const deps = localWakeDeps({ config: {} });
  await expect(deps.recognize("pcm")).rejects.toThrow("ASR failed");
  await Promise.resolve();
  expect(backend.release).toHaveBeenCalledWith("one");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(backend.keepAlive).not.toHaveBeenCalled();
  deps.closeRecognizer();
  expect(backend.release).toHaveBeenCalledTimes(1);
});
it("stop during acquisition releases once without transcription or heartbeat", async () => {
  vi.useFakeTimers();
  let finish!: (value: { lease: string }) => void;
  backend.start.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const deps = localWakeDeps({ config: {} });
  const result = deps.recognize("pcm");
  deps.closeRecognizer();
  finish({ lease: "late" });
  await expect(result).rejects.toThrow("Wake listening stopped.");
  await Promise.resolve();
  expect(backend.release).toHaveBeenCalledExactlyOnceWith("late");
  expect(backend.transcribe).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(backend.keepAlive).not.toHaveBeenCalled();
});
it.each(["resume", "worklet"])("closes tracks and context after %s failure", async (phase) => {
  const close = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "suspended";
      close = close;
      resume =
        phase === "resume"
          ? vi.fn().mockRejectedValue(new Error("setup"))
          : vi.fn().mockResolvedValue(undefined);
      audioWorklet = { addModule: vi.fn().mockRejectedValue(new Error("setup")) };
    },
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  await expect(localWakeDeps({ config: {} }).openCapture(() => {})).rejects.toThrow("setup");
  expect(stop).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});
