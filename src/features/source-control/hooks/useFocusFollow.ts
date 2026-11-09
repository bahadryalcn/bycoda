import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

type FocusFollowOptions = {
  fileRefs: RefObject<Map<string, HTMLElement>>;
  scrollerRef: RefObject<HTMLDivElement | null>;
  fileLayout: "stacked" | "cards";
  resolvedFocusId: string | undefined;
  focusRequest: number | undefined;
  fileKey: string;
  initialExpansion: string;
  open: Set<string>;
  setOpen: Dispatch<SetStateAction<Set<string>>>;
};

/**
 * The focused file stays pinned to the top while diffs above it load and grow,
 * until the reader scrolls or clicks in the view themselves.
 */
export function useFocusFollow({
  fileRefs,
  scrollerRef,
  fileLayout,
  resolvedFocusId,
  focusRequest,
  fileKey,
  initialExpansion,
  open,
  setOpen,
}: FocusFollowOptions) {
  const followFocusRef = useRef<string | null>(null);
  const scrollToFocus = useCallback(() => {
    const id = followFocusRef.current;
    const node = id ? fileRefs.current.get(id) : undefined;
    const scroller = scrollerRef.current;
    if (!node) return;
    if (!scroller) {
      node.scrollIntoView({ block: "start" });
      return;
    }
    // Measure against the scroller itself: it isn't the section's offsetParent,
    // so offsetTop would also count the toolbar above it.
    const offset =
      node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const top = Math.max(0, offset - (fileLayout === "cards" ? 8 : 0));
    if (Math.abs(scroller.scrollTop - top) > 1) scroller.scrollTo({ top });
  }, [fileLayout, fileRefs, scrollerRef]);
  const releaseFocus = useCallback(() => {
    followFocusRef.current = null;
  }, []);
  const openFocusedFile = useCallback(() => {
    const id = followFocusRef.current;
    if (!id || !fileRefs.current.has(id)) return;
    setOpen((current) => (current.has(id) ? current : new Set(current).add(id)));
    scrollToFocus();
  }, [fileRefs, scrollToFocus, setOpen]);

  // Only a new selection starts following.
  useEffect(() => {
    followFocusRef.current = resolvedFocusId ?? null;
    openFocusedFile();
  }, [resolvedFocusId, focusRequest, openFocusedFile]);

  // A refreshed file list re-anchors a file still being followed, but never
  // resumes one the reader already scrolled away from.
  useEffect(() => {
    openFocusedFile();
  }, [fileKey, initialExpansion, openFocusedFile]);

  // Expansion can change the scroll limit. Re-anchor after it reaches the DOM.
  useLayoutEffect(() => {
    scrollToFocus();
  }, [open, scrollToFocus]);

  const contentObserverRef = useRef<ResizeObserver | null>(null);
  const bindContent = useCallback(
    (el: HTMLDivElement | null) => {
      contentObserverRef.current?.disconnect();
      contentObserverRef.current = null;
      if (!el || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(scrollToFocus);
      observer.observe(el);
      contentObserverRef.current = observer;
    },
    [scrollToFocus],
  );

  return { releaseFocus, bindContent };
}
