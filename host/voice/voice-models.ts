import { execFile } from "node:child_process";
import { access, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { inspectVoiceRuntime } from "./voice-runtime";

const MODELS = {
  small: {
    label: "Whisper small",
    folder: "whisper-small",
    repo: "Systran/faster-whisper-small",
    expectedBytes: 484_000_000,
  },
  turbo: {
    label: "Whisper large v3 turbo",
    expectedBytes: 1_620_000_000,
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
  /** Download progress: bytes on disk so far and the expected total (optional for old clients). */
  bytesDone?: number;
  bytesTotal?: number;
};
type Run = (python: string, args: string[], signal: AbortSignal, timeout: number) => Promise<void>;

const run: Run = (python, args, signal, timeout) =>
  new Promise((resolve, reject) => {
    execFile(python, args, { signal, timeout, windowsHide: true, maxBuffer: 64_000 }, (error) =>
      error ? reject(error) : resolve(),
    );
  });

/** Bytes of every regular file below `path`; a missing folder counts as zero. */
async function folderBytes(path: string): Promise<number> {
  const entries = await readdir(path, { recursive: true, withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        lstat(join(entry.parentPath, entry.name)).then(
          (stat) => stat.size,
          () => 0,
        ),
      ),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

/** Only fixed installer-owned folders can be downloaded, tested or removed. */
export class VoiceModelsService {
  private job: Job = { state: "idle" };
  private controller?: AbortController;
  private closed = false;
  private progress?: ReturnType<typeof setInterval>;
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
        const installed = await this.installed(path);
        // Installed models report their real size; missing ones the expected download size.
        const sizeBytes = installed ? await folderBytes(path) : MODELS[id].expectedBytes;
        return { id, label: MODELS[id].label, path, installed, sizeBytes };
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
    this.stopProgress();
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
    if (action === "download") this.trackProgress(id);
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
        this.stopProgress();
        this.controller = undefined;
      });
    return this.status();
  }
  /** Poll the model folder so status() can report bytes downloaded while the job runs. */
  private trackProgress(id: Id) {
    const path = join(this.root(), MODELS[id].folder);
    const bytesTotal = MODELS[id].expectedBytes;
    this.job = { ...this.job, bytesDone: 0, bytesTotal };
    let reading = false;
    this.progress = setInterval(() => {
      if (reading) return;
      reading = true;
      void folderBytes(path)
        .then((bytesDone) => {
          if (this.job.state === "working" && this.job.id === id)
            this.job = { ...this.job, bytesDone: Math.min(bytesDone, bytesTotal) };
        })
        // A folder that is mid-write or missing only skips one progress sample.
        .catch(() => undefined)
        .finally(() => {
          reading = false;
        });
    }, 1000);
    this.progress.unref();
  }
  private stopProgress() {
    if (this.progress) clearInterval(this.progress);
    this.progress = undefined;
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
