import { t, useLocale } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { X } from "./icons";
import { useOverlay } from "./overlay";
import { useImageZoom } from "../hooks/useImageZoom";

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
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageZoom = useImageZoom(viewportRef, src, !failed);
  useEffect(() => setFailed(false), [src]);
  useOverlay(dialogRef, true, onClose);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("Image preview: {p0}", { p0: alt })}
      className="fixed inset-0 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
      style={{ zIndex: LAYER.dialog }}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {failed ? (
        <p role="alert" className="text-center text-sm text-white">
          {t("Preview unavailable. Try again.")}
        </p>
      ) : (
        <div ref={viewportRef} tabIndex={0} autoFocus role="group" aria-label={t("Image preview: {p0}", { p0: alt })}
          className="grid h-full w-full place-items-center overflow-clip" {...imageZoom.bindings}
          onClick={(event) => { if (event.target === event.currentTarget && !imageZoom.consumeClick()) onClose(); }}>
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
      <button
        ref={closeRef}
        type="button"
        aria-label={t("Close image preview")}
        title={t("Close")}
        onClick={onClose}
        className="ui-icon-hit absolute [inset-inline-end:1rem] [inset-block-start:1rem] grid size-9 place-items-center rounded-full border border-white/15 bg-black/45 text-white/80 shadow-lg backdrop-blur-md hover:bg-black/65 hover:text-white focus-visible:outline-2 focus-visible:outline-white/80"
      >
        <X className="size-4" strokeWidth={2} />
      </button>
    </div>,
    document.body,
  );
}
