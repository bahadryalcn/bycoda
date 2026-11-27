import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AndroidDeviceTouch,
  androidTouchPacket,
  parseAndroidDisplaySize,
  type AndroidTouchControl,
} from "./android-device-touch";

const ROOT = "pinned-root";
const DEVICE = "emulator-5554";
const SIZE = { width: 1000, height: 2000 };
const allow = { authorized: () => true };
const at = (phase: "down" | "move" | "up" | "cancel", x = 0.5, y = 0.5) => ({ phase, x, y });

class FakeSocket extends EventEmitter {
  packets: Buffer[] = [];
  stall = false;
  fail = false;
  write(data: Uint8Array, callback: (error?: Error | null) => void) {
    this.packets.push(Buffer.from(data));
    if (this.stall) return false;
    callback(this.fail ? new Error("write failed") : null);
    return true;
  }
  get actions() {
    return this.packets.map((packet) => packet.readUInt8(1));
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const closes: ReturnType<typeof vi.fn>[] = [];
  const openControl = vi.fn(async (): Promise<AndroidTouchControl> => {
    const socket = new FakeSocket();
    const close = vi.fn(async () => undefined);
    sockets.push(socket);
    closes.push(close);
    return { controlSocket: socket, proc: new EventEmitter() as never, close };
  });
  const touch = new AndroidDeviceTouch({
    adbPath: () => "adb",
    ports: { openControl, readSize: async () => SIZE },
  });
  return { touch, sockets, closes, openControl };
}

describe("android live touch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const settled = async <T>(work: Promise<T>) => {
    const outcome = work.then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(200);
    return outcome;
  };

  it("encodes the pinned inject-touch layout in native pixels", () => {
    const point = { x: 500, y: 1000, width: 1000, height: 2000 };
    const down = androidTouchPacket(0, point);
    expect(down).toHaveLength(32);
    expect([down.readUInt8(0), down.readUInt8(1)]).toEqual([2, 0]);
    expect([down.readInt32BE(10), down.readInt32BE(14)]).toEqual([500, 1000]);
    expect([down.readUInt16BE(18), down.readUInt16BE(20)]).toEqual([1000, 2000]);
    expect(down.readUInt16BE(22)).toBe(0xffff);
    const cancel = androidTouchPacket(3, point);
    expect(cancel.readUInt8(1)).toBe(3);
    expect([cancel.readUInt16BE(22), cancel.readUInt32BE(28)]).toEqual([0, 0]);
  });

  it("reads the rotated size of display 0 and fails closed", () => {
    const output =
      "Display: mDisplayId=1\n init=1x1 cur=720x1280\nDisplay: mDisplayId=0 rootTasks=1\n init=1080x2400 420dpi cur=2400x1080 app=2337x1080";
    expect(parseAndroidDisplaySize(output)).toEqual({ width: 2400, height: 1080 });
    expect(() => parseAndroidDisplaySize("no display")).toThrow("DEVICE_TOUCH_DISPLAY_UNKNOWN");
  });

  it("keeps one held pointer in order and reuses the session between gestures", async () => {
    const { touch, sockets, openControl } = harness();
    await touch.send(ROOT, DEVICE, "lease", at("down", 1, 1), allow);
    await expect(touch.send(ROOT, DEVICE, "lease", at("down"), allow)).rejects.toThrow(
      "DEVICE_TOUCH_ORDER",
    );
    await touch.send(ROOT, DEVICE, "lease", at("move"), allow);
    await touch.send(ROOT, DEVICE, "lease", at("up"), allow);
    await expect(touch.send(ROOT, DEVICE, "lease", at("move"), allow)).rejects.toThrow(
      "DEVICE_TOUCH_ORDER",
    );
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    expect(openControl).toHaveBeenCalledTimes(1);
    expect(sockets[0].actions).toEqual([0, 2, 1, 0]);
    expect(sockets[0].packets[0].readInt32BE(10)).toBe(999);
    await settled(touch.stop());
  });

  it("does not open a session for input without a held pointer", async () => {
    const { touch, openControl } = harness();
    await expect(touch.send(ROOT, DEVICE, "lease", at("move"), allow)).rejects.toThrow(
      "DEVICE_TOUCH_ORDER",
    );
    await touch.send(ROOT, DEVICE, "lease", at("cancel"), allow);
    expect(openControl).not.toHaveBeenCalled();
  });

