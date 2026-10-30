import { announceDrag, clearDropFeedback, setDropFeedback, setDropIndicator } from "./drag";
import { dragPointToClient } from "./dragPoint";

/**
 * Drop feedback for files that arrive from outside the document (the OS, another app, the
 * Explorer pointer drag). It reuses the one shared vocabulary from drag.ts: the receiving element
 * carries the single `inside` or `blocked` mark, the cursor carries the single badge that says what
 * releasing will do (or why it cannot), and one polite announcement repeats the badge. Receivers
 * keep their own admission rules and tell this module only the verdict.
 */
export type ExternalDropVerdict =
  | { kind: "accept"; label: string; subject?: string }
  | { kind: "blocked"; reason: string };

export type ExternalDropPointer = { clientX: number; clientY: number };

let announced = "";

/** Marks `target`, shows the badge at `pointer` and announces the sentence once per change. */
export function showExternalDrop(
  target: HTMLElement | null,
  verdict: ExternalDropVerdict,
  pointer: ExternalDropPointer,
) {
  const accepted = verdict.kind === "accept";
  const text = accepted ? verdict.label : verdict.reason;
  setDropIndicator(target, accepted ? "inside" : "blocked");
  setDropFeedback(
    accepted ? "move" : "blocked",
    pointer,
    text,
    accepted ? verdict.subject : undefined,
  );
  if (text !== announced) {
    announced = text;
    announceDrag(text);
  }
}

/** Removes the mark and badge. Safe to call when nothing is showing. */
export function endExternalDrop() {
  announced = "";
  clearDropFeedback();
}

/**
 * How many files a DOM drag carries. While dragging, browsers expose the items (kind and type)
 * but not the files themselves; 0 means the count is not known yet.
 */
export function droppedFileCount(data: DataTransfer | null | undefined): number {
  if (!data) return 0;
  const items = Array.from(data.items ?? []).filter((item) => item.kind === "file").length;
  return items || data.files?.length || 0;
}

/** MIME types of the dragged files; an empty string means the browser did not say. */
export function droppedFileTypes(data: DataTransfer | null | undefined): string[] {
  if (!data) return [];
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.type);
}

/** Pointer position of a Tauri drag-drop event in CSS pixels (physical on Windows). */
export function nativeDropPointer(
  position: { x: number; y: number } | undefined,
  fallback: ExternalDropPointer,
): ExternalDropPointer {
  if (!position) return fallback;
  const point = dragPointToClient(position.x, position.y);
  return { clientX: point.x, clientY: point.y };
}

/** A pointer inside `element`, used when a native event carries no position. */
export function pointerInside(element: HTMLElement | null): ExternalDropPointer {
  const rect = element?.getBoundingClientRect();
  return rect
    ? { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
    : { clientX: 0, clientY: 0 };
}
