/**
 * True when a provider `error` only refuses a `response.cancel` this connection sent because
 * the reply had already ended. That is a lost race, never a failed request: the session and
 * the next reply must continue. OpenAI echoes the cancel's `event_id` with the code
 * `response_cancel_not_active`; other providers may send only the message.
 */
export function refusedVoiceCancel(error: unknown, sentCancels: ReadonlyMap<string, unknown>) {
  const { code, event_id: id, message } = (error ?? {}) as Record<string, unknown>;
  const refused =
    code === "response_cancel_not_active" ||
    (typeof message === "string" && /cancel\w*\b.*\bno active response/i.test(message));
  return refused && (typeof id === "string" ? sentCancels.has(id) : sentCancels.size > 0);
}
