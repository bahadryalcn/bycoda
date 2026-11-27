import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import {
  DeviceTouchSchema,
  type DeviceTouch,
} from "../../src/shared/model/host-contracts/native-devices";
import {
  assertDeviceAuthority,
  DeviceAuthorityRevokedError,
  type DeviceEffectContext,
} from "./device-authority";
import { deviceCommand } from "./device-process";

// The packet layout and control-only launch below were read from this exact release.
const PINNED_HUB_VERSION = "0.12.0";
const SERIAL = /^[A-Za-z0-9_.:-]{1,200}$/;
const POINTER_ID = 0n;
const ACTION = { down: 0, up: 1, move: 2, cancel: 3 } as const;
const PRESSURE_FULL = 0xffff;
const BUTTON_PRIMARY = 1;

const OPEN_TIMEOUT_MS = 20_000;
const WRITE_TIMEOUT_MS = 1_500;
const CLOSE_TIMEOUT_MS = 8_000;
const AUTHORITY_TIMEOUT_MS = 2_000;
const SIZE_TIMEOUT_MS = 3_000;
const WATCHDOG_INTERVAL_MS = 1_000;
/** A still finger sends nothing, so this also caps a long press. */
const HELD_IDLE_MS = 10_000;
const SESSION_IDLE_MS = 30_000;
/** The server reads the socket asynchronously; closing at once could drop the final cancel. */
const CANCEL_SETTLE_MS = 50;
const MAX_QUEUED_INPUT = 64;
/** Releases keep room when moves have filled the queue. */
const MAX_QUEUED_RELEASE = 72;
const MAX_ENDED_LEASES = 16;
const MAX_TRACKED_DEVICES = 32;
/** Covers queue wait and recovery; stays under the 30 s wire response deadline. */
const SEND_DEADLINE_MS = 25_000;

type ControlSocket = {
  write(data: Uint8Array, callback: (error?: Error | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: () => void): unknown;
};
export type AndroidTouchControl = {
  controlSocket: ControlSocket;
  proc: Pick<ChildProcess, "once">;
  close(): Promise<void>;
};
type Point = { x: number; y: number; width: number; height: number };
type Session = {
  control: AndroidTouchControl;
  packageRoot: string;
  leaseId: string;
  effect: DeviceEffectContext;
  held?: Point;
  lastInputAt: number;
  watchdog: NodeJS.Timeout;
  inspecting: boolean;
  closing?: Promise<void>;
};
type DeviceState = {
  id: string;
  tail: Promise<void>;
  queued: number;
  session?: Session;
  opening?: { leaseId: string; controller: AbortController };
  /** A pointer that may still be down because its cancel was not delivered. */
  unreleased?: { packageRoot: string; leaseId: string; point: Point };
  ended: Set<string>;
};
type Ports = {
  openControl(
    packageRoot: string,
    serial: string,
    signal: AbortSignal,
  ): Promise<AndroidTouchControl>;
  readSize(serial: string): Promise<{ width: number; height: number }>;
};

/** Current logical size of display 0, including rotation and any `wm size` override. */
export function parseAndroidDisplaySize(output: string): { width: number; height: number } {
  const display = output.slice(Math.max(0, output.search(/mDisplayId=0\b/)));
  const match = /\bcur=(\d+)x(\d+)/.exec(display);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!(width >= 1 && width <= 0xffff && height >= 1 && height <= 0xffff))
    throw new Error("DEVICE_TOUCH_DISPLAY_UNKNOWN");
  return { width, height };
}

/** scrcpy inject-touch message. Without video the server reads x and y as native pixels. */
export function androidTouchPacket(action: number, point: Point): Buffer {
  const released = action === ACTION.up || action === ACTION.cancel;
  const packet = Buffer.alloc(32);
  packet.writeUInt8(2, 0);
  packet.writeUInt8(action, 1);
  packet.writeBigUInt64BE(POINTER_ID, 2);
  packet.writeInt32BE(point.x, 10);
  packet.writeInt32BE(point.y, 14);
  packet.writeUInt16BE(point.width, 18);
  packet.writeUInt16BE(point.height, 20);
  packet.writeUInt16BE(released ? 0 : PRESSURE_FULL, 22);
  packet.writeUInt32BE(BUTTON_PRIMARY, 24);
  packet.writeUInt32BE(released ? 0 : BUTTON_PRIMARY, 28);
  return packet;
}

