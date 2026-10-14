import { createContext, useContext, useEffect, useRef, type RefObject } from "react";
import { scrollTopToCenter, type RulerMark } from "../../files/editor/overviewRuler";
import { OverviewRuler, scrollbarGutter } from "../../files/editor/overviewRulerView";

/**
 * Each file's rows publish their change marks (pixels from the top of an
 * anchor element); the ruler places them in the shared scroller. Files that
 * are not rendered yet still publish, since their row heights are known.
 */
type DiffOverviewSource = {
  anchor: () => HTMLElement | null;
  marks: RulerMark[];
};

export class DiffOverviewRegistry {
  readonly sources = new Map<string, DiffOverviewSource>();
  private listener: (() => void) | null = null;

  set(id: string, source: DiffOverviewSource) {
    this.sources.set(id, source);
    this.listener?.();
  }

  delete(id: string) {
    if (this.sources.delete(id)) this.listener?.();
  }

  subscribe(listener: () => void) {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }
}

export const DiffOverviewContext = createContext<DiffOverviewRegistry | null>(null);

export function useDiffOverviewSource(
  id: string,
  marks: RulerMark[],
  anchor: RefObject<HTMLElement | null>,
) {
  const registry = useContext(DiffOverviewContext);
  useEffect(() => {
    if (!registry) return;
    registry.set(id, { anchor: () => anchor.current, marks });
    return () => registry.delete(id);
  }, [registry, id, marks, anchor]);
}

export function DiffOverviewRuler({
  scrollerRef,
  registry,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  registry: DiffOverviewRegistry;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const slot = slotRef.current;
    const scroller = scrollerRef.current;
    if (!slot || !scroller) return;
    const ruler = new OverviewRuler(
      {
        marks: () => {
          const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
          const out: RulerMark[] = [];
          for (const source of registry.sources.values()) {
            const anchor = source.anchor();
            if (!anchor) continue;
            const origin = anchor.getBoundingClientRect().top - base;
            for (const mark of source.marks) {
              out.push({
                kind: mark.kind,
                top: mark.top + origin,
                bottom: mark.bottom + origin,
                pos: mark.pos + origin,
              });
            }
          }
          return out.sort((a, b) => a.top - b.top);
        },
        geometry: () => ({
          contentHeight: scroller.scrollHeight,
          viewportHeight: scroller.clientHeight,
          scrollTop: scroller.scrollTop,
        }),
        scrollTo: (top) => {
          scroller.scrollTop = top;
        },
        reveal: (y) => {
          scroller.scrollTop = scrollTopToCenter(y, scroller.scrollHeight, scroller.clientHeight);
        },
      },
      {
        interactive: true,
        band: true,
        beforeDraw: () => {
          // Left of the native scrollbar, never over it.
          ruler.dom.style.right = `${scrollbarGutter(scroller)}px`;
          // The toolbar above the scroller is not part of the track.
          ruler.dom.style.top = `${scroller.offsetTop}px`;
          ruler.dom.style.height = `${scroller.offsetHeight}px`;
          ruler.dom.style.bottom = "auto";
        },
      },
    );
    ruler.dom.style.width = "10px";
    ruler.dom.style.zIndex = "30";
    slot.appendChild(ruler.dom);

    const invalidate = () => ruler.invalidate();
    const unsubscribe = registry.subscribe(invalidate);
    const onScroll = () => ruler.schedule();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    // Files above growing, collapsing or loading move everything below them.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(invalidate);
    observer?.observe(scroller);
    if (scroller.lastElementChild) observer?.observe(scroller.lastElementChild);
    invalidate();
    return () => {
      unsubscribe();
      observer?.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      ruler.destroy();
    };
  }, [registry, scrollerRef]);

  return <div ref={slotRef} className="pointer-events-none absolute inset-0" />;
}
