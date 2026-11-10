import type { AssistantProfile } from "../../../shared/model/host-contracts/assistant";

/** Automatic speech requires a recent, identified cause and an idle conversation. */
export type VoiceBriefingDelivery = {
  profile: AssistantProfile;
  presence: string;
  status: string;
  hold: boolean;
  hour: number;
  now: number;
  briefing: { id: string; createdAt: number };
  reason: "return" | "important";
  returnAt?: number;
  returnBriefingId?: string;
  meaningful: boolean;
  important?: boolean;
  conversationBusy: boolean;
  delivery: "pending" | "playing" | "delivered" | "interrupted" | "unknown";
};

export const VOICE_BRIEFING_FRESHNESS_MS = 5 * 60_000;

export function voiceQuietHours(profile: AssistantProfile, hour: number): boolean {
  if (profile.quietStart === profile.quietEnd) return false;
  return profile.quietStart < profile.quietEnd
    ? hour >= profile.quietStart && hour < profile.quietEnd
    : hour >= profile.quietStart || hour < profile.quietEnd;
}

export function maySpeakVoiceBriefing(
  profile: AssistantProfile,
  presence: string,
  status: string,
  hold: boolean,
  hour: number,
) {
  if (presence !== "active" || status !== "ready" || hold || profile.proactiveSpeech === "never")
    return false;
  return !voiceQuietHours(profile, hour);
}

export function mayDeliverVoiceBriefing(input: VoiceBriefingDelivery): boolean {
  const { profile, briefing, now, reason, returnAt } = input;
  if (!maySpeakVoiceBriefing(profile, input.presence, input.status, input.hold, input.hour))
    return false;
  if (
    !input.meaningful ||
    input.conversationBusy ||
    input.delivery !== "pending" ||
    !briefing.id.trim()
  )
    return false;
  if (!Number.isFinite(now) || !Number.isFinite(briefing.createdAt)) return false;
  const age = now - briefing.createdAt;
  if (age < 0 || age > VOICE_BRIEFING_FRESHNESS_MS) return false;
  if (reason === "important") return profile.proactiveSpeech === "important";
  // A return briefing must be produced for this particular observed return, not
  // merely be a recent daily or previously stored snapshot.
  return (
    (profile.proactiveSpeech === "return" ||
      (profile.proactiveSpeech === "important" && input.important === true)) &&
    input.returnBriefingId === briefing.id &&
    returnAt !== undefined &&
    Number.isFinite(returnAt) &&
    returnAt <= briefing.createdAt &&
    now - returnAt <= VOICE_BRIEFING_FRESHNESS_MS
  );
}
