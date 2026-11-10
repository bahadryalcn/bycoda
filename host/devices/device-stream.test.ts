import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_STREAM_MAX_CHUNK_BYTES } from "../../src/shared/model/host-contracts/native-devices";
import {
  DeviceStreams,
  H264GopBuffer,
  deviceStreamVideoSize,
  parseDisplaySize,
  type DeviceStreamPorts,
} from "./device-stream";

const nal = (type: number, ...payload: number[]) =>
  Buffer.from([0, 0, 0, 1, type === 5 ? 0x65 : type === 1 ? 0x41 : 0x60 | type, ...payload]);
const SPS = nal(7, 0x42, 0xc0, 0x1f);
const PPS = nal(8, 0xce, 0x3c, 0x80);
const idr = (...tail: number[]) => nal(5, 0x88, ...tail);
const frame = (...tail: number[]) => nal(1, 0x9a, ...tail);
const bytes = (base64: string) => Buffer.from(base64, "base64");

describe("H264GopBuffer", () => {
  it("resets a first read at SPS and continues by cursor", () => {
    const buffer = new H264GopBuffer();
    expect(buffer.read(undefined, 1024)).toBeUndefined();
    buffer.append(Buffer.concat([SPS, PPS, idr(1)]));
    buffer.append(frame(2));
    const first = buffer.read(undefined, 1024)!;
    expect(first.reset).toBe(true);
    expect(first.bytes).toEqual(Buffer.concat([SPS, PPS, idr(1), frame(2)]));
    expect(first.cursor).toBe(buffer.end);
    expect(buffer.read(first.cursor, 1024)).toBeUndefined();
    buffer.append(frame(3));
    expect(buffer.read(first.cursor, 1024)).toEqual({
      reset: false,
      cursor: buffer.end,
      bytes: frame(3),
    });
  });

  it("trims to the newest IDR and prefixes the remembered SPS and PPS", () => {
    const buffer = new H264GopBuffer();
    buffer.append(Buffer.concat([SPS, PPS, idr(1), frame(2)]));
    const old = buffer.read(undefined, 1024)!.cursor;
    buffer.append(frame(3));
    const beforeKey = buffer.end;
    // The encoder sends parameter sets once; later key frames arrive bare.
    buffer.append(idr(4));
    buffer.append(frame(5));
    expect(buffer.idrCount).toBe(2);
    expect(buffer.retainedBytes).toBe(idr(4).length + frame(5).length);
    // A cursor before the retained group cannot continue.
    const reset = buffer.read(old, 1024)!;
    expect(reset.reset).toBe(true);
    expect(reset.bytes).toEqual(Buffer.concat([SPS, PPS, idr(4), frame(5)]));
    expect(reset.cursor).toBe(buffer.end);
    // A client that was exactly at the key frame continues without a reset.
    expect(buffer.read(beforeKey, 1024)).toEqual({
      reset: false,
      cursor: buffer.end,
      bytes: Buffer.concat([idr(4), frame(5)]),
    });
    expect(buffer.read(buffer.end + 1, 1024)!.reset).toBe(true);
  });

  it("finds NAL units across pipe reads, three-byte start codes and extra IDR slices", () => {
    const buffer = new H264GopBuffer();
    const short = (unit: Buffer) => unit.subarray(1);
    const stream = Buffer.concat([
      short(SPS),
      short(PPS),
      idr(1),
      nal(5, 0x08, 9), // second slice of the same picture: first_mb_in_slice > 0
      frame(2),
    ]);
    for (const byte of stream) buffer.append(Buffer.from([byte]));
    expect(buffer.idrCount).toBe(1);
    const read = buffer.read(undefined, 1024)!;
    expect(read.bytes).toEqual(Buffer.concat([SPS, PPS, idr(1), nal(5, 0x08, 9), frame(2)]));
    expect(read.cursor).toBe(buffer.end);
  });

  it("caps a response and never continues into a new recorder run", () => {
    const buffer = new H264GopBuffer();
    buffer.append(Buffer.concat([SPS, PPS, idr(1, 2, 3, 4, 5, 6)]));
    const cut = buffer.read(undefined, SPS.length + PPS.length + 8)!;
    expect(cut.bytes).toHaveLength(SPS.length + PPS.length + 8);
    const rest = buffer.read(cut.cursor, 1024)!;
    expect(Buffer.concat([cut.bytes, rest.bytes])).toEqual(
      Buffer.concat([SPS, PPS, idr(1, 2, 3, 4, 5, 6)]),
    );
    const end = buffer.end;
    buffer.endRun();
    expect(buffer.read(end, 1024)).toBeUndefined();
    buffer.append(Buffer.concat([SPS, PPS, idr(7)]));
    expect(buffer.read(end, 1024)).toMatchObject({ reset: true });
  });
});

