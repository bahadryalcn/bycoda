import { expect, it, vi } from "vitest";
import { DevicePreviews, PREVIEW_RETENTION_TTL_MS } from "./device-preview";
import type { DeviceHost } from "./device-host";

/** A device host whose previews succeed at once, over an injected monotonic clock. */
function fixture(historyLimit?: number) {
  let now = 10_000;
  const host = {
    preflight: vi.fn().mockResolvedValue({
      device: { id: "sim", name: "Pixel", platform: "android", booted: true },
      checks: { sdk: true, tools: true, agentControl: true },
    }),
    status: vi.fn().mockResolvedValue({ running: true }),
    start: vi.fn(),
    boot: vi.fn(),
    prepareExpo: vi.fn().mockResolvedValue({ app: "host.exp.Exponent" }),
    openExpo: vi.fn().mockResolvedValue(undefined),
    action: vi.fn().mockResolvedValue('{"success":true}'),
    capture: vi
      .fn()
      .mockResolvedValue({ mime: "image/png", base64: "aW1hZ2U=", capturedAt: "now" }),
  };
  const previews = new DevicePreviews(
    host as unknown as DeviceHost,
    vi.fn().mockResolvedValue({ sdkVersion: "57.0.0" }),
    undefined,
    { now: () => now, historyLimit },
  );
  const input = (requestId: string) => ({
    requestId,
    deviceId: "sim",
    url: "exp://127.0.0.1:8081",
  });
  const run = async (requestId: string) => {
    const job = previews.start(input(requestId), "owner");
    await vi.waitFor(() => expect(previews.status(job.id, "owner").state).toBe("ready"));
    return job.id;
  };
  return {
    host,
    previews,
    input,
    run,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it("returns the finished outcome for a repeated requestId inside the TTL and retires it after", async () => {
  const f = fixture();
  const id = await f.run("request-a");
  f.advance(PREVIEW_RETENTION_TTL_MS - 1);
  expect(f.previews.start(f.input("request-a"), "owner").id).toBe(id);
  expect(f.previews.status(id, "owner", true)).toHaveProperty("frame");
  expect(f.host.openExpo).toHaveBeenCalledTimes(1);
  const authority = f.previews.resultAuthority(id, "owner");
  f.advance(1);
  // Past the TTL the outcome, its frame and its authority are retired together.
  const next = f.previews.start(f.input("request-a"), "owner");
  expect(next.id).not.toBe(id);
  expect(() => f.previews.status(id, "owner")).toThrow("PREVIEW_NOT_FOUND");
  expect(await authority()).toBe(false);
  await vi.waitFor(() => expect(f.previews.status(next.id, "owner").state).toBe("ready"));
  expect(f.host.openExpo).toHaveBeenCalledTimes(2);
});

it("evicts the least recently read finished preview when the history is full", async () => {
  const f = fixture(3);
  const first = await f.run("request-1");
  f.advance(1);
  const second = await f.run("request-2");
  f.advance(1);
  const third = await f.run("request-3");
  f.advance(1);
  f.previews.status(first, "owner"); // The oldest job becomes the most recently read.
  f.advance(1);
  const fourth = await f.run("request-4");
  expect(() => f.previews.status(second, "owner")).toThrow("PREVIEW_NOT_FOUND");
  for (const id of [first, third, fourth])
    expect(f.previews.status(id, "owner").state).toBe("ready");
  expect(f.previews.start(f.input("request-1"), "owner").id).toBe(first);
});

it("never evicts an active preview to make room", async () => {
  const f = fixture(1);
  let release!: () => void;
  const held = new Promise<void>((ready) => {
    release = ready;
  });
  const active = f.previews.start(f.input("request-active"), "owner", async () => {
    await held;
    return true;
  });
  f.advance(PREVIEW_RETENTION_TTL_MS * 2);
  expect(() => f.previews.start(f.input("request-next"), "owner")).toThrow("PREVIEW_BUSY");
  expect(f.previews.status(active.id, "owner").state).toBe("running");
  release();
  await vi.waitFor(() => expect(f.previews.status(active.id, "owner").state).toBe("ready"));
});
