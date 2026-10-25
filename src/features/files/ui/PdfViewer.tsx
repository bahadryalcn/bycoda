import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { t, useLocale } from "../../../shared/i18n/technical";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
// The worker is bundled as a hashed asset, so it loads from the app's own
// origin (allowed by `script-src 'self'`) and works offline. The legacy build
// avoids syntax older macOS WebKit versions reject.
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { Minus, Plus } from "../../../shared/ui/icons";
import { PdfRasterBudget, pdfRasterSize } from "../model/pdfRasterBudget";
import { documentErrorMessage } from "../model/documentViewer";
import { DocumentMessage } from "./DocumentMessage";
import {
  clampZoom,
  formatZoomPercent,
  recalledZoom,
  rememberZoom,
  useWheelZoom,
} from "./documentZoom";
import "./pdfTextLayer.css";

GlobalWorkerOptions.workerSrc = workerUrl;

const rasterBudget = new PdfRasterBudget();

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_STEP = 1.25;
// After the last wheel tick, how long to wait before re-rasterising at the new scale.
const SETTLE_MS = 160;
const PAGE_GAP = 12;
const SIDE_PADDING = 32;

type Size = readonly [width: number, height: number];
type Zoom = "fit" | number;

/** The page point under the pointer: which page, and where within it. */
type Anchor = {
  page: number;
  fx: number;
  fy: number;
  x: number;
  y: number;
};

export default function PdfViewer({
  bytes,
  trailing,
}: {
  bytes: Uint8Array;
  trailing?: ReactNode;
}) {
  useLocale();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // pdf.js transfers the buffer to its worker; hand it a copy so `bytes`
    // stays valid for a remount or reload.
    // The JPEG 2000 wasm decoder would need a `connect-src` entry, so it's off.
    const task = getDocument({ data: bytes.slice(), useWasm: false });
    task.promise.then(
      (loaded) => {
        if (!cancelled) setDoc(loaded);
      },
      (cause: unknown) => {
        if (!cancelled) setError(documentErrorMessage(cause));
      },
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes]);

  if (error)
    return (
      <DocumentMessage title={t("Couldn’t read this PDF")} error>
        {error}
      </DocumentMessage>
    );
  if (!doc) {
    return (
      <div className="grid h-full place-items-center text-ui-caption text-[var(--ui-text-muted)]">
        {t("Loading PDF…")}
      </div>
    );
  }
  return <PdfPages doc={doc} trailing={trailing} />;
}

