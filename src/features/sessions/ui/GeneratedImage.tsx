import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { readBinaryFile } from "../../../platform/tauri/fs";
import { formatFileSize, sniffImageMime } from "../../files/model/filePreview";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import type { GeneratedImageMeta } from "../model/session";
import { useNearViewport } from "./useNearViewport";

// Images start loading well before they scroll into view so their final height
// is settled by then; the last measured height is reused after a remount.
const NEAR_MARGIN_PX = 1000;
const knownHeights = new Map<string, number>();
const KNOWN_HEIGHT_LIMIT = 200;

/**
 * Keeps the visible transcript still when this image changes height entirely
 * above the viewport (scroll anchoring is disabled on the transcript).
 */
function useAboveViewportCompensation(ref: { current: HTMLElement | null }, key: string) {
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let previous = element.offsetHeight;
    const observer = new ResizeObserver(() => {
      const height = element.offsetHeight;
      const delta = height - previous;
      const oldBottom = element.getBoundingClientRect().top + previous;
      const measured = previous > 0 && height > 0;
      previous = height;
      if (!measured) return; // hidden panes collapse to 0; reveals restore scroll themselves
      if (element.querySelector("img")) {
        knownHeights.delete(key);
        knownHeights.set(key, height);
        if (knownHeights.size > KNOWN_HEIGHT_LIMIT)
          knownHeights.delete(knownHeights.keys().next().value!);
      }
      const scroller = element.closest<HTMLElement>(".agent-transcript");
      if (delta !== 0 && scroller && oldBottom <= scroller.getBoundingClientRect().top)
        scroller.scrollTop += delta;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, key]);
}

type State =
  | { status: "loading" }
  | { status: "ready"; url: string; size: number }
  | { status: "error" };

export function GeneratedImage({ image }: { image: GeneratedImageMeta }) {
  const t = useT();
  const [state, setState] = useState<State>({ status: "loading" });
  const [open, setOpen] = useState(false);
  const [nearBox, near] = useNearViewport<HTMLDivElement>(NEAR_MARGIN_PX);
  const box = useRef<HTMLDivElement | null>(null);
  const attachBox = (element: HTMLDivElement | null) => {
    box.current = element;
    nearBox.current = element;
  };
  useAboveViewportCompensation(box, image.path);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let created: string | null = null;
    setState({ status: "loading" });
    const bytes =
      image.data !== undefined || image.loadPreview
        ? Promise.resolve(image.data ?? image.loadPreview!()).then((data) =>
            Uint8Array.from(atob(data), (char) => char.charCodeAt(0)),
          )
        : readBinaryFile(image.path);
    void bytes.then(
      (bytes) => {
        if (cancelled) return;
        const mime = sniffImageMime(bytes);
        if (!mime) {
          setState({ status: "error" });
          return;
        }
        created = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setState({ status: "ready", url: created, size: bytes.byteLength });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
      if (created) {
        // Hibernating or unmounting drops the blob and the decoded bitmap with it.
        URL.revokeObjectURL(created);
        setState({ status: "loading" });
      }
    };
  }, [near, image.path, image.data, image.loadPreview]);

  const alt = image.alt || image.name;
  return (
    <div
      ref={attachBox}
      className="min-w-0"
      style={state.status === "loading" ? { minHeight: knownHeights.get(image.path) } : undefined}
    >
      {state.status === "loading" ? (
        <div className="px-4 py-3 text-xs text-(--ui-text-secondary)" role="status">
          {t("Loading generated image…")}
        </div>
      ) : state.status === "error" ? (
        <Alert tone="danger" role="alert">
          {t("Could not open generated image.")}
        </Alert>
      ) : (
        <div className="min-w-0 px-4 pb-3 pt-3">
          <Button
            fullWidth
            layout="media"
            label={t("Open {p0} full screen", { p0: image.name })}
            variant="item"
            type="button"
            aria-label={t("Open {p0} full screen", { p0: image.name })}
            title={t("Open {p0} full screen", { p0: image.name })}
            onClick={() => setOpen(true)}
            className="max-w-full"
          >
            <img
              src={state.url}
              alt={alt}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="mx-auto block h-auto w-auto max-h-[min(50dvh,480px)] max-w-full object-contain"
            />
          </Button>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-ui-micro text-(--ui-text-secondary)">
            <span className="truncate">{image.name}</span>
            <span>{formatFileSize(state.size)}</span>
          </div>
          {open ? <ImageLightbox src={state.url} alt={alt} onClose={() => setOpen(false)} /> : null}
        </div>
      )}
    </div>
  );
}
