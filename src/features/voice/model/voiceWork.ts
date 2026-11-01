/** Shared wire boundary for prepared work. Semantic intent is interpreted by the
 * companion; this rejects malformed payloads without truncating their meaning. */
export function voiceWorkText(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 16_000 ||
    // Wire text permits tabs/newlines, but no other C0 control characters.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new Error("The voice work brief is empty or invalid. Please try again.");
  return value.trim();
}
