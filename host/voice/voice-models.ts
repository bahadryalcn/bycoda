import { execFile } from "node:child_process";
import { access, lstat, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { inspectVoiceRuntime } from "./voice-runtime";

const MODELS = {
  small: { label: "Whisper small", folder: "whisper-small", repo: "Systran/faster-whisper-small" },
  turbo: {
    label: "Whisper large v3 turbo",
    folder: "whisper-large-v3-turbo",
    repo: "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
  },
} as const;
type Id = keyof typeof MODELS;
type Job = {
  state: "idle" | "working" | "ready" | "error";
  id?: Id;
  action?: "download" | "test" | "delete";
  detail?: string;
};
type Run = (python: string, args: string[], signal: AbortSignal, timeout: number) => Promise<void>;

const run: Run = (python, args, signal, timeout) =>
  new Promise((resolve, reject) => {
    execFile(python, args, { signal, timeout, windowsHide: true, maxBuffer: 64_000 }, (error) =>
      error ? reject(error) : resolve(),
    );
  });

/** Only fixed installer-owned folders can be downloaded, tested or removed. */
export class VoiceModelsService {
  private job: Job = { state: "idle" };
  private controller?: AbortController;
  private closed = false;
  constructor(
    private readonly home = homedir(),
    private readonly execute: Run = run,
    private readonly inspect = inspectVoiceRuntime,
  ) {}
  private root() {
    return join(this.home, ".bycoda", "voice", "models");
  }
  private id(value: unknown): Id {
    if (value !== "small" && value !== "turbo")
      throw new Error("Invalid local transcription model.");
    return value;
  }
  private async safeRoot() {
    let path = this.home;
    for (const part of [".bycoda", "voice", "models"]) {
      path = join(path, part);
      const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (stat?.isSymbolicLink() || (stat && !stat.isDirectory()))
        throw new Error("Voice model directory is not a regular folder.");
    }
  }
  private async installed(path: string) {
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory()))
      throw new Error("Voice model directory is not a regular folder.");
    if (!stat) return false;
    return (
      await Promise.all(
        ["model.bin", "config.json", "tokenizer.json"].map((name) =>
          access(join(path, name)).then(
            () => true,
            () => false,
          ),
        ),
      )
    ).every(Boolean);
  }
  async list() {
    await this.safeRoot();
    return Promise.all(
      (Object.keys(MODELS) as Id[]).map(async (id) => {
        const path = join(this.root(), MODELS[id].folder);
        return { id, label: MODELS[id].label, path, installed: await this.installed(path) };
      }),
    );
  }
  status() {
    return { ...this.job };
  }
  cancel() {
    this.controller?.abort();
    return this.status();
  }
  close() {
    this.closed = true;
    this.controller?.abort();
  }
  start(action: unknown, value: unknown, active: boolean, config: unknown) {
    if (this.closed)
      throw new Error("Voice model management is unavailable while the host is closing.");
    const id = this.id(value);
    if (action !== "download" && action !== "test" && action !== "delete")
      throw new Error("Invalid model action.");
    if (active) throw new Error("Disconnect voice before managing models.");
    if (this.controller) throw new Error("Another model action is running.");
    const controller = new AbortController();
    this.controller = controller;
    this.job = { state: "working", id, action };
    void this.perform(action, id, config, controller.signal)
      .then(
        () => {
          this.job = { state: "ready", id, action };
        },
        (error: unknown) => {
          this.job = {
            state: "error",
            id,
            action,
            detail: controller.signal.aborted
              ? "Model action cancelled."
              : error instanceof Error
                ? error.message
                : "Model action failed.",
          };
        },
      )
      .finally(() => {
        this.controller = undefined;
      });
    return this.status();
  }
  private async perform(
    action: "download" | "test" | "delete",
    id: Id,
    config: unknown,
    signal: AbortSignal,
  ) {
    await this.safeRoot();
    const path = join(this.root(), MODELS[id].folder);
    const installed = await this.installed(path);
    signal.throwIfAborted();
    if (action === "delete") {
      await rm(path, { recursive: true, force: true });
      return;
    }
    if (action === "test" && !installed) throw new Error("Download this model before testing it.");
    const runtime = await this.inspect(config);
    if (!runtime.python) throw new Error("Complete voice setup before managing models.");
    signal.throwIfAborted();
    if (action === "download") {
      await mkdir(this.root(), { recursive: true });
      await this.safeRoot();
      await this.installed(path);
      await this.execute(
        runtime.python,
        [
          "-c",
          "import sys; from huggingface_hub import snapshot_download; snapshot_download(sys.argv[1], local_dir=sys.argv[2], token=False)",
          MODELS[id].repo,
          path,
        ],
        signal,
        30 * 60_000,
      ).catch(() => {
        throw new Error("Model download failed. Check the connection and available disk space.");
      });
      if (!(await this.installed(path))) throw new Error("Downloaded model is incomplete.");
    } else {
      await this.execute(
        runtime.python,
        [
          "-c",
          "import sys; from faster_whisper import WhisperModel; WhisperModel(sys.argv[1], device='cpu', compute_type='int8', local_files_only=True)",
          path,
        ],
        signal,
        120_000,
      ).catch(() => {
        throw new Error("Model could not be loaded by the local recognizer.");
      });
    }
  }
}