function toPoint(touch: DeviceTouch, size: { width: number; height: number }): Point {
  return {
    x: Math.min(size.width - 1, Math.floor(touch.x * size.width)),
    y: Math.min(size.height - 1, Math.floor(touch.y * size.height)),
    width: size.width,
    height: size.height,
  };
}

function writeBounded(socket: ControlSocket, packet: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("DEVICE_TOUCH_WRITE_TIMEOUT")),
      WRITE_TIMEOUT_MS,
    );
    try {
      socket.write(packet, (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function closeBounded(control: AndroidTouchControl): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      control.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // The vendor reports forward/jar cleanup errors; input is already finished.
  } finally {
    clearTimeout(timer);
  }
}

async function assertAuthority(effect: DeviceEffectContext): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      assertDeviceAuthority(effect),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DeviceAuthorityRevokedError()), AUTHORITY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function withinSendDeadline(work: Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("DEVICE_TOUCH_TIMEOUT")), SEND_DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The vendor defaults to `adb` on PATH and visible Windows consoles, so both are replaced. */
function adbDependencies(adb: string) {
  return {
    runAdb: (
      serial: string,
      args: string[],
      options: { timeoutMs: number; signal?: AbortSignal },
    ) =>
      new Promise((resolve) => {
        execFile(
          adb,
          ["-s", serial, ...args],
          {
            timeout: options.timeoutMs,
            signal: options.signal,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
            encoding: "utf8",
          },
          (error, stdout, stderr) => {
            const code = error?.code;
            resolve({
              status: error ? (typeof code === "number" ? code : null) : 0,
              signal: error?.signal ?? null,
              stdout,
              stderr,
              timedOut: Boolean(error?.killed && !options.signal?.aborted),
              error: error && typeof code !== "number" ? error : undefined,
            });
          },
        );
      }),
    spawnAdb: (serial: string, args: string[]) =>
      spawn(adb, ["-s", serial, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      }),
  };
}

async function openPinnedControl(
  adb: string,
  packageRoot: string,
  serial: string,
  signal: AbortSignal,
): Promise<AndroidTouchControl> {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
    name?: unknown;
    version?: unknown;
  };
  if (manifest.name !== "expo-device-hub" || manifest.version !== PINNED_HUB_VERSION)
    throw new Error("DEVICE_TOUCH_UNSUPPORTED_HUB");
  const vendor = join(packageRoot, "vendor/serve-emu");
  const bundledServer = join(vendor, "vendor/scrcpy-server-v4.0");
  await access(bundledServer);
  const entry = pathToFileURL(join(vendor, "dist/scrcpy.js")).href;
  const scrcpy = (await import(/* @vite-ignore */ entry)) as {
    startScrcpyControl(
      options: { serial: string; signal: AbortSignal },
      dependencies: ReturnType<typeof adbDependencies> & { ensureServer(): Promise<string> },
    ): Promise<AndroidTouchControl>;
  };
  return scrcpy.startScrcpyControl(
    { serial, signal },
    { ...adbDependencies(adb), ensureServer: async () => bundledServer },
  );
}

/**
 * One control-only scrcpy session per device, owned by exactly one lease.
 * Input is applied strictly in order and is never replayed. Delivery means written
 * to the control socket: scrcpy has no per-input acknowledgement.
 */
export class AndroidDeviceTouch {
  private readonly devices = new Map<string, DeviceState>();
  private readonly ports: Ports;

  constructor(options: { adbPath: () => string; ports?: Partial<Ports> }) {
    this.ports = {
      openControl: (packageRoot, serial, signal) =>
        openPinnedControl(options.adbPath(), packageRoot, serial, signal),
      readSize: async (serial) =>
        parseAndroidDisplaySize(
          await deviceCommand(
            options.adbPath(),
            ["-s", serial, "shell", "dumpsys", "window", "displays"],
            { timeoutMs: SIZE_TIMEOUT_MS },
          ),
        ),
      ...options.ports,
    };
  }

