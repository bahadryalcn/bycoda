import type { ActivityDay, ActivitySummary } from "@bycoda/account-contracts/activity";
import { remoteRequest } from "../../connections/public/connections";
import type { ActivityReport } from "./activityTracker";

/**
 * Typed wrappers for the `activity.*` Host RPC methods (schemas live in `host/activity`).
 * `machineId` is this computer's Host.
 */
export function activityClient(machineId: string) {
  return {
    record: (report: ActivityReport & { deviceId?: string }) =>
      remoteRequest<{ changed: boolean }>(machineId, "activity.record", report),
    days: (range: { from: string; to: string }) =>
      remoteRequest<{ days: ActivityDay[] }>(machineId, "activity.days", range),
    summary: (query: { today: string; timeZone: string }) =>
      remoteRequest<ActivitySummary>(machineId, "activity.summary", query),
  };
}
export type ActivityClient = ReturnType<typeof activityClient>;
