import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { readBinaryFile } from "../../../platform/tauri/fs";
import { formatFileSize, sniffImageMime } from "../../files/model/filePreview";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import type { GeneratedImageMeta } from "../model/session";

type State =
  | { status: "loading" }
  | { status: "ready"; url: string; size: number }
  | { status: "error" };

export function GeneratedImage({ image }: { image: GeneratedImageMeta }) {
  useLocale();
  const [state, setState] = useState<State>({ status: "loading" });
  const [open, setOpen] = useState(false);

  useEffect(() => {
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
      if (created) URL.revokeObjectURL(created);
    };
  }, [image.path, image.data, image.loadPreview]);

  if (state.status === "loading") {
    return (
      <div className="px-4 py-3 text-xs text-(--ui-text-secondary)" role="status">
        {t("Loading generated image…")}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <Alert tone="info" role="alert">
        {t("Could not open generated image.")}
      </Alert>
    );
  }

  const alt = image.alt || image.name;
  return (
    <div className="min-w-0 px-4 pb-3 pt-3">
      <Button
        fullWidth
        iconOnly
        label={t("Open {p0} full screen", { p0: image.name })}
        variant="item"
        type="button"
        aria-label={t("Open {p0} full screen", { p0: image.name })}
        title={t("Open {p0} full screen", { p0: image.name })}
        onClick={() => setOpen(true)}
        className="block max-w-full"
      >
        <img
          src={state.url}
          alt={alt}
          draggable={false}
          className="max-h-[min(70vh,640px)] max-w-full object-contain"
        />
      </Button>
      <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-(--ui-text-secondary)">
        <span className="truncate">{image.name}</span>
        <span>{formatFileSize(state.size)}</span>
      </div>
      {open ? <ImageLightbox src={state.url} alt={alt} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
