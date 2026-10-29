import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  codeZoomOffset,
  codeZoomScale,
  subscribeCodeZoom,
  zoomCodeByWheel,
} from "../../files/editor/editorZoom";
import { anchoredScroll } from "../../files/ui/documentZoom";
import { diffRowMetrics } from "../model/unifiedDiffWindow";

/**
 * Ctrl+wheel zoom for a diff view. It shares the file editors' code size, so both
 * zoom together, and keeps the line under the pointer in place while rows resize.
 */
export function useDiffZoom(
  rootRef: RefObject<HTMLDivElement | null>,
  scrollerRef: RefObject<HTMLDivElement | null>,
  hasFiles: boolean,
) {
  const zoom = codeZoomScale(useSyncExternalStore(subscribeCodeZoom, codeZoomOffset));
  const rowMetrics = useMemo(() => diffRowMetrics(zoom), [zoom]);
  const zoomStyle = useMemo(
    () =>
      ({
        "--diff-zoom": zoom,
        "--diff-line-h": `${rowMetrics.line}px`,
        "--diff-fold-h": `${rowMetrics.fold}px`,
        "--diff-hunk-h": `${rowMetrics.hunk}px`,
        "--diff-code-font": `${12 * zoom}px`,
        "--diff-meta-font": `${11 * zoom}px`,
        "--diff-gutter-w": `${Math.round(48 * zoom)}px`,
      }) as CSSProperties,
    [rowMetrics, zoom],
  );
  const zoomAnchor = useRef<{ y: number; zoom: number } | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      const from = codeZoomScale();
      if (!zoomCodeByWheel(event)) return;
      event.preventDefault();
      const scroller = scrollerRef.current;
      if (scroller && !zoomAnchor.current) {
        zoomAnchor.current = {
          y: event.clientY - scroller.getBoundingClientRect().top,
          zoom: from,
        };
      }
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [hasFiles, rootRef, scrollerRef]);
  // Keep the line under the pointer in place while the rows grow or shrink.
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    zoomAnchor.current = null;
    const scroller = scrollerRef.current;
    if (!anchor || !scroller || anchor.zoom === zoom) return;
    const top = anchoredScroll(scroller.scrollTop, anchor.y, zoom / anchor.zoom);
    if (Number.isFinite(top)) scroller.scrollTop = Math.max(0, top);
  }, [zoom, scrollerRef]);

  return { zoom, rowMetrics, zoomStyle };
}
