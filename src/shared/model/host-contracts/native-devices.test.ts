import { expect, it } from "vitest";
import { exportWireSchema } from "./index";
import { getHostRpcMethod, hostRpcHasEffect, nativeDesktopMethod } from "./index";
import {
  DeviceFrameSchema,
  DeviceActionSchema,
  NATIVE_DEVICE_METHODS,
  NATIVE_DEVICES_RPC_SCHEMAS,
  nativeDeviceReadOnly,
} from "./native-devices";

it("declares paired-device methods with bounded waits and no private alias", () => {
  expect(NATIVE_DEVICE_METHODS).toHaveLength(14);
  for (const method of NATIVE_DEVICE_METHODS) {
    const definition = getHostRpcMethod(method)!;
    expect(definition.scope).toBe("device");
    expect(definition.requiredCapability).toBe("transport.ws.devices.v1");
    expect(definition.cancellation).toBe(nativeDeviceReadOnly(method) ? "query" : "wait-only");
    expect(hostRpcHasEffect(method, definition.kind)).toBe(!nativeDeviceReadOnly(method));
    expect(nativeDesktopMethod(method)).toBe(false);
    expect(getHostRpcMethod("native." + method)).toBeUndefined();
    expect(exportWireSchema(NATIVE_DEVICES_RPC_SCHEMAS[method].params)).toBeTruthy();
    expect(exportWireSchema(NATIVE_DEVICES_RPC_SCHEMAS[method].result)).toBeTruthy();
  }
  expect(getHostRpcMethod("devices.start")!.responseTimeoutMs).toBe(60000);
  expect(getHostRpcMethod("devices.boot")!.responseTimeoutMs).toBe(240000);
  expect(getHostRpcMethod("devices.action")!.responseTimeoutMs).toBe(180000);
  expect(getHostRpcMethod("devices.capture")!.retry).toBe("never");
});
it("keeps finite request variants and full four-MiB owner images", () => {
  expect(
    DeviceFrameSchema.safeParse({
      mime: "image/png",
      capturedAt: "now",
      base64: "a".repeat(Math.ceil((4 * 1024 * 1024) / 3) * 4),
    }).success,
  ).toBe(true);
  expect(DeviceActionSchema.safeParse({ type: "press", x: -1, y: 1 }).success).toBe(false);
  expect(
    DeviceActionSchema.safeParse({ type: "waitForText", text: "Ready", timeoutMs: 120001 }).success,
  ).toBe(false);
  expect(DeviceActionSchema.safeParse({ type: "shell", command: "id" }).success).toBe(false);
  expect(
    NATIVE_DEVICES_RPC_SCHEMAS["devices.capture"].params.safeParse({
      deviceId: "phone",
      owner: "forged",
    }).success,
  ).toBe(false);
  expect(
    NATIVE_DEVICES_RPC_SCHEMAS["devices.preview"].params.safeParse({
      requestId: "id",
      deviceId: "phone",
      url: "exp://localhost:8081",
      previewOwner: "e".repeat(200) + ":" + "s".repeat(200),
    }).success,
  ).toBe(true);
});
