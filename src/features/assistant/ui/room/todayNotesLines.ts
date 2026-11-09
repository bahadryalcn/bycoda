import { stripAssistantEventMarkers } from "../../model/assistantEventMarkers";

/** Plain-text preview lines shown on Today, across all of today's notes. */
export const TODAY_PREVIEW_LINES = 3;
/** Markdown block markers at the start of a line: headings, bullets. */
const BLOCK_MARKER = /^\s*(?:#{1,6}\s+|[-*+]\s+)/;

/** Note body as plain text lines: event markers and markdown block markers removed. */
export function notePlainLines(body: string): string[] {
  return stripAssistantEventMarkers(body)
    .split(/\r?\n/)
    .map((line) => line.replace(BLOCK_MARKER, "").trim())
    .filter(Boolean);
}

/** A timed daily-note line: "HH:MM UTC · text". */
const TIMED_LINE = /^(\d{1,2}:\d{2})(?:\s*UTC)?\s+·\s+(.+)$/;

/** Splits a leading clock time off a line; the " UTC" suffix is dropped from the time. */
export function timedNoteLine(line: string): { time?: string; text: string } {
  const match = TIMED_LINE.exec(line);
  return match ? { time: match[1], text: match[2] } : { text: line };
}

export interface TodayNoteLine {
  key: string;
  title: string;
  /** Clock time of a timed line, without " UTC". */
  time?: string;
  text: string;
}

/** At most three lines across the notes; a note's first line carries its title. */
export function todayNoteLines(
  notes: ReadonlyArray<{ id: string; title: string; body: string }>,
): TodayNoteLine[] {
  return notes
    .flatMap((note) => {
      const lines = notePlainLines(note.body);
      return (lines.length ? lines : [""]).slice(0, TODAY_PREVIEW_LINES).map((line, index) => ({
        key: `${note.id}:${index}`,
        title: index === 0 ? note.title : "",
        ...timedNoteLine(line),
      }));
    })
    .slice(0, TODAY_PREVIEW_LINES);
}
