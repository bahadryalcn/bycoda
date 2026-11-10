import { expect, it } from "vitest";
import { exportWireSchema } from "./index";
import { getHostRpcMethod, hostRpcHasEffect, nativeDesktopMethod } from "./index";
import {
  DEVICE_STREAM_MAX_CHUNK_BYTES,
  DeviceFrameSchema,
  DeviceActionSchema,
  NATIVE_DEVICE_METHODS,
  NATIVE_DEVICES_RPC_SCHEMAS,
  nativeDeviceReadOnly,
} from "./native-devices";

it("declares paired-device methods with bounded waits and no private alias", () => {
  expect(NATIVE_DEVICE_METHODS).toHaveLength(15);
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
  expect(getHostRpcMethod("devices.stream")!.retry).toBe("never");
  expect(getHostRpcMethod("devices.stream")!.kind).toBe(getHostRpcMethod("devices.capture")!.kind);
});
it("accepts only a device, an optional project and a non-negative cursor for the live stream", () => {
  const { params, result } = NATIVE_DEVICES_RPC_SCHEMAS["devices.stream"];
  expect(params.safeParse({ deviceId: "phone" }).success).toBe(true);
  expect(params.safeParse({ projectId: "p", deviceId: "phone", cursor: 0 }).success).toBe(true);
  for (const cursor of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "7"])
    expect(params.safeParse({ deviceId: "phone", cursor }).success).toBe(false);
  expect(params.safeParse({ cursor: 1 }).success).toBe(false);
  expect(params.safeParse({ deviceId: "phone", leaseId: "forged" }).success).toBe(false);
  const chunk = { cursor: 9, reset: true, base64: "", width: 1280, height: 2856 };
  expect(result.safeParse(chunk).success).toBe(true);
  expect(result.safeParse({ ...chunk, mime: "video/h264" }).success).toBe(false);
  expect(result.safeParse({ ...chunk, width: -1 }).success).toBe(false);
  expect(DEVICE_STREAM_MAX_CHUNK_BYTES).toBe(1024 * 1024);
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
