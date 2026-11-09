import { expect, it, vi } from "vitest";
import { createNativeDevicesService } from "./service";
import { HostDomainAuthorizationError, HostDomainOutcomeError } from "../context";

it("requires the captured owner capability and live request authority before effects", async () => {
  const service = createNativeDevicesService(),
    call = vi.fn();
  await expect(
    service.call("devices.list", {}, { authorized: async () => true }),
  ).rejects.toBeInstanceOf(HostDomainAuthorizationError);
  await expect(
    service.call(
      "devices.capture",
      { deviceId: "phone" },
      { nativeDevices: { call }, authorized: async () => false },
    ),
  ).rejects.toBeInstanceOf(HostDomainAuthorizationError);
  expect(call).not.toHaveBeenCalled();
});

it.each([false, true])(
  "reports only actual Device queue admission as unknown (admitted=%s)",
  async (admitted) => {
    const service = createNativeDevicesService();
    const context = {
      authorized: async () => true,
      nativeDevices: {
        call: async (_method: unknown, _params: unknown, _retain: unknown, mark?: () => void) => {
          if (admitted) mark?.();
          throw new Error(admitted ? "Device authority revoked" : "PREVIEW_BUSY");
        },
      },
    };
    await expect(service.call("devices.stop", {}, context)).rejects.toMatchObject({
      delivery: admitted ? "unknown" : "not-sent",
    });
    const read = await service.call("devices.list", {}, context).catch((error: unknown) => error);
    expect(read).not.toBeInstanceOf(HostDomainOutcomeError);
  },
);
it("validates finite canonical params before invoking the actual owner and retains original guards", async () => {
  const service = createNativeDevicesService(),
    original = async () => true,
    retain = vi.fn(),
    call = vi.fn(async (_method, _params, save) => {
      save(original);
      return "done";
    });
  const context = {
    authorized: async () => true,
    nativeDevices: { call },
    retainResultAuthority: retain,
  };
  await expect(
    service.call(
      "devices.action",
      { deviceId: "phone", leaseId: "lease", requestId: "request", action: { type: "shell" } },
      context,
    ),
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
  expect(
    await service.call(
      "devices.action",
      { deviceId: "phone", leaseId: "lease", requestId: "request", action: { type: "home" } },
      context,
    ),
  ).toBe("done");
  expect(retain).toHaveBeenCalledExactlyOnceWith(original);
});
