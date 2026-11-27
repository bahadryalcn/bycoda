import { Skeleton, SkeletonBar } from "../../../shared/ui/Skeleton";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { readBinaryFile, saveFileCopy } from "../../../platform/tauri/fs";
import { bytesToBase64, decodeBase64 } from "../../../shared/lib/base64";
import { errorText } from "../../../shared/lib/errors";
import { Download } from "../../../shared/ui/icons";
import { formatFileSize, sniffImageMime } from "../../files/public/filePreviewMetadata";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import type { GeneratedImageMeta, ImageGenerationMeta } from "../model/session";
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

export function GeneratedImage({
  image,
  generation,
}: {
  image?: GeneratedImageMeta;
  generation?: ImageGenerationMeta;
}) {
  const t = useT();
  const [state, setState] = useState<State>({ status: "loading" });
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState<{ owner: string; saving: boolean; error?: string }>();
  // A save result belongs to the image it was started for; a swapped image ignores it.
  const save = held && held.owner === image?.path ? held : { saving: false, error: undefined };
  const [nearBoxRef, near] = useNearViewport<HTMLDivElement>(NEAR_MARGIN_PX);
  const box = useRef<HTMLDivElement | null>(null);
  const attachBox = (element: HTMLDivElement | null) => {
    box.current = element;
    nearBoxRef.current = element;
  };
  useAboveViewportCompensation(box, generation?.itemId ?? image?.path ?? "");

  useEffect(() => {
    // Read only after the provider publishes the asset and the frame nears the viewport.
    if (!near || !image) return;
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
  }, [near, image?.path, image?.data, image?.loadPreview]);

  const ready = image && state.status === "ready";
  const alt = image?.alt || image?.name || "";
  const loadingHeight =
    !generation && image && state.status === "loading" ? knownHeights.get(image.path) : undefined;
  return (
    <div
      ref={attachBox}
      className="min-w-0 min-h-(--generated-image-loading-height)"
      style={
        loadingHeight === undefined
          ? undefined
          : ({ "--generated-image-loading-height": `${loadingHeight}px` } as CSSProperties)
      }
    >
      {generation?.status === "stopped" ? (
        <InlineMessage tone="neutral">{t("Stopped")}</InlineMessage>
      ) : generation?.status === "failed" ? (
        <InlineError>{t("Could not generate image.")}</InlineError>
      ) : state.status === "error" ? (
        <InlineError>{t("Could not open generated image.")}</InlineError>
      ) : (
        <div className="min-w-0 px-4 py-3">
          <div
            {...surfaceAttributes(
              { frame: "card", radius: "card" },
              generation
                ? "relative overflow-hidden"
                : ready
                  ? "w-fit max-w-full overflow-hidden"
                  : "aspect-video w-[min(100%,32.5rem)] overflow-hidden",
            )}
            data-generated-image-fixed-frame={generation ? "" : undefined}
            data-generated-image-placeholder={ready ? undefined : ""}
            style={
              generation?.aspectRatio === undefined
                ? undefined
                : ({ "--generated-image-aspect": generation.aspectRatio } as CSSProperties)
            }
          >
            {ready ? (
              <Button
                fullWidth
                layout="media"
                label={t("Open {p0} full screen", { p0: image.name })}
                variant="item"
                type="button"
                onClick={() => setOpen(true)}
                className={generation ? "absolute inset-0 max-w-full" : "max-w-full"}
              >
                <img
                  src={state.url}
                  alt={alt}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className={
                    generation
                      ? "block size-full object-contain"
                      : "mx-auto block h-auto w-auto max-h-[min(50dvh,480px)] max-w-full object-contain"
                  }
                />
              </Button>
            ) : generation ? (
              <Skeleton
                delay={false}
                label={generation.status === "running" ? t("Generating image…") : undefined}
                className="absolute inset-0"
                placeholder={<SkeletonBar height="100%" className="absolute inset-0" />}
              />
            ) : (
              <Skeleton delay={false} className="h-full w-full" />
            )}
          </div>
          {ready ? (
            <>
              <Text
                as="div"
                size="micro"
                tone="inherit"
                className="mt-1.5 flex min-w-0 items-center gap-2 text-(--transcript-ink-faint)"
                data-generated-image-caption={generation ? "" : undefined}
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
              {save.error ? <InlineError details={save.error} /> : null}
              {open ? (
                <ImageLightbox src={state.url} alt={alt} onClose={() => setOpen(false)} />
              ) : null}
            </>
          ) : generation ? (
            <div className="mt-1.5" data-generated-image-caption />
          ) : null}
        </div>
      )}
    </div>
  );
}
