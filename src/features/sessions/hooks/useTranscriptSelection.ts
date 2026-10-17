import { useCallback, useEffect, useRef, useState } from "react";
import {
  SELECTABLE_AGENT_RESPONSE_ATTR,
  validateTranscriptSelection,
  type TranscriptSelection,
} from "../model/transcriptSelection";

function responseIdForNode(node: Node | null, root: HTMLElement): string | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const response = element?.closest<HTMLElement>(`[${SELECTABLE_AGENT_RESPONSE_ATTR}]`);
  if (!response || !root.contains(response)) return null;
  return response.getAttribute(SELECTABLE_AGENT_RESPONSE_ATTR);
}

function clampToResponse(range: Range, root: HTMLElement): Range {
  const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const response = element?.closest<HTMLElement>(`[${SELECTABLE_AGENT_RESPONSE_ATTR}]`);
  if (!response || !root.contains(response) || response.contains(range.endContainer)) return range;
  // Whole-paragraph selections may end at the start of the following action row.
  // Only accept that boundary if no text outside the reply was selected.
  const overflow = range.cloneRange();
  overflow.setStart(response, response.childNodes.length);
  if (overflow.toString().trim()) return range;
  const clamped = range.cloneRange();
  clamped.setEnd(response, response.childNodes.length);
  return clamped;
}

function firstRangeRect(range: Range): DOMRect | null {
  const rects = range.getClientRects();
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects.item(index);
    if (rect && (rect.width > 0 || rect.height > 0)) return rect;
  }
  const rect = range.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

export function useTranscriptSelection(
  root: HTMLElement | null,
  enabled: boolean,
): {
  selection: TranscriptSelection | null;
  dismissSelection: () => void;
} {
  const [selection, setSelection] = useState<TranscriptSelection | null>(null);
  const frame = useRef<number | null>(null);

  const dismissSelection = useCallback(() => setSelection(null), []);

  useEffect(() => {
    if (!enabled || !root) {
      dismissSelection();
      return;
    }

    let pointerSelecting = false;

    const cancelFrame = () => {
      if (frame.current == null) return;
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    };
    const reportSelection = () => {
      frame.current = null;
      const nativeSelection = window.getSelection();
      if (!nativeSelection || nativeSelection.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const range = clampToResponse(nativeSelection.getRangeAt(0), root);
      const text = validateTranscriptSelection({
        text: nativeSelection.toString(),
        collapsed: nativeSelection.isCollapsed,
        anchorResponseId: responseIdForNode(range.startContainer, root),
        focusResponseId: responseIdForNode(range.endContainer, root),
      });
      const rect = text ? firstRangeRect(range) : null;
      let occurrence = 0;
      let responseText: string | undefined;
      if (text && rect) {
        const node =
          range.startContainer instanceof Element
            ? range.startContainer
            : range.startContainer.parentElement;
        const response = node?.closest(`[${SELECTABLE_AGENT_RESPONSE_ATTR}]`);
        if (response) {
          responseText = response.textContent ?? undefined;
          const prefix = range.cloneRange();
          prefix.selectNodeContents(response);
          prefix.setEnd(range.startContainer, range.startOffset);
          const before = prefix.toString();
          for (
            let index = before.indexOf(text);
            index >= 0;
            index = before.indexOf(text, index + text.length)
          )
            occurrence += 1;
        }
      }
      const next =
        text && rect
          ? {
              text,
              rect,
              responseId: responseIdForNode(nativeSelection.anchorNode, root) ?? undefined,
              occurrence,
              responseText,
            }
          : null;
      setSelection((previous) => {
        if (!previous || !next) return previous === next ? previous : next;
        return previous.text === next.text &&
          previous.responseId === next.responseId &&
          previous.occurrence === next.occurrence &&
          previous.responseText === next.responseText &&
          previous.rect.x === next.rect.x &&
          previous.rect.y === next.rect.y &&
          previous.rect.width === next.rect.width &&
          previous.rect.height === next.rect.height
          ? previous
          : next;
      });
    };
    const scheduleReport = () => {
      cancelFrame();
      frame.current = window.requestAnimationFrame(reportSelection);
    };
    const onPointerDown = (event: PointerEvent) => {
      pointerSelecting = responseIdForNode(event.target as Node, root) != null;
      if (pointerSelecting) cancelFrame();
    };
    const onPointerUp = () => {
      if (!pointerSelecting) return;
      pointerSelecting = false;
      scheduleReport();
    };
    const onPointerCancel = () => {
      pointerSelecting = false;
    };
    const onSelectionChange = () => {
      if (!pointerSelecting) scheduleReport();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift" || (event.shiftKey && event.key.startsWith("Arrow"))) {
        scheduleReport();
      }
    };

    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("pointerup", onPointerUp, { passive: true });
    document.addEventListener("pointercancel", onPointerCancel, {
      passive: true,
    });
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      cancelFrame();
      dismissSelection();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [dismissSelection, enabled, root]);

  return { selection, dismissSelection };
}
