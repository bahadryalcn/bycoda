import { t } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";

/** Interim speech delay: stay quiet for fast turns, reassure on slow multi-step ones. */
export const VOICE_PROGRESS_AFTER_MS = 6000;

const TURKISH =
  /[çğıöşüÇĞİÖŞÜ]|\b(bir|ve|bu|şu|için|yap|devam|not|oluştur|başlat|lütfen|evet|hayır)\b/i;
const isTurkish = (transcript: string) => TURKISH.test(transcript);

export function voiceProgressText(transcript: string) {
  return isTurkish(transcript) ? "Hâlâ üzerindeyim…" : "Working on it…";
}

/** One short, plain reason: no stack frames, no line breaks, at most 200 characters. */
export function voiceErrorReason(error: unknown) {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const line =
    raw
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => part && !/^at\s/.test(part)) ?? "";
  const reason = truncateGraphemes(line.replace(/\s+/g, " ").replace(/[.\s]+$/, ""), 200);
  return reason || "an unexpected error occurred";
}

export function voiceFailureReply(transcript: string, error: unknown) {
  const reason = voiceErrorReason(error);
  return isTurkish(transcript)
    ? `Bunu tamamlayamadım: ${reason}. Başka bir şey değiştirilmedi.`
    : `I couldn't finish that: ${reason}. Nothing else was changed.`;
}

/** Used only when the final no-tools summary call itself yields no usable reply. */
export function voiceLimitFallback(transcript: string, done: number) {
  return isTurkish(transcript)
    ? `Bu istek için adım sınırına ulaştım; ${done} adım tamamlandı. Devam etmemi istersen "devam et" de.`
    : `I reached the step limit for this request after ${done} steps. Say "continue" and I'll pick up from there.`;
}

export function observedRequestIds(observations: readonly unknown[]) {
  const ids = new Set<string>();
  for (const item of observations) {
    const args = (item as { args?: { requestId?: unknown } } | null)?.args;
    if (typeof args?.requestId === "string" && args.requestId) ids.add(args.requestId);
  }
  return [...ids];
}

/** Host RPC rejections arrive as strings; keep their reason instead of a generic fallback. */
export function voiceError(cause: unknown, fallback: string): string {
  const message = cause == null ? "" : errorText(cause).trim();
  return t(message && message !== "[object Object]" ? message : fallback);
}
