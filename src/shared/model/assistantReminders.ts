import { z } from "zod";

/** Personal timed reminders. A separate collection from jobs; carried only by the `reminders.*`
 * operations, so older clients never see them. */
export const ASSISTANT_REMINDER_MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
const id = z.string().min(1).max(200);
const text = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => !!value.trim());
const stamp = z.number().int().nonnegative();

export const AssistantReminderSchema = z.strictObject({
  id,
  version: stamp,
  text,
  /** Absolute due time in epoch milliseconds. */
  at: stamp,
  status: z.enum(["pending", "fired"]),
  createdAt: stamp,
  firedAt: stamp.optional(),
});
export type AssistantReminder = z.infer<typeof AssistantReminderSchema>;

export const AssistantReminderOps = [
  z.strictObject({ op: z.literal("reminders.create"), text, at: stamp, requestId: id }),
  z.strictObject({ op: z.literal("reminders.list") }),
  z.strictObject({ op: z.literal("reminders.cancel"), id, expectedVersion: stamp }),
] as const;
export type AssistantReminderRequest = z.infer<(typeof AssistantReminderOps)[number]>;

export const AssistantRemindersResponseSchema = z.strictObject({
  items: z.array(AssistantReminderSchema).max(100),
  reminder: AssistantReminderSchema.optional(),
});
export type AssistantRemindersResponse = z.infer<typeof AssistantRemindersResponseSchema>;