it("derives the encoded size and prefers an override display size", () => {
  expect(deviceStreamVideoSize({ width: 1280, height: 2856 })).toEqual({
    width: 574,
    height: 1280,
  });
  expect(deviceStreamVideoSize({ width: 2560, height: 1600 })).toEqual({
    width: 1280,
    height: 800,
  });
  expect(deviceStreamVideoSize({ width: 721, height: 1281 })).toEqual({ width: 720, height: 1280 });
  expect(deviceStreamVideoSize({ width: 480, height: 800 })).toEqual({ width: 480, height: 800 });
  expect(parseDisplaySize("Physical size: 1280x2856\n")).toEqual({ width: 1280, height: 2856 });
  expect(parseDisplaySize("Physical size: 1440x3120\r\nOverride size: 1080x2340\r\n")).toEqual({
    width: 1080,
    height: 2340,
  });
  expect(() => parseDisplaySize("error: closed")).toThrow("Device display size is unavailable");
});

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;
  constructor(readonly args: string[]) {
    super();
  }
  kill() {
    this.killed = true;
    this.exit(null, "SIGTERM");
    return true;
  }
  exit(code: number | null, signal: string | null = null) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    queueMicrotask(() => this.emit("close", code, signal));
  }
  write(...parts: Buffer[]) {
    this.stdout.emit("data", Buffer.concat(parts));
  }
}

function fixture(
  overrides: Partial<DeviceStreamPorts> & { device?: Record<string, unknown> } = {},
  timing: ConstructorParameters<typeof DeviceStreams>[1] = {},
) {
  const children: FakeChild[] = [];
  const state = { booted: true, platform: "android", closed: false };
  const { device: _device, ...ports } = overrides;
  const streams = new DeviceStreams(
    {
      device: async (id) => ({
        id,
        name: "Pixel",
        platform: state.platform as "android" | "ios",
        version: "Android",
        booted: state.booted,
        physical: false,
      }),
      platform: () => "win32",
      adb: () => "adb",
      env: () => ({}),
      closed: () => state.closed,
      command: (async () => "Physical size: 1280x2856\n") as DeviceStreamPorts["command"],
      spawn: ((_command: string, args: string[]) => {
        const child = new FakeChild(args);
        children.push(child);
        return child as unknown as ChildProcess;
      }) as unknown as DeviceStreamPorts["spawn"],
      ...ports,
    },
    timing,
  );
  return { streams, children, state };
}
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

