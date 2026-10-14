import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { prepareLocalFile, readBinaryFile } from "../../../platform/tauri/fs";
import { isImagePath, sniffImageMime } from "../../files/model/filePreview";
import { mediaKind } from "../../files/model/mediaPreview";

export function isLocalMediaPath(path: string): boolean {
  return (
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(path) &&
    !/^[\\/]{2}/.test(path) &&
    (isImagePath(path) || mediaKind(path) === "video")
  );
}

/** Near-view reads only; local videos stream through an exact native file grant. */
export function LocalMedia({
  path,
  label,
  onOpen,
  onContextMenu,
  fallback,
}: {
  path: string;
  label: string;
  onOpen?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  fallback: ReactNode;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const video = mediaKind(path) === "video";

  useEffect(() => {
    if (near || !box.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "400px" },
    );
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || !isLocalMediaPath(path)) return;
    const controller = new AbortController();
    let ownedUrl: string | undefined;
    void (async () => {
      try {
        let next: string;
        if (video) {
          const local = await prepareLocalFile(path, { signal: controller.signal });
          if (controller.signal.aborted) return;
          next = convertFileSrc(local);
        } else {
          const bytes = await readBinaryFile(path);
          if (controller.signal.aborted) return;
          const mime = sniffImageMime(bytes);
          if (!mime) throw new Error("Unsupported image");
          ownedUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
          next = ownedUrl;
        }
        setUrl(next);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => {
      controller.abort();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [near, path, video]);

  if (failed || !isLocalMediaPath(path)) return <>{fallback}</>;
  const image = url ? (
    <img
      src={url}
      alt={label}
      draggable={false}
      decoding="async"
      onError={() => setFailed(true)}
      className="block size-full object-contain"
    />
  ) : null;

  return (
    <>
      <span
        ref={box}
        data-local-media={path}
        className="[margin-block:0.5rem] block aspect-video w-80 max-w-full overflow-clip rounded-xl border border-content/10 bg-content/5"
      >
        {url && video ? (
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            aria-label={label}
            onError={() => setFailed(true)}
            className="block size-full object-contain"
          />
        ) : onOpen && image ? (
          <button
            type="button"
            aria-label={label}
            onClick={onOpen}
            onContextMenu={onContextMenu}
            className="block size-full cursor-zoom-in [@media(hover:hover)_and_(pointer:fine)]:hover:bg-content/10 active:bg-content/15 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
          >
            {image}
          </button>
        ) : image}
      </span>
      {fallback}
    </>
  );
}
