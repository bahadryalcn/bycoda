import type { useT } from "../../../shared/i18n";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";

const STORAGE_FULL = /QuotaExceededError|Failed to execute 'setItem' on 'Storage'/i;
const WS_INTERRUPTED = /RPC_WS_INTERRUPTED/;
/** A technical first line: an error code or exception name prefix. */
const TECHNICAL = /^\s*(?:[A-Z][A-Z0-9_]{2,}|[A-Za-z]*Error|[A-Za-z]*Exception)\s*:/;

/**
 * A readable sentence for a raw delivery failure; the raw text itself stays in the details.
 * Takes the caller's `useT()` and calls no module-`t` helper, so render code stays
 * compilable by the React Compiler.
 */
export function deliveryFailureSentence(raw: string, t: ReturnType<typeof useT>): string {
  if (STORAGE_FULL.test(raw))
    return t("This device's local storage is full, so the queue could not be saved.");
  if (WS_INTERRUPTED.test(raw))
    return t(
      "The connection to the Host dropped before the result was known. The queue checks again automatically.",
    );
  // Reasons the queue or provider wrote as a sentence lead with it; the rest stays in details.
  const first = raw.split(/\r?\n/, 1)[0].trim();
  if (first && !TECHNICAL.test(first)) return truncateGraphemes(first, 200);
  return t("The message was not sent. The technical reason is in the details.");
}
