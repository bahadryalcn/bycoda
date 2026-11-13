import { asRecord, stringField } from "../../../shared/lib/records";

const HTTP_FAILURE = /\bHTTP(?:\/\d(?:\.\d)?)?\s+[45]\d{2}\b/i;
const PROTOCOL_FAILURE = /^(?:(?:API )?Error:\s*)?(?:HTTP(?:\/\d(?:\.\d)?)?\s+)?[45]\d{2}\b/i;

/** Presentation only. The original error remains unchanged in conversation history. */
export function sessionErrorPresentation(text: string): { summary?: string; detail?: string } {
  const protocol = PROTOCOL_FAILURE.test(text.trimStart());
  if (!protocol && !text.trimStart().startsWith("{")) return { summary: text };
  const start = text.indexOf("{");
  let payload: Record<string, unknown> | null = null;
  if (start >= 0) {
    try {
      payload = asRecord(JSON.parse(text.slice(start)));
    } catch {
      // A malformed payload still remains available in full, including any HTTP status.
    }
  }
  if (!payload && !protocol) return { summary: text };
  const error = asRecord(payload?.error);
  const summary =
    (error && stringField(error, "message")) || (payload && stringField(payload, "message"));
  return {
    ...(summary && !HTTP_FAILURE.test(summary) && !/^\s*[{[]/.test(summary) ? { summary } : {}),
    detail: text,
  };
}
