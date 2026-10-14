import { useLayoutEffect, useRef, useState } from "react";

export const COLLAPSE_DURATION_MS = 220;

/** Measure once per toggle; neither React nor intrinsic grid sizing runs per frame. */
export function useCollapsibleHeight(open: boolean, immediate = false) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const [settledOpen, setSettledOpen] = useState(open);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!initialized.current || immediate || reduced) {
      initialized.current = true;
      viewport.style.transition = "none";
      viewport.style.height = open ? "auto" : "0px";
      setSettledOpen(open);
      return () => {
        viewport.style.removeProperty("transition");
      };
    }

    const from = viewport.getBoundingClientRect().height;
    const to = open ? content.scrollHeight : 0;
    setSettledOpen(false);
    viewport.style.transition = "none";
    viewport.style.height = `${from}px`;
    // Commit the start height before restoring the CSS transition.
    void viewport.offsetHeight;
    viewport.style.removeProperty("transition");
    viewport.dataset.animating = "true";
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      viewport.style.height = open ? "auto" : "0px";
      delete viewport.dataset.animating;
      setSettledOpen(open);
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === viewport && event.propertyName === "height") finish();
    };
    viewport.addEventListener("transitionend", onEnd);
    const frame = window.requestAnimationFrame(() => {
      viewport.style.height = `${to}px`;
      if (from === to) finish();
    });
    // Background WebViews may omit transitionend; never leave a promoted layer alive.
    const timer = window.setTimeout(finish, COLLAPSE_DURATION_MS + 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      viewport.removeEventListener("transitionend", onEnd);
      delete viewport.dataset.animating;
    };
  }, [open, immediate]);

  return { viewportRef, contentRef, settledOpen: open && settledOpen };
}
