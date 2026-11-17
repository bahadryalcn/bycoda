/** Mobile retries share the existing durable, transactional command receipt store. */
export function clientMessageCommand(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  if (value.clientMessageId === undefined) return raw;
  if (
    typeof value.clientMessageId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.clientMessageId,
    ) ||
    !["send", "steer", "draft", "compact"].includes(String(value.type)) ||
    typeof value.sessionId !== "string" ||
    !value.sessionId
  )
    throw new Error("Invalid client message ID");
  const { clientMessageId, ...command } = value;
  return { ...command, commandId: clientMessageId.toLowerCase() };
}
