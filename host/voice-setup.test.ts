import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { VoiceSetupService } from "./voice-setup";
import type { VoiceRuntimeConfig } from "./voice-runtime";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
afterEach(() => spawn.mockReset());

const home = join("test-home", "owner");
const python = join(home, ".bycoda", "voice", "Scripts/python.exe");
function fixture(natural = true, gpuValue?: { name: string; cuda?: string }) {
  let venv = false;
  const inspect = vi.fn(async (value?: unknown) => {
    const config = value as VoiceRuntimeConfig;
    if (config.python === python && !config.whisperPath && !venv)
      return { missing: ["Python 3.10–3.12"], ready: false };
    return {
      python: config.python ?? "supported-python",
      whisperPath: config.whisperPath,
      ...(natural ? { ttsPath: config.ttsPath } : {}),
      missing: config.whisperPath ? [] : ["Whisper model"],
      ready: Boolean(config.whisperPath),
      ...(natural ? { accelerated: false } : {}),
    };
  });
  const run = vi.fn(async (_program: string, args: string[], _signal: AbortSignal) => {
    if (args.includes("venv")) venv = true;
    if (args.includes("index"))
      return "torch (2.14.1+cu130)\nAvailable versions: 2.14.1+cu130, 2.14.0+cu130";
    if (args[0] !== "-c") return "";
    const config = JSON.parse(args[2]);
    return JSON.stringify({
      ...config,
      whisperPath: config.whisperPath ?? args[3],
      ...(natural ? { ttsPath: config.ttsPath ?? args[4] } : {}),
    });
  });
  const mkdir = vi.fn(async () => {});
  const preparePython = vi.fn(async () => "downloaded-python");
  const gpu = vi.fn(async () => gpuValue);
  const service = new VoiceSetupService({
    inspect,
    run,
    mkdir,
    home,
    platform: "win32",
    preparePython,
    gpu,
  });
  return { service, inspect, run, mkdir, preparePython, gpu };
}

it("does no work until explicitly started and deduplicates concurrent install requests", async () => {
  const { service, run, inspect } = fixture();
  expect(service.status()).toEqual({ state: "idle" });
  expect(run).not.toHaveBeenCalled();
  expect(inspect).not.toHaveBeenCalled();
  const request = { natural: false };
  expect(service.start(request)).toMatchObject({ state: "installing", requestedConfig: request });
  expect(service.start({ natural: true })).toMatchObject({
    state: "installing",
    requestedConfig: request,
  });
  await vi.waitFor(() => expect(service.status().state).toBe("ready"));
  expect(run.mock.calls.filter(([, args]) => args.includes("venv"))).toHaveLength(1);
  expect(service.status().requestedConfig).toEqual(request);
});

it("installs only into its managed environment and excludes natural speech when disabled", async () => {
  const { service, run } = fixture(false);
  service.start({ natural: false });
  await vi.waitFor(() => expect(service.status().state).toBe("ready"));
  expect(run.mock.calls[0]).toEqual([
    "supported-python",
    ["-m", "venv", join(home, ".bycoda", "voice")],
    expect.any(AbortSignal),
  ]);
  const pip = run.mock.calls.find(([, args]) => args.includes("pip"))!;
  expect(pip[0]).toBe(python);
  expect(pip[1]).toContain("faster-whisper");
  expect(pip[1]).not.toContain("voxcpm");
  expect(service.status().config).toMatchObject({
    python,
    natural: false,
    whisperPath: join(home, ".bycoda", "voice", "models", "whisper-small"),
  });
  expect(service.status().config?.ttsPath).toBeUndefined();
});

it("preserves existing selected model folders instead of downloading replacements", async () => {
  const { service, inspect, run } = fixture();
  service.start({ natural: true, whisperPath: "existing-asr", ttsPath: "existing-tts" });
  await vi.waitFor(() => expect(service.status().state).toBe("ready"));
  const download = run.mock.calls.find(([, args]) => args[0] === "-c")!;
  expect(JSON.parse(download[1][2])).toMatchObject({
    whisperPath: "existing-asr",
    ttsPath: "existing-tts",
  });
  expect(inspect).toHaveBeenLastCalledWith(
    expect.objectContaining({ whisperPath: "existing-asr", ttsPath: "existing-tts" }),
  );
  expect(service.status().config).toMatchObject({
    whisperPath: "existing-asr",
    ttsPath: "existing-tts",
  });
});

