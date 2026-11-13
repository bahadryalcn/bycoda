import { asRecord, stringField } from "../../../shared/lib/records";

const HTTP_FAILURE = /\bHTTP(?:\/\d(?:\.\d)?)?\s+[45]\d{2}\b/i;
const PROTOCOL_FAILURE = /^(?:(?:API )?Error:\s*)?(?:HTTP(?:\/\d(?:\.\d)?)?\s+)?[45]\d{2}\b/i;
const HTTP_SUFFIX = /\s*\(HTTP(?:\/\d(?:\.\d)?)?\s+[45]\d{2}\)\s*$/i;
const USAGE_LIMIT =
  /^(?:you['’]ve hit your (?:(?:weekly|usage) )?limit|(?:weekly )?usage limit reached)\b[\s.·:,-]*/i;

function readableMessage(summary: string, raw: string) {
  const clean = summary.replace(HTTP_SUFFIX, "").trim();
  if (USAGE_LIMIT.test(clean)) {
    return { usageLimit: true, summary: clean.replace(USAGE_LIMIT, ""), detail: raw };
  }
  return { summary: clean, ...(clean !== raw ? { detail: raw } : {}) };
}

/** Presentation only. The original error remains unchanged in conversation history. */
export function sessionErrorPresentation(text: string): {
  summary?: string;
  detail?: string;
  usageLimit?: boolean;
} {
  const protocol = PROTOCOL_FAILURE.test(text.trimStart());
  if (!protocol && !text.trimStart().startsWith("{")) return readableMessage(text, text);
  const start = text.indexOf("{");
  let payload: Record<string, unknown> | null = null;
  if (start >= 0) {
    try {
      payload = asRecord(JSON.parse(text.slice(start)));
    } catch {
      // A malformed payload still remains available in full, including any HTTP status.
    }
  }
  if (!payload && !protocol) return readableMessage(text, text);
  const error = asRecord(payload?.error);
  const summary =
    (error && stringField(error, "message")) || (payload && stringField(payload, "message"));
  return {
    ...(summary && !HTTP_FAILURE.test(summary.replace(HTTP_SUFFIX, "")) && !/^\s*[{[]/.test(summary)
      ? readableMessage(summary, text)
      : {}),
    detail: text,
  };
}