describe("DeviceStreams", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts one unlimited recorder and resets the first read at SPS", async () => {
    const f = fixture();
    const pending = f.streams.read("emulator-5554", undefined);
    await settle();
    expect(f.children).toHaveLength(1);
    expect(f.children[0].args).toEqual([
      "-s",
      "emulator-5554",
      "exec-out",
      "screenrecord",
      "--output-format=h264",
      "--size",
      "574x1280",
      "--bit-rate",
      "4M",
      "--time-limit",
      "0",
      "-",
    ]);
    f.children[0].write(SPS, PPS, idr(1));
    await settle(8);
    const first = await pending;
    expect(first).toMatchObject({ reset: true, width: 1280, height: 2856 });
    expect(bytes(first.base64)).toEqual(Buffer.concat([SPS, PPS, idr(1)]));
    // A second viewer joins the same recorder and also starts at SPS.
    const other = await f.streams.read("emulator-5554", undefined);
    expect(bytes(other.base64).subarray(0, SPS.length)).toEqual(SPS);
    expect(f.children).toHaveLength(1);
    await f.streams.stopAll();
  });

  it("continues by cursor and answers an idle second with an empty chunk", async () => {
    const f = fixture();
    const opening = f.streams.read("emulator-5554", undefined);
    await settle();
    f.children[0].write(SPS, PPS, idr(1));
    await settle(8);
    const { cursor } = await opening;
    let done = false;
    const waiting = f.streams.read("emulator-5554", cursor).then((chunk) => {
      done = true;
      return chunk;
    });
    await settle(999);
    expect(done).toBe(false);
    await settle(1);
    expect(await waiting).toEqual({ cursor, reset: false, base64: "", width: 1280, height: 2856 });
    const next = f.streams.read("emulator-5554", cursor);
    await settle(300);
    f.children[0].write(frame(2));
    await settle(8);
    const chunk = await next;
    expect(chunk.reset).toBe(false);
    expect(bytes(chunk.base64)).toEqual(frame(2));
    expect(chunk.cursor).toBe(cursor + frame(2).length);
    await f.streams.stopAll();
  });

  it("replies only after the pipe is quiet, within the settle cap", async () => {
    const f = fixture();
    const opening = f.streams.read("emulator-5554", undefined);
    await settle();
    f.children[0].write(SPS, PPS, idr(1));
    await settle(8);
    const { cursor } = await opening;
    let done = false;
    const burst = f.streams.read("emulator-5554", cursor).then((chunk) => {
      done = true;
      return chunk;
    });
    await settle(100);
    f.children[0].write(frame(2).subarray(0, 3));
    await settle(5);
    expect(done).toBe(false);
    f.children[0].write(frame(2).subarray(3));
    await settle(7);
    expect(done).toBe(false);
    await settle(1);
    expect(bytes((await burst).base64)).toEqual(frame(2));
    // Writes that never pause are still delivered 40 ms after the first new byte.
    const steady = f.streams.read("emulator-5554", (await burst).cursor).then((chunk) => {
      done = true;
      return chunk;
    });
    done = false;
    await settle(10);
    for (let index = 0; index < 8; index++) {
      f.children[0].write(frame(index));
      await settle(5);
    }
    expect(done).toBe(true);
    expect(bytes((await steady).base64)).toEqual(
      Buffer.concat([0, 1, 2, 3, 4, 5, 6, 7].map((n) => frame(n))),
    );
    await f.streams.stopAll();
  });

  it("returns a cap-sized chunk at once and the rest by cursor", async () => {
    const f = fixture();
    const opening = f.streams.read("emulator-5554", undefined);
    await settle();
    const big = Buffer.concat([idr(), Buffer.alloc(DEVICE_STREAM_MAX_CHUNK_BYTES, 7)]);
    f.children[0].write(SPS, PPS, big);
    await settle(8);
    const first = await opening;
    expect(bytes(first.base64)).toHaveLength(DEVICE_STREAM_MAX_CHUNK_BYTES);
    const rest = await f.streams.read("emulator-5554", first.cursor);
    expect(rest.reset).toBe(false);
    expect(Buffer.concat([bytes(first.base64), bytes(rest.base64)])).toEqual(
      Buffer.concat([SPS, PPS, big]),
    );
    await f.streams.stopAll();
  });

  it("resets a reader whose cursor fell behind a new key frame", async () => {
    const f = fixture();
    const opening = f.streams.read("emulator-5554", undefined);
    await settle();
    f.children[0].write(SPS, PPS, idr(1));
    await settle(8);
    const { cursor } = await opening;
    f.children[0].write(frame(2));
    f.children[0].write(idr(3), frame(4));
    await settle(8);
    const reset = await f.streams.read("emulator-5554", cursor);
    expect(reset.reset).toBe(true);
    expect(bytes(reset.base64)).toEqual(Buffer.concat([SPS, PPS, idr(3), frame(4)]));
    await f.streams.stopAll();
  });

  it("stops an unread recorder after five seconds", async () => {
    const f = fixture();
    const opening = f.streams.read("emulator-5554", undefined);
    await settle();
    f.children[0].write(SPS, PPS, idr(1));
    await settle(8);
    await opening;
    await settle(4000);
    expect(f.children[0].killed).toBe(false);
    await f.streams.read("emulator-5554", undefined);
    await settle(4999);
    expect(f.children[0].killed).toBe(false);
    await settle(1);
    expect(f.children[0].killed).toBe(true);
    expect(f.streams.active()).toEqual([]);
  });

  it("restarts the recorder when a group of pictures outgrows the buffer", async () => {
    const f = fixture({}, { maxBufferBytes: 64 });
    const opening = f.streams.read("emulator-5554", undefined);
    await settle();
    f.children[0].write(SPS, PPS, idr(1));
    await settle(8);
    const { cursor } = await opening;
    f.children[0].write(frame(), Buffer.alloc(80, 1));
    expect(f.children[0].killed).toBe(true);
    const pending = f.streams.read("emulator-5554", cursor);
    await settle();
    expect(f.children).toHaveLength(2);
    f.children[1].write(SPS, PPS, idr(9));
    await settle(8);
    const chunk = await pending;
    expect(chunk.reset).toBe(true);
    expect(bytes(chunk.base64)).toEqual(Buffer.concat([SPS, PPS, idr(9)]));
    await f.streams.stopAll();
  });

  it("retries without the time limit and reports three immediate failures as unsupported", async () => {
    const f = fixture();
    const failed = f.streams.read("emulator-5554", undefined).catch((error: Error) => error);
    for (let attempt = 0; attempt < 3; attempt++) {
      await settle(attempt ? 250 * attempt : 0);
      expect(f.children).toHaveLength(attempt + 1);
      f.children[attempt].stderr.emit("data", Buffer.from([0xff, ...Buffer.from("no encoder")]));
      f.children[attempt].exit(1);
    }
    await settle();
    const error = (await failed) as Error;
    expect(error.message).toBe("DEVICE_STREAM_UNSUPPORTED: �no encoder");
    expect(f.children[0].args).toContain("--time-limit");
    expect(f.children[1].args).not.toContain("--time-limit");
    // The failed recorder keeps refusing instead of spawning again.
    await expect(f.streams.read("emulator-5554", undefined)).rejects.toThrow(
      "DEVICE_STREAM_UNSUPPORTED:",
    );
    expect(f.children).toHaveLength(3);
    await f.streams.stopAll();
  });

  it("restarts after an exit and never continues the old stream", async () => {
    const f = fixture();
    const opening = f.streams.read("emulator-5554", undefined);
    await settle();
    f.children[0].write(SPS, PPS, idr(1));
    await settle(8);
    const { cursor } = await opening;
    f.children[0].exit(0);
    const pending = f.streams.read("emulator-5554", cursor);
    await settle(250);
    expect(f.children).toHaveLength(2);
    f.children[1].write(SPS, PPS, idr(2));
    await settle(8);
    const chunk = await pending;
    expect(chunk.reset).toBe(true);
    expect(bytes(chunk.base64)).toEqual(Buffer.concat([SPS, PPS, idr(2)]));
    await f.streams.stopAll();
  });

  it("refuses unsupported targets, unbooted devices and revoked authority", async () => {
    const ios = fixture();
    ios.state.platform = "ios";
    await expect(ios.streams.read("simulator", undefined)).rejects.toThrow(
      /^DEVICE_STREAM_UNSUPPORTED:/,
    );
    const linux = fixture({ platform: () => "linux" });
    await expect(linux.streams.read("emulator-5554", undefined)).rejects.toThrow(
      /^DEVICE_STREAM_UNSUPPORTED:/,
    );
    expect([...ios.children, ...linux.children]).toHaveLength(0);

    const f = fixture();
    await expect(
      f.streams.read("emulator-5554", undefined, { authorized: () => false }),
    ).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
    await expect(f.streams.read("emulator-5554", -1)).rejects.toThrow(
      "Invalid device stream cursor",
    );
    expect(f.children).toHaveLength(0);
    let allowed = true;
    const opening = f.streams
      .read("emulator-5554", undefined, { authorized: () => allowed })
      .catch((error: Error) => error);
    await settle();
    f.children[0].write(SPS, PPS, idr(1));
    allowed = false;
    await settle(8);
    expect(String(await opening)).toContain("DEVICE_AUTHORITY_REVOKED");

    // The booted check repeats while streaming and stops the recorder.
    f.state.booted = false;
    await settle(2000);
    await expect(f.streams.read("emulator-5554", undefined)).rejects.toThrow(
      "Boot the device before viewing",
    );
    expect(f.children[0].killed).toBe(true);
    expect(f.streams.active()).toEqual([]);
  });

  it("ends a waiting read and every recorder when the host stops", async () => {
    const f = fixture();
    const opening = f.streams.read("emulator-5554", undefined);
    await settle();
    await f.streams.stopAll();
    expect(f.children[0].killed).toBe(true);
    await settle();
    expect(await opening).toMatchObject({ cursor: 0, reset: true, base64: "" });
    f.state.closed = true;
    await expect(f.streams.read("emulator-5554", undefined)).rejects.toThrow(
      "Device host is disposed",
    );
  });
});
