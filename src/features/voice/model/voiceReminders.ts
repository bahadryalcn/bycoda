import { z } from "zod";
import {
  ASSISTANT_REMINDER_MAX_AHEAD_MS,
  type AssistantReminder,
} from "../../../shared/model/assistantReminders";
import type {
  AssistantRequest,
  AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";

/** The realtime `assistant_reminder` tool definition; part of the assistant control tools. */
export const VOICE_REMINDER_TOOL = {
  name: "assistant_reminder",
  description:
    "Create, list or cancel the owner's personal timed reminders; no work is started. create needs text (what to remind, at most 500 characters) and at: the ABSOLUTE due time in epoch milliseconds, which you resolve in the owner's local timezone from the current local date and time (never pass relative words like tomorrow). It must be in the future and at most a year ahead. After creating, say the resolved date and time aloud so the owner can correct it. Reuse the same requestId when retrying the identical create. list returns pending reminders with ids and versions. cancel needs the id and expectedVersion from list and only follows an explicit owner request. The reminder arrives as an assistant notification at its time.",
  properties: {
    action: { type: "string", enum: ["create", "list", "cancel"] },
    text: { type: "string", minLength: 1, maxLength: 500 },
    at: { type: "integer", minimum: 1 },
    requestId: { type: "string", minLength: 1, maxLength: 200 },
    id: { type: "string", maxLength: 200 },
    expectedVersion: { type: "integer", minimum: 0 },
  },
  required: ["action"],
} as const;

const reminderArgs = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    text: z.string().trim().min(1).max(500),
    at: z.number().int().positive(),
    requestId: z.string().min(1).max(200),
  }),
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({
    action: z.literal("cancel"),
    id: z.string().min(1).max(200),
    expectedVersion: z.number().int().nonnegative(),
  }),
]);

const row = ({ id, text, at, version }: AssistantReminder) => ({
  id,
  text,
  at,
  version,
  localTime: new Date(at).toString(),
});

/** Runs one reminder tool call against the Host; times are checked here and again by the Host. */
export async function voiceReminderCall(
  args: unknown,
  request: (input: AssistantRequest) => Promise<AssistantResponse>,
  now = Date.now(),
) {
  const input = reminderArgs.parse(args);
  if (input.action === "create") {
    if (input.at <= now) throw new Error("The reminder time is in the past. Resolve it again.");
    if (input.at > now + ASSISTANT_REMINDER_MAX_AHEAD_MS)
      throw new Error("A reminder can be at most one year ahead.");
    const { reminders } = await request({
      op: "reminders.create",
      text: input.text,
      at: input.at,
      requestId: input.requestId,
    });
    if (!reminders?.reminder) throw new Error("Reminder creation is unconfirmed. Check the Room.");
    return { status: "created", reminder: row(reminders.reminder) };
  }
  const { reminders } = await request(
    input.action === "list"
      ? { op: "reminders.list" }
      : { op: "reminders.cancel", id: input.id, expectedVersion: input.expectedVersion },
  );
  if (!reminders) throw new Error("Reminders are unavailable on this Host.");
  return input.action === "list"
    ? { reminders: reminders.items.map(row) }
    : { status: "cancelled", reminders: reminders.items.map(row) };
}
