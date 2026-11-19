import { useCallback, useEffect, useRef, useState } from "react";
import {
  SELECTABLE_AGENT_RESPONSE_ATTR,
  selectedOccurrence,
  validateTranscriptSelection,
  type TranscriptSelection,
  type TranscriptSelectionSource,
} from "../model/transcriptSelection";
import {
  firstRangeRect,
  isRectVisible,
  type SelectionGeometry,
} from "../model/selectionGeometry";

function responseIdForNode(node: Node | null, root: HTMLElement): string | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const response = element?.closest<HTMLElement>(`[${SELECTABLE_AGENT_RESPONSE_ATTR}]`);
  if (!response || !root.contains(response)) return null;
  return response.getAttribute(SELECTABLE_AGENT_RESPONSE_ATTR);
}

function clampToResponse(range: Range, root: HTMLElement): Range {
  const element =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
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

/** The cloned range tracks DOM mutations itself, so it keeps pointing at the selected text while the page scrolls or streams. */
function liveMeasure(range: Range): () => SelectionGeometry | null {
  const live = range.cloneRange();
  // Range text, not Selection text: the two differ in block separators, so compare like with like.
  const captured = live.toString();
  return () => {
    const container =
      live.commonAncestorContainer instanceof Element
        ? live.commonAncestorContainer
        : live.commonAncestorContainer.parentElement;
    if (!container?.isConnected || live.collapsed || live.toString() !== captured) return null;
    const rect = firstRangeRect(live);
    return rect ? { rect, visible: isRectVisible(rect, container) } : null;
  };
}

/**
 * Occurrence and response text are read only when an action asks, from the same live range as
 * `liveMeasure`. A selectionchange therefore never rescans the response or copies its text.
 */
function liveSource(range: Range, text: string): () => TranscriptSelectionSource | null {
  const live = range.cloneRange();
  const captured = live.toString();
  return () => {
    const node =
      live.startContainer instanceof Element
        ? live.startContainer
        : live.startContainer.parentElement;
    const response = node?.closest<HTMLElement>(`[${SELECTABLE_AGENT_RESPONSE_ATTR}]`);
    if (!response?.isConnected || live.collapsed || live.toString() !== captured) return null;
    const prefix = live.cloneRange();
    prefix.selectNodeContents(response);
    prefix.setEnd(live.startContainer, live.startOffset);
    return {
      occurrence: selectedOccurrence(prefix.toString(), text),
      responseText: response.textContent ?? "",
    };
  };
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
    // Cleanup of the previous run already dismissed the selection.
    if (!enabled || !root) return;

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
      const next =
        text && rect
          ? {
              text,
              rect,
              responseId: responseIdForNode(range.startContainer, root) ?? undefined,
              measure: liveMeasure(range),
              resolveSource: liveSource(range, text),
            }
          : null;
      setSelection((previous) => {
        if (!previous || !next) return previous === next ? previous : next;
        return previous.text === next.text &&
          previous.responseId === next.responseId &&
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

  return { selection: enabled && root ? selection : null, dismissSelection };
}
