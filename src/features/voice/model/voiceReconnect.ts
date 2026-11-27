import { truncateGraphemes } from "../../../shared/lib/text/truncate";

/** A finite retry budget; each attempt must mint its own short-lived credential. */
export const VOICE_RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
export const VOICE_ROTATION_MS = 55 * 60_000;

export type VoiceFailure = {
  recoverable: boolean;
  code?: string;
  /** Owner audio was captured but never became an accepted transcript on this connection. */
  speechLost?: boolean;
};

/** Authentication, billing and capture permission failures require owner action.
 * A cleanup delivery timeout is transient only after the runtime closes its
 * uncertain provider session; recovery must use a fresh session, never replay it. */
export function classifyVoiceFailure(error: unknown, code?: string): VoiceFailure {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const fatal =
    /NotAllowedError|PermissionDeniedError|SecurityError|permission|denied|unauthori[sz]ed|forbidden|authentication|invalid_api_key|invalid.*(?:key|credential)|insufficient_quota|quota|billing|payment|not.?signed.?in|not.?logged.?in|sign.?in.*(?:required|rejected)|\b(?:401|402|403)\b|unsupported|secure.*context/i;
  return { recoverable: !fatal.test(`${code ?? ""} ${message}`), ...(code ? { code } : {}) };
}

export type VoiceRecentTurn = { role: "user" | "assistant"; text: string };

/**
 * Stored turns plus the accepted local turns newer than the last one the Host has. Local text may
 * be tail-trimmed, so it matches the end of the stored text.
 */
export function voiceResumeTurns<Turn extends VoiceRecentTurn>(
  stored: readonly Turn[],
  local: readonly Turn[],
): Turn[] {
  let cursor = 0;
  let lastMatched = -1;
  local.forEach((turn, index) => {
    const found = stored.findIndex(
      (candidate, position) =>
        position >= cursor && candidate.role === turn.role && candidate.text.endsWith(turn.text),
    );
    if (found < 0) return;
    cursor = found + 1;
    lastMatched = index;
  });
  return [...stored, ...local.slice(lastMatched + 1)].slice(-6);
}

/** Status event after a drop that lost captured speech; nothing is inferred from the lost audio. */
export function voiceLostSpeechNotice(lastRequest = "") {
  const request = lastRequest.trim();
  const known = request
    ? ` The owner's last received request was: "${truncateGraphemes(request, 300)}". It has no confirmed answer, and tools started for it may or may not have finished.`
    : "";
  return `The voice connection dropped while the owner was speaking, and that speech was never received or transcribed.${known} First read the seeded "Work this voice assistant started" block and assistant_status or workspace.sessions.list, and report what actually happened to earlier work; never say work was not started unless that state confirms it. Then say the connection dropped and ask them once to repeat only the sentence that was lost. Do not guess it, and do not repeat any action until they answer.`;
}

/** Only bounded transcript data crosses sessions, never tool calls or responses. */
export function recentVoiceContext(turns: readonly VoiceRecentTurn[]) {
  return turns
    .slice(-6)
    .filter((turn) => turn.text.trim())
    .map((turn) => ({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: turn.role,
        content: [
          // The realtime API rejects any other content type on an assistant message.
          {
            type: turn.role === "user" ? "input_text" : "output_text",
            text: turn.text.slice(0, 4_000),
          },
        ],
      },
    }));
}
