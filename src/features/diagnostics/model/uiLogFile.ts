import { redactDiagnosticText } from "@bycoda/account-contracts";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import type { UiLogSink } from "./uiLogBuffer";

export type UiLogFileLine = { level: "warn" | "error"; message: string };

const FLUSH_MS = 2000;
const BATCH_LINES = 50;
const LINE_GRAPHEMES = 2000;
/** The same line is written again only after this long, so a failing loop cannot fill the file. */
const REPEAT_MS = 5 * 60_000;
const MINUTE_LINES = 60;
const REMEMBERED = 500;

/**
 * A sink for `setUiLogSink` that writes redacted UI warnings and errors to the native log file
 * in small batches. Lines over the per-minute limit, repeats and failed writes are dropped.
 */
export function createUiLogFile(
  write: (lines: UiLogFileLine[]) => Promise<void>,
  now: () => number = Date.now,
): UiLogSink {
  // `seen` holds queued lines only; a line that is dropped by a limit or fails to write is not
  // remembered, so the next occurrence can still be written.
  const seen = new Map<string, number>();
  let pending: { line: UiLogFileLine; key: string; at: number }[] = [];
  let minute = 0;
  let written = 0;
  const flush = () => {
    const batch = pending;
    pending = [];
    // -- the log file is best effort; reporting a failed write would feed this sink again.
    write(batch.map((queued) => queued.line)).catch(() => {
      for (const { key, at } of batch) if (seen.get(key) === at) seen.delete(key);
    });
  };
  return (level, category, message) => {
    const text = truncateGraphemes(
      redactDiagnosticText(`[${category}] ${message}`),
      LINE_GRAPHEMES,
    );
    const at = now();
    const key = `${level}\0${text}`;
    const last = seen.get(key);
    if (last !== undefined && at - last < REPEAT_MS) return;
    if (at - minute >= 60_000) {
      minute = at;
      written = 0;
    }
    if (written >= MINUTE_LINES || pending.length >= BATCH_LINES) return;
    if (seen.size >= REMEMBERED) seen.clear();
    seen.set(key, at);
    written += 1;
    pending.push({ line: { level, message: text }, key, at });
    if (pending.length === 1) setTimeout(flush, FLUSH_MS);
  };
}