  it("prepares the leased control channel without pressing and reuses it for the first drag", async () => {
    const { touch, sockets, openControl } = harness();
    await touch.prepare(ROOT, DEVICE, "lease", allow);
    await touch.prepare(ROOT, DEVICE, "lease", allow);
    expect(openControl).toHaveBeenCalledTimes(1);
    expect(sockets[0].actions).toEqual([]);
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    await touch.send(ROOT, DEVICE, "lease", at("up"), allow);
    expect(openControl).toHaveBeenCalledTimes(1);
    expect(sockets[0].actions).toEqual([0, 1]);
    await touch.release(DEVICE, "lease");
    await expect(touch.prepare(ROOT, DEVICE, "lease", allow)).rejects.toThrow(
      "DEVICE_CONTROL_LEASE_INVALID",
    );
  });

  it("sends a real cancel and discards the session", async () => {
    const { touch, sockets, closes, openControl } = harness();
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    await settled(touch.send(ROOT, DEVICE, "lease", at("cancel"), allow));
    expect(sockets[0].actions).toEqual([0, 3]);
    expect(closes[0]).toHaveBeenCalled();
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    expect(openControl).toHaveBeenCalledTimes(2);
    await settled(touch.stop());
  });

  it("rechecks authority before each write and cancels on revocation", async () => {
    const { touch, sockets } = harness();
    let authorized = true;
    const effect = { authorized: () => authorized };
    await touch.send(ROOT, DEVICE, "lease", at("down"), effect);
    authorized = false;
    const error = await settled(touch.send(ROOT, DEVICE, "lease", at("move"), effect));
    expect(String(error)).toContain("DEVICE_AUTHORITY_REVOKED");
    expect(sockets[0].actions).toEqual([0, 3]);
  });

  it("does not press when authority ends while the session opens", async () => {
    const { touch, sockets } = harness();
    const authorized = vi.fn<() => boolean>().mockReturnValueOnce(true).mockReturnValue(false);
    const error = await settled(touch.send(ROOT, DEVICE, "lease", at("down"), { authorized }));
    expect(String(error)).toContain("DEVICE_AUTHORITY_REVOKED");
    expect(sockets[0].actions).toEqual([]);
  });

  it("releases only the exact lease and rejects its late input", async () => {
    const { touch, sockets, closes } = harness();
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    await touch.release(DEVICE, "other");
    expect(sockets[0].actions).toEqual([0]);
    await expect(touch.send(ROOT, DEVICE, "other", at("down"), allow)).rejects.toThrow(
      "DEVICE_CONTROL_LEASE_INVALID",
    );
    await settled(touch.release(DEVICE, "lease"));
    expect(sockets[0].actions).toEqual([0, 3]);
    expect(closes[0]).toHaveBeenCalled();
    await expect(touch.send(ROOT, DEVICE, "lease", at("down"), allow)).rejects.toThrow(
      "DEVICE_CONTROL_LEASE_INVALID",
    );
  });

  it("blocks another lease while a pointer is held", async () => {
    const { touch } = harness();
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    await expect(touch.send(ROOT, DEVICE, "next", at("down"), allow)).rejects.toThrow(
      "DEVICE_CONTROL_BUSY",
    );
    await settled(touch.stop());
  });

  it("cancels a silent held pointer from the watchdog", async () => {
    const { touch, sockets, closes } = harness();
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(sockets[0].actions).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(sockets[0].actions).toEqual([0, 3]);
    expect(closes[0]).toHaveBeenCalled();
  });

  it("cancels from the watchdog when authority ends between events", async () => {
    const { touch, sockets } = harness();
    let authorized = true;
    await touch.send(ROOT, DEVICE, "lease", at("down"), { authorized: () => authorized });
    authorized = false;
    await vi.advanceTimersByTimeAsync(1_200);
    expect(sockets[0].actions).toEqual([0, 3]);
  });

  it("treats a hanging authority callback as revoked", async () => {
    const { touch, sockets } = harness();
    let hang = false;
    const authorized = () => (hang ? new Promise<boolean>(() => undefined) : true);
    await touch.send(ROOT, DEVICE, "lease", at("down"), { authorized });
    hang = true;
    await vi.advanceTimersByTimeAsync(3_500);
    expect(sockets[0].actions).toEqual([0, 3]);
  });

