// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncHostDeviceAccess: vi.fn(),
  disableHostDeviceAccess: vi.fn(),
  remoteRequest: vi.fn(),
}));
vi.mock("../../account", () => ({ accountApi: () => mocks }));
vi.mock("./connections", () => ({ remoteRequest: mocks.remoteRequest }));

import { accountDeviceAccess, startAccountDeviceAccess } from "./accountDeviceAccess";

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("acknowledges recovery only after the expected local Host applies it", async () => {
  vi.useFakeTimers();
  const accountDeviceId = "account-desktop";
  const pairedId = "10434b8c-fdc7-43b2-ac17-e9acb74454f4";
  const requestId = "117d5451-bdb6-4626-84fa-7d3094f10423";
  const change = { deviceId: pairedId, requestId, management: null };
  const local = {
    id: "local",
    name: "Local desktop",
    isLocalDesktop: true,
    isCurrent: true,
    canManageDevices: true,
  };
  const paired = { id: pairedId, name: "Lost phone", isCurrent: false, canManageDevices: false };
  const machine = {
    id: "connection",
    environmentId: "host",
    name: "Studio",
    endpoint: "http://127.0.0.1:1",
  };
  mocks.remoteRequest.mockImplementation(async (_id, method) => {
    if (method === "environment.describe")
      return { name: "Studio", capabilities: ["devices.applyRecovery"] };
    if (method === "devices.applyRecovery") return { applied: true };
    return {
      devices: [
        local,
        ...(mocks.remoteRequest.mock.calls.some((call) => call[1] === "devices.applyRecovery")
          ? []
          : [paired]),
      ],
    };
  });
  mocks.syncHostDeviceAccess
    .mockResolvedValueOnce({ pending: [change] })
    .mockResolvedValue({ pending: [] });
  accountDeviceAccess.save(accountDeviceId);
  const onError = vi.fn();
  const stop = startAccountDeviceAccess(accountDeviceId, async () => machine, onError);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.syncHostDeviceAccess).toHaveBeenNthCalledWith(1, {
      params: { id: accountDeviceId },
      body: {
        environmentId: "host",
        name: "Studio",
        applied: [],
        devices: [{ id: pairedId, name: "Lost phone", canManageDevices: false }],
      },
    });
    expect(mocks.remoteRequest).toHaveBeenCalledWith(
      "connection",
      "devices.applyRecovery",
      change,
      false,
      true,
      "host",
    );
    expect(mocks.syncHostDeviceAccess).toHaveBeenNthCalledWith(2, {
      params: { id: accountDeviceId },
      body: { environmentId: "host", name: "Studio", devices: [], applied: [requestId] },
    });
    expect(onError).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});
