import { editorSurfaceActive, observeEditorSurface } from "./editorSurfaceVisibility";
import {
  buildRulerSpans,
  scrollTopToCenter,
  spanAtY,
  trackToContentY,
  viewportBand,
  type RulerMark,
  type RulerSpan,
} from "./overviewRuler";

export type RulerHost = {
  /** Marks in scroll-content pixels. Called only after `invalidate()`. */
  marks(): RulerMark[];
  geometry(): {
    contentHeight: number;
    viewportHeight: number;
    scrollTop: number;
  };
  /** Sets the scroll position; the host clamps it. */
  scrollTo(top: number): void;
  /** Brings one mark into view, centred. */
  reveal(pos: number): void;
};

export type RulerOptions = {
  /** Takes presses and the wheel; off when something else owns the strip. */
  interactive: boolean;
  /** Draw the current viewport as a faint band. */
  band: boolean;
  /** Horizontal inset of the ticks inside the strip, in CSS pixels. */
  padLeft?: number;
  padRight?: number;
  /** Runs at the start of every frame, before the strip is measured. */
  beforeDraw?: () => void;
};

export const RULER_COLORS = {
  add: "--ui-diff-ruler-add",
  del: "--ui-diff-ruler-del",
  mod: "--ui-diff-ruler-mod",
  conflict: "--ui-diff-ruler-conflict",
} as const;

/**
 * Room to leave for a scrollbar, in CSS pixels. A classic scrollbar takes layout
 * width, so it is measured; an overlay one (macOS) takes none but still appears
 * over the edge when scrolling, so a fixed gutter keeps it grabbable.
 */
export function scrollbarGutter(scroller: HTMLElement): number {
  const measured = scroller.offsetWidth - scroller.clientWidth;
  return measured > 0 ? measured : 12;
}

/**
 * One canvas that draws merged change ticks and the viewport band. The owner
 * places `dom` (position, width, z-index); this class paints, maps presses to
 * scroll positions and redraws at most once per frame.
 */
export class OverviewRuler {
  readonly dom = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private readonly resizeObserver: ResizeObserver | null;
  private frame = 0;
  private dirty = true;
  private hasMarks = false;
  private marks: RulerMark[] = [];
  private spans: RulerSpan[] = [];
  private spansFor = { content: -1, track: -1 };
  private pointerId: number | null = null;
  private stopObserving: (() => void) | null = null;

  constructor(
    private readonly host: RulerHost,
    private readonly options: RulerOptions,
  ) {
    const style = this.dom.style;
    style.position = "absolute";
    style.top = "0";
    style.bottom = "0";
    style.color = "var(--color-content)";
    style.cursor = "default";
    style.userSelect = "none";
    style.visibility = "hidden";
    style.pointerEvents = "none";
    this.dom.setAttribute("aria-hidden", "true");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "none";
    this.dom.append(this.canvas);
    if (options.interactive) {
      this.dom.addEventListener("pointerdown", this.onPointerDown);
      this.dom.addEventListener("pointermove", this.onPointerMove);
      this.dom.addEventListener("pointerup", this.onPointerEnd);
      this.dom.addEventListener("pointercancel", this.onPointerEnd);
      this.dom.addEventListener("lostpointercapture", this.onPointerEnd);
      this.dom.addEventListener("wheel", this.onWheel, { passive: false });
    }
    this.resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(this.schedule);
    this.resizeObserver?.observe(this.dom);
  }

  /** Marks or geometry changed: recompute the ticks on the next frame. */
  invalidate() {
    this.dirty = true;
    this.schedule();
  }

