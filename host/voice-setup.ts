import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureVoicePython } from "./voice-python-install";
import {
  inspectVoiceRuntime,
  voiceRuntimeConfig,
  type VoiceRuntimeConfig,
  type VoiceRuntimeStatus,
} from "./voice-runtime";

export type VoiceSetupStatus = {
  state: "idle" | "installing" | "ready" | "error";
  stage?: "environment" | "packages" | "models" | "checking";
  requestedConfig?: VoiceRuntimeConfig;
  config?: VoiceRuntimeConfig;
  error?: "python_missing" | "install_failed";
  detail?: string;
};

type Run = (program: string, args: string[], signal: AbortSignal) => Promise<string>;
type Dependencies = {
  inspect: (value?: unknown) => Promise<VoiceRuntimeStatus>;
  run: Run;
  mkdir: (path: string) => Promise<unknown>;
  home: string;
  platform: NodeJS.Platform;
  preparePython: typeof ensureVoicePython;
};

/** Only invoked by the owner's explicit Install action, never by detection. */
const downloadModels = String.raw`
import json, sys
from huggingface_hub import snapshot_download
c = json.loads(sys.argv[1])
if not c.get('whisperPath'):
    c['whisperPath'] = snapshot_download('Systran/faster-whisper-small', local_dir=sys.argv[2], token=False)
if c.get('natural', True) and not c.get('ttsPath'):
    c['ttsPath'] = snapshot_download('openbmb/VoxCPM2', local_dir=sys.argv[3], token=False)
print(json.dumps(c))
`;

function installationFailure(stderr: string): string {
  // Installer output can include authenticated registry URLs or local secrets.
  // Classify a bounded tail into fixed recovery guidance; never return raw text.
  if (/no space left|disk (?:is )?full|not enough (?:disk )?space|errno 28/i.test(stderr))
    return "Not enough disk space for voice setup. Free space and try again.";
  if (/permission denied|access is denied|winerror 5/i.test(stderr))
    return "Voice setup could not write its files. Check permissions for the bycoda voice folder and try again.";
  if (/no module named ['"]?ensurepip|ensurepip is not available/i.test(stderr))
    return "Python virtual-environment support is missing. Repair your Python installation and try again.";
  if (/no module named ['"]?pip\b/i.test(stderr))
    return "Python package support (pip) is missing. Repair your Python installation and try again.";
  if (
    /resolutionimpossible|conflicting dependencies|no matching distribution|requires a different python/i.test(
      stderr,
    )
  )
    return "The voice packages are incompatible with this Python installation. Choose Python 3.10–3.12 and try again.";
  if (
    /certificate_verify_failed|sslcertverificationerror|connectionerror|connection (?:refused|reset)|name resolution|network is unreachable|readtimeout|connecttimeout|timed out/i.test(
      stderr,
    )
  )
    return "Voice files could not be downloaded. Check your connection, proxy and certificate settings, then try again.";
  if (
    /failed building wheel|could not build wheels|microsoft visual c\+\+|subprocess-exited-with-error/i.test(
      stderr,
    )
  )
    return "A voice dependency could not be built. Check the Python build prerequisites or choose another supported Python installation.";
  return "Installation failed. Check your connection and available disk space, then try again.";
}

/** Shell-free, bounded, cancellable child commands. Pip never targets system Python. */
const run: Run = (program, args, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONNOUSERSITE: "1",
        PIP_NO_INPUT: "1",
        HF_HUB_DISABLE_IMPLICIT_TOKEN: "1",
        // Use the standard resumable HTTP transport. XET repeatedly failed to
        // start large model transfers on the verified macOS setup path.
        HF_HUB_DISABLE_XET: "1",
      },
    });
    let output = "";
    let stderr = "";
    let settled = false;
    const kill = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => {
          child.kill();
        });
      } else child.kill();
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(output);
    };
    const abort = () => {
      kill();
      finish(new Error("Installation stopped."));
    };
    const timer = setTimeout(() => {
      kill();
      finish(new Error("Installation timed out. Check your connection and try again."));
    }, 30 * 60_000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      // Keep a bounded tail; only the fixed download script's final JSON is read.
      output = (output + chunk.toString()).slice(-32_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-32_000);
    });
    child.on("error", () => finish(new Error("The voice installer could not start.")));
    child.on("close", (code) =>
      finish(code === 0 ? undefined : new Error(installationFailure(stderr))),
    );
  });

