import { useEffect, useRef, useState, type RefObject } from "react";
import type { TranscriptSelection } from "../model/transcriptSelection";
import { textareaSelectionRect } from "../model/textareaSelectionRect";

export type ComposerTranslationSelection = TranscriptSelection & {
  value: string;
  start: number;
  end: number;
};

export function useComposerTranslationSelection(
  ref: RefObject<HTMLTextAreaElement | null>,
  enabled: boolean,
) {
  const [selection, setSelection] = useState<ComposerTranslationSelection | null>(null);
  const dismissedSelection = useRef<{ value: string; start: number; end: number } | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    let selecting = false;
    let frame = 0;
    let pointerAnchor: { x: number; y: number } | null = null;
    const report = () => {
      frame = 0;
      if (selecting || document.activeElement !== element) return;
      const { value, selectionStart: start, selectionEnd: end } = element;
      const dismissed = dismissedSelection.current;
      if (dismissed?.value === value && dismissed.start === start && dismissed.end === end) return;
      const text = value.slice(start, end);
      let rect: DOMRect | null = null;
      if (text.trim()) {
        try {
          rect = textareaSelectionRect(element, start, end);
        } catch {
          /* Native selection geometry can be temporarily unavailable. */
        }
        if (!rect) {
          const bounds = element.getBoundingClientRect();
          if (bounds.width > 0 && bounds.height > 0) {
            const style = getComputedStyle(element);
            const x = pointerAnchor?.x ?? bounds.left + (parseFloat(style.paddingLeft) || 0);
            const y = pointerAnchor?.y ?? bounds.top + (parseFloat(style.paddingTop) || 0);
            rect = new DOMRect(
              Math.min(bounds.right, Math.max(bounds.left, x)),
              Math.min(bounds.bottom, Math.max(bounds.top, y)),
              1,
              1,
            );
          }
        }
      }
      setSelection(rect ? { value, start, end, text, rect } : null);
    };
    const scheduleReport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    };
    const down = (event: PointerEvent) => {
      dismissedSelection.current = null;
      selecting = true;
      pointerAnchor = { x: event.clientX, y: event.clientY };
      cancelAnimationFrame(frame);
      setSelection(null);
    };
    const up = (event: PointerEvent) => {
      if (!selecting) return;
      selecting = false;
      pointerAnchor = { x: event.clientX, y: event.clientY };
      scheduleReport();
    };
    const keyup = (event: KeyboardEvent) => {
      if ((event.key.toLowerCase() === "a" && (event.ctrlKey || event.metaKey)) || event.shiftKey)
        dismissedSelection.current = null;
      pointerAnchor = null;
      scheduleReport();
    };
    const dismiss = () => {
      dismissedSelection.current = null;
      cancelAnimationFrame(frame);
      setSelection(null);
    };
    element.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    element.addEventListener("select", scheduleReport);
    document.addEventListener("selectionchange", scheduleReport);
    element.addEventListener("keyup", keyup);
    element.addEventListener("input", dismiss);
    element.addEventListener("scroll", scheduleReport);
    return () => {
      element.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      cancelAnimationFrame(frame);
      element.removeEventListener("select", scheduleReport);
      document.removeEventListener("selectionchange", scheduleReport);
      element.removeEventListener("keyup", keyup);
      element.removeEventListener("input", dismiss);
      element.removeEventListener("scroll", scheduleReport);
    };
  }, [ref, enabled]);
  return {
    selection: enabled ? selection : null,
    dismissSelection: () => {
      const element = ref.current;
      if (selection)
        dismissedSelection.current = {
          value: selection.value,
          start: selection.start,
          end: selection.end,
        };
      else if (element)
        dismissedSelection.current = {
          value: element.value,
          start: element.selectionStart,
          end: element.selectionEnd,
        };
      setSelection(null);
    },
  };
}