it("preserves an invalid explicit Python location without downloading a replacement", async () => {
  const { service, inspect, run, mkdir, preparePython } = fixture();
  inspect.mockResolvedValue({ missing: ["Python 3.10–3.12"], ready: false });
  service.start({ natural: true, python: "selected-python" });
  await vi.waitFor(() =>
    expect(service.status()).toMatchObject({ state: "error", error: "python_missing" }),
  );
  expect(run).not.toHaveBeenCalled();
  expect(mkdir).not.toHaveBeenCalled();
  expect(preparePython).not.toHaveBeenCalled();
});

it("prepares private Python when automatic detection finds none and completes setup", async () => {
  const { service, inspect, run, preparePython } = fixture(false);
  inspect.mockResolvedValueOnce({ missing: ["Python 3.10–3.12"], ready: false });
  service.start({ natural: false });
  await vi.waitFor(() => expect(service.status().state).toBe("ready"));
  expect(preparePython).toHaveBeenCalledExactlyOnceWith({
    directory: join(home, ".bycoda", "voice", "python-runtime"),
    signal: expect.any(AbortSignal),
    run,
    platform: "win32",
  });
  expect(run.mock.calls[0][0]).toBe("downloaded-python");
});

it("reports a private Python download failure without running package installers", async () => {
  const { service, inspect, run, preparePython } = fixture(false);
  inspect.mockResolvedValueOnce({ missing: ["Python 3.10–3.12"], ready: false });
  preparePython.mockRejectedValueOnce(new Error("Python download failed. Try again."));
  service.start({ natural: false });
  await vi.waitFor(() => expect(service.status().state).toBe("error"));
  expect(service.status().detail).toContain("Python download failed");
  expect(run).not.toHaveBeenCalled();
});

it("rejects incomplete explicitly selected folders before installing and allows a corrected retry", async () => {
  const { service, run } = fixture(false);
  service.start({ whisperPath: "" });
  await vi.waitFor(() => expect(service.status().state).toBe("ready"));
  service.start({ natural: true, ttsPath: "invalid-selected-folder" });
  await vi.waitFor(() =>
    expect(service.status()).toMatchObject({ state: "error", error: "install_failed" }),
  );
  expect(service.status().detail).toContain("selected model folder");
  expect(run).toHaveBeenCalledTimes(3);
  service.start({ natural: false });
  await vi.waitFor(() => expect(service.status().state).toBe("ready"));
});

it("surfaces command failure and cancels an owned installation when the host closes", async () => {
  const { service, run } = fixture();
  run.mockImplementation(
    async (_program, _args, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("Installation stopped.")), {
          once: true,
        });
      }),
  );
  service.start();
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  const signal = run.mock.calls[0][2];
  service.close();
  expect(signal.aborted).toBe(true);
  await vi.waitFor(() =>
    expect(service.status()).toMatchObject({ state: "error", error: "install_failed" }),
  );
  expect(() => service.start()).toThrow("closing");
});

it("does not report ready when final verification fails", async () => {
  const { service, inspect } = fixture();
  inspect.mockResolvedValue({
    python: "supported-python",
    missing: ["faster-whisper"],
    ready: false,
  });
  service.start();
  await vi.waitFor(() =>
    expect(service.status()).toMatchObject({ state: "error", error: "install_failed" }),
  );
  expect(service.status().config).toBeUndefined();
});

it.each([
  ["ERROR: No matching distribution found for voxcpm", "incompatible"],
  ["OSError: [Errno 28] No space left on device", "disk space"],
  ["SSLCertVerificationError: CERTIFICATE_VERIFY_FAILED", "certificate settings"],
  ["No module named ensurepip", "virtual-environment support"],
  ["No module named pip", "package support (pip)"],
  ["error: Microsoft Visual C++ 14.0 is required", "build prerequisites"],
])("classifies installer failures with safe recovery guidance: %s", async (stderr, expected) => {
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      child.stderr.write(
        `https://user:private-secret@registry.invalid/path?token=hidden\n${stderr}`,
      );
      child.emit("close", 1);
    });
    return child;
  });
  const { inspect, mkdir } = fixture(false);
  const service = new VoiceSetupService({ inspect, mkdir, home, platform: "win32" });
  service.start({ natural: false });
  await vi.waitFor(() => expect(service.status().state).toBe("error"));
  expect(service.status().detail).toContain(expected);
  expect(service.status().detail).not.toMatch(/private-secret|registry\.invalid|hidden/);
  expect(spawn.mock.calls[0][2].env.HF_HUB_DISABLE_XET).toBe("1");
});

