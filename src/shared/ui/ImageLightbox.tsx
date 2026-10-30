import { useT } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { AlertCircle, ImagePlus, Maximize2, Minus, Plus, X } from "./icons";
import { useOverlay } from "./overlay";
import { useImageZoom } from "../hooks/useImageZoom";
import { ImageCompare } from "./ImageCompare";
import { Button } from "./Button";
import { MediaToolbar, MediaToolbarButton } from "./MediaToolbar";

type Props = {
  src: string;
  alt: string;
  onClose: () => void;
};

/**
 * Modal image preview. Keyboard scope, Escape, inert background and focus return belong to
 * `useOverlay` (one overlay stack); the viewer owns only zoom, the compare state and the
 * load-failure recovery. View, compare and failed are mutually exclusive stage states.
 */
export function ImageLightbox(props: Props) {
  // A different image starts clean (load failure, retry attempt, comparison): remount keyed by `src`.
  return <ImageLightboxContent key={props.src} {...props} />;
}

function ImageLightboxContent({ src, alt, onClose }: Props) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [comparison, setComparison] = useState<{ url: string; name: string } | null>(null);
  const [compareError, setCompareError] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewing = !failed && !comparison;
  const imageZoom = useImageZoom(viewportRef, src, viewing);
  const zoomed = Math.abs(imageZoom.value.scale - 1) > 0.005;
  // The viewport that held focus unmounts on failure; hand focus to the recovery action.
  useEffect(() => {
    if (failed) retryRef.current?.focus();
  }, [failed]);
  useEffect(
    () => () => {
      if (comparison) URL.revokeObjectURL(comparison.url);
    },
    [comparison],
  );
  // The stage control (viewport, compare divider or Retry) takes initial focus, before the Close button.
  useOverlay(dialogRef, true, onClose, true, "[data-lightbox-focus], [data-handle]");

  const stopComparison = () => {
    setComparison(null);
    setCompareError(false);
  };

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("Image preview: {p0}", { p0: alt })}
      data-modal-layer="media"
      className="fixed inset-0 flex flex-col gap-3 p-4 max-[520px]:p-2"
      style={{ zIndex: LAYER.dialog }}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {/* The shared modal scrim, behind the viewer controls (they keep the media-on-dark ink). */}
      <div aria-hidden="true" className="modal-backdrop pointer-events-none absolute inset-0 -z-10" />
      <div className="flex shrink-0 items-center justify-between gap-3">
        <p title={alt} className="text-ui-secondary text-on-solid min-w-0 flex-1 truncate">
          {alt}
        </p>
        <MediaToolbarButton
          ref={closeRef}
          type="button"
          label={t("Close image preview")}
          tooltip={t("Close")}
          onClick={onClose}
        >
          <X className="icon-sm" strokeWidth={1.75} />
        </MediaToolbarButton>
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
        {failed ? (
          <div
            role="alert"
            className="text-ui-secondary text-on-solid flex flex-col items-center gap-3 text-center"
          >
            <AlertCircle className="icon-lg" aria-hidden />
            <p>{t("Preview unavailable. Try again.")}</p>
            <Button
              ref={retryRef}
              data-lightbox-focus=""
              variant="secondary"
              onClick={() => {
                setFailed(false);
                setAttempt((value) => value + 1);
              }}
            >
              {t("Retry")}
            </Button>
          </div>
        ) : comparison ? (
          <ImageCompare
            key={comparison.url}
            className="h-full max-w-[80rem]"
            before={<img src={src} alt={alt} style={{ objectFit: "contain" }} draggable={false} />}
            after={
              <img
                src={comparison.url}
                alt={comparison.name}
                style={{ objectFit: "contain" }}
                draggable={false}
                onError={() => setCompareError(true)}
              />
            }
            labels={[alt, comparison.name]}
            aspectRatio="auto"
          />
        ) : (
          <div
            ref={viewportRef}
            tabIndex={0}
            data-lightbox-focus=""
            role="group"
            aria-label={t("Image preview: {p0}", { p0: alt })}
            className="grid h-full w-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-center overflow-clip focus-visible:outline-offset-[-2px]"
            {...imageZoom.bindings}
            onClick={(event) => {
              if (event.target === event.currentTarget && !imageZoom.consumeClick()) onClose();
            }}
          >
            <img
              key={attempt}
              src={src}
              alt={alt}
              draggable={false}
              onError={() => setFailed(true)}
              className="max-h-full max-w-full select-none object-contain"
              style={imageZoom.style}
            />
          </div>
        )}
      </div>
      {compareError ? (
        <p role="alert" className="text-ui-secondary text-on-solid shrink-0 text-center">
          {t("Preview unavailable. Try again.")}
        </p>
      ) : null}
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
        {viewing ? (
          <MediaToolbar label={t("Zoom")}>
            <MediaToolbarButton
              label={t("Zoom out")}
              onClick={() => imageZoom.zoom(1 / 1.5)}
            >
              <Minus className="icon-sm" aria-hidden />
            </MediaToolbarButton>
            <span
              aria-live="polite"
              title={t("Zoom level")}
              className="text-ui-caption text-on-solid min-w-[3.25rem] text-center tabular-nums"
            >
              {Math.round(imageZoom.value.scale * 100)}%
            </span>
            <MediaToolbarButton label={t("Zoom in")} onClick={() => imageZoom.zoom(1.5)}>
              <Plus className="icon-sm" aria-hidden />
            </MediaToolbarButton>
            <MediaToolbarButton
              label={t("Reset zoom")}
              disabled={!zoomed}
              onClick={() => imageZoom.reset()}
            >
              <Maximize2 className="icon-sm" aria-hidden />
            </MediaToolbarButton>
          </MediaToolbar>
        ) : null}
        <input
          ref={pickerRef}
          type="file"
          accept="image/*"
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            if (!file.type.startsWith("image/")) {
              setCompareError(true);
              return;
            }
            setCompareError(false);
            setComparison({ url: URL.createObjectURL(file), name: file.name });
          }}
        />
        <Button
          variant="secondary"
          startIcon={<ImagePlus className="icon-sm" aria-hidden />}
          onClick={() => pickerRef.current?.click()}
        >
          {t("Compare with image")}
        </Button>
        {comparison ? (
          <Button variant="secondary" onClick={stopComparison}>
            {t("Stop comparison")}
          </Button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
