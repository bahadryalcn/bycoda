import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";
import {
  encodeHelperFrame,
  HelperFrameReader,
  HelperProtocolError,
  isHelperAddress,
  parseHelperReply,
  type HelperCommand,
  type HelperReply,
  type JsonValue,
  type NativeHelperErrorCode,
} from "./protocol";

export type HelperClientCode =
  | NativeHelperErrorCode
  | "CAPACITY"
  | "QUEUE_FULL"
  | "HELPER_EXIT"
  | "RUNTIME_CLOSED"
  | "CLOSED"
  | "SPAWN_FAILED"
  | "INVALID_VALUE"
  | "STDERR_LIMIT";
export class NativeHelperClientError extends Error {
  constructor(
    readonly code: HelperClientCode,
    /** This helper command only. Never a proof that a domain effect was not admitted. */
    readonly commandDelivery: "not-sent" | "unknown",
    readonly source: "client" | "helper" = "client",
  ) {
    super(`Native authority helper: ${code}`);
    this.name = "NativeHelperClientError";
  }
}
export type HelperWaitOptions = { timeoutMs?: number; signal?: AbortSignal };
export type HelperExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawned: boolean;
};
export type NativeHelperSpawnOptions = SpawnOptionsWithoutStdio & {
  stdio: ["pipe", "pipe", "pipe"];
  shell: false;
  windowsHide: true;
};
/** Trusted composition/test injection only; must return an actual owned child. */
export type NativeHelperSpawner = (
  executable: string,
  args: readonly string[],
  options: NativeHelperSpawnOptions,
) => ChildProcessWithoutNullStreams;
export type NativeHelperRuntimeOptions = {
  /** Protected current-installation selection, never renderer/RPC input. */
  executablePath: string;
  spawn?: NativeHelperSpawner;
  maxActiveHelpers?: number;
  maxQueuedCommands?: number;
  maxQueuedBytes?: number;
  defaultTimeoutMs?: number;
  terminationGraceMs?: number;
};
export interface NativeAuthorityHelperClient {
  readonly exited: Promise<HelperExit>;
  send(value: JsonValue, wait?: HelperWaitOptions): Promise<void>;
  receive(wait?: HelperWaitOptions): Promise<JsonValue>;
  close(wait?: HelperWaitOptions): Promise<void>;
  observation(): {
    qualified: false;
    state: string;
    queuedCommands: number;
    queuedBytes: number;
    inFlight: boolean;
    exited: boolean;
  };
}
type Limits = {
  queued: number;
  bytes: number;
  timeout: number;
  killGrace: number;
};
type Command = {
  id: number;
  kind: HelperCommand["kind"];
  frame: Buffer;
  deadline: number;
  attempted: boolean;
  written: boolean;
  drained: boolean;
  reply?: HelperReply;
  resolve: (value?: JsonValue) => void;
  reject: (error: NativeHelperClientError) => void;
  timer?: NodeJS.Timeout;
  abort?: () => void;
  signal?: AbortSignal;
  drain?: () => void;
};

const GLOBAL_LIMIT = 8;
const budgetKey = Symbol.for("bycoda.native-authority-helper.process-budget.v1");
const processGlobals = globalThis as typeof globalThis & {
  [budgetKey]?: { active: number };
};
const processBudget = (processGlobals[budgetKey] ??= { active: 0 });
function bounded(
  value: number | undefined,
  fallback: number,
  maximum: number,
  minimum = 1,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    throw new Error("Invalid native helper limit");
  return result;
}
function timeout(options: HelperWaitOptions, fallback: number): number {
  return bounded(options.timeoutMs, fallback, 30_000);
}
function minimalEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    "path",
    "systemroot",
    "windir",
    "temp",
    "tmp",
    "userprofile",
    "homedrive",
    "homepath",
    "localappdata",
    "appdata",
    "lang",
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && allowed.has(key.toLowerCase()),
    ),
  );
}

/** Stream transport only; this is not an AuthenticatedNativeAuthorityPort or journal verifier. */
export class NativeAuthorityHelperRuntime {
  private readonly clients = new Set<HelperClientProcess>();
  private readonly maximum: number;
  private readonly limits: Limits;
  private active = 0;
  private closing = false;
  private closingPromise?: Promise<HelperExit[]>;
  private readonly executablePath: string;
  private readonly spawnNative: NativeHelperSpawner;

