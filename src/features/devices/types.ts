import type {
  DeviceAction,
  DeviceFrame,
  DeviceHostStatus,
  DeviceSummary,
} from "../../shared/model/host-contracts/native-devices";
export type {
  DevicePlatform,
  DeviceAction,
  DeviceFrame,
  DeviceHostStatus,
  DeviceSummary,
} from "../../shared/model/host-contracts/native-devices";
export interface DevicePanelApi {
  status: () => Promise<DeviceHostStatus>;
  setup: (agentAccess: boolean) => Promise<DeviceHostStatus>;
  start: () => Promise<DeviceHostStatus>;
  stop: () => Promise<DeviceHostStatus>;
  list: () => Promise<{ devices: DeviceSummary[]; errors: string[] }>;
  boot: (deviceId: string) => Promise<DeviceSummary>;
  capture: (deviceId: string) => Promise<DeviceFrame>;
  action: (deviceId: string, action: DeviceAction, leaseId?: string) => Promise<string>;
  controlStatus?: (deviceId: string) => Promise<DeviceControlStatus>;
  claimControl?: (deviceId: string, requestId: string) => Promise<DeviceControlLease>;
  releaseControl?: (deviceId: string, leaseId: string) => Promise<{ released: true }>;
  renewControl?: (deviceId: string, leaseId: string) => Promise<DeviceControlLease>;
  inspect?: (deviceId: string, leaseId: string) => Promise<DeviceInspection>;
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