function PdfPages({ doc, trailing }: { doc: PDFDocumentProxy; trailing?: ReactNode }) {
  useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<Zoom>(() => recalledZoom("pdf") ?? "fit");
  const [pageState, setPageState] = useState({ current: 1, input: "1" });
  const { current, input: pageInput } = pageState;
  const setCurrent = useCallback((current: number) => {
    setPageState((previous) =>
      previous.current === current ? previous : { current, input: String(current) },
    );
  }, []);
  const setPageInput = (input: string) => setPageState((previous) => ({ ...previous, input }));
  // Unscaled page sizes; pages not yet measured borrow the first page's.
  const [sizes, setSizes] = useState<Record<number, Size>>({});
  const pendingAnchor = useRef<Anchor | null>(null);
  const observedWidth = useRef(0);
  const rememberAnchor = () => {
    const element = scrollRef.current;
    if (!element || pendingAnchor.current) return;
    const rect = element.getBoundingClientRect();
    pendingAnchor.current = anchorAt(
      element,
      rect.left + element.clientWidth / 2,
      rect.top + element.clientHeight / 2,
    );
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (observedWidth.current === element.clientWidth) return;
      observedWidth.current = element.clientWidth;
      rememberAnchor();
      setWidth(element.clientWidth);
    });
    observer.observe(element);
    setWidth(element.clientWidth);
    observedWidth.current = element.clientWidth;
    return () => observer.disconnect();
  }, []);

  const first = sizes[1];
  const fitScale = first ? clampZoom((width - SIDE_PADDING) / first[0], MIN_SCALE, MAX_SCALE) : 1;
  const scale = zoom === "fit" ? fitScale : zoom;
  // Geometry follows the gesture every frame; only the committed scale below
  // drives PDF rendering. This keeps virtual offsets, gaps and stretched
  // bitmaps in agreement without rasterizing on every wheel event.
  const [gestureScale, setGestureScale] = useState<number | null>(null);
  const visualScale = gestureScale ?? scale;
  const pageHeight = (number: number) =>
    Math.floor((sizes[number] ?? first ?? [600, 800])[1] * visualScale);
  const pageStart = (number: number) => {
    let start = 0;
    for (let page = 1; page < number; page++) start += pageHeight(page) + PAGE_GAP;
    return start;
  };
  // Invalidate estimated offsets during render, before the spacer commits its
  // new height. There are no independently measured DOM heights to retain.
  const geometryKey = useCallback((index: number) => index, [sizes, visualScale]);
  const pages = useVirtualizer({
    count: doc.numPages,
    getScrollElement: () => scrollRef.current,
    getItemKey: geometryKey,
    estimateSize: (index) => pageHeight(index + 1) + PAGE_GAP,
    overscan: 2,
    initialRect: { width: 0, height: 800 },
    rangeExtractor: (range) => {
      const anchor = pendingAnchor.current;
      if (!anchor) return defaultRangeExtractor(range);
      // Until the layout effect synchronizes scrollTop, select the new range
      // from the anchor. Otherwise a deep page can unmount for one commit and
      // unnecessarily discard its still-valid bitmap during a wheel gesture.
      let start = anchor.page - 1;
      let top = pageStart(anchor.page);
      const offset = Math.max(0, top + anchor.fy * pageHeight(anchor.page) - anchor.y);
      while (start > 0 && top > offset) {
        start--;
        top -= pageHeight(start + 1) + PAGE_GAP;
      }
      let end = start;
      let bottom = top + pageHeight(end + 1) + PAGE_GAP;
      const height = scrollRef.current?.clientHeight || 800;
      while (end < doc.numPages - 1 && bottom < offset + height) {
        end++;
        bottom += pageHeight(end + 1) + PAGE_GAP;
      }
      return Array.from(
        {
          length:
            Math.min(doc.numPages - 1, end + range.overscan) -
            Math.max(0, start - range.overscan) +
            1,
        },
        (_, index) => Math.max(0, start - range.overscan) + index,
      );
    },
  });
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    if (!element || !anchor) return;
    const padding = Number.parseFloat(getComputedStyle(element).paddingTop) || 0;
    const pageWidth = Math.floor((sizes[anchor.page] ?? first ?? [600, 800])[0] * visualScale);
    // A virtual page may have unmounted between capture and commit. Restore
    // from its stable page number and current metrics, never a detached node.
    const top = padding + pageStart(anchor.page) + anchor.fy * pageHeight(anchor.page) - anchor.y;
    const left =
      Math.max(0, (element.clientWidth - pageWidth) / 2) + anchor.fx * pageWidth - anchor.x;
    pages.scrollToOffset(top);
    element.scrollLeft = left;
  }, [pages, sizes, visualScale, scale, width]);

  const onSize = useCallback((page: number, size: Size) => {
    setSizes((prev) => {
      const known = prev[page];
      if (known && known[0] === size[0] && known[1] === size[1]) return prev;
      rememberAnchor();
      return { ...prev, [page]: size };
    });
  }, []);

  const goTo = (page: number) => {
    const target = clampZoom(Math.round(page) || 1, 1, doc.numPages);
    pages.scrollToIndex(target - 1, { align: "start" });
    setCurrent(target);
    setPageInput(String(target));
  };

  const changeZoom = (next: Zoom) => {
    if ((next === "fit" ? fitScale : next) !== visualScale) rememberAnchor();
    rememberZoom("pdf", next);
    setZoom(next);
  };

  // Ctrl/Cmd+wheel changes the page/virtual geometry while retaining the
  // existing canvases. Once the gesture settles, visible pages re-rasterize.
  const gesture = useRef<{
    target: number | null;
    timer: number;
  }>({ target: null, timer: 0 });
  const scaleRef = useRef(scale);
  const percentRef = useRef<HTMLSpanElement>(null);

  const endGesture = () => {
    const g = gesture.current;
    window.clearTimeout(g.timer);
    g.target = null;
    setGestureScale(null);
  };

  const onWheelZoom = (factor: number, clientX: number, clientY: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const g = gesture.current;
    const visual = g.target ?? scaleRef.current;
    const next = clampZoom(visual * factor, MIN_SCALE, MAX_SCALE);
    if (next === visual) return;
    const anchor = anchorAt(element, clientX, clientY);
    g.target = next;
    pendingAnchor.current = anchor;
    setGestureScale(next);
    if (percentRef.current) {
      percentRef.current.textContent = formatZoomPercent(next);
    }
    window.clearTimeout(g.timer);
    g.timer = window.setTimeout(() => {
      g.timer = 0;
      if (g.target == null) return;
      const target = g.target;
      changeZoom(target);
      endGesture();
    }, SETTLE_MS);
  };
  useWheelZoom(scrollRef, onWheelZoom);

  useLayoutEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => () => window.clearTimeout(gesture.current.timer), []);

  const zoomBy = (factor: number) => {
    const base = gesture.current.target ?? scale;
    endGesture();
    changeZoom(clampZoom(base * factor, MIN_SCALE, MAX_SCALE));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-stroke px-3 text-ui-micro text-[var(--ui-text-secondary)]">
        <TextField
          hideLabel
          label=""
          aria-label={t("Page number")}
          fieldClassName="w-10 shrink-0"
          value={pageInput}
          inputMode="numeric"
          onChange={(event) => setPageInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") goTo(Number(pageInput));
          }}
          onBlur={() => setPageInput(String(current))}
          className="w-10 text-center tabular-nums"
        />
        <span className="tabular-nums">/ {doc.numPages}</span>
        <span className="flex-1" />
        <ToolbarButton label={t("Zoom out")} onClick={() => zoomBy(1 / ZOOM_STEP)}>
          <Minus className="size-3" strokeWidth={1.75} />
        </ToolbarButton>
        <span ref={percentRef} className="w-10 text-center tabular-nums">
          {formatZoomPercent(scale)}
        </span>
        <ToolbarButton label={t("Zoom in")} onClick={() => zoomBy(ZOOM_STEP)}>
          <Plus className="size-3" strokeWidth={1.75} />
        </ToolbarButton>
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          title={t("Fit to width")}
          onClick={() => {
            endGesture();
            changeZoom("fit");
          }}
          className={""}
        >
          {t("Fit width")}
        </Button>
        {trailing}
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-(--ui-surface-muted) py-3"
        style={{ overflowAnchor: "none" }}
      >
        <div className="relative w-full" style={{ height: pages.getTotalSize() }}>
          {pages.getVirtualItems().map((item) => {
            const number = item.index + 1;
            return (
              <div
                key={number}
                data-index={item.index}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start}px)`, paddingBottom: PAGE_GAP }}
              >
                <PdfPage
                  doc={doc}
                  number={number}
                  scale={scale}
                  visualScale={visualScale}
                  size={sizes[number] ?? first}
                  root={scrollRef}
                  onSize={onSize}
                  onCenter={setCurrent}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PdfPage({
  doc,
  number,
  scale,
  visualScale,
  size,
  root,
  onSize,
  onCenter,
}: {
  doc: PDFDocumentProxy;
  number: number;
  scale: number;
  visualScale: number;
  size: Size | undefined;
  root: React.RefObject<HTMLDivElement | null>;
  onSize: (page: number, size: Size) => void;
  onCenter: (page: number) => void;
}) {
  useLocale();
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Only pages within a screen or so of the viewport are rasterized; the rest
  // stay as empty frames, so a 300-page file costs a handful of canvases.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries[entries.length - 1].isIntersecting),
      { root: root.current, rootMargin: "100% 0px" },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [root]);

  // The page crossing the middle of the viewport is the "current" one.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[entries.length - 1].isIntersecting) onCenter(number);
      },
      { root: root.current, rootMargin: "-50% 0px -50% 0px" },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [root, number, onCenter]);

  // Offscreen pages do not retain bitmap or text allocations.
  useEffect(() => {
    if (near) return;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    textRef.current?.replaceChildren();
  }, [near]);

  useEffect(() => {
    const canvas = canvasRef.current;
    return () => {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const text = textRef.current;
    if (!near || !canvas || !text) return;
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let textLayer: TextLayer | null = null;
    const allocation = new AbortController();
    let release: ((pixels?: number) => void) | undefined;
    let rendering = false;
    let copied = false;
    let page: PDFPageProxy | undefined;
    let settled = false;
    // Resolution is budgeted independently of CSS/text zoom. Reserve both canvases
    // before allocating, and release the temporary half as soon as copying ends.
    const buffer = document.createElement("canvas");
    const releaseBuffer = () => {
      buffer.width = 0;
      buffer.height = 0;
    };
    setError(null);

    void (async () => {
      page = await doc.getPage(number);
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      onSize(number, [natural.width, natural.height]);
      const viewport = page.getViewport({ scale });
      const raster = pdfRasterSize(viewport.width, viewport.height, window.devicePixelRatio);
      const pixels = raster.width * raster.height;
      release = await rasterBudget.reserve(pixels * 2, allocation.signal);
      if (cancelled) {
        release();
        return;
      }
      const ratio = raster.ratio;
      buffer.width = raster.width;
      buffer.height = raster.height;
      rendering = true;
      const task = page.render({
        canvas: buffer,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      renderTask = task;
      await task.promise;
      rendering = false;
      if (cancelled) return;
      canvas.width = buffer.width;
      canvas.height = buffer.height;
      canvas.getContext("2d")?.drawImage(buffer, 0, 0);
      releaseBuffer();
      copied = true;
      release(pixels);
      text.replaceChildren();
      textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: text,
        viewport,
      });
      await textLayer.render();
    })()
      .catch((cause: unknown) => {
        if (cancelled || (cause instanceof Error && cause.name === "RenderingCancelledException"))
          return;
        canvas.width = 0;
        canvas.height = 0;
        release?.();
        text.replaceChildren();
        setError(documentErrorMessage(cause));
      })
      .finally(() => {
        settled = true;
        rendering = false;
        releaseBuffer();
        // cancel() requests cancellation; the render promise owns the buffer
        // until it actually settles. Keep its allocation charged meanwhile.
        if (cancelled || !copied) release?.();
        if (cancelled) page?.cleanup();
      });

    return () => {
      cancelled = true;
      allocation.abort();
      renderTask?.cancel();
      textLayer?.cancel();
      if (settled) page?.cleanup();
      canvas.width = 0;
      canvas.height = 0;
      if (!rendering) {
        releaseBuffer();
        release?.();
      }
    };
  }, [doc, number, scale, near, onSize, attempt]);

  // Keep unmeasured frames visible to IntersectionObserver so their page load
  // (and any page-specific failure) does not depend on eager getPage(1).
  const width = Math.floor((size?.[0] ?? 600) * visualScale);
  const height = Math.floor((size?.[1] ?? 800) * visualScale);

  return (
    <div
      ref={frameRef}
      data-page={number}
      className="relative mx-auto shrink-0 bg-on-solid shadow-sm"
      style={
        {
          width,
          height,
          "--total-scale-factor": visualScale,
        } as React.CSSProperties
      }
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div ref={textRef} className="pdf-text-layer" />
      {error && (
        <div className="absolute inset-0">
          <DocumentMessage title={t("Couldn’t render page {p0}", { p0: number })} error>
            <p>{error}</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              {t("Retry page {p0}", { p0: number })}
            </Button>
          </DocumentMessage>
        </div>
      )}
    </div>
  );
}

/** Which page, and where on it, is under the given viewport point. */
function anchorAt(container: HTMLElement, clientX: number, clientY: number): Anchor | null {
  const frames = container.querySelectorAll<HTMLElement>("[data-page]");
  let hit: HTMLElement | null = null;
  let rect: DOMRect | null = null;
  for (const frame of frames) {
    const bounds = frame.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    hit = frame;
    rect = bounds;
    if (rect.bottom > clientY) break;
  }
  if (!hit || !rect) return null;
  return {
    page: Number(hit.dataset.page),
    fx: clampZoom((clientX - rect.left) / (rect.width || 1), 0, 1),
    fy: clampZoom((clientY - rect.top) / (rect.height || 1), 0, 1),
    x: clientX - container.getBoundingClientRect().left,
    y: clientY - container.getBoundingClientRect().top,
  };
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  useLocale();
  return (
    <Button
      size="sm"
      iconOnly
      label={label}
      variant="ghost"
      motion="none"
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid place-items-center"
    >
      {children}
    </Button>
  );
}
