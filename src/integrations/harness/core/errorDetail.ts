import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { redactExitStderrLine } from "./exitDiagnostics";

const ERROR_DETAIL_MAX = 240;

/**
 * Provider-, host- or OS-owned failure text kept as secondary detail under a translated sentence:
 * credentials are masked, links become `link`, control bytes and runs of whitespace collapse, and
 * the result is bounded. `undefined` when nothing readable is left.
 */
export function safeErrorDetail(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value : value instanceof Error ? value.message : "";
  const text = redactExitStderrLine(raw.replace(/https?:\/\/\S+/gi, "link"))
    .replace(/\s+/g, " ")
    .trim();
  return text ? truncateGraphemes(text, ERROR_DETAIL_MAX) : undefined;
}
