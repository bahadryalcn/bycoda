import { z } from "zod";
import { SafeCounterSchema } from "./schemas";

export const DevicePlatformSchema = z.enum(["ios", "android"]);
export const DeviceSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  platform: DevicePlatformSchema,
  version: z.string(),
  booted: z.boolean(),
  physical: z.boolean(),
});
export const DeviceHostStatusSchema = z.strictObject({
  running: z.boolean(),
  installed: z.boolean(),
  agentInstalled: z.boolean(),
  platform: z.string(),
  controlProtocol: z.literal(1).optional(),
  platforms: z.array(
    z.strictObject({
      platform: DevicePlatformSchema,
      available: z.boolean(),
      reason: z.string().optional(),
    }),
  ),
  lastError: z.string().optional(),
});
// Actual owner binary bounds (4MiB) and base64 validity are execution checks.
// Do not truncate frames or invent a 1MiB DTO cap to fit the socket envelope.
export const DeviceFrameSchema = z.strictObject({
  mime: z.enum(["image/png", "image/jpeg"]),
  base64: z.string(),
  capturedAt: z.string(),
});
const coordinate = SafeCounterSchema.max(20000);
export const DeviceActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("openApp"), app: z.string() }),
  z.strictObject({ type: z.literal("press"), x: coordinate, y: coordinate }),
  z.strictObject({ type: z.literal("type"), text: z.string() }),
  z.strictObject({
    type: z.literal("swipe"),
    x: coordinate,
    y: coordinate,
    endX: coordinate,
    endY: coordinate,
  }),
  z.strictObject({ type: z.literal("home") }),
  z.strictObject({ type: z.literal("snapshot") }),
  z.strictObject({ type: z.literal("pressElement"), label: z.string() }),
  z.strictObject({ type: z.literal("pressNode"), inspectionId: z.string(), nodeId: z.string() }),
  z.strictObject({
    type: z.literal("waitForText"),
    text: z.string(),
    timeoutMs: SafeCounterSchema.min(1).max(120000).optional(),
  }),
]);
export const DevicePreviewInputSchema = z.strictObject({
  requestId: z.string(),
  deviceId: z.string(),
  url: z.string(),
  installExpoGo: z.boolean().optional(),
  expectedText: z.string().optional(),
});
export const DevicePreviewStageSchema = z.strictObject({
  name: z.string(),
  state: z.enum(["running", "done", "blocked"]),
  code: z.string().optional(),
  message: z.string().optional(),
});
export const DevicePreviewSnapshotSchema = z.strictObject({
  id: z.string(),
  requestId: z.string(),
  deviceId: z.string(),
  state: z.enum(["queued", "running", "ready", "blocked"]),
  stages: z.array(DevicePreviewStageSchema),
  verification: z.enum(["launch-only", "expected-text"]),
  updatedAt: z.string(),
  deviceName: z.string().optional(),
  frame: DeviceFrameSchema.optional(),
});
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;
export type DeviceSummary = z.infer<typeof DeviceSummarySchema>;
export type DeviceHostStatus = z.infer<typeof DeviceHostStatusSchema>;
export type DeviceFrame = z.infer<typeof DeviceFrameSchema>;
export type DeviceAction = z.infer<typeof DeviceActionSchema>;
export type DevicePreviewInput = z.infer<typeof DevicePreviewInputSchema>;
export type DevicePreviewStage = z.infer<typeof DevicePreviewStageSchema>;
export type DevicePreviewSnapshot = z.infer<typeof DevicePreviewSnapshotSchema>;