  constructor(options: NativeHelperRuntimeOptions) {
    if (!isAbsolute(options.executablePath))
      throw new Error("Native helper executable must be selected by trusted composition");
    this.executablePath = options.executablePath;
    this.spawnNative =
      options.spawn ?? ((file, args, launchOptions) => spawn(file, [...args], launchOptions));
    this.maximum = bounded(options.maxActiveHelpers, 4, 4);
    this.limits = {
      queued: bounded(options.maxQueuedCommands, 32, 32),
      bytes: bounded(options.maxQueuedBytes, 512 * 1024, 1024 * 1024),
      timeout: bounded(options.defaultTimeoutMs, 5_000, 30_000),
      killGrace: bounded(options.terminationGraceMs, 250, 1000, 0),
    };
  }

  open(address: string, wait: HelperWaitOptions = {}): Promise<NativeAuthorityHelperClient> {
    let bootstrap: Buffer;
    let lifetime: number;
    try {
      if (!isHelperAddress(address))
        throw new NativeHelperClientError("INVALID_BOOTSTRAP", "not-sent");
      lifetime = timeout(wait, this.limits.timeout);
      bootstrap = encodeHelperFrame({ version: 1, address });
    } catch (error) {
      return Promise.reject(error);
    }
    if (wait.signal?.aborted)
      return Promise.reject(new NativeHelperClientError("CANCELLED", "not-sent"));
    const deadline = performance.now() + lifetime;
    if (this.closing)
      return Promise.reject(new NativeHelperClientError("RUNTIME_CLOSED", "not-sent"));
    if (this.active >= this.maximum || processBudget.active >= GLOBAL_LIMIT) {
      return Promise.reject(new NativeHelperClientError("CAPACITY", "not-sent"));
    }
    this.active += 1;
    processBudget.active += 1;
    let released = false;
    let client: HelperClientProcess | undefined;
    const release = () => {
      if (released) return;
      released = true;
      this.active -= 1;
      processBudget.active -= 1;
      if (client) this.clients.delete(client);
    };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnNative(this.executablePath, ["--native-authority-helper"], {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
        env: minimalEnvironment(),
      });
    } catch {
      release(); // Confirmed never spawned; no child exists to retain.
      return Promise.reject(new NativeHelperClientError("SPAWN_FAILED", "not-sent"));
    }
    client = new HelperClientProcess(child, bootstrap, wait.signal, deadline, this.limits, release);
    this.clients.add(client);
    return client.ready.then(() => client!);
  }

  observation() {
    return {
      qualified: false as const,
      activeHelpers: this.active,
      globalActiveHelpers: processBudget.active,
      closing: this.closing,
    };
  }

  /** Shutdown owns helper processes only; it says nothing about domain cancellation. */
  close(): Promise<HelperExit[]> {
    this.closing = true;
    this.closingPromise ??= Promise.all(
      [...this.clients].map((client) => {
        client.terminate(new NativeHelperClientError("RUNTIME_CLOSED", "unknown"));
        return client.exited;
      }),
    );
    return this.closingPromise;
  }
}

