import type {
  DeviceAction,
  DeviceFrame,
  DeviceHostStatus as HostDeviceStatus,
  DeviceSummary,
  DeviceTouch,
} from "../../shared/model/host-contracts/native-devices";
export type {
  DevicePlatform,
  DeviceAction,
  DeviceFrame,
  DeviceSummary,
} from "../../shared/model/host-contracts/native-devices";
/** Local rendering capability, negotiated separately from the legacy status payload. */
export type DeviceHostStatus = HostDeviceStatus & { touchProtocol?: 1 };
export interface DevicePanelApi {
  /** The machine behind this API, so a failed load reruns when it answers again. */
  environmentId?: string;
  status: () => Promise<DeviceHostStatus>;
  setup: (agentAccess: boolean) => Promise<DeviceHostStatus>;
  start: () => Promise<DeviceHostStatus>;
  stop: () => Promise<DeviceHostStatus>;
  list: () => Promise<{ devices: DeviceSummary[]; errors: string[] }>;
  boot: (deviceId: string) => Promise<DeviceSummary>;
  capture: (deviceId: string) => Promise<DeviceFrame>;
  /** Long-poll read of the device's H.264 video; absent or failing means still captures only. */
  stream?: (deviceId: string, cursor?: number) => Promise<DeviceStreamChunk>;
  subscribeStream?: (
    deviceId: string,
    onChunk: (chunk: DeviceStreamChunk) => void,
    onError: (failure: unknown) => void,
  ) => Promise<() => void>;
  touch?: (deviceId: string, touch: DeviceTouch, leaseId: string) => Promise<void>;
  action: (deviceId: string, action: DeviceAction, leaseId?: string) => Promise<string>;
  controlStatus?: (deviceId: string) => Promise<DeviceControlStatus>;
  claimControl?: (deviceId: string, requestId: string) => Promise<DeviceControlLease>;
  releaseControl?: (deviceId: string, leaseId: string) => Promise<{ released: true }>;
  renewControl?: (deviceId: string, leaseId: string) => Promise<DeviceControlLease>;
  inspect?: (deviceId: string, leaseId: string) => Promise<DeviceInspection>;
}

export interface DeviceStreamChunk {
  /** Byte offset after this chunk; pass it to the next read. */
  cursor: number;
  /** The bytes start at a key picture instead of continuing from the caller's cursor. */
  reset: boolean;
  /** H.264 Annex-B bytes; empty while the screen is still. */
  base64: string;
  /** The device's display size in pixels, not the encoded video size. */
  width: number;
  height: number;
  /** Whether this chunk ends on a complete recorder write. */
  boundary?: boolean;
}
export interface DeviceControlStatus {
  deviceId: string;
  busy: boolean;
}
export interface DeviceControlLease {
  deviceId: string;
  leaseId: string;
  expiresAt: number;
}
export interface DeviceInspection {
  inspectionId: string;
  deviceId: string;
  supported?: boolean;
  raw: string;
  frame: DeviceFrame;
  inspectedAt: string;
  coordinateSpace: "pixels" | "points";
  viewport?: { width: number; height: number };
  nodes: Array<{
    id: string;
    label: string;
    role: string;
    bounds: { x: number; y: number; width: number; height: number };
    enabled: boolean;
    clickable: boolean;
  }>;
}
