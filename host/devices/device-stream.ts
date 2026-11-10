import { spawn, type ChildProcess } from "node:child_process";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import {
  DEVICE_STREAM_MAX_CHUNK_BYTES,
  type DeviceStreamChunk,
  type DeviceSummary,
} from "../../src/shared/model/host-contracts/native-devices";
import { assertDeviceAuthority, type DeviceEffectContext } from "./device-authority";
import { deviceCommand, stopDeviceChild } from "./device-process";

const START_CODE = Buffer.from([0, 0, 0, 1]);
const MAX_PARAMETER_SET_BYTES = 1024;

/**
 * Keeps the newest H.264 group of pictures of an Annex-B byte stream. Offsets are
 * absolute stream positions and keep growing across recorder restarts, so a cursor
 * from an earlier run can never be mistaken for a continuation.
 */
export class H264GopBuffer {
  private chunks: Buffer[] = [];
  /** Absolute offset of the first retained byte. */
  private start = 0;
  private total = 0;
  private gopStart?: number;
  private gopNal = 0;
  private sps?: Buffer;
  private pps?: Buffer;
  private zeros = 0;
  private codeStart = 0;
  private nalStart = 0;
  private stage: "data" | "header" | "idr" = "data";
  private capture?: { type: number; bytes: number[] };
  /** IDR pictures seen since construction; diagnostics and tests only. */
  idrCount = 0;

  get end(): number {
    return this.total;
  }
  get retainedBytes(): number {
    return this.total - this.start;
  }
  get hasGop(): boolean {
    return this.gopStart !== undefined;
  }

  append(chunk: Buffer): void {
    const base = this.total;
    let idr = false;
    this.chunks.push(chunk);
    for (let index = 0; index < chunk.length; index++) {
      const byte = chunk[index];
      if (this.stage === "header") {
        const type = byte & 0x1f;
        this.nalStart = base + index;
        this.stage = type === 5 ? "idr" : "data";
        this.capture = type === 7 || type === 8 ? { type, bytes: [byte] } : undefined;
        this.zeros = 0;
        continue;
      }
      if (this.stage === "idr") {
        this.stage = "data";
        // first_mb_in_slice == 0 (a leading 1 bit) starts a new picture; later
        // slices of the same IDR picture must not trim the first one away.
        if (byte & 0x80 && this.sps && this.pps) {
          idr = true;
          this.idrCount++;
          this.gopNal = this.nalStart;
          this.gopStart = Math.max(this.codeStart, this.start);
        }
      }
      if (byte === 0) {
        this.zeros++;
        this.capture?.bytes.push(0);
      } else {
        if (byte === 1 && this.zeros >= 2) {
          const zeros = Math.min(this.zeros, 3);
          this.finishParameterSet(zeros);
          this.codeStart = base + index - zeros;
          this.stage = "header";
        } else this.capture?.bytes.push(byte);
        this.zeros = 0;
      }
      if (this.capture && this.capture.bytes.length > MAX_PARAMETER_SET_BYTES)
        this.capture = undefined;
    }
    this.total += chunk.length;
    if (idr) this.dropBefore(this.gopStart!);
    // Without a key frame nothing is decodable. One chunk stays so an IDR whose
    // start code or header straddles two pipe reads is still retained whole.
    else if (this.gopStart === undefined) this.dropBefore(this.total - this.chunks.at(-1)!.length);
  }

  /** A new recorder process starts a new stream: nothing retained continues into it. */
  endRun(): void {
    this.chunks = [];
    this.start = this.total;
    this.gopStart = undefined;
    this.sps = this.pps = this.capture = undefined;
    this.zeros = 0;
    this.stage = "data";
  }

