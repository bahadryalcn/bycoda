import type { AutonomyAction } from "../../../src/features/social/model/autonomy";
import type { OutreachChannel } from "../../../src/features/social/model/outreach";
import { SOCIAL_PLATFORMS } from "../../../src/features/social/model/social";
import { str } from "../core/social-helpers";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
export const OUTREACH_CHANNELS: readonly OutreachChannel[] = [
  "dm",
  "comment",
  "mention",
  "email",
  "whatsapp",
  "telegram",
];

/** Autonomy action that governs each channel (the send itself is checked again by sendDraft). */
export const CHANNEL_ACTION: Record<OutreachChannel, AutonomyAction> = {
  dm: "message",
  whatsapp: "message",
  telegram: "message",
  comment: "comment",
  mention: "comment",
  email: "email",
};

/** Cursor and limit of a keyset page. The store clamps the limit. */
export function pageInput(input: Record<string, unknown>): { cursor?: string; limit?: number } {
  const cursor =
    typeof input.cursor === "string" && input.cursor ? input.cursor.slice(0, 300) : undefined;
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : undefined;
  return { ...(cursor !== undefined ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) };
}

export function channelInput(value: unknown, field = "channel"): OutreachChannel {
  if (!OUTREACH_CHANNELS.includes(value as OutreachChannel)) throw new Error(`Invalid ${field}.`);
  return value as OutreachChannel;
}

export function platformInput(value: unknown): (typeof SOCIAL_PLATFORMS)[number] {
  if (!SOCIAL_PLATFORMS.includes(value as (typeof SOCIAL_PLATFORMS)[number]))
    throw new Error("Invalid platform.");
  return value as (typeof SOCIAL_PLATFORMS)[number];
}

/** Optional string field: absent or null is undefined, present must be a bounded non-empty string. */
export function optionalStr(value: unknown, field: string, maximum = 200): string | undefined {
  return value === undefined || value === null ? undefined : str(value, field, maximum);
}

/**
 * An email step's template is "Subject: ...", then a blank line or newline, then the body.
 * A first line without the prefix is the subject too. Both parts must be non-empty.
 */
export function splitEmailTemplate(template: string): { subject: string; body: string } {
  const [first = "", ...rest] = template.split(/\r?\n/);
  const subject = first.replace(/^subject:\s*/i, "").trim();
  const body = rest.join("\n").trim();
  if (!subject || !body) throw new Error("Email steps need a subject line and a body.");
  return { subject, body };
}
