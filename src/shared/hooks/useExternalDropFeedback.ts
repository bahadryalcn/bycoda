import { useCallback, useEffect, useRef } from "react";
import {
  endExternalDrop,
  showExternalDrop,
  type ExternalDropPointer,
  type ExternalDropVerdict,
} from "../lib/externalDrop";

/**
 * Drop mark and cursor badge for files dragged in from outside the document. `show` is safe to
 * call on every drag-over; `hide` is safe to call when nothing is showing. The hook also ends the
 * feedback on Escape, window blur, the end of a drag and unmount, so a receiver only has to call
 * `hide` for its own leave and drop events.
 */
export function useExternalDropFeedback() {
  const showing = useRef(false);
  const hide = useCallback(() => {
    if (!showing.current) return;
    showing.current = false;
    endExternalDrop();
  }, []);
  const show = useCallback(
    (target: HTMLElement | null, verdict: ExternalDropVerdict, pointer: ExternalDropPointer) => {
      showing.current = true;
      showExternalDrop(target, verdict, pointer);
    },
    [],
  );
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onEscape);
    window.addEventListener("blur", hide);
    window.addEventListener("dragend", hide);
    return () => {
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("blur", hide);
      window.removeEventListener("dragend", hide);
      hide();
    };
  }, [hide]);
  return { show, hide };
}
