import { win32 } from "node:path";
import { SHARE_ENV, Worker } from "node:worker_threads";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { createLogger } from "../diagnostics/logger";

const log = createLogger("git.pool");
const gitCommands = new Set(
  "add branch cat-file check-ref-format checkout cherry-pick clean clone commit config diff diff-index diff-tree fetch for-each-ref hash-object init log ls-files ls-remote ls-tree merge merge-base mv pull push read-tree rebase reflog remote reset restore rev-list rev-parse rm show show-ref stash status submodule switch symbolic-ref tag update-index update-ref worktree write-tree".split(
    " ",
  ),
);

function commandLabel({ file, args }: Command): string {
  const executable = win32
    .basename(file)
    .toLowerCase()
    .replace(/\.exe$/, "");
  if (executable === "git") {
    // Skip global options (`-c key=value`, `-C dir`, `--literal-pathspecs`, …) to the subcommand.
    let subcommand: string | undefined;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === "-c" || arg === "-C") index++;
      else if (!arg.startsWith("-")) {
        subcommand = arg;
        break;
      }
    }
    return subcommand && gitCommands.has(subcommand) ? `git ${subcommand}` : "git";
  }
  return ["powershell", "pwsh", "node"].includes(executable) ? executable : "other";
}

type Output = string | Buffer<ArrayBuffer>;
type Result<T = Output> = { stdout: T; stderr: T };
type Failure = {
  name: string;
  message: string;
  code?: number | string | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  cmd?: string;
  errno?: number;
  spawnargs?: string[];
  path?: string;
  syscall?: string;
};

type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer?: number;
  encoding?: BufferEncoding | "buffer";
  input?: string | Buffer | readonly (string | Buffer)[];
  windowsHide?: boolean;
  replaceEnv?: boolean;
  nativeTimeout?: boolean;
  streaming?: boolean;
};
/** `network` is for long fetch/push/pull/clone calls so they cannot starve short probes. */
type Lane = "default" | "network" | "background" | "control";
type ExecOptions = Omit<CommandOptions, "streaming"> & {
  signal?: AbortSignal;
  lane?: Lane;
  /** Consume chunks synchronously with pipe backpressure. The caller owns output limits. */
  onOutput?: (stream: "stdout" | "stderr", chunk: Buffer) => void;
};
type Command = {
  id: number;
  lane: Lane;
  file: string;
  args: readonly string[];
  options: CommandOptions;
  deadline: bigint;
  cancelled: Int32Array;
};

type Reply = Result<string | ArrayBuffer> & { id: number; error?: Failure };
type Chunk = { id: number; stream: "stdout" | "stderr"; bytes: Uint8Array };

// Inline CommonJS keeps the same worker usable from the bundled Host and source tests.
const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
const { execFile, execFileSync, spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const active = new Map();
const resumeOutput = new Map();
let closing = false;

// Hooks, helpers and transports are grandchildren: stop the whole tree, not only git.
function killTree(child, signal, sync) {
  const pid = child.pid;
  if (pid === undefined) { child.kill(signal); return; }
  if (process.platform === "win32") {
    const args = ["/PID", String(pid), "/T", "/F"];
    try {
      if (sync) execFileSync("taskkill", args, { windowsHide: true, stdio: "ignore", timeout: 2000 });
      else execFile("taskkill", args, { windowsHide: true, timeout: 5000 }, () => child.kill(signal));
    } catch { child.kill(signal); }
    return;
  }
  try { process.kill(-pid, signal); } catch { child.kill(signal); }
}

function childEnv(overrides) {
  if (!overrides) return process.env;
  const env = { ...process.env };
  if (process.platform === "win32") {
    const keys = new Set(Object.keys(overrides).map((key) => key.toUpperCase()));
    for (const key of Object.keys(env)) {
      if (keys.has(key.toUpperCase())) delete env[key];
    }
  }
  return Object.assign(env, overrides);
}

function report(id, error, stdout, stderr) {
  const transfer = [];
  const output = (value) => {
    if (typeof value === "string") return value;
    // Do not transfer or expose adjacent bytes from a pooled Node Buffer.
    const bytes = new Uint8Array(value.length);
    bytes.set(value);
    transfer.push(bytes.buffer);
    return bytes.buffer;
  };
  parentPort.postMessage({
    id, stdout: output(stdout), stderr: output(stderr),
    error: error && {
      name: error.name, message: error.message, code: error.code, killed: error.killed,
      signal: error.signal, cmd: error.cmd, errno: error.errno, path: error.path, syscall: error.syscall,
      spawnargs: error.spawnargs,
    },
  }, transfer);
}

// Bound raw pipe bytes before decoding. An overflow may split a UTF-8 character.
function collectOutput(child, stream, outcome, encoding, maxBuffer) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  const pipe = child[stream];
  pipe.on("data", (chunk) => {
    const remaining = maxBuffer - bytes;
    if (chunk.length <= remaining) {
      bytes += chunk.length;
      chunks.push(chunk);
      return;
    }
    chunks.push(chunk.subarray(0, remaining));
    truncated = true;
    outcome.error ??= Object.assign(new RangeError(stream + " maxBuffer length exceeded"), {
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    });
    child.stdout.destroy();
    child.stderr.destroy();
    killTree(child, "SIGKILL", false);
  });
  child.once("close", () => {
    const buffer = Buffer.concat(chunks);
    outcome[stream] = encoding === "buffer" ? buffer
      : truncated ? new StringDecoder(encoding).write(buffer) : buffer.toString(encoding);
  });
}

