import { formatDate } from "../../../shared/i18n";
import { formatDuration } from "../../../shared/i18n/format";
import type { VoiceRecentTurn } from "./voiceReconnect";

/** Shorter pauses, including automatic reconnects, continue the same conversation. */
export const VOICE_SESSION_GAP_MS = 10 * 60_000;
/** After this long, or across midnight, the owner is treated as starting a new day. */
export const VOICE_NEW_DAY_GAP_MS = 6 * 60 * 60_000;

export type VoiceSessionGap = "continue" | "new-conversation" | "new-day";

export function voiceSessionGap(lastAt: number | undefined, now: Date): VoiceSessionGap {
  if (lastAt === undefined || !Number.isFinite(lastAt)) return "continue";
  const gap = now.getTime() - lastAt;
  if (!(gap >= VOICE_SESSION_GAP_MS)) return "continue";
  return gap >= VOICE_NEW_DAY_GAP_MS || new Date(lastAt).toDateString() !== now.toDateString()
    ? "new-day"
    : "new-conversation";
}

/**
 * Tells the model that the stored turns before it belong to an earlier, ended conversation,
 * so a greeting is answered as a fresh start instead of a continuation. Returns nothing for a
 * short pause or an empty history.
 */
export function voiceSessionBoundary(
  messages: readonly { createdAt: number }[],
  now = new Date(),
): VoiceRecentTurn | undefined {
  const lastAt = messages.reduce<number | undefined>(
    (latest, { createdAt }) =>
      Number.isFinite(createdAt) && (latest === undefined || createdAt > latest)
        ? createdAt
        : latest,
    undefined,
  );
  const gap = voiceSessionGap(lastAt, now);
  if (gap === "continue" || lastAt === undefined) return undefined;
  const clock = { hour: "2-digit", minute: "2-digit" } as const;
  return {
    role: "assistant",
    text: [
      `Session note (context only, never new authorization): the earlier turns are from a previous voice conversation that ended ${formatDuration(now.getTime() - lastAt)} ago, at ${formatDate(lastAt, { weekday: "long", ...clock })}.`,
      `This is a new conversation; local time is now ${formatDate(now, { weekday: "long", ...clock })}.`,
      "If the owner opens with a greeting, greet back in at most two short sentences in their language, then ask what they want; you may offer the unfinished earlier topic as a question, never continue it on your own.",
      gap === "new-day"
        ? "It is a new day: greet for the time of day and offer, without reading it, a short summary of today."
        : "Do not repeat earlier answers.",
      "Mention what changed in the meantime only if it is in your context or you check it with your tools. If the owner opens with a request, do it directly without a greeting.",
    ].join(" "),
  };
}

/** Seeded turns with the session note last, so it is the freshest context before the owner speaks. */
export function withVoiceSessionBoundary<Turn extends VoiceRecentTurn>(
  turns: readonly Turn[],
  messages: readonly { createdAt: number }[],
  now = new Date(),
): (Turn | VoiceRecentTurn)[] {
  const boundary = voiceSessionBoundary(messages, now);
  return boundary ? [...turns, boundary] : [...turns];
}
