import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { inspectVoiceRuntime, voiceRuntimeConfig } from "./voice-runtime";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:fs/promises", () => ({ readdir: vi.fn(async () => []) }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  spawn.mockReset();
});

function child(result?: object, code = 0) {
  const process = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  if (result)
    queueMicrotask(() => {
      process.stdout.write(JSON.stringify(result));
      process.emit("close", code);
    });
  return process;
}
it("accepts custom model paths as data and rejects malformed runtime options", () => {
  expect(
    voiceRuntimeConfig({
      python: " C:\\Voice\\python.exe ",
      whisperPath: "G:\\Models\\whisper",
      natural: true,
    }),
  ).toEqual({ python: "C:\\Voice\\python.exe", whisperPath: "G:\\Models\\whisper", natural: true });
  for (const value of [
    null,
    [],
    { python: 4 },
    { python: "x\ncommand" },
    { ttsPath: "a".repeat(4097) },
    { natural: "true" },
  ])
    expect(() => voiceRuntimeConfig(value)).toThrow();
});

it("finds a ready interpreter without waiting for a stalled earlier candidate", async () => {
  vi.stubEnv("BYCODA_VOICE_PYTHON", "stalled-python");
  const stalled = child();
  const ready = { python: "working-python", missing: [], ready: true };
  spawn.mockImplementation((program: string) =>
    program === "stalled-python" ? stalled : child(ready),
  );
  expect(await inspectVoiceRuntime({ natural: false })).toEqual(ready);
  expect(stalled.kill).toHaveBeenCalled();
  expect(spawn.mock.calls.every(([, , options]) => options.windowsHide)).toBe(true);
});

it("bounds the entire discovery scan and kills interpreters that do not finish", async () => {
  vi.useFakeTimers();
  const children: ReturnType<typeof child>[] = [];
  spawn.mockImplementation(() => {
    const process = child();
    children.push(process);
    return process;
  });
  const pending = inspectVoiceRuntime({ natural: false });
  await vi.advanceTimersByTimeAsync(12_000);
  expect(await pending).toMatchObject({
    ready: false,
    missing: ["Python 3.10–3.12", "faster-whisper", "Whisper model"],
  });
  expect(children.length).toBeGreaterThan(0);
  expect(children.every((process) => process.kill.mock.calls.length > 0)).toBe(true);
});

it("keeps an explicit interpreter authoritative and ignores output from failed probes", async () => {
  spawn.mockImplementation(() => child({ python: "failed-python", missing: [], ready: true }, 1));
  expect(await inspectVoiceRuntime({ python: "selected-python", natural: false })).toMatchObject({
    ready: false,
  });
  expect(spawn).toHaveBeenCalledOnce();
  expect(spawn.mock.calls[0][0]).toBe("selected-python");
});

it("prefers a compatible incomplete interpreter over an unsupported Python with fewer missing items", async () => {
  vi.stubEnv("BYCODA_VOICE_PYTHON", "unsupported-python");
  const supported = {
    python: "supported-python",
    missing: ["faster-whisper", "Whisper model"],
    ready: false,
  };
  spawn.mockImplementation((program: string) =>
    child(
      program === "unsupported-python"
        ? { missing: ["Python 3.10–3.12"], ready: false }
        : supported,
    ),
  );
  expect(await inspectVoiceRuntime({ natural: false })).toEqual(supported);
});

it.skipIf(process.platform !== "win32")(
  "uses the Windows launcher to find supported versions outside PATH",
  async () => {
    const ready = { python: "C:/Other/Python312/python.exe", missing: [], ready: true };
    spawn.mockImplementation((program: string, args: string[]) =>
      child(
        program === "py" && args[0] === "-3.12"
          ? ready
          : { missing: ["Python 3.10–3.12"], ready: false },
      ),
    );
    expect(await inspectVoiceRuntime({ natural: false })).toEqual(ready);
    expect(
      spawn.mock.calls.some(([program, args]) => program === "py" && args[0] === "-3.12"),
    ).toBe(true);
  },
);
