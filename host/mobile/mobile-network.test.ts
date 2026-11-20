import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const { execFile, createSocket, networkInterfaces } = vi.hoisted(() => ({
  execFile: vi.fn(),
  createSocket: vi.fn(),
  networkInterfaces: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFile }));
vi.mock("node:dgram", () => ({ createSocket }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  networkInterfaces,
}));
const wifi = (address: string) => ({
  "Wi-Fi": [{ address, family: "IPv4", internal: false }],
  Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
});
beforeEach(() => {
  networkInterfaces.mockReturnValue(wifi("192.168.1.5"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.resetModules();
});

it.each([
  ['{"Ethernet":"Public"}\r\n', true],
  ['{"Ethernet":"Private"}\r\n', false],
  ["", false],
  ["invalid JSON", false],
  ['["Public"]', false],
  ['{"Ethernet":true}', false],
])("only hints for a Public interface with firewall enabled: %s", async (output, expected) => {
  execFile.mockImplementation((_file, _args, _options, callback) =>
    callback(null, Buffer.from(output)),
  );
  const { createWindowsNetworkHint } = await import("./mobile-network");
  const hint = createWindowsNetworkHint("win32");
  expect(Boolean(await hint("Ethernet"))).toBe(expected);
  expect(await hint("Other adapter")).toBeUndefined();
  expect(execFile).toHaveBeenCalledTimes(1);
  expect(execFile.mock.calls[0][2]).toMatchObject({
    windowsHide: true,
    timeout: 3000,
    maxBuffer: 65536,
    encoding: "buffer",
  });
  expect(execFile.mock.calls[0][1]).toContain("-NonInteractive");
  expect(execFile.mock.calls[0][1].at(-1)).toContain("Get-NetFirewallProfile -Name Public");
});

it("ignores and caches timeouts, command failures and unknown interfaces", async () => {
  execFile.mockImplementation((_file, _args, _options, callback) =>
    callback(new Error("timeout"), Buffer.alloc(0)),
  );
  const { createWindowsNetworkHint } = await import("./mobile-network");
  const hint = createWindowsNetworkHint("win32");
  expect(await hint()).toBeUndefined();
  expect(execFile).not.toHaveBeenCalled();
  expect(await hint("Ethernet")).toBeUndefined();
  expect(await hint("Ethernet")).toBeUndefined();
  expect(execFile).toHaveBeenCalledTimes(1);
});

// Regression: the adapter query is synchronous and status polls called it per address,
// blocking the Host event loop; PowerShell was restarted every 30 s.
it("shares one adapter snapshot and fingerprints only external IPv4 addresses", async () => {
  networkInterfaces.mockReturnValue(wifi("192.168.1.5"));
  const { currentNetworkInterfaces, networkFingerprint } = await import("./mobile-network");
  for (let index = 0; index < 20; index++) currentNetworkInterfaces();
  expect(networkInterfaces).toHaveBeenCalledTimes(1);
  expect(networkFingerprint()).toBe("Wi-Fi=192.168.1.5");
});

it("asks Windows for network profiles again only when the adapters change", async () => {
  execFile.mockImplementation((_file, _args, _options, callback) =>
    callback(null, Buffer.from('{"Wi-Fi":"Public"}')),
  );
  let network = "Wi-Fi=192.168.1.5";
  const { createWindowsNetworkHint } = await import("./mobile-network");
  const hint = createWindowsNetworkHint("win32", () => network);
  for (let index = 0; index < 5; index++) expect(await hint("Wi-Fi")).toBeDefined();
  expect(execFile).toHaveBeenCalledTimes(1);
  network = "Wi-Fi=10.0.0.7";
  await hint("Wi-Fi");
  expect(execFile).toHaveBeenCalledTimes(2);
});

it("rechecks a Public answer soon, so the hint clears after a switch to Private", async () => {
  vi.useFakeTimers();
  let category = "Public";
  execFile.mockImplementation((_file, _args, _options, callback) =>
    callback(null, Buffer.from(`{"Wi-Fi":"${category}"}`)),
  );
  const { createWindowsNetworkHint } = await import("./mobile-network");
  const hint = createWindowsNetworkHint("win32", () => "Wi-Fi=192.168.1.5");
  expect(await hint("Wi-Fi")).toBeDefined();
  category = "Private";
  await vi.advanceTimersByTimeAsync(31_000);
  expect(await hint("Wi-Fi")).toBeUndefined();
  expect(execFile).toHaveBeenCalledTimes(2);
  // A Private answer is kept for minutes: no PowerShell every 30 s.
  await vi.advanceTimersByTimeAsync(31_000);
  await hint("Wi-Fi");
  expect(execFile).toHaveBeenCalledTimes(2);
});

it("never queries Windows profiles on other platforms", async () => {
  const { createWindowsNetworkHint } = await import("./mobile-network");
  expect(await createWindowsNetworkHint("linux")("Ethernet")).toBeUndefined();
  expect(execFile).not.toHaveBeenCalled();
});

function socketFixture() {
  const socket = Object.assign(new EventEmitter(), {
    connect: vi.fn(),
    close: vi.fn(),
    address: () => ({ address: "192.168.2.108" }),
    send: vi.fn(),
  });
  createSocket.mockReturnValue(socket);
  return socket;
}

it("detects and caches the routed local address without sending traffic", async () => {
  const socket = socketFixture();
  socket.connect.mockImplementation((_port, _address, callback) => callback());
  const { defaultRouteAddress, knownDefaultRouteAddress } = await import("./mobile-network");
  expect(await defaultRouteAddress()).toBe("192.168.2.108");
  expect(knownDefaultRouteAddress()).toBe("192.168.2.108");
  expect(socket.connect).toHaveBeenCalledWith(53, "1.1.1.1", expect.any(Function));
  expect(socket.send).not.toHaveBeenCalled();
  expect(socket.close).toHaveBeenCalledTimes(1);
  expect(createSocket).toHaveBeenCalledTimes(1);
});

it.each(["timeout", "error", "throw"])(
  "closes the UDP probe after %s and tolerates late events",
  async (failure) => {
    vi.useFakeTimers();
    const socket = socketFixture();
    if (failure === "throw")
      socket.connect.mockImplementation(() => {
        throw new Error("offline");
      });
    const { defaultRouteAddress } = await import("./mobile-network");
    const result = defaultRouteAddress();
    if (failure === "error") socket.emit("error", new Error("offline"));
    if (failure === "timeout") await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBeUndefined();
    socket.emit("error", new Error("late"));
    expect(socket.close).toHaveBeenCalledTimes(1);
  },
);
