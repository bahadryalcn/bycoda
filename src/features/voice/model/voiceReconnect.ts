/** A finite retry budget; each attempt must mint its own short-lived credential. */
export const VOICE_RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
export const VOICE_ROTATION_MS = 55 * 60_000;

export type VoiceFailure = { recoverable: boolean; code?: string };

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
          { type: turn.role === "user" ? "input_text" : "text", text: turn.text.slice(0, 4_000) },
        ],
      },
    }));
}
