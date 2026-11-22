import { LoadingText } from "../../../shared/ui/LoadingText";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { readBinaryFile, saveFileCopy } from "../../../platform/tauri/fs";
import { bytesToBase64, decodeBase64 } from "../../../shared/lib/base64";
import { errorText } from "../../../shared/lib/errors";
import { Download } from "../../../shared/ui/icons";
import { formatFileSize, sniffImageMime } from "../../files/public/filePreviewMetadata";
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
      // A turn wholly above the view is already compensated by useTurnScrollAnchor.
      const turn = element.closest<HTMLElement>("[data-transcript-turn]");
      const turnCompensated =
        turn?.dataset.transcriptVirtualizedTurn !== "true" &&
        turn != null &&
        turn.getBoundingClientRect().bottom - delta <= (scroller?.getBoundingClientRect().top ?? 0);
      if (
        delta !== 0 &&
        scroller &&
        !turnCompensated &&
        oldBottom <= scroller.getBoundingClientRect().top
      )
        scroller.scrollTop += delta;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, key]);
}

/** The session reader (remote Host) wins over a local path, like the preview. */
function readImageBytes(image: GeneratedImageMeta): Promise<Uint8Array<ArrayBuffer>> {
  return image.data !== undefined || image.loadPreview
    ? Promise.resolve(image.data ?? image.loadPreview!()).then((data) => decodeBase64(data))
    : readBinaryFile(image.path);
}

// Module-level so the try/finally stays out of the component the React Compiler compiles.
async function saveImageCopy(
  image: GeneratedImageMeta,
  update: (saving: boolean, error?: string) => void,
) {
  try {
    update(true);
    // The native dialog picks the destination; bytes are written as data, never opened.
    await saveFileCopy({ name: image.name, data: bytesToBase64(await readImageBytes(image)) });
    update(false);
  } catch (cause) {
    update(false, errorText(cause));
  }
}

type State =
  | { status: "loading" }
  | { status: "ready"; url: string; size: number }
  | { status: "error" };

export function GeneratedImage({ image }: { image: GeneratedImageMeta }) {
  const t = useT();
  const [state, setState] = useState<State>({ status: "loading" });
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState<{ owner: string; saving: boolean; error?: string }>();
  // A save result belongs to the image it was started for; a swapped image ignores it.
  const save = held?.owner === image.path ? held : { saving: false, error: undefined };
  const [nearBoxRef, near] = useNearViewport<HTMLDivElement>(NEAR_MARGIN_PX);
  const box = useRef<HTMLDivElement | null>(null);
  const attachBox = (element: HTMLDivElement | null) => {
    box.current = element;
    nearBoxRef.current = element;
  };
  useAboveViewportCompensation(box, image.path);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let created: string | null = null;
    setState({ status: "loading" });
    void readImageBytes(image).then(
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
        <LoadingText delay={false} inset="panel">
          {t("Loading generated image…")}
        </LoadingText>
      ) : state.status === "error" ? (
        <Alert tone="danger">{t("Could not open generated image.")}</Alert>
      ) : (
        <div className="min-w-0 px-4 pb-3 pt-3">
          <Button
            fullWidth
            layout="media"
            label={t("Open {p0} full screen", { p0: image.name })}
            variant="item"
            type="button"
            aria-label={t("Open {p0} full screen", { p0: image.name })}
            tooltip={t("Open {p0} full screen", { p0: image.name })}
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
          <Text
            as="div"
            size="micro"
            tone="secondary"
            className="mt-1 flex min-w-0 items-center gap-2"
          >
            <Text size="inherit" tone="inherit" truncate>
              {image.name}
            </Text>
            <span>{formatFileSize(state.size)}</span>
            <Button
              size="sm"
              iconOnly
              variant="ghost"
              type="button"
              label={t("Save {p0}", { p0: image.name })}
              aria-label={t("Save {p0}", { p0: image.name })}
              tooltip={t("Download")}
              disabled={save.saving}
              loading={save.saving}
              onClick={() => {
                if (save.saving) return;
                const owner = image.path;
                void saveImageCopy(image, (saving, error) => setHeld({ owner, saving, error }));
              }}
            >
              <Download className="icon-xs" strokeWidth={2} />
            </Button>
          </Text>
          {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
          {open ? <ImageLightbox src={state.url} alt={alt} onClose={() => setOpen(false)} /> : null}
        </div>
      )}
    </div>
  );
}
