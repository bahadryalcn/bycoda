import type { Attachment } from "../model/session";
import { findTokens } from "../model/attachmentTokens";

// A caret inside any supported token has a closing bracket ahead on this line.
const TOKEN_TAIL = /[^[\]\r\n]*\]/y;
function mayBeInsideToken(text: string, offset: number) {
  if (offset <= 0 || offset >= text.length) return false;
  TOKEN_TAIL.lastIndex = offset;
  return TOKEN_TAIL.test(text);
}

export function snapAttachmentSelection(
  text: string,
  files: Pick<Attachment, "kind" | "size">[],
  start: number,
  end: number,
  motion: "forward" | "backward" | "none" = "none",
) {
  if (
    !files.length ||
    (!mayBeInsideToken(text, start) && (end === start || !mayBeInsideToken(text, end)))
  )
    return { start, end };
  const tokens = findTokens(text, files);
  if (start === end) {
    const hit = tokens.find((token) => start > token.start && start < token.end);
    if (!hit) return { start, end };
    const point =
      motion === "backward"
        ? hit.start
        : motion === "forward"
          ? hit.end
          : start - hit.start < hit.end - start
            ? hit.start
            : hit.end;
    return { start: point, end: point };
  }
  for (const token of tokens) {
    if (start > token.start && start < token.end) start = token.start;
    if (end > token.start && end < token.end) end = token.end;
  }
  return { start, end };
}

export function installAttachmentSelectionPolicy(
  el: HTMLTextAreaElement,
  files: () => Pick<Attachment, "kind" | "size">[],
) {
  let composing = false;
  let snapping = false;
  let motion: "forward" | "backward" | "none" = "none";
  const snap = () => {
    if (composing || snapping) return;
    const { selectionStart, selectionEnd, selectionDirection } = el;
    const next = snapAttachmentSelection(el.value, files(), selectionStart, selectionEnd, motion);
    if (next.start !== selectionStart || next.end !== selectionEnd) {
      snapping = true;
      try {
        el.setSelectionRange(next.start, next.end, selectionDirection);
      } finally {
        snapping = false;
      }
    }
    motion = "none";
  };
  const keydown = (event: KeyboardEvent) => {
    if (
      event.shiftKey &&
      !event.isComposing &&
      el.selectionStart !== el.selectionEnd &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      const tokens = findTokens(el.value, files());
      const backward = el.selectionDirection === "backward";
      const hit = tokens.find((token) =>
        backward
          ? event.key === "ArrowRight" &&
            token.start === el.selectionStart &&
            token.end <= el.selectionEnd
          : event.key === "ArrowLeft" &&
            token.end === el.selectionEnd &&
            token.start >= el.selectionStart,
      );
      if (hit) {
        event.preventDefault();
        el.setSelectionRange(
          backward ? hit.end : el.selectionStart,
          backward ? el.selectionEnd : hit.start,
          el.selectionDirection,
        );
        return;
      }
    }
    if (!event.isComposing)
      motion =
        event.key === "ArrowLeft" ? "backward" : event.key === "ArrowRight" ? "forward" : "none";
  };
  const compositionStart = () => {
    composing = true;
  };
  const compositionEnd = () => {
    composing = false;
    snap();
  };
  el.addEventListener("keydown", keydown);
  el.addEventListener("keyup", snap);
  el.addEventListener("select", snap);
  el.addEventListener("beforeinput", snap);
  el.addEventListener("compositionstart", compositionStart);
  el.addEventListener("compositionend", compositionEnd);
  return () => {
    el.removeEventListener("keydown", keydown);
    el.removeEventListener("keyup", snap);
    el.removeEventListener("select", snap);
    el.removeEventListener("beforeinput", snap);
    el.removeEventListener("compositionstart", compositionStart);
    el.removeEventListener("compositionend", compositionEnd);
  };
}
