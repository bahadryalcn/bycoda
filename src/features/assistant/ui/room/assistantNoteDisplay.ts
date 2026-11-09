import type { AssistantNote } from "../../../../shared/model/host-contracts/assistant";
import { stripAssistantEventMarkers } from "../../model/assistantEventMarkers";

const DAILY_TITLE = /^(.+) · (\d{4}-\d{2}-\d{2})$/;
const EVENT_LINE = /^-\s+(\d{2}:\d{2}) UTC · (.+)$/;
const DAY_MS = 86_400_000;

export type NoteLine = { time?: string; text: string };

/**
 * The Host writes a daily assistant note titled "<name> · YYYY-MM-DD" and tagged "assistant"
 * (host/assistant/work/assistant-daily-note.ts). Returns the day, or undefined for other notes.
 */
export function dailyNoteDay(note: Pick<AssistantNote, "title" | "tags">): string | undefined {
  if (!note.tags.includes("assistant")) return undefined;
  return DAILY_TITLE.exec(note.title)?.[2];
}

/** Display lines with event dedupe markers removed; timed "- HH:MM UTC · text" entries are split out. */
export function noteLines(body: string): NoteLine[] {
  return stripAssistantEventMarkers(body)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = EVENT_LINE.exec(line);
      return match ? { time: match[1], text: match[2] } : { text: line };
    });
}

/** Newest day first for daily notes; other notes keep their updated-at order. */
export function sortNotesForDisplay(notes: readonly AssistantNote[]): AssistantNote[] {
  const sortKey = (note: AssistantNote) => {
    const day = dailyNoteDay(note);
    return day ? Date.parse(`${day}T00:00:00Z`) + DAY_MS - 1 : note.updatedAt;
  };
  return [...notes].sort((left, right) => sortKey(right) - sortKey(left));
}

const PREVIEW_MAX = 140;

/** One plain line for a list row: markdown marks removed, lines joined, cut at a word-safe length. */
export function notePreview(body: string): string {
  const text = noteLines(body)
    .map((line) => line.text)
    .join(" · ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(^|\s)(#{1,6}|>|[-*+])\s+/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX).trimEnd()}…` : text;
}
