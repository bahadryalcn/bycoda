import { execFile } from "node:child_process";
import { access, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
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
/** What the model subprocess runner reports about a failed run; classification reads only this. */
type RunFailure = Error & {
  /** Bounded tail of the subprocess stderr. */
  stderr?: string;
  code?: number | string | null;
  /** True when Node killed the child (deadline or output limit), not the owner. */
  killed?: boolean;
  signal?: string | null;
};
type Run = (python: string, args: string[], signal: AbortSignal, timeout: number) => Promise<void>;

/**
 * A download is stopped when no new bytes reach the model folder for `stallMs`
 * (slow but healthy links never trip it) and, regardless of progress, after `maxMs`.
 */
export type VoiceModelLimits = { stallMs: number; maxMs: number; pollMs: number };
const DEFAULT_LIMITS: VoiceModelLimits = {
  stallMs: 5 * 60_000,
  maxMs: 6 * 60 * 60_000,
  pollMs: 1000,
};

const run: Run = (python, args, signal, timeout) =>
  new Promise((resolve, reject) => {
    execFile(
      python,
      args,
      {
        signal,
        timeout,
        windowsHide: true,
        maxBuffer: 1_000_000,
        // Progress bars would flood stderr; the folder size already reports progress.
        env: { ...process.env, HF_HUB_DISABLE_PROGRESS_BARS: "1" },
      },
      (error, _stdout, stderr) =>
        error ? reject(Object.assign(error, { stderr: String(stderr).slice(-8_000) })) : resolve(),
    );
  });

// eslint-disable-next-line no-control-regex -- matching terminal control characters in subprocess output
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;
const DISK_FULL = "Not enough disk space for the model download. Free space and try again.";
const NO_PERMISSION =
  "The model download could not write to the bycoda voice folder. Check its permissions and try again.";
const STALLED =
  "The download stalled: no data arrived for several minutes. Check the connection and try again.";
const TOO_LONG =
  "The download took longer than the maximum allowed time and was stopped. Try again on a faster connection.";

/** Maps a failed folder operation to a specific message, or undefined for an unknown code. */
function filesystemFailure(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOSPC" || code === "EDQUOT") return DISK_FULL;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return NO_PERMISSION;
  return undefined;
}

/**
 * Turns a failed `snapshot_download` run into one specific message. Order matters: local
 * disk and permission faults are checked before network wording, because Python reports
 * them as OSError text that can also mention a connection.
 */
function downloadFailure(error: unknown): string {
  const failure = (error ?? {}) as RunFailure;
  const stderr = typeof failure.stderr === "string" ? failure.stderr : "";
  if (failure.code === "ENOENT")
    return "The voice Python runtime could not be started. Run voice setup again.";
  if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return "The model downloader produced too much output and was stopped. Try again.";
  if (failure.killed && failure.signal === "SIGTERM") return TOO_LONG;
  if (/No module named ['"]?huggingface_hub/i.test(stderr))
    return "The huggingface_hub package is missing from the voice environment. Run voice setup again.";
  if (/ModuleNotFoundError|No module named/i.test(stderr))
    return "A Python package the downloader needs is missing from the voice environment. Run voice setup again.";
  if (/no space left|errno 28|disk (?:is )?full|not enough (?:disk )?space/i.test(stderr))
    return DISK_FULL;
  if (/permission denied|access is denied|winerror 5|errno 13|\bEACCES\b|\bEPERM\b/i.test(stderr))
    return NO_PERMISSION;
  if (/checksum|hash mismatch|size mismatch|consistency check failed|corrupt/i.test(stderr))
    return "A downloaded model file failed verification. Delete the partial model and download it again.";
  if (
    /RepositoryNotFoundError|RevisionNotFoundError|GatedRepoError|\b40[134] Client Error/i.test(
      stderr,
    )
  )
    return "The model repository is not available from the download service. Try again later.";
  if (
    /ConnectionError|ConnectTimeout|ReadTimeout|MaxRetryError|NameResolutionError|ProxyError|SSLError|ChunkedEncodingError|IncompleteRead|getaddrinfo|name or service not known|temporary failure in name resolution|connection (?:reset|aborted|refused)|network is unreachable|timed out|\b5\d\d Server Error/i.test(
      stderr,
    )
  )
    return "The connection to the model download service failed. Check the connection and try again.";
  const exit =
    typeof failure.code === "number"
      ? ` (exit code ${String(failure.code)})`
      : failure.signal
        ? ` (${failure.signal})`
        : "";
  // Control characters become line breaks so progress redraws and escapes cannot reshape the text.
  const last = stderr
    .replace(CONTROL_CHARACTERS, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  return last
    ? `The model download failed${exit}: ${truncateGraphemes(last, 160)}`
    : `The model download failed${exit} without an error message.`;
}

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
  private readonly limits: VoiceModelLimits;
  constructor(
    private readonly home = homedir(),
    private readonly execute: Run = run,
    private readonly inspect = inspectVoiceRuntime,
    limits: Partial<VoiceModelLimits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }
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
    // Separate from the owner's cancel signal so a stall is never reported as a cancellation.
    const stall = new AbortController();
    if (action === "download") this.trackProgress(id, stall);
    void this.perform(action, id, config, controller.signal, stall.signal)
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
  /**
   * Poll the model folder so status() can report bytes downloaded while the job runs, and
   * abort `stall` when the folder has not grown for `limits.stallMs`.
   */
  private trackProgress(id: Id, stall: AbortController) {
    const path = join(this.root(), MODELS[id].folder);
    const bytesTotal = MODELS[id].expectedBytes;
    this.job = { ...this.job, bytesDone: 0, bytesTotal };
    let reading = false;
    let largest = 0;
    let grewAt = monotonicNow();
    this.progress = setInterval(() => {
      if (elapsedSince(grewAt) >= this.limits.stallMs) stall.abort();
      if (reading) return;
      reading = true;
      void folderBytes(path)
        .then((bytesDone) => {
          if (bytesDone > largest) {
            largest = bytesDone;
            grewAt = monotonicNow();
          }
          if (this.job.state === "working" && this.job.id === id)
            this.job = { ...this.job, bytesDone: Math.min(bytesDone, bytesTotal) };
        })
        // A folder that is mid-write or missing only skips one progress sample.
        .catch(() => undefined)
        .finally(() => {
          reading = false;
        });
    }, this.limits.pollMs);
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
    stalled: AbortSignal,
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
      await mkdir(this.root(), { recursive: true }).catch((error: unknown) => {
        throw new Error(
          filesystemFailure(error) ?? "The voice model folder could not be prepared for download.",
        );
      });
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
        AbortSignal.any([signal, stalled]),
        this.limits.maxMs,
      ).catch((error: unknown) => {
        // The owner's cancel is reported by start(); a stall is ours to name.
        if (signal.aborted) throw error;
        throw new Error(stalled.aborted ? STALLED : downloadFailure(error));
      });
      if (!(await this.installed(path)))
        throw new Error("Downloaded model is incomplete. Download it again to repair it.");
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
