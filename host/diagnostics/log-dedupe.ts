/**
 * Repeated identical Host warnings print once, then one count per window instead of thousands of lines.
 * `detail` is printed with the line but is not part of its identity, so a per-request id can be
 * logged without making every line unique.
 */
export type DedupedWarn = (message: string, detail?: string) => void;

export function createDedupedWarn(
  options: {
    windowMs?: number;
    maxKeys?: number;
    now?: () => number;
    write?: (line: string) => void;
  } = {},
): DedupedWarn {
  const windowMs = options.windowMs ?? 5 * 60_000;
  const maxKeys = options.maxKeys ?? 200;
  const now = options.now ?? Date.now;
  const write = options.write ?? ((line: string) => console.warn(line));
  const seen = new Map<string, { last: number; suppressed: number }>();
  return (message, detail) => {
    const at = now();
    const entry = seen.get(message);
    if (entry && at - entry.last < windowMs) {
      entry.suppressed += 1;
      return;
    }
    seen.delete(message);
    seen.set(message, { last: at, suppressed: 0 });
    if (seen.size > maxKeys) seen.delete(seen.keys().next().value as string);
    if (entry?.suppressed)
      write(
        `(${entry.suppressed} identical warnings suppressed in the last ${Math.round(windowMs / 60_000)} min)`,
      );
    write(detail ? `${message} ${detail}` : message);
  };
}

/** Shared Host warning sink. Use for repeated operational failures instead of console.warn. */
export const hostWarnDeduped: DedupedWarn = createDedupedWarn();