  it("closes an idle session without touching the device", async () => {
    const { touch, sockets, closes } = harness();
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    await touch.send(ROOT, DEVICE, "lease", at("up"), allow);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(sockets[0].actions).toEqual([0, 1]);
    expect(closes[0]).toHaveBeenCalled();
  });

  it("recovers a lost transport with only a cancel and no replay", async () => {
    const { touch, sockets, openControl } = harness();
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    await touch.send(ROOT, DEVICE, "lease", at("move", 0.25, 0.25), allow);
    sockets[0].emit("close");
    await vi.advanceTimersByTimeAsync(200);
    expect(openControl).toHaveBeenCalledTimes(2);
    expect(sockets[1].actions).toEqual([3]);
    expect(sockets[1].packets[0].readInt32BE(10)).toBe(250);
  });

  it("bounds a stalled write and cancels through a fresh session", async () => {
    const { touch, sockets } = harness();
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    sockets[0].stall = true;
    const move = touch.send(ROOT, DEVICE, "lease", at("move"), allow);
    const outcome = move.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_700);
    expect(String(await outcome)).toContain("DEVICE_TOUCH_TRANSPORT_FAILED");
    expect(sockets[1].actions).toEqual([3]);
  });

  it("refuses new input until a stuck pointer is cancelled", async () => {
    const { touch, sockets, openControl } = harness();
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    openControl.mockRejectedValueOnce(new Error("adb offline"));
    sockets[0].emit("close");
    await vi.advanceTimersByTimeAsync(200);
    openControl.mockRejectedValueOnce(new Error("adb offline"));
    await expect(touch.send(ROOT, DEVICE, "next", at("down"), allow)).rejects.toThrow(
      "DEVICE_TOUCH_STUCK",
    );
    expect(await settled(touch.send(ROOT, DEVICE, "next", at("down"), allow))).toBeUndefined();
    expect(sockets[1].actions).toEqual([3]);
    expect(sockets[2].actions).toEqual([0]);
    await settled(touch.stop());
  });

  it("aborts a pending open on release and never presses", async () => {
    const { touch, sockets, openControl } = harness();
    let signal: AbortSignal | undefined;
    openControl.mockImplementationOnce((async (
      _root: string,
      _serial: string,
      abort: AbortSignal,
    ) => {
      signal = abort;
      await new Promise((resolve) => abort.addEventListener("abort", resolve));
      throw abort.reason;
    }) as never);
    const down = touch.send(ROOT, DEVICE, "lease", at("down"), allow).catch((error) => error);
    await vi.advanceTimersByTimeAsync(1);
    await settled(touch.release(DEVICE, "lease"));
    expect(signal?.aborted).toBe(true);
    expect(String(await down)).toContain("DEVICE_CONTROL_LEASE_INVALID");
    expect(sockets).toHaveLength(0);
  });

  it("rejects input beyond the queue bound but keeps room for a release", async () => {
    const { touch, sockets } = harness();
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    sockets[0].stall = true;
    const moves = Array.from({ length: 64 }, () =>
      touch.send(ROOT, DEVICE, "lease", at("move"), allow).catch((error: unknown) => error),
    );
    await expect(touch.send(ROOT, DEVICE, "lease", at("move"), allow)).rejects.toThrow(
      "DEVICE_TOUCH_OVERLOADED",
    );
    const cancel = touch
      .send(ROOT, DEVICE, "lease", at("cancel"), allow)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.all([...moves, cancel]);
  });

  const tracked = (touch: AndroidDeviceTouch) =>
    (touch as unknown as { devices: Map<string, unknown> }).devices;

  it("creates no state for release or non-press input on an unknown device", async () => {
    const { touch, openControl } = harness();
    await touch.release("ios-simulator-id", "lease");
    await touch.send(ROOT, DEVICE, "lease", at("cancel"), allow);
    await expect(touch.send(ROOT, DEVICE, "lease", at("move"), allow)).rejects.toThrow(
      "DEVICE_TOUCH_ORDER",
    );
    await expect(touch.send(ROOT, DEVICE, "lease", at("up"), allow)).rejects.toThrow(
      "DEVICE_TOUCH_ORDER",
    );
    expect(tracked(touch).size).toBe(0);
    expect(openControl).not.toHaveBeenCalled();
  });

  it("evicts the least recently pressed idle device at the bound", async () => {
    const { touch } = harness();
    for (let index = 0; index < 32; index++) {
      await touch.send(ROOT, `device-${index}`, "lease", at("down"), allow);
      await touch.send(ROOT, `device-${index}`, "lease", at("up"), allow);
      await settled(touch.release(`device-${index}`, "lease"));
    }
    await touch.send(ROOT, "device-0", "next", at("down"), allow);
    await touch.send(ROOT, "device-0", "next", at("up"), allow);
    await touch.send(ROOT, "device-new", "lease", at("down"), allow);
    expect(tracked(touch).size).toBe(32);
    expect(tracked(touch).has("device-0")).toBe(true);
    expect(tracked(touch).has("device-1")).toBe(false);
    await settled(touch.stop());
  });

  it("keeps an unreleased pointer across eviction and cancels it before new input", async () => {
    const { touch, sockets, openControl } = harness();
    await touch.send(ROOT, "stuck", "lease", at("down"), allow);
    openControl.mockRejectedValueOnce(new Error("adb offline"));
    sockets[0].emit("close");
    await vi.advanceTimersByTimeAsync(200);
    for (let index = 0; index < 40; index++) {
      await touch.send(ROOT, `device-${index}`, "lease", at("down"), allow);
      await touch.send(ROOT, `device-${index}`, "lease", at("up"), allow);
      await settled(touch.release(`device-${index}`, "lease"));
    }
    expect(tracked(touch).size).toBe(32);
    expect(tracked(touch).has("stuck")).toBe(true);
    const before = sockets.length;
    expect(await settled(touch.send(ROOT, "stuck", "next", at("down"), allow))).toBeUndefined();
    expect(sockets[before].actions).toEqual([3]);
    expect(sockets[before + 1].actions).toEqual([0]);
    await settled(touch.stop());
  });

  it("refuses a new device when every tracked entry is active", async () => {
    const { touch } = harness();
    for (let index = 0; index < 32; index++)
      await touch.send(ROOT, `device-${index}`, "lease", at("down"), allow);
    await expect(touch.send(ROOT, "device-new", "lease", at("down"), allow)).rejects.toThrow(
      "DEVICE_TOUCH_CAPACITY",
    );
    expect(tracked(touch).size).toBe(32);
    await settled(touch.stop());
  });

  it("answers within the send deadline and never presses afterwards", async () => {
    const sockets: FakeSocket[] = [];
    const touch = new AndroidDeviceTouch({
      adbPath: () => "adb",
      ports: {
        openControl: async () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return {
            controlSocket: socket,
            proc: new EventEmitter() as never,
            close: async () => undefined,
          };
        },
        readSize: () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(SIZE), 26_000);
          }),
      },
    });
    const outcome = touch
      .send(ROOT, DEVICE, "lease", at("down"), allow)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(String(await outcome)).toContain("DEVICE_TOUCH_TIMEOUT");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets[0].actions).toEqual([]);
    await settled(touch.stop());
  });

  it("still lifts the finger when an up waited past the deadline", async () => {
    const { touch, sockets } = harness();
    await touch.send(ROOT, DEVICE, "lease", at("down"), allow);
    const slow = {
      authorized: () =>
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(true), 1_900);
        }),
    };
    const moves = Array.from({ length: 15 }, () =>
      touch.send(ROOT, DEVICE, "lease", at("move"), slow).catch((error: unknown) => error),
    );
    const up = touch.send(ROOT, DEVICE, "lease", at("up"), allow).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(String(await up)).toContain("DEVICE_TOUCH_TIMEOUT");
    expect(sockets[0].actions.at(-1)).toBe(2);
    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.all(moves);
    expect(sockets[0].actions.at(-1)).toBe(1);
    expect(sockets[0].actions).not.toContain(3);
    await settled(touch.stop());
  });

  it("accepts only the pinned hub package", async () => {
    vi.useRealTimers();
    const root = await mkdtemp(join(tmpdir(), "android-touch-"));
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "expo-device-hub", version: "9.9.9" }),
      );
      const touch = new AndroidDeviceTouch({
        adbPath: () => "adb",
        ports: { readSize: async () => SIZE },
      });
      await expect(touch.send(root, DEVICE, "lease", at("down"), allow)).rejects.toThrow(
        "DEVICE_TOUCH_UNSUPPORTED_HUB",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