function run({ id, file, args, options, deadline, cancelled }) {
  const { input, encoding = "utf8", env, cwd, maxBuffer, windowsHide = true, streaming, replaceEnv, nativeTimeout, timeout } = options;
  const empty = encoding === "buffer" ? Buffer.alloc(0) : "";
  const remaining = () => Math.ceil(Number(deadline - process.hrtime.bigint()) / 1e6);
  const cmd = [file, ...args].join(" ");
  const cancellation = () => [undefined, "ABORT_ERR", "ECANCELED"][Atomics.load(cancelled, 0)];
  const messages = {
    ABORT_ERR: "The operation was aborted",
    ECANCELED: "Git command pool closed",
    ETIMEDOUT: nativeTimeout ? "Command timed out before launch" : "Command timed out: " + cmd,
  };
  const errorFor = (code, killed = false, signal = null) => Object.assign(new Error(messages[code]), {
    name: code === "ABORT_ERR" ? "AbortError" : "Error",
    code: code === "ETIMEDOUT" && killed ? null : code,
    killed, signal, cmd,
  });
  const cancelledBeforeLaunch = cancellation();
  if (cancelledBeforeLaunch || remaining() <= 0) {
    report(id, errorFor(cancelledBeforeLaunch ?? "ETIMEDOUT"), empty, empty);
    return;
  }

  let child, timer, killTimer, outcome, stopped, inputError;
  try {
    const launch = {
      cwd, windowsHide,
      env: replaceEnv ? env : childEnv(env),
      // A POSIX process group lets cancellation reach grandchildren.
      detached: process.platform !== "win32",
    };
    // execFile drops detached on POSIX and kills only the parent on a buffer overflow.
    child = spawn(file, args, launch);
    outcome = { stdout: empty, stderr: empty };
    child.once("error", (error) => { outcome.error = error; });
    if (streaming) {
      for (const stream of ["stdout", "stderr"]) {
        child[stream].on("data", (chunk) => {
          child[stream].pause();
          const bytes = Uint8Array.from(chunk);
          resumeOutput.get(id)[stream] = () => child[stream].resume();
          parentPort.postMessage({ id, stream, bytes }, [bytes.buffer]);
        });
      }
    } else {
      collectOutput(child, "stdout", outcome, encoding, maxBuffer ?? 1024 * 1024);
      collectOutput(child, "stderr", outcome, encoding, maxBuffer ?? 1024 * 1024);
    }
  } catch (error) {
    report(id, error, empty, empty);
    return;
  }
  const stop = (code, sync = false) => {
    if (stopped && code !== "ECANCELED") return;
    if (code === "ECANCELED") clearTimeout(killTimer);
    stopped = code;
    if (code === "ETIMEDOUT") {
      killTree(child, "SIGTERM", sync);
      killTimer = setTimeout(() => killTree(child, "SIGKILL", false), 250);
    } else killTree(child, "SIGKILL", sync);
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  };
  active.set(id, stop);
  if (streaming) resumeOutput.set(id, {});
  child.once("close", (code, signal) => {
    clearTimeout(timer);
    clearTimeout(killTimer);
    // A cooperative parent may exit on TERM while one of its helpers ignores it.
    if (process.platform !== "win32" && stopped === "ETIMEDOUT") killTree(child, "SIGKILL", false);
    active.delete(id);
    resumeOutput.delete(id);
    const { error, stdout, stderr } = outcome;
    const failure = stopped
      // Windows tree kill ends the child without a signal; keep the signal contract.
      ? errorFor(stopped, true, signal ?? (stopped === "ETIMEDOUT" ? "SIGTERM" : "SIGKILL"))
      : error || (code !== 0 || signal !== null
        ? Object.assign(new Error("Command failed: " + cmd + (streaming ? "" : "\\n" + stderr)), { code, signal, cmd, killed: false })
        : inputError);
    if (!streaming && failure) {
      failure.cmd = cmd;
      if (nativeTimeout && stopped === "ETIMEDOUT") failure.message = "Command failed: " + cmd + "\\n" + stderr;
    }
    report(id, failure, stdout, stderr);
    if (closing && !active.size) parentPort.close();
  });
  child.stdin.on("error", (error) => { inputError = error; });
  // A total deadline includes process creation. Native timeouts start after spawn.
  const delay = remaining();
  const cancelledDuringLaunch = cancellation();
  if (cancelledDuringLaunch || (!nativeTimeout && delay <= 0)) stop(cancelledDuringLaunch ?? "ETIMEDOUT");
  else {
    if (!nativeTimeout) timer = setTimeout(() => stop("ETIMEDOUT"), delay);
    else if (timeout > 0) timer = setTimeout(() => stop("ETIMEDOUT"), timeout);
    if (Array.isArray(input)) {
      for (const piece of input) child.stdin.write(piece);
      child.stdin.end();
    } else if (input !== undefined || streaming) child.stdin.end(input);
  }
}

