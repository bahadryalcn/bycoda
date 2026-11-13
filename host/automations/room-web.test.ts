import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { readRoomWeb, roomWebPublicAddress, roomWebUrl } from "./room-web";

beforeEach(() => vi.resetAllMocks());

it.each([
  "127.0.0.1",
  "10.2.3.4",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.0.1",
  "100.64.0.1",
  "0.0.0.0",
  "::1",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
  "fc00::1",
  "fe80::1",
  "fec0::1",
  "64:ff9b::a00:1",
  "2002:7f00:1::",
  "2001:db8::1",
  "224.0.0.1",
])("blocks reserved address %s", (address) => {
  expect(roomWebPublicAddress(address)).toBe(false);
});
it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("accepts public address %s", (address) => {
  expect(roomWebPublicAddress(address)).toBe(true);
});
it.each(["http://example.com", "https://user:password@example.com", "https://example.com:8443"])(
  "rejects unsafe URL %s",
  (value) => {
    expect(() => roomWebUrl(value)).toThrow("public HTTPS");
  },
);
it("rejects mixed public/private DNS before opening a socket", async () => {
  mocks.lookup.mockResolvedValue([
    { address: "1.1.1.1", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  await expect(readRoomWeb("https://example.com")).rejects.toThrow("private or reserved");
  expect(mocks.request).not.toHaveBeenCalled();
});

it("a cancelled occurrence opens no DNS query or socket", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Owner stopped"));
  await expect(
    readRoomWeb("https://example.com", async () => true, controller.signal),
  ).rejects.toThrow("Owner stopped");
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("cancels an in-flight pinned HTTPS read with the exact occurrence signal", async () => {
  const controller = new AbortController();
  mocks.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  let signal: AbortSignal | undefined;
  mocks.request.mockImplementation((_url, options) => {
    signal = options.signal;
    const request = Object.assign(new EventEmitter(), { end: vi.fn() });
    options.signal.addEventListener("abort", () => request.emit("error", options.signal.reason), {
      once: true,
    });
    return request;
  });
  const pending = readRoomWeb("https://example.com", async () => true, controller.signal);
  await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
  controller.abort(new Error("Owner stopped"));
  await expect(pending).rejects.toThrow("Owner stopped");
  expect(signal?.aborted).toBe(true);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

function response(statusCode: number, headers: Record<string, string>, text = "page") {
  mocks.request.mockImplementationOnce((_url, options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () => {
      const res = Object.assign(new EventEmitter(), { statusCode, headers, destroy: vi.fn() });
      callback(res);
      res.emit("data", Buffer.from(text));
      res.emit("end");
    };
    expect(options.agent).toBe(false);
    expect(options.family).toBe(4);
    options.lookup("example.com", {}, (error: Error | null, address: string, family: number) => {
      expect(error).toBeNull();
      expect(address).toBe("1.1.1.1");
      expect(family).toBe(4);
    });
    return req;
  });
}
it("pins validated DNS and bounds readable output", async () => {
  mocks.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  response(200, { "content-type": "text/plain" }, "x".repeat(20000));
  const page = await readRoomWeb("https://example.com");
  expect(page.url).toBe("https://example.com/");
  expect(page.text.length).toBeLessThanOrEqual(12000);
});
it("revalidates redirect DNS and rejects private destination", async () => {
  mocks.lookup
    .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
    .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
  response(302, { location: "https://private.example" });
  await expect(readRoomWeb("https://example.com")).rejects.toThrow("private or reserved");
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
