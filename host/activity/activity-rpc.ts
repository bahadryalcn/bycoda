import { z } from "zod";
import { ActivityDay } from "@bycoda/account-contracts/activity";
import type { ActivityMethod } from "../../src/shared/model/host-contracts/activity";
import type { ActivityService } from "./activity-store";

const DateSchema = ActivityDay.shape.date;

/** Strict schemas the Host handler parses with: the account contract's own date and bitmap rules. */
const ACTIVITY_RPC_STRICT = {
  "activity.record": {
    params: z.strictObject({
      deviceId: ActivityDay.shape.deviceId.optional(),
      date: DateSchema,
      timeZone: ActivityDay.shape.timeZone,
      minutes: ActivityDay.shape.minutes,
    }),
  },
  "activity.days": {
    params: z.strictObject({ from: DateSchema, to: DateSchema }),
  },
  "activity.summary": {
    params: z.strictObject({
      today: DateSchema,
      timeZone: ActivityDay.shape.timeZone,
    }),
  },
} as const;

/** Parses params, runs the service and returns the result for `request.result`. */
export async function handleActivityRpc(
  service: ActivityService,
  method: ActivityMethod,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "activity.record":
      return {
        changed: await service.recordMinutes(ACTIVITY_RPC_STRICT[method].params.parse(params)),
      };
    case "activity.days":
      return {
        days: await service.listDays(ACTIVITY_RPC_STRICT[method].params.parse(params)),
      };
    case "activity.summary":
      return service.summary(ACTIVITY_RPC_STRICT[method].params.parse(params));
  }
}
