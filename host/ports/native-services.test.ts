import { expect, it, vi } from "vitest";
import { bindNativeServicesOwner, type NativeServicesAdapters } from "./native-services";
function fixture() {
  let authorized = true;
  const request = vi.fn(async () => ({
    status: {
      enabled: true,
      active: true,
      stopped: false,
      currentAction: { app: "Allowed app", action: "click" },
      installed: true,
      verified: true,
      upstreamRef: "private-path",
      protocol: "private-protocol",
    },
    configuration: { binary: "private-binary", allowedApps: ["private-config"] },
    snapshot: { treeJson: "private-app-content" },
  }));
  const adapters = {
    store: {
      db: {
        withAuthorization: async (_guard: unknown, action: () => Promise<unknown>) => action(),
      },
    },
    desktopControl: {
      request,
      indicatorStatus: async (...args: unknown[]) =>
        (await Reflect.apply(request, undefined, args)).status,
    },
    assistantName: async () => "Owner's chosen name",
  } as unknown as NativeServicesAdapters;
  return {
    request,
    port: bindNativeServicesOwner(adapters, "captured-device-hash", async () => authorized),
    revoke: () => {
      authorized = false;
    },
  };
}
it("returns only finite desktop status metadata using the captured device owner", async () => {
  const f = fixture();
  expect(await f.port.desktopStatus!()).toEqual({
    enabled: true,
    active: true,
    stopped: false,
    currentAction: { app: "Allowed app", action: "click" },
    assistantName: "Owner's chosen name",
  });
  expect(f.request.mock.calls[0]).toMatchObject([
    { kind: "owner", id: "captured-device-hash" },
    expect.any(Function),
  ]);
});
it("rejects status when the actual device is revoked while its read is pending", async () => {
  const f = fixture();
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async () => {
    const result = await original();
    f.revoke();
    return result;
  });
  await expect(f.port.desktopStatus!()).rejects.toThrow();
});
