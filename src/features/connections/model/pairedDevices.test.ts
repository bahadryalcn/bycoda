import { beforeEach, expect, it, vi } from "vitest";
import type { RemoteMachine } from "./protocol";

const remote = vi.hoisted(() => ({
  loadRemoteCapabilities: vi.fn<(environmentId: string) => Promise<string[] | undefined>>(),
  remoteRequest: vi.fn(),
}));
vi.mock("./connections", () => remote);

const { loadPairedDevices, readPairedDevices, revokePairedDevice } =
  await import("./pairedDevices");

const machine: RemoteMachine = {
  id: "m",
  name: "Mac",
  endpoint: "http://127.0.0.1:1",
  environmentId: "env",
};

beforeEach(() => {
  remote.loadRemoteCapabilities.mockReset();
  remote.remoteRequest.mockReset();
});

it("keeps valid metadata, drops malformed fields and sorts this desktop then recent use", () => {
  const read = readPairedDevices({
    devices: [
      { id: "old", name: "Old phone", isCurrent: false, kind: "phone", lastSeenAt: 10 },
      { id: "me", name: "Desktop", isCurrent: true, kind: "tablet", pairedAt: -1 },
      { id: "new", name: "New phone", isCurrent: false, pairedAt: 50 },
    ],
    devicesTruncated: true,
  });
  expect(read.truncated).toBe(true);
  expect(read.devices.map((device) => device.id)).toEqual(["me", "new", "old"]);
  expect(read.devices[0]).toEqual({ id: "me", name: "Desktop", isCurrent: true });
  expect(read.devices[2]).toEqual({
    id: "old",
    name: "Old phone",
    isCurrent: false,
    kind: "phone",
    lastSeenAt: 10,
  });
});

it("rejects rows without identity and duplicate ids", () => {
  expect(() => readPairedDevices({ devices: [{ id: "", name: "x", isCurrent: false }] })).toThrow();
  expect(() =>
    readPairedDevices({
      devices: [
        { id: "a", name: "x", isCurrent: false },
        { id: "a", name: "y", isCurrent: false },
      ],
    }),
  ).toThrow();
  expect(() => readPairedDevices(null)).toThrow();
});

it("prefers devices.paired, falls back to host.access.read and reports older hosts", async () => {
  remote.remoteRequest.mockResolvedValue({ devices: [], devicesTruncated: false });
  remote.loadRemoteCapabilities.mockResolvedValue(["devices.paired", "host.access.read"]);
  await loadPairedDevices(machine);
  expect(remote.remoteRequest).toHaveBeenLastCalledWith("m", "devices.paired");
  remote.loadRemoteCapabilities.mockResolvedValue(["host.access.read"]);
  await loadPairedDevices(machine);
  expect(remote.remoteRequest).toHaveBeenLastCalledWith("m", "host.access.read");
  remote.loadRemoteCapabilities.mockResolvedValue([]);
  expect(await loadPairedDevices(machine)).toEqual({ state: "unsupported" });
});

it("revokes only other devices and treats an already removed one as an error", async () => {
  await expect(
    revokePairedDevice(machine, { id: "me", name: "Desktop", isCurrent: true }),
  ).rejects.toThrow();
  remote.remoteRequest.mockResolvedValue({ revoked: true });
  await revokePairedDevice(machine, { id: "p", name: "Phone", isCurrent: false });
  expect(remote.remoteRequest).toHaveBeenCalledWith(
    "m",
    "devices.revokeOther",
    { id: "p" },
    false,
    true,
  );
  remote.remoteRequest.mockResolvedValue({ revoked: false });
  await expect(
    revokePairedDevice(machine, { id: "p", name: "Phone", isCurrent: false }),
  ).rejects.toThrow("already removed");
});