  /** Warm the transport while the selected device's automatic lease is active. */
  async prepare(
    packageRoot: string,
    id: string,
    leaseId: string,
    effect: DeviceEffectContext,
  ): Promise<void> {
    if (!SERIAL.test(id)) throw new Error("Invalid device ID");
    const device = this.admit(id);
    const deadline = monotonicNow() + SEND_DEADLINE_MS;
    return withinSendDeadline(
      this.enqueue(
        device,
        async () => {
          if (device.session || device.unreleased) return;
          await this.authorize(device, leaseId, effect);
          const remaining = deadline - monotonicNow();
          if (remaining > 0)
            await this.open(
              device,
              packageRoot,
              leaseId,
              effect,
              Math.min(OPEN_TIMEOUT_MS, remaining),
            );
        },
        MAX_QUEUED_INPUT,
      ),
    );
  }

  async send(
    packageRoot: string,
    deviceId: string,
    leaseId: string,
    touch: DeviceTouch,
    effect: DeviceEffectContext,
  ): Promise<void> {
    if (!SERIAL.test(deviceId)) throw new Error("Invalid device ID");
    const parsed = DeviceTouchSchema.parse(touch);
    // Only a press can start tracking a device; anything else has no pointer to act on.
    const device = parsed.phase === "down" ? this.admit(deviceId) : this.devices.get(deviceId);
    if (!device) {
      if (parsed.phase === "cancel") return;
      throw new Error("DEVICE_TOUCH_ORDER");
    }
    const limit =
      parsed.phase === "down" || parsed.phase === "move" ? MAX_QUEUED_INPUT : MAX_QUEUED_RELEASE;
    const expiresAt = monotonicNow() + SEND_DEADLINE_MS;
    return withinSendDeadline(
      this.enqueue(
        device,
        () => this.apply(device, packageRoot, leaseId, parsed, effect, expiresAt),
        limit,
      ),
    );
  }

  /** Ends this exact lease on this device: cancels its pointer and closes its session. */
  async release(deviceId: string, leaseId: string): Promise<void> {
    // Called for every native lease, including iOS and devices never touched.
    const device = this.devices.get(deviceId);
    if (!device) return;
    this.endLease(device, leaseId);
    if (device.opening?.leaseId === leaseId)
      device.opening.controller.abort(new Error("DEVICE_CONTROL_LEASE_INVALID"));
    return this.enqueue(device, async () => {
      if (device.session?.leaseId === leaseId) await this.retire(device, device.session);
      else if (device.unreleased?.leaseId === leaseId) await this.recover(device);
    });
  }

