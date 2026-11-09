import { z } from "zod";
import { EntityId, IanaTimeZone, LocalDate } from "./common.ts";

/** Minutes in one wall-clock day slot map (always 1440, even on 23h/25h DST days). */
export const MINUTES_PER_DAY = 1440;
/** Bytes of the packed bitmap: 1440 bits. */
export const MINUTES_BYTES = 180;
/** Base64 length of 180 bytes (a multiple of 3, so there is no padding). */
export const MINUTES_BASE64_LENGTH = 240;
export const MAX_DAYS_PER_UPLOAD = 62;

const Base64Minutes = z.string().regex(/^[A-Za-z0-9+/]{240}$/, "expected 180 bytes as base64");

/**
 * One device's active-minute map for one local day. Bit `i` (byte `i >> 3`, bit `i & 7`,
 * least significant first) is set when local wall-clock minute `i` (hour*60+minute) was active.
 */
export const ActivityDay = z.strictObject({
  date: LocalDate,
  timeZone: IanaTimeZone,
  deviceId: EntityId,
  minutes: Base64Minutes,
});
export type ActivityDay = z.infer<typeof ActivityDay>;

export const ActivityDaysUpload = z.strictObject({
  days: z.array(ActivityDay).min(1).max(MAX_DAYS_PER_UPLOAD),
});
export type ActivityDaysUpload = z.infer<typeof ActivityDaysUpload>;

export const ActivityUploadResult = z.object({ accepted: z.number().int() });
export type ActivityUploadResult = z.infer<typeof ActivityUploadResult>;

export const ActivityTotals = z.object({
  today: z.number().int(),
  week: z.number().int(),
  month: z.number().int(),
  year: z.number().int(),
});
export type ActivityTotals = z.infer<typeof ActivityTotals>;

export const ActivitySummary = ActivityTotals.extend({
  last7Days: z.array(z.object({ date: LocalDate, minutes: z.number().int() })),
  /** The 12 calendar months ending with the current one, oldest first. Added in 0.3.0; older servers omit it. */
  last12Months: z
    .array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), minutes: z.number().int() }))
    .optional(),
  perDevice: z.array(ActivityTotals.extend({ deviceId: EntityId })).optional(),
});
export type ActivitySummary = z.infer<typeof ActivitySummary>;

export const ActivitySummaryQuery = z.strictObject({
  timeZone: IanaTimeZone,
  /** The caller's current local date; week/month/year are derived from it. */
  date: LocalDate,
});
export type ActivitySummaryQuery = z.infer<typeof ActivitySummaryQuery>;
