import { t, useLocale } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { X } from "./icons";
import { useOverlay } from "./overlay";
import { useImageZoom } from "../hooks/useImageZoom";
import { ImageCompare } from "./ImageCompare";
import { Button } from "./Button";

type Props = {
  src: string;
  alt: string;
  onClose: () => void;
};

export function ImageLightbox({ src, alt, onClose }: Props) {
  useLocale();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [comparison, setComparison] = useState<{ url: string; name: string } | null>(null);
  const [compareError, setCompareError] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageZoom = useImageZoom(viewportRef, src, !failed && !comparison);
  useEffect(() => setFailed(false), [src]);
  useEffect(() => {
    setComparison(null);
    setCompareError(false);
  }, [src]);
  useEffect(
    () => () => {
      if (comparison) URL.revokeObjectURL(comparison.url);
    },
    [comparison],
  );
  useOverlay(dialogRef, true, onClose);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("Image preview: {p0}", { p0: alt })}
      className="fixed inset-0 flex items-center justify-center bg-scrim/85 p-6 backdrop-blur-sm"
      style={{ zIndex: LAYER.dialog }}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {failed ? (
        <p role="alert" className="text-center text-sm text-on-solid">
          {t("Preview unavailable. Try again.")}
        </p>
      ) : comparison ? (
        <div className="bycoda-image-comparison">
          <ImageCompare
            key={comparison.url}
            before={
              <img
                src={src}
                alt={alt}
                style={{ objectFit: "contain" }}
                onError={() => setFailed(true)}
              />
            }
            after={
              <img
                src={comparison.url}
                alt={comparison.name}
                style={{ objectFit: "contain" }}
                onError={() => setCompareError(true)}
              />
            }
            labels={[alt, comparison.name]}
            aspectRatio="auto"
          />
          {compareError ? <p role="alert">{t("Preview unavailable. Try again.")}</p> : null}
        </div>
      ) : (
        <div
          ref={viewportRef}
          tabIndex={0}
          autoFocus
          role="group"
          aria-label={t("Image preview: {p0}", { p0: alt })}
          className="grid h-full w-full place-items-center overflow-clip"
          {...imageZoom.bindings}
          onClick={(event) => {
            if (event.target === event.currentTarget && !imageZoom.consumeClick()) onClose();
          }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            onError={() => setFailed(true)}
            className="max-h-full max-w-full select-none object-contain shadow-2xl"
            style={imageZoom.style}
          />
        </div>
      )}
      <div className="bycoda-image-compare-actions">
        <label className="bycoda-image-compare-picker">
          {t("Compare with image")}
          <input
            type="file"
            accept="image/*"
            aria-label={t("Compare with image")}
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
        </label>
        {comparison ? (
          <Button
            variant="secondary"
            onClick={() => {
              setComparison(null);
              setCompareError(false);
            }}
          >
            {t("Stop comparison")}
          </Button>
        ) : null}
      </div>
      <Button
        ref={closeRef}
        type="button"
        iconOnly
        label={t("Close image preview")}
        tooltip={t("Close")}
        variant="secondary"
        shape="pill"
        size="lg"
        onClick={onClose}
        className="absolute [inset-inline-end:1rem] [inset-block-start:1rem]"
      >
        <X className="size-4" strokeWidth={2} />
      </Button>
    </div>,
    document.body,
  );
}
