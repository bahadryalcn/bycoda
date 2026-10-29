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
  action: (deviceId: string, action: DeviceAction) => Promise<string>;
}