const rtx = { name: "NVIDIA GeForce RTX 4070", cuda: "13.0" };
const torchInstalls = (run: ReturnType<typeof fixture>["run"]) =>
  run.mock.calls.filter(([, args]) => args.some((arg) => arg.startsWith("torch==")));

it("installs the pinned CUDA PyTorch build when automatic processing finds an NVIDIA GPU", async () => {
  const { service, run } = fixture(true, rtx);
  service.start({ natural: true, engine: "voxcpm2" });
  await vi.waitFor(() => expect(service.status().state).toBe("ready"));
  const [install] = torchInstalls(run);
  expect(install[0]).toBe(python);
  expect(install[1]).toEqual(
    expect.arrayContaining([
      "--index-url",
      "https://download.pytorch.org/whl/cu130",
      "torch==2.14.1+cu130",
    ]),
  );
  // Faster, more accurate recognition is downloaded only with GPU support.
  const download = run.mock.calls.find(([, args]) => args[0] === "-c")!;
  expect(download[1].at(-1)).toBe(
    join(home, ".bycoda", "voice", "models", "whisper-large-v3-turbo"),
  );
});

it("finishes automatic setup on the CPU when GPU support cannot be installed", async () => {
  const { service, run } = fixture(true, rtx);
  const base = run.getMockImplementation()!;
  run.mockImplementation(async (program, args, signal) => {
    if (args.some((arg) => arg.startsWith("torch=="))) throw new Error("network");
    return base(program, args, signal);
  });
  service.start({ natural: true, engine: "voxcpm2" });
  await vi.waitFor(() => expect(service.status().state).toBe("ready"));
  expect(torchInstalls(run).length).toBeGreaterThan(0);
});

it("fails an explicit GPU setup without an NVIDIA GPU and never touches GPU packages for CPU", async () => {
  const gpuSetup = fixture(true);
  gpuSetup.service.start({ natural: true, device: "gpu" });
  await vi.waitFor(() => expect(gpuSetup.service.status().state).toBe("error"));
  expect(gpuSetup.service.status().detail).toContain("No NVIDIA GPU");

  const cpuSetup = fixture(true, rtx);
  cpuSetup.service.start({ natural: true, device: "cpu" });
  await vi.waitFor(() => expect(cpuSetup.service.status().state).toBe("ready"));
  expect(cpuSetup.gpu).not.toHaveBeenCalled();
  expect(torchInstalls(cpuSetup.run)).toHaveLength(0);
  const download = cpuSetup.run.mock.calls.find(([, args]) => args[0] === "-c")!;
  expect(download[1].slice(2).join(" ")).not.toContain("large-v3-turbo");
});

it("installs Supertonic by default without PyTorch and still adds GPU recognition", async () => {
  const { service, run } = fixture(true, rtx);
  service.start({ natural: true });
  await vi.waitFor(() => expect(service.status().state).toBe("ready"));
  const pip = run.mock.calls.find(([, args]) => args.includes("pip"))!;
  expect(pip[1]).toContain("supertonic==1.3.1");
  expect(pip[1]).not.toContain("voxcpm");
  expect(torchInstalls(run)).toHaveLength(0);
  const download = run.mock.calls.find(([, args]) => args[0] === "-c")!;
  expect(download[1].at(-1)).toBe(
    join(home, ".bycoda", "voice", "models", "whisper-large-v3-turbo"),
  );
});

it("installs no local speech package or model for the ElevenLabs reply voice", async () => {
  const { service, run } = fixture(true, rtx);
  service.start({ natural: true, engine: "elevenlabs" });
  await vi.waitFor(() => expect(service.status().state).toBe("ready"));
  const pip = run.mock.calls.find(([, args]) => args.includes("pip"))!;
  expect(pip[1]).not.toContain("voxcpm");
  expect(pip[1]).not.toContain("supertonic==1.3.1");
  expect(torchInstalls(run)).toHaveLength(0);
  const download = run.mock.calls.find(([, args]) => args[0] === "-c")!;
  expect(JSON.parse(download[1][2])).toMatchObject({ engine: "elevenlabs" });
});
