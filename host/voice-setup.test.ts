import { expect, it, vi } from "vitest";
import { join } from "node:path";
import { VoiceSetupService } from "./voice-setup";
import type { VoiceRuntimeConfig } from "./voice-runtime";

const home = join("test-home", "owner");
const python = join(home, ".bycoda", "voice", "Scripts/python.exe");
function fixture(natural = true) {
  const inspect = vi.fn(async (value?: unknown) => {
    const config = value as VoiceRuntimeConfig;
    if (config.python === python && !config.whisperPath)
      return { missing: ["Python 3.10–3.12"], ready: false };
    return {
      python: config.python ?? "supported-python",
      whisperPath: config.whisperPath,
      ...(natural ? { ttsPath: config.ttsPath } : {}),
      missing: config.whisperPath ? [] : ["Whisper model"],
      ready: Boolean(config.whisperPath),
    };
  });
  const run = vi.fn(async (_program: string, args: string[], _signal: AbortSignal) => {
    if (args[0] !== "-c") return "";
    const config = JSON.parse(args[2]);
    return JSON.stringify({
      ...config,
      whisperPath: config.whisperPath ?? args[3],
      ...(natural ? { ttsPath: config.ttsPath ?? args[4] } : {}),
    });
  });
  const mkdir = vi.fn(async () => {});
  const service = new VoiceSetupService({ inspect, run, mkdir, home, platform: "win32" });
  return { service, inspect, run, mkdir };
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

it("reports missing compatible Python without running installers or creating directories", async () => {
  const { service, inspect, run, mkdir } = fixture();
  inspect.mockResolvedValue({ missing: ["Python 3.10–3.12"], ready: false });
  service.start({ natural: true });
  await vi.waitFor(() =>
    expect(service.status()).toMatchObject({ state: "error", error: "python_missing" }),
  );
  expect(run).not.toHaveBeenCalled();
  expect(mkdir).not.toHaveBeenCalled();
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