  /**
   * Bytes for a client at `cursor`, or undefined when nothing new exists. A cursor
   * outside the retained group gets SPS, PPS and the latest IDR onward (`reset`).
   */
  read(
    cursor: number | undefined,
    limit: number,
  ): { reset: boolean; cursor: number; bytes: Buffer } | undefined {
    if (this.gopStart === undefined) return undefined;
    if (cursor !== undefined && cursor >= this.gopStart && cursor <= this.total) {
      if (cursor === this.total) return undefined;
      const bytes = this.slice(cursor, limit);
      return { reset: false, cursor: cursor + bytes.length, bytes };
    }
    const prefix = Buffer.concat([START_CODE, this.sps!, START_CODE, this.pps!, START_CODE]);
    const body = this.slice(this.gopNal, Math.max(0, limit - prefix.length));
    return {
      reset: true,
      cursor: this.gopNal + body.length,
      bytes: Buffer.concat([prefix, body]),
    };
  }

  private finishParameterSet(startCodeZeros: number): void {
    const capture = this.capture;
    this.capture = undefined;
    if (!capture) return;
    const bytes = Buffer.from(capture.bytes.slice(0, capture.bytes.length - startCodeZeros));
    if (capture.type === 7) this.sps = bytes;
    else this.pps = bytes;
  }

  private dropBefore(offset: number): void {
    while (this.chunks.length && this.start + this.chunks[0].length <= offset)
      this.start += this.chunks.shift()!.length;
    if (this.chunks.length && this.start < offset) {
      this.chunks[0] = this.chunks[0].subarray(offset - this.start);
      this.start = offset;
    }
  }

  private slice(from: number, limit: number): Buffer {
    const parts: Buffer[] = [];
    let offset = this.start;
    let left = limit;
    for (const chunk of this.chunks) {
      const next = offset + chunk.length;
      if (left <= 0) break;
      if (next > from) {
        const part = chunk.subarray(Math.max(0, from - offset), chunk.length);
        parts.push(part.length > left ? part.subarray(0, left) : part);
        left -= parts.at(-1)!.length;
      }
      offset = next;
    }
    return Buffer.concat(parts);
  }
}

/** Encoded size: long side at most 1280, both sides even, aspect preserved. */
export function deviceStreamVideoSize(display: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const scale = Math.min(1, 1280 / Math.max(display.width, display.height));
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(display.width), height: even(display.height) };
}

/** `wm size` output; an override is what input coordinates and frames really use. */
export function parseDisplaySize(output: string): { width: number; height: number } {
  const match =
    /Override size:\s*(\d+)x(\d+)/.exec(output) ?? /Physical size:\s*(\d+)x(\d+)/.exec(output);
  const width = Number(match?.[1]),
    height = Number(match?.[2]);
  if (!(width > 0 && height > 0 && width <= 20000 && height <= 20000))
    throw new Error("Device display size is unavailable");
  return { width, height };
}

export interface DeviceStreamPorts {
  device(id: string): Promise<DeviceSummary>;
  platform(): NodeJS.Platform;
  adb(): string;
  env(): NodeJS.ProcessEnv;
  closed(): boolean;
  spawn?: typeof spawn;
  command?: typeof deviceCommand;
}

export const DEVICE_STREAM_TIMING = {
  /** Longest wait of one read for new bytes. */
  waitMs: 1000,
  /** A recorder nobody reads is stopped. */
  idleMs: 5000,
  /** Pipe silence that ends a burst; a reply then ends where a device write ended. */
  quietMs: 8,
  /** Longest delay of a reply after its first new byte. */
  settleMs: 40,
  /** Booted/platform re-check interval while a recorder runs. */
  verifyMs: 2000,
  backoffMs: 250,
  maxBufferBytes: 16 * 1024 * 1024,
  maxFailures: 3,
};

interface Recorder {
  readonly id: string;
  readonly buffer: H264GopBuffer;
  readonly waiters: Set<() => void>;
  child?: ChildProcess;
  starting?: Promise<void>;
  display: { width: number; height: number };
  verifiedAt: number;
  lastDataAt: number;
  /** Consecutive runs that ended before their first key frame. */
  failures: number;
  retryAt: number;
  error?: Error;
  timeLimit: boolean;
  diagnostic: string;
  idle?: ReturnType<typeof setTimeout>;
}

/** One `adb exec-out screenrecord` H.264 recorder per Android device, read by cursor. */
export class DeviceStreams {
  private readonly recorders = new Map<string, Recorder>();
  private readonly timing: typeof DEVICE_STREAM_TIMING;
  constructor(
    private readonly ports: DeviceStreamPorts,
    timing: Partial<typeof DEVICE_STREAM_TIMING> = {},
  ) {
    this.timing = { ...DEVICE_STREAM_TIMING, ...timing };
  }

