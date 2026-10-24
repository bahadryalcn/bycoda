import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const command = vi.hoisted(() => ({ statuses: new Map<string, unknown>(), calls: [] as string[] }));
vi.mock("node:fs/promises", () => ({ readdir: vi.fn(async () => []) }));
vi.mock("node:child_process", () => ({
  spawn: (python: string) => {
    command.calls.push(python);
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      child.stdout.emit("data", JSON.stringify(command.statuses.get(python) ?? {}));
      child.emit("close", 0);
    });
    return child;
  },
}));
import { inspectVoiceRuntime } from "./voice-runtime";
afterEach(() => {
  command.statuses.clear();
  command.calls.length = 0;
  vi.unstubAllEnvs();
});

it("chooses compatible Python over an unsupported interpreter with fewer missing packages", async () => {
  vi.stubEnv("BYCODA_VOICE_PYTHON", "unsupported-python");
  command.statuses.set("unsupported-python", { missing: ["Python 3.10–3.12"], ready: false });
  for (const candidate of ["python", "python3"])
    command.statuses.set(candidate, {
      python: "compatible-python",
      missing: ["faster-whisper", "Whisper model", "voxcpm", "VoxCPM2 model"],
      ready: false,
    });
  const result = await inspectVoiceRuntime();
  expect(result.python).toBe("compatible-python");
  expect(result.ready).toBe(false);
});

it("honors an explicit installation without replacing it with automatic candidates", async () => {
  command.statuses.set("chosen-python", {
    python: "chosen-python",
    missing: ["Whisper model"],
    ready: false,
  });
  expect(await inspectVoiceRuntime({ python: "chosen-python" })).toMatchObject({
    python: "chosen-python",
    ready: false,
  });
  expect(command.calls).toEqual(["chosen-python"]);
});