  /** Ends whichever lease is active on this device. */
  async stopDevice(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) await this.stopState(device);
  }

  async stop(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.devices.values()].map((device) => this.stopState(device)),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  private stopState(device: DeviceState): Promise<void> {
    if (device.session) this.endLease(device, device.session.leaseId);
    if (device.opening) {
      this.endLease(device, device.opening.leaseId);
      device.opening.controller.abort(new Error("DEVICE_TOUCH_STOPPED"));
    }
    return this.enqueue(device, async () => {
      if (device.session) await this.retire(device, device.session);
      await this.recover(device);
    });
  }

  /** Least recently pressed idle entry goes first; a possibly held pointer is never forgotten. */
  private admit(id: string): DeviceState {
    const known = this.devices.get(id);
    if (known) {
      this.devices.delete(id);
      this.devices.set(id, known);
      return known;
    }
    if (this.devices.size >= MAX_TRACKED_DEVICES) {
      const idle = [...this.devices.values()].find(
        (device) => !device.session && !device.opening && !device.unreleased && !device.queued,
      );
      if (!idle) throw new Error("DEVICE_TOUCH_CAPACITY");
      this.devices.delete(idle.id);
    }
    const device: DeviceState = { id, tail: Promise.resolve(), queued: 0, ended: new Set() };
    this.devices.set(id, device);
    return device;
  }

  private endLease(device: DeviceState, leaseId: string) {
    device.ended.delete(leaseId);
    device.ended.add(leaseId);
    if (device.ended.size > MAX_ENDED_LEASES)
      device.ended.delete(device.ended.values().next().value as string);
  }

  private enqueue<T>(
    device: DeviceState,
    task: () => Promise<T>,
    limit = Number.POSITIVE_INFINITY,
  ): Promise<T> {
    if (device.queued >= limit) return Promise.reject(new Error("DEVICE_TOUCH_OVERLOADED"));
    device.queued++;
    const result = device.tail.then(task).finally(() => {
      device.queued--;
    });
    device.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async apply(
    device: DeviceState,
    packageRoot: string,
    leaseId: string,
    touch: DeviceTouch,
    effect: DeviceEffectContext,
    expiresAt: number,
  ): Promise<void> {
    // The caller has already been told a late press or move failed. Up and cancel
    // only lift the finger, so they still run after the deadline.
    const assertNotExpired = () => {
      if ((touch.phase === "down" || touch.phase === "move") && monotonicNow() >= expiresAt)
        throw new Error("DEVICE_TOUCH_TIMEOUT");
    };
    assertNotExpired();
    if (device.ended.has(leaseId)) throw new Error("DEVICE_CONTROL_LEASE_INVALID");
    if (device.session && device.session.leaseId !== leaseId && device.session.held)
      throw new Error("DEVICE_CONTROL_BUSY");
    await this.authorize(device, leaseId, effect);
    await this.recover(device);
    if (device.session && device.session.leaseId !== leaseId)
      await this.retire(device, device.session);
    assertNotExpired();
    let session = device.session;

    if (touch.phase === "down") {
      if (session?.held) throw new Error("DEVICE_TOUCH_ORDER");
      session ??= await this.open(
        device,
        packageRoot,
        leaseId,
        effect,
        Math.min(OPEN_TIMEOUT_MS, expiresAt - monotonicNow()),
      );
      const point = toPoint(touch, await this.ports.readSize(device.id));
      // Opening and reading the display can outlive the authority checked above.
      await this.authorize(device, leaseId, effect);
      assertNotExpired();
      if (device.session !== session || device.ended.has(leaseId))
        throw new Error("DEVICE_CONTROL_LEASE_INVALID");
      session.effect = effect;
      // Set first: a failed write may still have reached the device.
      session.held = point;
      await this.write(device, session, ACTION.down, point);
      return;
    }

    if (!session?.held) {
      if (touch.phase === "cancel") return;
      throw new Error("DEVICE_TOUCH_ORDER");
    }
    session.effect = effect;
    const point = toPoint(touch, session.held);
    session.held = point;
    if (touch.phase === "cancel") {
      // The server may keep cancelled pointers in its table, so never reuse this session.
      await this.retire(device, session);
      return;
    }
    await this.write(device, session, ACTION[touch.phase], point);
    if (touch.phase === "up") session.held = undefined;
  }

  /** Fails closed and takes the caller's own held pointer down with it. */
  private async authorize(device: DeviceState, leaseId: string, effect: DeviceEffectContext) {
    try {
      await assertAuthority(effect);
    } catch (cause) {
      if (device.session?.leaseId === leaseId)
        await this.retire(device, device.session).catch(() => undefined);
      throw cause;
    }
  }

  private async open(
    device: DeviceState,
    packageRoot: string,
    leaseId: string,
    effect: DeviceEffectContext,
    timeoutMs: number,
  ): Promise<Session> {
    const controller = new AbortController();
    device.opening = { leaseId, controller };
    const timer = setTimeout(
      () => controller.abort(new Error("DEVICE_TOUCH_OPEN_TIMEOUT")),
      timeoutMs,
    );
    let control: AndroidTouchControl;
    try {
      control = await this.ports.openControl(packageRoot, device.id, controller.signal);
    } finally {
      clearTimeout(timer);
      device.opening = undefined;
    }
    if (controller.signal.aborted || device.ended.has(leaseId)) {
      await closeBounded(control);
      throw new Error("DEVICE_CONTROL_LEASE_INVALID");
    }
    const session: Session = {
      control,
      packageRoot,
      leaseId,
      effect,
      lastInputAt: monotonicNow(),
      inspecting: false,
      watchdog: setInterval(() => this.watch(device, session), WATCHDOG_INTERVAL_MS),
    };
    session.watchdog.unref();
    device.session = session;
    // Listeners stay attached: each is inert once this session is no longer current.
    const lost = () => this.lose(device, session);
    control.controlSocket.on("error", lost);
    control.controlSocket.once("close", lost);
    control.proc.once("exit", lost);
    return session;
  }

  private async write(device: DeviceState, session: Session, action: number, point: Point) {
    try {
      await writeBounded(session.control.controlSocket, androidTouchPacket(action, point));
      session.lastInputAt = monotonicNow();
    } catch {
      this.lose(device, session);
      throw new Error("DEVICE_TOUCH_TRANSPORT_FAILED");
    }
  }

  private watch(device: DeviceState, session: Session) {
    if (session.inspecting || device.session !== session) return;
    session.inspecting = true;
    void this.enqueue(device, () => this.inspect(device, session))
      // A failed cancel stays in `unreleased` and is retried before the next input.
      .catch(() => undefined)
      .finally(() => {
        session.inspecting = false;
      });
  }

  private async inspect(device: DeviceState, session: Session) {
    if (device.session !== session) return;
    const authorized = await assertAuthority(session.effect).then(
      () => true,
      () => false,
    );
    if (device.session !== session) return;
    const limit = session.held ? HELD_IDLE_MS : SESSION_IDLE_MS;
    if (
      !authorized ||
      device.ended.has(session.leaseId) ||
      elapsedSince(session.lastInputAt) >= limit
    )
      await this.retire(device, session);
  }

  private dispose(device: DeviceState, session: Session): Promise<void> {
    if (device.session === session) device.session = undefined;
    clearInterval(session.watchdog);
    session.closing ??= closeBounded(session.control);
    return session.closing;
  }

  /** The transport died outside a release; only a fresh session can still cancel. */
  private lose(device: DeviceState, session: Session) {
    if (device.session !== session) return;
    if (session.held)
      device.unreleased = {
        packageRoot: session.packageRoot,
        leaseId: session.leaseId,
        point: session.held,
      };
    session.held = undefined;
    // closeBounded already absorbs vendor cleanup failures.
    void this.dispose(device, session).catch(() => undefined);
    if (device.unreleased)
      void this.enqueue(device, () => this.recover(device))
        // Stays in `unreleased`; the next input on this device retries it first.
        .catch(() => undefined);
  }

  private async retire(device: DeviceState, session: Session): Promise<void> {
    if (device.session !== session) {
      await this.recover(device);
      return;
    }
    const held = session.held;
    if (held) {
      try {
        await writeBounded(session.control.controlSocket, androidTouchPacket(ACTION.cancel, held));
        session.held = undefined;
        await settle(CANCEL_SETTLE_MS);
      } catch {
        device.unreleased = {
          packageRoot: session.packageRoot,
          leaseId: session.leaseId,
          point: held,
        };
        session.held = undefined;
      }
    }
    await this.dispose(device, session);
    await this.recover(device);
  }

  /** Sends only ACTION_CANCEL through a new session; earlier input is never repeated. */
  private async recover(device: DeviceState): Promise<void> {
    const pending = device.unreleased;
    if (!pending) return;
    let control: AndroidTouchControl | undefined;
    try {
      control = await this.ports.openControl(
        pending.packageRoot,
        device.id,
        AbortSignal.timeout(OPEN_TIMEOUT_MS),
      );
      await writeBounded(control.controlSocket, androidTouchPacket(ACTION.cancel, pending.point));
      device.unreleased = undefined;
      await settle(CANCEL_SETTLE_MS);
    } catch {
      if (device.unreleased) throw new Error("DEVICE_TOUCH_STUCK");
    } finally {
      if (control) await closeBounded(control);
    }
  }
}
