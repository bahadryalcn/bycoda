import { z } from "zod";

const HostDeviceId = z.string().uuid();
const EnvironmentId = z.string().min(1).max(200);
const HostDeviceAccessDevice = z
  .object({
    id: HostDeviceId,
    name: z.string().min(1).max(160),
    canManageDevices: z.boolean(),
  })
  .strict();
export const HostDeviceAccessChange = z
  .object({
    deviceId: HostDeviceId,
    management: z.boolean().nullable(),
  })
  .strict();
export const HostDeviceAccessRequest = HostDeviceAccessChange.extend({
  requestId: z.string().uuid(),
});
export const HostDeviceAccessSync = z
  .object({
    environmentId: EnvironmentId,
    name: z.string().min(1).max(160),
    devices: z.array(HostDeviceAccessDevice).max(256),
    applied: z.array(z.string().uuid()).max(256),
  })
  .strict();
export const HostDeviceAccessReport = HostDeviceAccessSync.omit({ applied: true }).extend({
  id: z.string().uuid(),
  lastSynced: z.string().datetime(),
  pending: z.array(HostDeviceAccessRequest).max(256),
});
export type HostDeviceAccessSync = z.infer<typeof HostDeviceAccessSync>;
export type HostDeviceAccessReport = z.infer<typeof HostDeviceAccessReport>;
export type HostDeviceAccessChange = z.infer<typeof HostDeviceAccessChange>;
export type HostDeviceAccessRequest = z.infer<typeof HostDeviceAccessRequest>;
