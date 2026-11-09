import { z } from "zod";
import type { HostRpcMethodDefinition } from "./methods";

// The published manifest allows only length and identifier checks, so the wire schemas bound the
// strings by length and the handler applies the strict schemas above.
const wireDate = z.string().min(10).max(10);
const wireZone = z.string().min(1).max(64);
const wireDevice = z.string().min(1).max(200);
const wireMinutes = z.string().min(240).max(240);
const wireDay = z.strictObject({
  date: wireDate,
  timeZone: wireZone,
  deviceId: wireDevice,
  minutes: wireMinutes,
});
const wireTotals = {
  today: z.number().int(),
  week: z.number().int(),
  month: z.number().int(),
  year: z.number().int(),
};

/** Local active-time RPC; the Host stores minutes per local day, the renderer reports them. */
export const ACTIVITY_RPC = {
  "activity.record": {
    params: z.strictObject({
      deviceId: wireDevice.optional(),
      date: wireDate,
      timeZone: wireZone,
      minutes: wireMinutes,
    }),
    result: z.strictObject({ changed: z.boolean() }),
    query: false,
  },
  "activity.days": {
    params: z.strictObject({ from: wireDate, to: wireDate }),
    result: z.strictObject({ days: z.array(wireDay) }),
    query: true,
  },
  "activity.summary": {
    params: z.strictObject({ today: wireDate, timeZone: wireZone }),
    result: z.strictObject({
      ...wireTotals,
      last7Days: z.array(z.strictObject({ date: wireDate, minutes: z.number().int() })),
      last12Months: z
        .array(z.strictObject({ month: z.string().min(7).max(7), minutes: z.number().int() }))
        .optional(),
      perDevice: z.array(z.strictObject({ ...wireTotals, deviceId: wireDevice })).optional(),
    }),
    query: true,
  },
} as const;

export type ActivityMethod = keyof typeof ACTIVITY_RPC;

/** The caller passes its workflow builder in, as `decisionModelsMethods` does. */
export function activityMethods(
  workflow: (
    requiredCapability: string,
    params: z.ZodType,
    result: z.ZodType,
    query?: boolean,
  ) => HostRpcMethodDefinition,
) {
  const operation = (method: ActivityMethod): HostRpcMethodDefinition => {
    const schema = ACTIVITY_RPC[method];
    return workflow("activity.v1", schema.params, schema.result, schema.query);
  };
  return {
    "activity.record": operation("activity.record"),
    "activity.days": operation("activity.days"),
    "activity.summary": operation("activity.summary"),
  };
}
