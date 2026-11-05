import { expect, it, vi } from "vitest";

const spawnOverride = vi.hoisted(() => ({ child: undefined as unknown }));
vi.mock("node:child_process", async (importActual) => {
  const actual = await importActual<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: ((...args: Parameters<typeof actual.spawn>) =>
      spawnOverride.child ?? actual.spawn(...args)) as typeof actual.spawn,
  };
});
import { DICTATION_WARM_MS, LocalVoiceService, validateVoiceAudio } from "./voice-local";
import * as runtime from "./voice-runtime";
it("does not expire a live lease because the wall clock jumps forward", async () => {
  vi.useFakeTimers();
  const service = new LocalVoiceService();
  const inspect = vi
    .spyOn(runtime, "inspectVoiceRuntime")
    .mockResolvedValue({ ready: true, missing: [], python: "python" });
  const internals = service as unknown as { ensureWorker: () => Promise<unknown> };
  vi.spyOn(internals, "ensureWorker").mockResolvedValue({ model: "small", device: "cpu" });
  try {
    const { lease } = await service.start({ natural: false });
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(() => service.keepAlive(lease)).not.toThrow();
    await vi.advanceTimersByTimeAsync(105_000);
    expect(() => service.keepAlive(lease)).toThrow("expired");
  } finally {
    inspect.mockRestore();
    service.close();
    vi.useRealTimers();
  }
});
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

it("counts a pending voice preflight as active before any worker starts", async () => {
  const service = new LocalVoiceService();
  let finish!: (value: runtime.VoiceRuntimeStatus) => void;
  const inspect = vi.spyOn(runtime, "inspectVoiceRuntime").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    expect(service.isActive).toBe(false);
    const starting = service.start({ natural: false });
    expect(service.isActive).toBe(true);
    finish({ ready: false, missing: ["Whisper model"] });
    await expect(starting).rejects.toThrow("incomplete");
    expect(service.isActive).toBe(false);
  } finally {
    inspect.mockRestore();
    service.close();
  }
});

it("shares the recognizer for dictation without loading natural speech", async () => {
  const service = new LocalVoiceService();
  const inspect = vi
    .spyOn(runtime, "inspectVoiceRuntime")
    .mockResolvedValue({ ready: true, missing: [], python: "python", ttsPath: "tts" });
  const internals = service as unknown as {
    ensureWorker: () => Promise<unknown>;
    speech: { start: (config: unknown) => Promise<void> };
  };
  vi.spyOn(internals, "ensureWorker").mockResolvedValue({ model: "small", device: "cuda" });
  const speech = vi.spyOn(internals.speech, "start").mockResolvedValue();
  try {
    const dictation = await service.start({ natural: true }, true);
    expect(speech).not.toHaveBeenCalled();
    // The companion can join the same runtime afterwards and loads speech then.
    const companion = await service.start({ natural: true });
    expect(speech).toHaveBeenCalledOnce();
    expect(dictation.lease).not.toBe(companion.lease);
  } finally {
    inspect.mockRestore();
    service.close();
  }
});

it("keeps the recognizer warm after dictation, reuses it and unloads after the grace period", async () => {
  vi.useFakeTimers();
  const service = new LocalVoiceService();
  const inspect = vi
    .spyOn(runtime, "inspectVoiceRuntime")
    .mockResolvedValue({ ready: true, missing: [], python: "python" });
  const internals = service as unknown as {
    ensureWorker: () => Promise<unknown>;
    child?: unknown;
  };
  const worker = vi.spyOn(internals, "ensureWorker").mockImplementation(async () => {
    internals.child = { kill: () => {} };
    (service as unknown as { loading: Promise<unknown> }).loading = Promise.resolve();
    return { model: "small", device: "cuda" };
  });
  const close = vi.spyOn(service, "close");
  try {
    const first = await service.start({ natural: false }, true);
    service.release(first.lease);
    expect(close).not.toHaveBeenCalled();
    // Kept warm without users: setup is not blocked by it.
    expect(service.isActive).toBe(false);
    const second = await service.start({ natural: false }, true);
    // The loaded recognizer is reused without probing the installation again.
    expect(inspect).toHaveBeenCalledOnce();
    expect(worker).toHaveBeenCalledTimes(2);
    expect(service.isActive).toBe(true);
    service.release(second.lease);
    vi.advanceTimersByTime(DICTATION_WARM_MS - 1);
    expect(close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(close).toHaveBeenCalledOnce();
  } finally {
    inspect.mockRestore();
    close.mockRestore();
    (internals as { child?: unknown }).child = undefined;
    service.close();
    vi.useRealTimers();
  }
});

it("unloads at once when the voice companion releases the last connection", async () => {
  const service = new LocalVoiceService();
  const inspect = vi
    .spyOn(runtime, "inspectVoiceRuntime")
    .mockResolvedValue({ ready: true, missing: [], python: "python" });
  const internals = service as unknown as { ensureWorker: () => Promise<unknown>; child?: unknown };
  vi.spyOn(internals, "ensureWorker").mockImplementation(async () => {
    internals.child = { kill: () => {} };
    return { model: "small", device: "cuda" };
  });
  const close = vi.spyOn(service, "close");
  try {
    const companion = await service.start({ natural: false });
    service.release(companion.lease);
    expect(close).toHaveBeenCalledOnce();
  } finally {
    inspect.mockRestore();
    close.mockRestore();
    internals.child = undefined;
    service.close();
  }
});

it("reloads a warm recognizer when dictation starts with other settings", async () => {
  const service = new LocalVoiceService();
  const inspect = vi
    .spyOn(runtime, "inspectVoiceRuntime")
    .mockResolvedValue({ ready: true, missing: [], python: "python" });
  const internals = service as unknown as { ensureWorker: () => Promise<unknown>; child?: unknown };
  vi.spyOn(internals, "ensureWorker").mockImplementation(async () => {
    internals.child = { kill: () => {} };
    (service as unknown as { loading: Promise<unknown> }).loading = Promise.resolve();
    return { model: "small", device: "cuda" };
  });
  const close = vi.spyOn(service, "close");
  try {
    const first = await service.start({ natural: false, device: "gpu" }, true);
    service.release(first.lease);
    expect(close).not.toHaveBeenCalled();
    await service.start({ natural: false, device: "cpu" }, true);
    expect(close).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledTimes(2);
  } finally {
    inspect.mockRestore();
    close.mockRestore();
    internals.child = undefined;
    service.close();
  }
});

it("closes the worker and fails pending requests when the worker stdin errors", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const stdin = Object.assign(new EventEmitter(), { write: vi.fn() });
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  const service = new LocalVoiceService();
  const internals = service as unknown as {
    ensureWorker: () => Promise<unknown>;
    child?: unknown;
    requests: Map<string, unknown>;
  };
  try {
    // Mirror the real spawn site: worker startup registers the stdin error handler.
    spawnOverride.child = child;
    const starting = internals.ensureWorker();
    starting.catch(() => undefined);
    spawnOverride.child = undefined;
    expect(stdin.listenerCount("error")).toBeGreaterThan(0);
    expect(() => stdin.emit("error", new Error("EPIPE"))).not.toThrow();
    await expect(starting).rejects.toThrow("Local voice needs Python");
    expect(child.kill).toHaveBeenCalled();
    expect(internals.child).toBeUndefined();
  } finally {
    service.close();
  }
});
