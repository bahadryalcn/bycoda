import { expect, it } from "vitest";
import {
  DEVICE_LIFECYCLE_METHODS,
  DEVICE_LIFECYCLE_RPC_SCHEMAS,
  MOBILE_DEVICE_PREVIEW_METHODS,
  MOBILE_DEVICE_PREVIEW_RPC_SCHEMAS,
  NATIVE_DEVICE_METHODS,
} from "./native-devices";
import { exportWireSchema, getHostRpcMethod, hostRpcHasEffect } from "./index";

it("keeps lifecycle and mobile preview lists separate from the exact Native helper nine", () => {
  expect(NATIVE_DEVICE_METHODS).toHaveLength(9);
  expect(DEVICE_LIFECYCLE_METHODS).toEqual(["devices.setup", "devices.stop"]);
  expect(MOBILE_DEVICE_PREVIEW_METHODS).toEqual([
    "devices.preview.mobile.start",
    "devices.preview.mobile.status",
    "devices.preview.impact",
  ]);
  for (const method of [...DEVICE_LIFECYCLE_METHODS, ...MOBILE_DEVICE_PREVIEW_METHODS]) {
    const definition = getHostRpcMethod(method)!;
    const effect =
      method === "devices.setup" ||
      method === "devices.stop" ||
      method === "devices.preview.mobile.start";
    expect(hostRpcHasEffect(method, definition.kind)).toBe(effect);
    expect(definition.scope).toBe("device");
    expect(definition.retry).toBe(effect ? "never" : "safe-query");
    expect(definition.cancellation).toBe(effect ? "wait-only" : "query");
    expect(definition.requiredCapability).toBe(
      method.includes("preview")
        ? "transport.ws.devices.preview.mobile.v1"
        : "transport.ws.devices.v1",
    );
    expect(exportWireSchema(definition.paramsSchema)).toBeTruthy();
    expect(exportWireSchema(definition.resultSchema)).toBeTruthy();
  }
  expect(getHostRpcMethod("devices.setup")!.responseTimeoutMs).toBe(1230000);
  expect(getHostRpcMethod("devices.stop")!.responseTimeoutMs).toBe(30000);
});
it("requires explicit setup agent consent and exact mobile project/status intent", () => {
  const setup = DEVICE_LIFECYCLE_RPC_SCHEMAS["devices.setup"].params;
  expect(setup.safeParse({}).success).toBe(false);
  expect(setup.parse({ agentAccess: false }).agentAccess).toBe(false);
  const start = MOBILE_DEVICE_PREVIEW_RPC_SCHEMAS["devices.preview.mobile.start"].params;
  expect(
    start.safeParse({ requestId: "request", deviceId: "phone", url: "exp://localhost:8081" })
      .success,
  ).toBe(false);
  expect(
    start.parse({
      projectId: "project",
      requestId: "request",
      deviceId: "phone",
      url: "exp://localhost:8081",
      installExpoGo: false,
    }).installExpoGo,
  ).toBe(false);
  const status = MOBILE_DEVICE_PREVIEW_RPC_SCHEMAS["devices.preview.mobile.status"].params;
  expect(status.safeParse({ projectId: "project" }).success).toBe(false);
  expect(
    status.safeParse({
      projectId: "project",
      requestId: "request",
      id: "preview",
      includeFrame: true,
    }).success,
  ).toBe(true);
  expect(
    status.safeParse({ projectId: "project", requestId: "request", owner: "forged" }).success,
  ).toBe(false);
});
