import { asRecord, looksLikeCallId, stringField } from "./records";

export function humanField(rec: Record<string, unknown>, key: string): string | undefined {
  const value = stringField(rec, key);
  return !value || looksLikeCallId(value) ? undefined : value;
}

/** Some transports already supply whitespace at chunk boundaries. */
export function textFromContent(
  content: unknown,
  separator = "",
  preserveBoundaryWhitespace = false,
): string {
  if (typeof content === "string") return content;
  const record = asRecord(content);
  if (record && typeof record.text === "string") return record.text;
  if (record && record.content != null)
    return textFromContent(record.content, separator, preserveBoundaryWhitespace);
  if (!Array.isArray(content)) return "";
  const parts = content
    .map((item) => textFromContent(item, separator, preserveBoundaryWhitespace))
    .filter(Boolean);
  if (!preserveBoundaryWhitespace) return parts.join(separator);
  return parts.reduce(
    (joined, part) =>
      !joined
        ? part
        : joined + (!separator || /\s$/.test(joined) || /^\s/.test(part) ? "" : separator) + part,
    "",
  );
}