  /** Device ids with a live recorder entry. */
  active(): string[] {
    return [...this.recorders.keys()];
  }

  async read(
    id: string,
    cursor: number | undefined,
    effect?: DeviceEffectContext,
  ): Promise<DeviceStreamChunk> {
    if (this.ports.closed()) throw new Error("Device host is disposed");
    if (cursor !== undefined && !(Number.isSafeInteger(cursor) && cursor >= 0))
      throw new Error("Invalid device stream cursor");
    await assertDeviceAuthority(effect);
    let recorder = this.recorders.get(id);
    if (!recorder || elapsedSince(recorder.verifiedAt) >= this.timing.verifyMs) {
      let device: DeviceSummary;
      try {
        device = await this.ports.device(id);
      } catch (cause) {
        await this.stop(id);
        throw cause;
      }
      await assertDeviceAuthority(effect);
      if (!device.booted) {
        await this.stop(id);
        throw new Error("Boot the device before viewing");
      }
      if (!["win32", "darwin"].includes(this.ports.platform()) || device.platform !== "android")
        throw new Error(
          "DEVICE_STREAM_UNSUPPORTED: Live view needs an Android device on a Windows or macOS Host.",
        );
      if (this.ports.closed()) throw new Error("Device host is disposed");
      recorder = this.recorders.get(id);
      if (!recorder) {
        recorder = {
          id,
          buffer: new H264GopBuffer(),
          waiters: new Set(),
          display: { width: 0, height: 0 },
          verifiedAt: 0,
          lastDataAt: 0,
          failures: 0,
          retryAt: 0,
          timeLimit: true,
          diagnostic: "",
        };
        this.recorders.set(id, recorder);
      }
      recorder.verifiedAt = monotonicNow();
    }
    this.armIdle(recorder);
    const chunk = await this.next(recorder, cursor);
    await assertDeviceAuthority(effect);
    return chunk;
  }

