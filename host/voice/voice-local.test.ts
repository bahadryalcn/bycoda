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
import {
  DICTATION_WARM_MS,
  LOCAL_REQUEST_TIMEOUT_MS,
  LOCAL_WORKER_UNRESPONSIVE_MS,
  LocalVoiceService,
  validateVoiceAudio,
} from "./voice-local";
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

it("marks a selected model path as exact while keeping automatic detection automatic", async () => {
  const service = new LocalVoiceService();
  const inspect = vi
    .spyOn(runtime, "inspectVoiceRuntime")
    .mockResolvedValue({ ready: true, missing: [], python: "python", whisperPath: "owned/small" });
  const internals = service as unknown as {
    ensureWorker: () => Promise<unknown>;
    runtime: runtime.VoiceRuntimeConfig;
  };
  vi.spyOn(internals, "ensureWorker").mockResolvedValue({ model: "small", device: "cpu" });
  try {
    await service.start({ whisperPath: "owned/small", whisperExact: true }, true);
    expect(internals.runtime.whisperExact).toBe(true);
    service.close();
    await service.start({}, true);
    expect(internals.runtime.whisperExact).toBeUndefined();
  } finally {
    inspect.mockRestore();
    service.close();
  }
});

it("shares a running companion recognizer when only dictation idle timeout differs", async () => {
  const service = new LocalVoiceService();
  const inspect = vi
    .spyOn(runtime, "inspectVoiceRuntime")
    .mockResolvedValue({ ready: true, missing: [], python: "python" });
  const internals = service as unknown as {
    ensureWorker: () => Promise<unknown>;
    loading?: Promise<unknown>;
  };
  vi.spyOn(internals, "ensureWorker").mockImplementation(async () => {
    internals.loading = Promise.resolve({ model: "small", device: "cpu", turn: false });
    return { model: "small", device: "cpu", turn: false };
  });
  try {
    await service.start({ natural: false });
    await expect(
      service.start({ natural: false, idleUnloadMinutes: 1 }, true),
    ).resolves.toMatchObject({ model: "small" });
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

it("honors the configured idle timeout, including immediate unload", async () => {
  vi.useFakeTimers();
  const service = new LocalVoiceService();
  const inspect = vi
    .spyOn(runtime, "inspectVoiceRuntime")
    .mockResolvedValue({ ready: true, missing: [], python: "python" });
  const internals = service as unknown as { ensureWorker: () => Promise<unknown>; child?: unknown };
  vi.spyOn(internals, "ensureWorker").mockImplementation(async () => {
    internals.child = { kill: () => {} };
    return { model: "small", device: "cpu" };
  });
  const close = vi.spyOn(service, "close");
  try {
    const first = await service.start({ idleUnloadMinutes: 1 }, true);
    service.release(first.lease);
    vi.advanceTimersByTime(59_999);
    expect(close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(close).toHaveBeenCalledTimes(1);
    const second = await service.start({ idleUnloadMinutes: 0 }, true);
    service.release(second.lease);
    expect(close).toHaveBeenCalledTimes(2);
    expect(() => runtime.voiceRuntimeConfig({ idleUnloadMinutes: -1 })).toThrow(
      "Invalid dictation idle timeout",
    );
    expect(() => runtime.voiceRuntimeConfig({ idleUnloadMinutes: 121 })).toThrow(
      "Invalid dictation idle timeout",
    );
  } finally {
    inspect.mockRestore();
    close.mockRestore();
    internals.child = undefined;
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

// Real streams carry the protocol; only timers are faked so stream delivery stays real.
const audio = Buffer.alloc(6400).toString("base64");
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function connectedWorker() {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const written: Array<{ id: string }> = [];
  const write = vi.fn((data: string, done?: (error?: Error | null) => void) => {
    written.push(JSON.parse(data));
    done?.();
    return true;
  });
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { write }),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const inspect = vi
    .spyOn(runtime, "inspectVoiceRuntime")
    .mockResolvedValue({ ready: true, missing: [], python: "python" });
  const service = new LocalVoiceService();
  spawnOverride.child = child;
  const first = service.start({ natural: false });
  await flush();
  spawnOverride.child = undefined;
  child.stdout.write(JSON.stringify({ ready: true, model: "small", device: "cpu" }) + "\n");
  const windowA = await first;
  const windowB = await service.start({ natural: false });
  const reply = async (id: string, text = "hello") => {
    child.stdout.write(
      JSON.stringify({ id, text, language: "en", inferenceMs: 1 }) + "\n",
    );
    await flush();
  };
  const cleanup = () => {
    spawnOverride.child = undefined;
    inspect.mockRestore();
    service.close();
    vi.useRealTimers();
  };
  return { service, child, write, written, windowA, windowB, reply, cleanup };
}

it("fails only the slow request and keeps the worker and every lease", async () => {
  const w = await connectedWorker();
  try {
    const slow = w.service.transcribe(w.windowA.lease, audio);
    const failure = expect(slow).rejects.toThrow("timed out");
    await flush();
    await vi.advanceTimersByTimeAsync(LOCAL_REQUEST_TIMEOUT_MS);
    await failure;
    expect(w.child.kill).not.toHaveBeenCalled();
    expect(() => w.service.keepAlive(w.windowA.lease)).not.toThrow();
    expect(w.service.keepAlive(w.windowB.lease)).toEqual({ ready: true });
    // The late reply for the abandoned request is dropped, not delivered anywhere.
    await w.reply(w.written[0]!.id, "late");
    const next = w.service.transcribe(w.windowB.lease, audio);
    await flush();
    await w.reply(w.written[1]!.id, "fresh");
    await expect(next).resolves.toMatchObject({ text: "fresh" });
    expect(w.child.kill).not.toHaveBeenCalled();
  } finally {
    w.cleanup();
  }
});

it("ignores stdout lines that are not worker protocol messages", async () => {
  const w = await connectedWorker();
  try {
    const pending = w.service.transcribe(w.windowA.lease, audio);
    await flush();
    for (const noise of [
      "UserWarning: something printed to stdout",
      "null",
      "7",
      '{"error":"stray worker error"}',
      `{"id":"unknown","text":"not ours"}`,
      "{broken",
    ])
      w.child.stdout.write(noise + "\n");
    w.child.stdout.write("x".repeat(40_000) + "\n");
    await flush();
    expect(w.child.kill).not.toHaveBeenCalled();
    expect(() => w.service.keepAlive(w.windowB.lease)).not.toThrow();
    await w.reply(w.written[0]!.id);
    await expect(pending).resolves.toMatchObject({ text: "hello" });
  } finally {
    w.cleanup();
  }
});

it("fails only the request whose stdin write errors", async () => {
  const w = await connectedWorker();
  try {
    const kept = w.service.transcribe(w.windowA.lease, audio);
    await flush();
    w.write.mockImplementationOnce((_data, done) => {
      done?.(new Error("write failed"));
      return false;
    });
    await expect(w.service.transcribe(w.windowB.lease, audio)).rejects.toThrow("failed");
    expect(w.child.kill).not.toHaveBeenCalled();
    expect(() => w.service.keepAlive(w.windowA.lease)).not.toThrow();
    await w.reply(w.written[0]!.id);
    await expect(kept).resolves.toMatchObject({ text: "hello" });
    // A healthy worker that is not owing replies is never restarted by the watchdog.
    await vi.advanceTimersByTimeAsync(LOCAL_WORKER_UNRESPONSIVE_MS);
    expect(w.child.kill).not.toHaveBeenCalled();
  } finally {
    w.cleanup();
  }
});

it("counts timed-out requests the worker still owes toward the busy limit", async () => {
  const w = await connectedWorker();
  try {
    const first = expect(w.service.transcribe(w.windowA.lease, audio)).rejects.toThrow("timed out");
    const second = expect(w.service.transcribe(w.windowB.lease, audio)).rejects.toThrow(
      "timed out",
    );
    await flush();
    await vi.advanceTimersByTimeAsync(LOCAL_REQUEST_TIMEOUT_MS);
    await Promise.all([first, second]);
    await expect(w.service.transcribe(w.windowA.lease, audio)).rejects.toThrow("busy");
    expect(w.write).toHaveBeenCalledTimes(2);
    // Answering an abandoned request frees its slot without a restart.
    await w.reply(w.written[0]!.id);
    const next = w.service.transcribe(w.windowA.lease, audio);
    await flush();
    await w.reply(w.written[2]!.id, "after");
    await expect(next).resolves.toMatchObject({ text: "after" });
    expect(w.child.kill).not.toHaveBeenCalled();
  } finally {
    w.cleanup();
  }
});

it("restarts a worker that owes a reply and goes silent", async () => {
  const w = await connectedWorker();
  try {
    const slow = expect(w.service.transcribe(w.windowA.lease, audio)).rejects.toThrow("timed out");
    await flush();
    await vi.advanceTimersByTimeAsync(LOCAL_REQUEST_TIMEOUT_MS);
    await slow;
    await vi.advanceTimersByTimeAsync(LOCAL_WORKER_UNRESPONSIVE_MS - LOCAL_REQUEST_TIMEOUT_MS - 1);
    expect(w.child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(w.child.kill).toHaveBeenCalledOnce();
    expect(() => w.service.keepAlive(w.windowB.lease)).toThrow("expired");
  } finally {
    w.cleanup();
  }
});

it("does not let a replaced worker's startup timer close its successor", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const fake = () =>
    Object.assign(new EventEmitter(), {
      stdin: Object.assign(new EventEmitter(), { write: vi.fn() }),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
  const old = fake();
  const next = fake();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const inspect = vi
    .spyOn(runtime, "inspectVoiceRuntime")
    .mockResolvedValue({ ready: true, missing: [], python: "python" });
  const service = new LocalVoiceService();
  try {
    spawnOverride.child = old;
    const abandoned = service.start({ natural: false });
    abandoned.catch(() => undefined);
    await flush();
    // The old worker never reports exit, so its startup timer is still pending.
    service.close();
    spawnOverride.child = next;
    const restarted = service.start({ natural: false });
    await flush();
    spawnOverride.child = undefined;
    next.stdout.write(JSON.stringify({ ready: true, model: "small", device: "cpu" }) + "\n");
    const { lease } = await restarted;
    await vi.advanceTimersByTimeAsync(45_000);
    expect(next.kill).not.toHaveBeenCalled();
    expect(() => service.keepAlive(lease)).not.toThrow();
  } finally {
    spawnOverride.child = undefined;
    inspect.mockRestore();
    service.close();
    vi.useRealTimers();
  }
});
