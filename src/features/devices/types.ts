export type DevicePlatform = "ios" | "android";
export interface DeviceSummary {
  id: string;
  name: string;
  platform: DevicePlatform;
  version: string;
  booted: boolean;
  physical: boolean;
}
export interface DeviceHostStatus {
  running: boolean;
  installed: boolean;
  agentInstalled: boolean;
  platform: string;
  platforms: { platform: DevicePlatform; available: boolean; reason?: string }[];
  lastError?: string;
}
export interface DeviceFrame {
  mime: "image/png" | "image/jpeg";
  base64: string;
  capturedAt: string;
}
export type DeviceAction =
  | { type: "openApp"; app: string }
  | { type: "press"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "swipe"; x: number; y: number; endX: number; endY: number }
  | { type: "home" }
  | { type: "snapshot" };
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