/** One host-owned job survives settings navigation and deduplicates repeated clicks. */
export class VoiceSetupService {
  private value: VoiceSetupStatus = { state: "idle" };
  private controller?: AbortController;
  private closed = false;
  private readonly dependencies: Dependencies;

  constructor(dependencies: Partial<Dependencies> = {}) {
    this.dependencies = {
      inspect: inspectVoiceRuntime,
      run,
      mkdir: (path) => mkdir(path, { recursive: true }),
      home: homedir(),
      platform: process.platform,
      preparePython: ensureVoicePython,
      ...dependencies,
    };
  }

  status(): VoiceSetupStatus {
    return structuredClone(this.value);
  }

  start(value?: unknown): VoiceSetupStatus {
    const config = voiceRuntimeConfig(value);
    if (this.closed) throw new Error("Voice setup is unavailable while the host is closing.");
    if (this.value.state === "installing") return this.status();
    const controller = new AbortController();
    this.controller = controller;
    this.value = { state: "installing", stage: "environment", requestedConfig: config };
    void this.install(config, controller)
      .catch((cause: unknown) => {
        if (this.controller !== controller) return;
        this.value = {
          state: "error",
          requestedConfig: config,
          error: "install_failed",
          detail: cause instanceof Error ? cause.message : "Voice installation failed. Try again.",
        };
      })
      .finally(() => {
        if (this.controller === controller) this.controller = undefined;
      });
    return this.status();
  }

  close() {
    this.closed = true;
    this.controller?.abort();
  }

  private async install(config: VoiceRuntimeConfig, controller: AbortController) {
    const { inspect, run, mkdir, home, platform, preparePython } = this.dependencies;
    const signal = controller.signal;
    const stage = (value: VoiceSetupStatus["stage"]) => {
      signal.throwIfAborted();
      this.value = { state: "installing", stage: value, requestedConfig: config };
    };
    let found = await inspect(config);
    signal.throwIfAborted();
    if (!found.python && !config.python) {
      const python = await preparePython({
        directory: join(home, ".bycoda", "voice", "python-runtime"),
        signal,
        run,
        platform,
      });
      signal.throwIfAborted();
      found = await inspect({ ...config, python });
      signal.throwIfAborted();
    }
    if (!found.python) {
      this.value = { state: "error", requestedConfig: config, error: "python_missing" };
      return;
    }
    if (
      (config.whisperPath && !found.whisperPath) ||
      (config.natural !== false && config.ttsPath && !found.ttsPath)
    )
      throw new Error(
        "The selected model folder is incomplete. Choose another folder or clear the custom location and try again.",
      );
    const directory = join(home, ".bycoda", "voice");
    const python = join(directory, platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const managed = await inspect({ ...config, python });
    signal.throwIfAborted();
    if (!managed.python) {
      await mkdir(join(home, ".bycoda"));
      await run(found.python, ["-m", "venv", directory], signal);
    }
    stage("packages");
    await run(
      python,
      [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "faster-whisper",
        "huggingface-hub",
        ...(config.natural === false ? [] : ["voxcpm"]),
      ],
      signal,
    );
    stage("models");
    const resolved: VoiceRuntimeConfig = {
      ...config,
      python,
      ...(found.whisperPath ? { whisperPath: found.whisperPath } : {}),
      ...(config.natural !== false && found.ttsPath ? { ttsPath: found.ttsPath } : {}),
    };
    const output = await run(
      python,
      [
        "-c",
        downloadModels,
        JSON.stringify(resolved),
        join(directory, "models", "whisper-small"),
        join(directory, "models", "voxcpm2"),
      ],
      signal,
    );
    const downloaded = voiceRuntimeConfig(JSON.parse(output.trim().split(/\r?\n/).at(-1) ?? ""));
    stage("checking");
    const checked = await inspect(downloaded);
    signal.throwIfAborted();
    if (!checked.ready)
      throw new Error(
        "Voice installation is incomplete. Try again or choose an existing installation.",
      );
    this.value = {
      state: "ready",
      requestedConfig: config,
      config: {
        ...downloaded,
        python: checked.python,
        whisperPath: checked.whisperPath,
        ...(config.natural === false ? {} : { ttsPath: checked.ttsPath }),
      },
    };
  }
}