const base = { projectId: z.string().optional() };
// These hints select continuity/deadline intent only. Actual authority is the
// original paired-principal/environment captured by the trusted owner port.
const previewMetadata = {
  previewOwner: z.string().optional(),
  previewExpiresAt: SafeCounterSchema.optional(),
};
const list = z.strictObject({ devices: z.array(DeviceSummarySchema), errors: z.array(z.string()) });
export const NativeDevicePreflightSchema = list.extend({
  status: DeviceHostStatusSchema,
  device: DeviceSummarySchema.optional(),
  checks: z.strictObject({
    sdk: z.boolean(),
    device: z.boolean(),
    tools: z.boolean(),
    agentControl: z.boolean(),
  }),
});
export const NATIVE_DEVICES_RPC_SCHEMAS = {
  "devices.status": { params: z.strictObject(base), result: DeviceHostStatusSchema },
  "devices.preflight": {
    params: z.strictObject({ ...base, deviceId: z.string().optional() }),
    result: NativeDevicePreflightSchema,
  },
  "devices.preview": {
    params: DevicePreviewInputSchema.extend({ ...base, ...previewMetadata }),
    result: DevicePreviewSnapshotSchema,
  },
  "devices.preview.status": {
    params: z.strictObject({
      ...base,
      ...previewMetadata,
      id: z.string(),
      includeFrame: z.boolean().optional(),
    }),
    result: DevicePreviewSnapshotSchema,
  },
  "devices.list": { params: z.strictObject(base), result: list },
  "devices.start": { params: z.strictObject(base), result: DeviceHostStatusSchema },
  "devices.boot": {
    params: z.strictObject({ ...base, deviceId: z.string() }),
    result: DeviceSummarySchema,
  },
  "devices.capture": {
    params: z.strictObject({ ...base, deviceId: z.string() }),
    result: DeviceFrameSchema,
  },
  "devices.control.status": {
    params: z.strictObject({ ...base, deviceId: z.string() }),
    result: z.strictObject({ deviceId: z.string(), busy: z.boolean() }),
  },
  "devices.control.claim": {
    params: z.strictObject({ ...base, deviceId: z.string(), requestId: z.string() }),
    result: z.strictObject({
      deviceId: z.string(),
      leaseId: z.string(),
      expiresAt: SafeCounterSchema,
    }),
  },
  "devices.control.release": {
    params: z.strictObject({ ...base, deviceId: z.string(), leaseId: z.string() }),
    result: z.strictObject({ released: z.literal(true) }),
  },
  "devices.control.renew": {
    params: z.strictObject({ ...base, deviceId: z.string(), leaseId: z.string() }),
    result: z.strictObject({
      deviceId: z.string(),
      leaseId: z.string(),
      expiresAt: SafeCounterSchema,
    }),
  },
  "devices.inspect": {
    params: z.strictObject({ ...base, deviceId: z.string(), leaseId: z.string() }),
    result: z.strictObject({
      deviceId: z.string(),
      inspectionId: z.string(),
      raw: z.string(),
      inspectedAt: z.string(),
      frame: DeviceFrameSchema,
      coordinateSpace: z.enum(["pixels", "points"]),
      viewport: z.strictObject({ width: SafeCounterSchema, height: SafeCounterSchema }).optional(),
      nodes: z.array(
        z.strictObject({
          id: z.string(),
          label: z.string(),
          role: z.string(),
          identity: z.string(),
          bounds: z.strictObject({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
          }),
          enabled: z.boolean(),
          clickable: z.boolean(),
        }),
      ),
    }),
  },
  "devices.action": {
    params: z.strictObject({
      ...base,
      deviceId: z.string(),
      leaseId: z.string(),
      requestId: z.string(),
      action: DeviceActionSchema,
    }),
    result: z.string(),
  },
} as const;
export type NativeDeviceMethod = keyof typeof NATIVE_DEVICES_RPC_SCHEMAS;
export const NATIVE_DEVICE_METHODS = Object.freeze(
  Object.keys(NATIVE_DEVICES_RPC_SCHEMAS) as NativeDeviceMethod[],
);
export function nativeDeviceReadOnly(method: NativeDeviceMethod): boolean {
  return (
    method === "devices.status" ||
    method === "devices.list" ||
    method === "devices.preflight" ||
    method === "devices.control.status" ||
    method === "devices.inspect" ||
    method === "devices.preview.status"
  );
}

/** Original paired-owner lifecycle methods; never part of Native helper Device9 scope. */
export const DEVICE_LIFECYCLE_RPC_SCHEMAS = {
  "devices.setup": {
    params: z.strictObject({ ...base, agentAccess: z.boolean() }),
    result: DeviceHostStatusSchema,
  },
  "devices.stop": { params: z.strictObject(base), result: DeviceHostStatusSchema },
} as const;
const mobileScope = { projectId: z.string() };
const mobileIdentity = {
  id: z.string(),
  requestId: z.string().optional(),
  includeFrame: z.boolean().optional(),
};
export const DevicePreviewImpactSchema = z.strictObject({
  activeCount: SafeCounterSchema.max(128),
  owned: z
    .array(
      z.strictObject({
        id: z.string(),
        deviceId: z.string(),
        state: z.enum(["queued", "running"]),
      }),
    )
    .max(128),
  otherActiveCount: SafeCounterSchema.max(128),
});
export const MOBILE_DEVICE_PREVIEW_RPC_SCHEMAS = {
  "devices.preview.mobile.start": {
    params: DevicePreviewInputSchema.extend(mobileScope),
    result: DevicePreviewSnapshotSchema,
  },
  "devices.preview.mobile.status": {
    params: z.union([
      z.strictObject({ ...mobileScope, ...mobileIdentity }),
      z.strictObject({
        ...mobileScope,
        ...mobileIdentity,
        id: z.string().optional(),
        requestId: z.string(),
      }),
    ]),
    result: DevicePreviewSnapshotSchema,
  },
  "devices.preview.impact": {
    params: z.strictObject(mobileScope),
    result: DevicePreviewImpactSchema,
  },
} as const;
export type DeviceLifecycleMethod = keyof typeof DEVICE_LIFECYCLE_RPC_SCHEMAS;
export type MobileDevicePreviewMethod = keyof typeof MOBILE_DEVICE_PREVIEW_RPC_SCHEMAS;
export type DevicePreviewImpact = z.infer<typeof DevicePreviewImpactSchema>;
export const DEVICE_LIFECYCLE_METHODS = Object.freeze(
  Object.keys(DEVICE_LIFECYCLE_RPC_SCHEMAS) as DeviceLifecycleMethod[],
);
export const MOBILE_DEVICE_PREVIEW_METHODS = Object.freeze(
  Object.keys(MOBILE_DEVICE_PREVIEW_RPC_SCHEMAS) as MobileDevicePreviewMethod[],
);
export const DEVICE_OWNER_RPC_SCHEMAS = {
  ...NATIVE_DEVICES_RPC_SCHEMAS,
  ...DEVICE_LIFECYCLE_RPC_SCHEMAS,
  ...MOBILE_DEVICE_PREVIEW_RPC_SCHEMAS,
} as const;
export type DeviceOwnerMethod = keyof typeof DEVICE_OWNER_RPC_SCHEMAS;

export function deviceOwnerReadOnly(method: DeviceOwnerMethod): boolean {
  return (
    method === "devices.status" ||
    method === "devices.list" ||
    method === "devices.preflight" ||
    method === "devices.control.status" ||
    method === "devices.inspect" ||
    method === "devices.preview.status" ||
    method === "devices.preview.mobile.status" ||
    method === "devices.preview.impact"
  );
}
