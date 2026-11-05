import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { GuardianProviderChild } from "./providers/provider-child";

const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_DATA_BYTES = 64 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const replyFields: Record<string, readonly string[]> = {
  ready: ["version", "kind", "guardianId", "platform", "containment"],
  started: ["version", "kind", "guardianId", "parentId", "ownerId", "pid"],
  written: ["version", "kind", "guardianId", "parentId", "ownerId", "id", "ok"],
  rejected: ["version", "kind", "guardianId", "parentId", "ownerId", "id", "reason"],
  data: ["version", "kind", "guardianId", "parentId", "ownerId", "stream", "data"],
  settled: ["version", "kind", "guardianId", "parentId", "ownerId", "exitCode", "retirement"],
  failed: ["version", "kind", "guardianId", "parentId", "reason"],
};

export type GuardianLaunch = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  buildReceipt?: { nonce: string; path: string };
};

export class ProviderGuardianError extends Error {
  constructor(message = "Provider guardian retirement is unknown.") {
    super(message);
    this.name = "ProviderGuardianError";
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function bytes(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(MAX_DATA_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw new ProviderGuardianError("Invalid guardian data frame.");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length > MAX_DATA_BYTES || decoded.toString("base64") !== value)
    throw new ProviderGuardianError("Invalid guardian data frame.");
  return decoded;
}

/** Private framed control and provider byte streams have separate ownership.
 * This object retains one actual guardian ChildProcess, never a replacement. */
export class NativeGuardianChild extends EventEmitter implements GuardianProviderChild {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  readonly started: Promise<void>;
  readonly retirement: Promise<void>;
  private readonly startResult = deferred<void>();
  private readonly retireResult = deferred<void>();
  private readonly closedResult = deferred<void>();
  private readonly parentId = randomUUID();
  private guardianId?: string;
  private ownerId?: string;
  private providerPid?: number;
  private providerExit: number | null = null;
  private transportSignal: NodeJS.Signals | null = null;
  private nextId = 0;
  private readonly writes = new Map<number, ReturnType<typeof deferred<void>>>();
  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private terminal = false;
  private terminalRetirement?: string;
  private failed = false;
  private stopping = false;
  private stopWork?: Promise<void>;
  private readonly blockedStreams = new Set<"stdout" | "stderr">();
  private readonly raw: ChildProcessWithoutNullStreams;
  private readonly beforeStart?: () => Promise<void>;
  private readonly commitStart?: () => void;
  private startupTimer: ReturnType<typeof setTimeout>;

  constructor(
    executable: string,
    launch: GuardianLaunch,
    beforeStart?: () => Promise<void>,
    commitStart?: () => void,
  ) {
    super();
    this.beforeStart = beforeStart;
    this.commitStart = commitStart;
    this.started = this.startResult.promise;
    this.retirement = this.retireResult.promise;
    // The guardian receives no provider credentials/environment in argv or env.
    // Provider environment is sent once through the private start frame.
    this.raw = spawn(executable, ["--provider-process-guardian"], {
      cwd: launch.cwd,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key, value]) =>
            value !== undefined &&
            ["SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"].includes(key.toUpperCase()),
        ),
      ),
      stdio: "pipe",
      windowsHide: true,
      // Keep the supervisor alive after Node exits so its own job can drain.
      detached: process.platform === "win32",
    });
    this.on("error", () => {});
    this.stdin = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        void this.writeBytes(chunk).then(
          () => callback(),
          (error) => callback(error),
        );
      },
      final: (callback) => {
        void this.stop().then(
          () => callback(),
          (error) => callback(error),
        );
      },
    });
    this.stdin.on("error", () => {});
    this.raw.stdin.on("error", (error) => {
      if (!this.terminal) this.fail(error);
    });
    this.raw.stderr.resume();
    this.raw.stdout.on("data", (chunk: Buffer) => {
      try {
        this.consume(chunk, launch);
      } catch (error) {
        this.fail(error);
      }
    });
    this.raw.on("error", (error) => this.fail(error));
    this.raw.on("close", (_code, signal) => {
      clearTimeout(this.startupTimer);
      this.transportSignal = signal;
      if (!this.terminal || this.fragmentBytes)
        this.fail(new ProviderGuardianError("Guardian closed without a complete private receipt."));
      if (!this.failed) {
        if (this.terminalRetirement === "verified" || this.terminalRetirement === "not-started")
          this.retireResult.resolve();
        else this.retireResult.reject(new ProviderGuardianError());
      }
      if (!this.ownerId && !this.failed)
        this.startResult.reject(new ProviderGuardianError("Provider was not started."));
      this.stdout.end();
      this.stderr.end();
      this.closedResult.resolve();
      this.emit("close", this.providerExit, signal);
    });
    this.startupTimer = setTimeout(() => {
      if (!this.ownerId)
        this.abortStart(new ProviderGuardianError("Provider guardian startup timed out."));
    }, 45_000);
  }

  get pid(): number | undefined {
    return this.providerPid;
  }
  get exitCode(): number | null {
    return this.providerExit;
  }
  get signalCode(): NodeJS.Signals | null {
    return this.transportSignal;
  }
  get retirementVerified(): boolean {
    return (
      !this.failed &&
      this.terminal &&
      (this.terminalRetirement === "verified" || this.terminalRetirement === "not-started")
    );
  }

  /** Emergency request addresses only the actual guardian; it supplies no proof. */
  kill(signal?: NodeJS.Signals): boolean {
    return this.raw.kill(signal);
  }

  stop(): Promise<void> {
    if (this.stopWork) return this.stopWork;
    this.stopping = true;
    this.stopWork = (async () => {
      if (!this.terminal && !this.failed) {
        await this.started;
        if (!this.terminal) await this.send({ kind: "stop", ...this.binding(), id: this.id() });
      }
      await this.closedResult.promise;
      await this.retirement;
    })();
    void this.stopWork.catch(() => {});
    return this.stopWork;
  }

  private id(): number {
    if (this.nextId >= Number.MAX_SAFE_INTEGER)
      throw new ProviderGuardianError("Guardian command IDs exhausted.");
    return ++this.nextId;
  }

  private binding() {
    if (!this.guardianId || !this.ownerId)
      throw new ProviderGuardianError("Provider owner is unavailable.");
    return { guardianId: this.guardianId, parentId: this.parentId, ownerId: this.ownerId };
  }

  private send(frame: Record<string, unknown>): Promise<void> {
    const encoded = Buffer.from(`${JSON.stringify({ version: 1, ...frame })}\n`);
    if (encoded.length > MAX_FRAME_BYTES)
      return Promise.reject(new ProviderGuardianError("Guardian frame is too large."));
    return new Promise<void>((resolve, reject) => {
      this.raw.stdin.write(encoded, (error) => (error ? reject(error) : resolve()));
    });
  }

  private async writeBytes(chunk: Buffer): Promise<void> {
    if (this.stopping || this.terminal || this.failed)
      throw new ProviderGuardianError("Provider owner is retiring.");
    await this.started;
    for (let offset = 0; offset < chunk.length; offset += MAX_DATA_BYTES) {
      if (this.stopping || this.terminal || this.failed)
        throw new ProviderGuardianError("Provider owner is retiring.");
      const id = this.id();
      const result = deferred<void>();
      this.writes.set(id, result);
      const actual = this.send({
        kind: "write",
        ...this.binding(),
        id,
        data: chunk.subarray(offset, offset + MAX_DATA_BYTES).toString("base64"),
      });
      // An observation failure cannot discharge the real pipe callback.
      const outcomes = await Promise.allSettled([actual, result.promise]);
      this.writes.delete(id);
      for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
    }
  }

  private consume(chunk: Buffer, launch: GuardianLaunch): void {
    let from = 0;
    while (from < chunk.length) {
      const newline = chunk.indexOf(10, from);
      const end = newline < 0 ? chunk.length : newline + 1;
      const piece = chunk.subarray(from, end);
      this.fragmentBytes += piece.length;
      if (this.fragmentBytes > MAX_FRAME_BYTES)
        throw new ProviderGuardianError("Guardian frame is too large.");
      this.fragments.push(piece);
      if (newline >= 0) {
        const encoded = Buffer.concat(this.fragments, this.fragmentBytes);
        this.fragments = [];
        this.fragmentBytes = 0;
        const frame: unknown = JSON.parse(encoded.toString("utf8"));
        this.frame(frame, launch);
      }
      from = end;
    }
  }

  private frame(value: unknown, launch: GuardianLaunch): void {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new ProviderGuardianError();
    const frame = value as Record<string, unknown>;
    if (frame.version !== 1 || typeof frame.kind !== "string" || this.terminal || this.failed)
      throw new ProviderGuardianError("Invalid guardian protocol state.");
    const fields = replyFields[frame.kind];
    if (
      !fields ||
      Object.keys(frame).length !== fields.length ||
      fields.some((key) => !Object.hasOwn(frame, key))
    )
      throw new ProviderGuardianError("Invalid guardian frame fields.");
    if (frame.kind === "ready") {
      if (
        this.guardianId ||
        typeof frame.guardianId !== "string" ||
        !UUID.test(frame.guardianId) ||
        frame.platform !== process.platform ||
        frame.containment !== (process.platform === "win32" ? "windows-job" : "original-child")
      )
        throw new ProviderGuardianError();
      this.guardianId = frame.guardianId;
      void (async () => {
        try {
          await this.beforeStart?.();
          if (this.stopping) throw new ProviderGuardianError("Provider startup was cancelled.");
          // The async preparation result may be resumed after a newer attempt.
          // Commit against this original caller immediately before send, with
          // no further awaited recheck that would open another microtask gap.
          this.commitStart?.();
        } catch (error) {
          this.abortStart(error);
          return;
        }
        if (this.failed || this.terminal)
          throw new ProviderGuardianError("Provider startup was cancelled.");
        await this.send({
          kind: "start",
          guardianId: this.guardianId,
          parentId: this.parentId,
          ...launch,
          env: Object.fromEntries(
            Object.entries(launch.env).filter((entry) => entry[1] !== undefined),
          ),
        });
      })().catch((error) => this.fail(error));
      return;
    }
    if (
      frame.kind === "rejected" &&
      (frame.guardianId !== this.guardianId ||
        frame.parentId !== this.parentId ||
        frame.ownerId !== this.ownerId)
    )
      return;
    const preStart =
      !this.ownerId &&
      frame.parentId === null &&
      (frame.kind === "failed" || (frame.kind === "settled" && frame.retirement === "not-started"));
    if (frame.guardianId !== this.guardianId || (frame.parentId !== this.parentId && !preStart))
      throw new ProviderGuardianError("Guardian receipt identity mismatch.");
    if (frame.kind === "started") {
      if (
        this.ownerId ||
        typeof frame.ownerId !== "string" ||
        !UUID.test(frame.ownerId) ||
        !Number.isSafeInteger(frame.pid) ||
        Number(frame.pid) <= 1
      )
        throw new ProviderGuardianError();
      this.ownerId = frame.ownerId;
      this.providerPid = Number(frame.pid);
      clearTimeout(this.startupTimer);
      this.startResult.resolve();
      this.emit("spawn");
      return;
    }
    if (
      frame.kind === "failed" &&
      !this.ownerId &&
      ["invalid-start", "spawn-failed", "unsupported", "io"].includes(String(frame.reason))
    ) {
      this.startResult.reject(new ProviderGuardianError("Guardian provider startup failed."));
      return;
    }
    if (frame.kind === "settled") {
      if (
        (this.ownerId ? frame.ownerId !== this.ownerId : frame.ownerId !== null) ||
        (frame.exitCode !== null && !Number.isInteger(frame.exitCode)) ||
        !["verified", "unknown", "unsupported", "not-started"].includes(String(frame.retirement)) ||
        (frame.retirement === "not-started") !== !this.ownerId
      )
        throw new ProviderGuardianError();
      this.terminal = true;
      this.terminalRetirement = String(frame.retirement);
      clearTimeout(this.startupTimer);
      this.providerExit = frame.exitCode as number | null;
      for (const pending of this.writes.values())
        pending.reject(new ProviderGuardianError("Provider closed during write."));
      if (!this.ownerId)
        this.startResult.reject(new ProviderGuardianError("Provider was not started."));
      this.raw.stdin.end();
      return;
    }
    if (!this.ownerId || frame.ownerId !== this.ownerId) throw new ProviderGuardianError();
    if (frame.kind === "data") {
      if (frame.stream !== "stdout" && frame.stream !== "stderr") throw new ProviderGuardianError();
      const stream = frame.stream;
      if (!this[stream].write(bytes(frame.data))) {
        this.blockedStreams.add(stream);
        this.raw.stdout.pause();
        this[stream].once("drain", () => {
          this.blockedStreams.delete(stream);
          if (!this.blockedStreams.size) this.raw.stdout.resume();
        });
      }
      return;
    }
    if (frame.kind === "written" || frame.kind === "rejected") {
      if (!Number.isSafeInteger(frame.id) || Number(frame.id) <= 0)
        throw new ProviderGuardianError();
      const pending = this.writes.get(Number(frame.id));
      if (frame.kind === "written" && typeof frame.ok !== "boolean")
        throw new ProviderGuardianError();
      if (pending) {
        if (frame.kind === "written" && frame.ok === true) pending.resolve();
        else pending.reject(new ProviderGuardianError("Guardian rejected provider write."));
      }
      return;
    }
    throw new ProviderGuardianError("Unknown guardian frame.");
  }

  private fail(reason: unknown): void {
    if (this.failed) return;
    this.failed = true;
    clearTimeout(this.startupTimer);
    const error = reason instanceof Error ? reason : new ProviderGuardianError();
    this.startResult.reject(error);
    this.retireResult.reject(error);
    for (const pending of this.writes.values()) pending.reject(error);
    // EOF asks this original guardian to stop. A timeout/crash remains unknown;
    // no PID-tree request or replacement owner is used as a substitute.
    this.raw.stdin.end();
    this.emit("error", error);
  }

  private abortStart(reason: unknown): void {
    this.startResult.reject(reason);
    this.stopping = true;
    // Keep parsing the original guardian's final receipt. A visible startup
    // deadline/cancel is not a protocol failure or a retirement proof.
    this.raw.stdin.end();
  }
}