  /** Only the scroll position changed: repaint the band. */
  readonly schedule = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  };

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver?.disconnect();
    this.stopObserving?.();
    this.releasePointer();
    this.dom.remove();
  }

  /** The small tick under a client y, for a press that should land on it. */
  tickAt(clientY: number): RulerSpan | null {
    if (!editorSurfaceActive(this.dom)) return null;
    return spanAtY(this.spans, clientY - this.dom.getBoundingClientRect().top);
  }

  private draw() {
    this.stopObserving ??= observeEditorSurface(this.dom, this.schedule);
    if (!editorSurfaceActive(this.dom)) {
      this.dom.style.visibility = "hidden";
      this.dom.style.pointerEvents = "none";
      this.releasePointer();
      return;
    }
    this.options.beforeDraw?.();
    if (this.dirty) {
      this.dirty = false;
      this.marks = this.host.marks();
      this.hasMarks = this.marks.length > 0;
      this.spansFor = { content: -1, track: -1 };
    }
    // Hidden by visibility, not display: a collapsed box could not be measured
    // again when marks come back.
    this.dom.style.visibility = this.hasMarks ? "inherit" : "hidden";
    this.dom.style.pointerEvents = this.hasMarks && this.options.interactive ? "auto" : "none";
    const track = this.dom.clientHeight;
    const width = this.dom.clientWidth;
    const geometry = this.host.geometry();
    if (this.spansFor.content !== geometry.contentHeight || this.spansFor.track !== track) {
      this.spansFor = { content: geometry.contentHeight, track };
      this.spans = buildRulerSpans(this.marks, geometry.contentHeight, track);
    }
    if (!this.hasMarks || track === 0 || width === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(track * dpr);
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, track);

    if (this.options.band) {
      const band = viewportBand(
        geometry.scrollTop,
        geometry.viewportHeight,
        geometry.contentHeight,
        track,
      );
      if (band) {
        context.fillStyle = getComputedStyle(this.dom).getPropertyValue("--ui-surface-selected");
        context.fillRect(0, band.top, width, band.height);
      }
    }
    const left = this.options.padLeft ?? 1;
    const inner = Math.max(1, width - left - (this.options.padRight ?? 1));
    const style = getComputedStyle(this.dom);
    const forcedColors = window.matchMedia("(forced-colors: active)").matches;
    for (const span of this.spans) {
      context.fillStyle = forcedColors
        ? "CanvasText"
        : style.getPropertyValue(RULER_COLORS[span.kind]);
      context.fillRect(left, span.top, inner, span.bottom - span.top);
    }
  }

  private scrollToPointer(clientY: number) {
    const track = this.dom.clientHeight;
    const geometry = this.host.geometry();
    const y = clientY - this.dom.getBoundingClientRect().top;
    const contentY = trackToContentY(y, track, geometry.contentHeight);
    this.host.scrollTo(
      scrollTopToCenter(contentY, geometry.contentHeight, geometry.viewportHeight),
    );
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (
      !editorSurfaceActive(this.dom) ||
      event.defaultPrevented ||
      event.pointerType === "touch" ||
      event.button !== 0 ||
      this.pointerId !== null
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const tick = this.tickAt(event.clientY);
    if (tick) {
      this.host.reveal(tick.pos);
      return;
    }
    this.scrollToPointer(event.clientY);
    try {
      this.dom.setPointerCapture(event.pointerId);
      this.pointerId = event.pointerId;
    } catch {
      this.pointerId = null;
    }
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    if (!editorSurfaceActive(this.dom)) {
      this.releasePointer();
      return;
    }
    event.preventDefault();
    this.scrollToPointer(event.clientY);
  };

  private readonly onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.releasePointer();
  };

  private releasePointer() {
    const pointer = this.pointerId;
    this.pointerId = null;
    if (pointer !== null && this.dom.hasPointerCapture?.(pointer))
      this.dom.releasePointerCapture(pointer);
  }

  /** The strip sits beside the scroller, so the wheel has to be handed over. */
  private readonly onWheel = (event: WheelEvent) => {
    if (
      !editorSurfaceActive(this.dom) ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.deltaY === 0
    )
      return;
    const geometry = this.host.geometry();
    if (geometry.contentHeight <= geometry.viewportHeight) return;
    const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? geometry.viewportHeight : 1;
    event.preventDefault();
    this.host.scrollTo(geometry.scrollTop + event.deltaY * scale);
  };
}