class HelperClientProcess implements NativeAuthorityHelperClient {
  readonly ready: Promise<void>;
  readonly exited: Promise<HelperExit>;
  private readyResolve!: () => void;
  private readyReject!: (error: NativeHelperClientError) => void;
  private exitResolve!: (exit: HelperExit) => void;
  private readonly reader = new HelperFrameReader();
  private readonly queue: Command[] = [];
  private queuedBytes = 0;
  private active?: Command;
  private nextId = 1;
  private state: "starting" | "open" | "closing" | "terminating" | "exited" = "starting";
  private failure?: NativeHelperClientError;
  private exit?: HelperExit;
  private stdoutEnded = false;
  private stderrBytes = 0;
  private startupWritten = false;
  private startupDrained = true;
  private startupReply = false;
  private startupTimer?: NodeJS.Timeout;
  private startupAbort?: () => void;
  private startupDrain?: () => void;
  private killTimer?: NodeJS.Timeout;
  private closeRequested = false;
  private closePromise?: Promise<void>;
  private pumpScheduled = false;
  private readyScheduled = false;
  private completionScheduled = false;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    bootstrap: Buffer,
    private readonly startupSignal: AbortSignal | undefined,
    private readonly startupDeadline: number,
    private readonly limits: Limits,
    private readonly release: () => void,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.exited = new Promise<HelperExit>((resolve) => {
      this.exitResolve = resolve;
    });
    // Runtime open() observes ready immediately; lifecycle rejection is never an unhandled side channel.
    void this.ready.catch(() => {});
    child.once("error", () => {
      const neverStarted = child.pid === undefined;
      this.terminate(
        new NativeHelperClientError(
          neverStarted ? "SPAWN_FAILED" : "IO_ERROR",
          neverStarted ? "not-sent" : "unknown",
        ),
      );
      if (neverStarted) this.recordExit({ code: null, signal: null, spawned: false });
    });
    child.once("exit", (code, signal) => this.recordExit({ code, signal, spawned: true }));
    child.once("close", (code, signal) => {
      if (!this.exit) this.recordExit({ code, signal, spawned: child.pid !== undefined });
      this.stdoutEnded = true;
      try {
        this.reader.finish();
      } catch {
        this.terminate(new NativeHelperClientError("INVALID_FRAME", this.delivery()));
      }
      this.finishExit();
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.failure) return;
      try {
        this.reader.push(chunk, (value) => this.onFrame(parseHelperReply(value)));
      } catch (error) {
        this.terminate(
          new NativeHelperClientError(
            error instanceof HelperProtocolError ? error.code : "INVALID_FRAME",
            this.delivery(),
          ),
        );
      }
    });
    child.stdout.once("end", () => {
      this.stdoutEnded = true;
      try {
        this.reader.finish();
      } catch {
        this.terminate(new NativeHelperClientError("INVALID_FRAME", this.delivery()));
      }
      this.finishExit();
    });
    child.stdout.on("error", () =>
      this.terminate(new NativeHelperClientError("STDIO_ERROR", this.delivery())),
    );
    child.stdin.on("error", () =>
      this.terminate(new NativeHelperClientError("STDIO_ERROR", this.delivery())),
    );
    child.stderr.on("error", () =>
      this.terminate(new NativeHelperClientError("STDIO_ERROR", this.delivery())),
    );
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrBytes += chunk.length;
      if (this.stderrBytes > 8192)
        this.terminate(new NativeHelperClientError("STDERR_LIMIT", this.delivery()));
    });
    this.startupTimer = setTimeout(
      () => this.terminate(new NativeHelperClientError("DEADLINE", "unknown")),
      Math.max(0, this.startupDeadline - performance.now()),
    );
    this.startupAbort = () => this.terminate(new NativeHelperClientError("CANCELLED", "unknown"));
    startupSignal?.addEventListener("abort", this.startupAbort, { once: true });
    if (startupSignal?.aborted) {
      this.startupAbort();
      return;
    }
    try {
      this.startupDrained = child.stdin.write(bootstrap, (error) => {
        if (error) {
          this.terminate(new NativeHelperClientError("STDIO_ERROR", "unknown"));
          return;
        }
        this.startupWritten = true;
        this.maybeReady();
      });
      if (!this.startupDrained) {
        this.startupDrain = () => {
          this.startupDrained = true;
          this.maybeReady();
        };
        child.stdin.once("drain", this.startupDrain);
      }
    } catch {
      this.terminate(new NativeHelperClientError("STDIO_ERROR", "unknown"));
    }
  }

  /** Resolves after pipe-write acknowledgement, not domain admission or execution. */
  send(value: JsonValue, wait: HelperWaitOptions = {}): Promise<void> {
    return this.enqueue("send", value, wait).then(() => {});
  }
  receive(wait: HelperWaitOptions = {}): Promise<JsonValue> {
    return this.enqueue("receive", undefined, wait).then((value) => value!);
  }
  close(wait: HelperWaitOptions = {}): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closeRequested = true;
    if (this.failure)
      return (this.closePromise = this.exited.then(() => {
        throw this.failure;
      }));
    this.closePromise = this.enqueue("close", undefined, wait)
      .then(() => {})
      .catch(async (error: unknown) => {
        const reason =
          error instanceof NativeHelperClientError
            ? error
            : new NativeHelperClientError("IO_ERROR", "unknown");
        this.terminate(reason);
        await this.exited;
        throw reason;
      });
    return this.closePromise;
  }
  observation() {
    return {
      qualified: false as const,
      state: this.state,
      queuedCommands: this.queue.length,
      queuedBytes: this.queuedBytes,
      inFlight: !!this.active,
      exited: !!this.exit,
    };
  }

  private enqueue(
    kind: HelperCommand["kind"],
    value: JsonValue | undefined,
    wait: HelperWaitOptions,
  ): Promise<JsonValue | undefined> {
    let frame: Buffer;
    let lifetime: number;
    if (
      this.failure ||
      this.exit ||
      this.state !== "open" ||
      (this.closeRequested && kind !== "close")
    ) {
      return Promise.reject(new NativeHelperClientError("CLOSED", "not-sent"));
    }
    try {
      lifetime = timeout(wait, this.limits.timeout);
      if (!Number.isSafeInteger(this.nextId))
        throw new NativeHelperClientError("CLOSED", "not-sent");
      frame = encodeHelperFrame(
        kind === "send" ? { kind, id: this.nextId, value } : { kind, id: this.nextId },
      );
    } catch (error) {
      return Promise.reject(
        error instanceof NativeHelperClientError
          ? error
          : new NativeHelperClientError(
              error instanceof HelperProtocolError ? error.code : "INVALID_VALUE",
              "not-sent",
            ),
      );
    }
    if (wait.signal?.aborted)
      return Promise.reject(new NativeHelperClientError("CANCELLED", "not-sent"));
    if (
      this.queue.length >= this.limits.queued ||
      this.queuedBytes + frame.length > this.limits.bytes
    ) {
      return Promise.reject(new NativeHelperClientError("QUEUE_FULL", "not-sent"));
    }
    const id = this.nextId++;
    return new Promise<JsonValue | undefined>((resolve, reject) => {
      const command: Command = {
        id,
        kind,
        frame,
        deadline: performance.now() + lifetime,
        attempted: false,
        written: false,
        drained: true,
        resolve,
        reject,
        signal: wait.signal,
      };
      const stop = (code: "CANCELLED" | "DEADLINE") => {
        if (this.active === command) {
          this.terminate(new NativeHelperClientError(code, "unknown"));
          return;
        }
        const index = this.queue.indexOf(command);
        if (index < 0) return;
        this.queue.splice(index, 1);
        this.queuedBytes -= command.frame.length;
        this.cleanCommand(command);
        command.reject(new NativeHelperClientError(code, "not-sent"));
      };
      command.abort = () => stop("CANCELLED");
      wait.signal?.addEventListener("abort", command.abort, { once: true });
      command.timer = setTimeout(
        () => stop("DEADLINE"),
        Math.max(0, command.deadline - performance.now()),
      );
      this.queue.push(command);
      this.queuedBytes += frame.length;
      this.schedulePump();
    });
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }
  private pump(): void {
    if (this.failure || this.exit || this.active || this.state !== "open") return;
    const command = this.queue.shift();
    if (!command) return;
    this.queuedBytes -= command.frame.length;
    if (performance.now() >= command.deadline) {
      this.cleanCommand(command);
      command.reject(new NativeHelperClientError("DEADLINE", "not-sent"));
      this.schedulePump();
      return;
    }
    this.active = command;
    command.attempted = true;
    if (command.kind === "close") this.state = "closing";
    try {
      command.drained = this.child.stdin.write(command.frame, (error) => {
        if (error) {
          this.terminate(new NativeHelperClientError("STDIO_ERROR", "unknown"));
          return;
        }
        command.written = true;
        this.maybeComplete();
      });
      if (!command.drained) {
        command.drain = () => {
          command.drained = true;
          this.maybeComplete();
        };
        this.child.stdin.once("drain", command.drain);
      }
    } catch {
      this.terminate(new NativeHelperClientError("STDIO_ERROR", "unknown"));
    }
  }

  private onFrame(reply: HelperReply): void {
    if (reply.kind === "error") {
      if (reply.id !== undefined && reply.id !== this.active?.id)
        throw new HelperProtocolError("INVALID_FRAME");
      this.terminate(new NativeHelperClientError(reply.code, this.delivery(), "helper"));
      return;
    }
    if (this.state === "starting") {
      if (reply.kind !== "ready" || this.startupReply)
        throw new HelperProtocolError("INVALID_FRAME");
      this.startupReply = true;
      this.maybeReady();
      return;
    }
    const command = this.active;
    if (command && performance.now() >= command.deadline) {
      this.terminate(
        new NativeHelperClientError("DEADLINE", command.attempted ? "unknown" : "not-sent"),
      );
      return;
    }
    if (
      !command ||
      reply.kind === "ready" ||
      reply.id !== command.id ||
      command.reply ||
      reply.kind !== ({ send: "sent", receive: "received", close: "closed" } as const)[command.kind]
    ) {
      throw new HelperProtocolError("INVALID_FRAME");
    }
    command.reply = reply;
    this.maybeComplete();
  }
  private maybeReady(): void {
    if (
      this.failure ||
      this.exit ||
      this.stdoutEnded ||
      this.state !== "starting" ||
      !this.startupReply ||
      !this.startupWritten ||
      !this.startupDrained
    )
      return;
    if (this.readyScheduled) return;
    this.readyScheduled = true;
    queueMicrotask(() => {
      this.readyScheduled = false;
      if (this.failure || this.exit || this.stdoutEnded || this.state !== "starting") return;
      if (performance.now() >= this.startupDeadline) {
        this.terminate(new NativeHelperClientError("DEADLINE", "unknown"));
        return;
      }
      this.cleanStartup();
      this.state = "open";
      this.readyResolve();
    });
  }
  private maybeComplete(): void {
    const command = this.active;
    if (this.failure || !command?.reply || !command.written || !command.drained) return;
    if (this.completionScheduled) return;
    this.completionScheduled = true;
    queueMicrotask(() => {
      this.completionScheduled = false;
      if (this.failure || this.active !== command) return;
      if (performance.now() >= command.deadline) {
        this.terminate(new NativeHelperClientError("DEADLINE", "unknown"));
      } else if (command.kind === "close") {
        this.child.stdin.end();
        this.finishExit();
      } else {
        this.active = undefined;
        this.cleanCommand(command);
        const reply = command.reply;
        command.resolve(reply?.kind === "received" ? reply.value : undefined);
        this.schedulePump(); // No next command while checking the same output chunk.
      }
    });
  }
  private delivery(): "not-sent" | "unknown" {
    return this.active?.attempted || this.state === "starting" ? "unknown" : "not-sent";
  }
  private cleanStartup(): void {
    clearTimeout(this.startupTimer);
    if (this.startupAbort) this.startupSignal?.removeEventListener("abort", this.startupAbort);
    if (this.startupDrain) this.child.stdin.off("drain", this.startupDrain);
  }
  private cleanCommand(command: Command): void {
    clearTimeout(command.timer);
    if (command.abort) command.signal?.removeEventListener("abort", command.abort);
    if (command.drain) this.child.stdin.off("drain", command.drain);
  }
  private recordExit(exit: HelperExit): void {
    if (this.exit) return;
    this.exit = exit;
    clearTimeout(this.killTimer);
    this.release(); // Actual exit or confirmed never-spawned, never mere close/kill request.
    this.exitResolve(exit);
    if (this.state === "starting" && !this.failure) {
      this.terminate(new NativeHelperClientError("HELPER_EXIT", "unknown"));
    }
    if (this.failure) this.state = "exited";
    this.finishExit();
  }
  private finishExit(): void {
    if (this.failure || !this.stdoutEnded) return;
    const command = this.active;
    if (command?.kind === "close" && command.reply?.kind === "closed") {
      if (this.exit && (this.exit.code !== 0 || this.exit.signal !== null)) {
        this.terminate(new NativeHelperClientError("HELPER_EXIT", "unknown"));
      } else if (command.written && command.drained && this.exit?.code === 0) {
        this.active = undefined;
        this.cleanCommand(command);
        this.state = "exited";
        command.resolve();
      }
    } else if (this.exit || !command || command.kind !== "close") {
      this.terminate(new NativeHelperClientError("HELPER_EXIT", this.delivery()));
    }
  }

  /** Failure never releases capacity until exit. No reconnect or command replay. */
  terminate(error: NativeHelperClientError): void {
    if (this.failure || (this.state === "exited" && !this.active)) return;
    this.failure = error;
    this.state = this.exit ? "exited" : "terminating";
    this.cleanStartup();
    this.readyReject(error);
    if (this.active) {
      const active = this.active;
      this.active = undefined;
      this.cleanCommand(active);
      active.reject(
        new NativeHelperClientError(
          error.code,
          active.attempted ? "unknown" : "not-sent",
          error.source,
        ),
      );
    }
    for (const command of this.queue.splice(0)) {
      this.cleanCommand(command);
      command.reject(new NativeHelperClientError(error.code, "not-sent", error.source));
    }
    this.queuedBytes = 0;
    this.child.stdin.destroy();
    this.child.stdout.destroy();
    this.child.stderr.destroy();
    if (!this.exit) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        /* Exit remains required. */
      }
      this.killTimer = setTimeout(() => {
        if (!this.exit) {
          try {
            this.child.kill("SIGKILL");
          } catch {
            /* Still retain ownership. */
          }
        }
      }, this.limits.killGrace);
    }
  }
}