  /** Stops one recorder; adbd ends the device-side screenrecord when its client goes. */
  async stop(id: string): Promise<void> {
    const recorder = this.recorders.get(id);
    if (!recorder) return;
    this.recorders.delete(id);
    clearTimeout(recorder.idle);
    const child = recorder.child;
    recorder.child = undefined;
    this.wake(recorder);
    if (child) await stopDeviceChild(child);
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.active().map((id) => this.stop(id)));
  }

  private async next(recorder: Recorder, cursor: number | undefined): Promise<DeviceStreamChunk> {
    const { waitMs, quietMs, settleMs } = this.timing;
    const startedAt = monotonicNow();
    let firstSeenAt: number | undefined;
    const reply = (next: number, reset: boolean, bytes?: Buffer): DeviceStreamChunk => ({
      cursor: next,
      reset,
      base64: bytes ? bytes.toString("base64") : "",
      ...recorder.display,
    });
    for (;;) {
      await this.ensureRunning(recorder);
      if (this.ports.closed()) throw new Error("Device host is disposed");
      const found =
        this.recorders.get(recorder.id) === recorder
          ? recorder.buffer.read(cursor, DEVICE_STREAM_MAX_CHUNK_BYTES)
          : undefined;
      const now = monotonicNow();
      if (found) {
        firstSeenAt ??= now;
        const settle = Math.min(
          quietMs - elapsedSince(recorder.lastDataAt, now),
          settleMs - elapsedSince(firstSeenAt, now),
        );
        if (settle <= 0 || found.bytes.length >= DEVICE_STREAM_MAX_CHUNK_BYTES)
          return reply(found.cursor, found.reset, found.bytes);
        await new Promise((resolve) => setTimeout(resolve, settle));
        continue;
      }
      const left = waitMs - elapsedSince(startedAt, now);
      // An empty reply to a cursor that cannot continue carries cursor 0, which no
      // key frame can ever start at, so the following read resets with data.
      const continues = cursor !== undefined && cursor === recorder.buffer.end;
      if (left <= 0 || this.recorders.get(recorder.id) !== recorder)
        return reply(continues ? cursor : 0, !continues);
      const retry = recorder.child ? left : Math.max(1, recorder.retryAt - now);
      await this.wait(recorder, Math.min(left, retry));
    }
  }

  private ensureRunning(recorder: Recorder): Promise<void> | undefined {
    if (recorder.error) throw recorder.error;
    if (recorder.child || this.recorders.get(recorder.id) !== recorder) return undefined;
    if (recorder.starting) return recorder.starting;
    if (monotonicNow() < recorder.retryAt) return undefined;
    recorder.starting = this.start(recorder).finally(() => {
      recorder.starting = undefined;
    });
    return recorder.starting;
  }

  private async start(recorder: Recorder): Promise<void> {
    const adb = this.ports.adb(),
      env = this.ports.env();
    recorder.display = parseDisplaySize(
      await (this.ports.command ?? deviceCommand)(adb, ["-s", recorder.id, "shell", "wm", "size"], {
        env,
        timeoutMs: 10_000,
      }),
    );
    if (this.recorders.get(recorder.id) !== recorder || this.ports.closed()) return;
    const size = deviceStreamVideoSize(recorder.display);
    // The idle timer is this long-running command's deadline: an unread recorder ends.
    const child = (this.ports.spawn ?? spawn)(
      adb,
      [
        "-s",
        recorder.id,
        "exec-out",
        "screenrecord",
        "--output-format=h264",
        "--size",
        `${size.width}x${size.height}`,
        "--bit-rate",
        "4M",
        // Older builds reject 0 (unlimited); they then run their 180 s default and restart.
        ...(recorder.timeLimit ? ["--time-limit", "0"] : []),
        "-",
      ],
      { env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    recorder.child = child;
    recorder.diagnostic = "";
    let keyFrame = false;
    const ended = (cause?: Error) => {
      if (recorder.child !== child) return;
      recorder.child = undefined;
      recorder.buffer.endRun();
      recorder.retryAt = monotonicNow() + this.timing.backoffMs;
      if (!keyFrame) {
        recorder.failures++;
        recorder.timeLimit = false;
        recorder.retryAt += this.timing.backoffMs * (recorder.failures - 1);
        if (recorder.failures >= this.timing.maxFailures)
          recorder.error = new Error(
            `DEVICE_STREAM_UNSUPPORTED: ${recorder.diagnostic.trim() || cause?.message || "screenrecord produced no video."}`,
          );
      }
      this.wake(recorder);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      if (recorder.child !== child) return;
      recorder.lastDataAt = monotonicNow();
      recorder.buffer.append(chunk);
      if (recorder.buffer.hasGop) {
        keyFrame = true;
        recorder.failures = 0;
      } else if (recorder.buffer.end < 2000)
        // A device without raw exec-out prints its error on standard output.
        recorder.diagnostic = `${recorder.diagnostic}${chunk.toString("utf8")}`.slice(-2000);
      if (recorder.buffer.retainedBytes > this.timing.maxBufferBytes) {
        // A group of pictures this large is not a live view any more: start over.
        recorder.child = undefined;
        recorder.buffer.endRun();
        void stopDeviceChild(child).catch(() => {});
      }
      this.wake(recorder);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      // Buffer#toString replaces invalid UTF-8 instead of throwing.
      recorder.diagnostic = `${recorder.diagnostic}${chunk.toString("utf8")}`.slice(-2000);
    });
    child.once("error", (cause) => ended(cause));
    child.once("close", () => ended());
  }

  private wait(recorder: Recorder, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        recorder.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      recorder.waiters.add(done);
    });
  }

  private wake(recorder: Recorder): void {
    // Deleting the visited entry while iterating a Set is well defined.
    for (const waiter of recorder.waiters) waiter();
  }

  private armIdle(recorder: Recorder): void {
    clearTimeout(recorder.idle);
    recorder.idle = setTimeout(() => {
      void this.stop(recorder.id).catch(() => {});
    }, this.timing.idleMs);
    recorder.idle.unref?.();
  }
}