parentPort.on("message", (message) => {
  if (message.type === "run") run(message.command);
  else if (message.type === "resume") {
    const streams = resumeOutput.get(message.id);
    const resume = streams?.[message.stream];
    if (streams) delete streams[message.stream];
    resume?.();
  }
  else if (message.type === "abort") active.get(message.id)?.("ABORT_ERR");
  else if (message.type === "close") {
    closing = true;
    for (const stop of active.values()) stop("ECANCELED");
    if (!active.size) parentPort.close();
  }
});
function stopActive() {
  for (const stop of active.values()) stop("ECANCELED", true);
}
process.on("uncaughtExceptionMonitor", stopActive);
process.on("exit", stopActive);
`;

type Job = {
  command: Command;
  submittedAt: number;
  onOutput?: ExecOptions["onOutput"];
  outputFailure?: { error: unknown };
  signal?: AbortSignal;
  queueTimer?: NodeJS.Timeout;
  abort: () => void;
  resolve: (result: Result) => void;
  reject: (error: Error) => void;
};

type Slot = { worker: Worker; active: Map<number, Job>; exited: Promise<void>; error?: Error };

/**
 * FIFO admission per lane. Slots stay held until children close.
 * Network, background and process-tree termination have separate capacity.
 */
export class GitExecPool {
  private readonly queue = new Map<number, Job>();
  private slot: Slot | undefined;
  private closing: Promise<void> | undefined;
  private nextId = 0;
  private lastBusyWarning = -Infinity;
  private suppressedWarnings = 0;

  constructor(
    // Process creation dominates on Windows (antivirus scans each launch), so more slots in
    // flight raise throughput without adding main-thread work.
    private readonly concurrency = 6,
    private readonly maxQueued = 128,
    private readonly startWorker = (source: string) =>
      new Worker(source, { eval: true, execArgv: [], env: SHARE_ENV }),
    private readonly networkConcurrency = 2,
    private readonly backgroundConcurrency = 2,
  ) {
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      !Number.isSafeInteger(maxQueued) ||
      maxQueued < 0 ||
      !Number.isSafeInteger(networkConcurrency) ||
      networkConcurrency < 1 ||
      !Number.isSafeInteger(backgroundConcurrency) ||
      backgroundConcurrency < 1
    )
      throw new RangeError("Invalid Git command pool capacity");
  }

  private hasCapacity(slot: Slot | undefined, lane: Lane) {
    let active = 0;
    for (const job of slot?.active.values() ?? []) if (job.command.lane === lane) active++;
    const capacity = {
      default: this.concurrency,
      network: this.networkConcurrency,
      background: this.backgroundConcurrency,
      control: 2,
    };
    return active < capacity[lane];
  }

  exec(
    file: string,
    args: readonly string[],
    options: ExecOptions & { encoding: "buffer" },
  ): Promise<Result<Buffer<ArrayBuffer>>>;
  exec(
    file: string,
    args: readonly string[],
    options: ExecOptions & { encoding?: BufferEncoding },
  ): Promise<Result<string>>;
  exec(file: string, args: readonly string[], options: ExecOptions): Promise<Result>;
  exec(
    file: string,
    args: readonly string[],
    { signal, lane = "default", onOutput, ...options }: ExecOptions,
  ): Promise<Result> {
    return new Promise((resolve, reject) => {
      if (
        !Number.isSafeInteger(options.timeout) ||
        options.timeout < (options.nativeTimeout ? 0 : 1) ||
        options.timeout > 2 ** 31 - 1
      ) {
        reject(new RangeError("Git command timeout must be a positive timer duration"));
        return;
      }
      if (!onOutput && options.maxBuffer !== undefined && !(options.maxBuffer >= 0)) {
        reject(
          Object.assign(
            new RangeError(
              `The value of "options.maxBuffer" is out of range. It must be a positive number. Received ${options.maxBuffer}`,
            ),
            { code: "ERR_OUT_OF_RANGE" },
          ),
        );
        return;
      }
      // Callers requesting native execFile timing get the full timeout after spawn.
      const queueTimeout = options.nativeTimeout ? 30_000 : options.timeout;
      const command = {
        id: ++this.nextId,
        lane,
        file,
        args: [...args],
        options: { ...options, streaming: !!onOutput, env: options.env && { ...options.env } },
        deadline: process.hrtime.bigint() + BigInt(queueTimeout) * 1_000_000n,
        // A posted run can reach the worker before a later cancellation message.
        cancelled: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
      };
      const job: Job = {
        command,
        submittedAt: monotonicNow(),
        signal,
        onOutput,
        resolve,
        reject,
        abort: () => this.abort(job),
      };
      if (signal?.aborted) {
        this.fail(job, "ABORT_ERR", "The operation was aborted");
        return;
      }
      if (this.closing) {
        this.fail(job, "ECANCELED", "Git command pool closed");
        return;
      }
      const canDispatch = !this.slot?.error && this.hasCapacity(this.slot, lane);
      if (this.queue.size >= this.maxQueued && !canDispatch) {
        this.fail(job, "EAGAIN", "Git command queue is full");
        return;
      }
      signal?.addEventListener("abort", job.abort, { once: true });
      job.queueTimer = setTimeout(() => this.expire(job), queueTimeout);
      this.queue.set(command.id, job);
      this.dispatch();
    });
  }

  /** Stop queued work, kill active children and wait for the worker to exit. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    const slot = this.slot;
    this.closing = slot?.exited ?? Promise.resolve();
    for (const job of this.queue.values()) this.fail(job, "ECANCELED", "Git command pool closed");
    this.queue.clear();
    if (slot) {
      for (const job of slot.active.values()) Atomics.store(job.command.cancelled, 0, 2);
      slot.worker.ref();
      slot.worker.postMessage({ type: "close" });
    }
    return this.closing;
  }

  private dispatch() {
    if (this.closing || !this.queue.size) return;
    let slot: Slot;
    try {
      slot = this.slot ??= this.createSlot();
    } catch (error) {
      for (const job of this.queue.values()) this.fail(job, "EIO", String(error));
      this.queue.clear();
      return;
    }
    for (const [id, job] of this.queue) {
      if (slot.error) return;
      // A full lane must not hold back jobs of other lanes queued behind it.
      if (!this.hasCapacity(slot, job.command.lane)) continue;
      if (job.command.deadline <= process.hrtime.bigint()) {
        this.expire(job);
        continue;
      }
      this.warnBusy(job, false);
      this.queue.delete(id);
      clearTimeout(job.queueTimer);
      slot.active.set(id, job);
      slot.worker.ref();
      try {
        slot.worker.postMessage({ type: "run", command: job.command });
      } catch (error) {
        slot.active.delete(id);
        this.fail(job, "EIO", String(error));
        if (!slot.active.size) slot.worker.unref();
      }
    }
  }

  private createSlot(): Slot {
    const worker = this.startWorker(WORKER_SOURCE);
    const active = new Map<number, Job>();
    const exited = new Promise<void>((resolve) => {
      worker.once("exit", (code) => {
        this.slot = undefined;
        for (const job of active.values())
          this.fail(
            job,
            "EIO",
            slot.error?.message ?? `Git command worker exited with code ${code}`,
          );
        resolve();
        this.dispatch();
      });
    });
    const slot: Slot = { worker, active, exited };
    worker.on("message", (reply: Reply | Chunk) => {
      const job = slot.active.get(reply.id);
      if (!job) return;
      if ("stream" in reply) {
        if (job.signal?.aborted || job.outputFailure || this.closing) return;
        try {
          job.onOutput?.(
            reply.stream,
            Buffer.from(reply.bytes.buffer, reply.bytes.byteOffset, reply.bytes.byteLength),
          );
          if (!job.signal?.aborted)
            worker.postMessage({ type: "resume", id: reply.id, stream: reply.stream });
        } catch (error) {
          job.outputFailure = { error };
          this.abort(job);
        }
        return;
      }
      slot.active.delete(reply.id);
      const { stdout, stderr } = reply;
      const result = {
        stdout: typeof stdout === "string" ? stdout : Buffer.from(stdout),
        stderr: typeof stderr === "string" ? stderr : Buffer.from(stderr),
      };
      this.cleanup(job);
      if (job.outputFailure) job.reject(job.outputFailure.error as Error);
      else if (reply.error) {
        const { message, ...error } = reply.error;
        job.reject(
          Object.assign(
            new Error(message),
            error,
            result,
            job.command.options.nativeTimeout
              ? {}
              : {
                  killed: error.killed ?? false,
                  code: error.code ?? null,
                  signal: error.signal ?? null,
                },
            error.code === "ABORT_ERR" ? { cause: job.signal?.reason } : {},
          ),
        );
      } else job.resolve(result);
      if (!slot.active.size && !this.closing) worker.unref();
      this.dispatch();
    });
    worker.once("error", (error) => {
      slot.error = error instanceof Error ? error : new Error(String(error));
    });
    worker.unref();
    return slot;
  }

  private abort(job: Job) {
    const id = job.command.id;
    if (this.queue.delete(id)) this.fail(job, "ABORT_ERR", "The operation was aborted");
    else if (!this.closing && this.slot?.active.has(id)) {
      Atomics.store(job.command.cancelled, 0, 1);
      this.slot.worker.postMessage({ type: "abort", id });
    }
  }

  private expire(job: Job) {
    if (!this.queue.has(job.command.id)) return;
    this.warnBusy(job, true);
    this.queue.delete(job.command.id);
    this.fail(job, "ETIMEDOUT", "Command timed out before launch");
  }

  private warnBusy(job: Job, expired: boolean) {
    const now = monotonicNow();
    const waited = elapsedSince(job.submittedAt, now);
    if (!expired && waited <= 2_000) return;
    if (elapsedSince(this.lastBusyWarning, now) < 60_000) {
      this.suppressedWarnings++;
      return;
    }
    const { lane } = job.command;
    const queued = [...this.queue.values()].filter((entry) => entry.command.lane === lane);
    const active = [...(this.slot?.active.values() ?? [])].filter(
      (entry) => entry.command.lane === lane,
    );
    const counts = new Map<string, number>();
    for (const entry of [...queued, ...active]) {
      const label = commandLabel(entry.command);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const top = [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count]) => `${label}:${count}`)
      .join(",");
    log.warn(
      `git pool busy lane=${lane} waitedMs=${Math.round(waited)} queued=${queued.length} active=${active.length} top=${top} suppressed=${this.suppressedWarnings}`,
    );
    this.lastBusyWarning = now;
    this.suppressedWarnings = 0;
  }

  private cleanup(job: Job) {
    clearTimeout(job.queueTimer);
    job.signal?.removeEventListener("abort", job.abort);
  }

  private fail(job: Job, code: string, message: string) {
    this.cleanup(job);
    const empty = job.command.options.encoding === "buffer" ? Buffer.alloc(0) : "";
    job.reject(
      Object.assign(new Error(message), {
        name: code === "ABORT_ERR" ? "AbortError" : "Error",
        code,
        killed: false,
        signal: null,
        cmd: [job.command.file, ...job.command.args].join(" "),
        stdout: empty,
        stderr: empty,
        ...(code === "ABORT_ERR" ? { cause: job.signal?.reason } : {}),
      }),
    );
  }
}

export const hostGitExec = new GitExecPool();
