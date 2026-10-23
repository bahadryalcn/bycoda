import { Button } from "../../../shared/ui/Button";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { MediaVisibilityContext } from "../../files/model/mediaVisibility";
import { prepareLocalFile, readBinaryFile } from "../../../platform/tauri/fs";
import { isImagePath, sniffImageMime } from "../../files/model/filePreview";
import { mediaKind } from "../../files/model/mediaPreview";
import { useNearViewport } from "./useNearViewport";

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
  const [box, near] = useNearViewport<HTMLSpanElement>();
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const video = mediaKind(path) === "video";
  const player = useRef<HTMLVideoElement>(null);
  const visible = useContext(MediaVisibilityContext);
  useLayoutEffect(() => {
    const element = player.current;
    const pauseWhenHidden = () => {
      if (!visible || document.hidden) element?.pause();
    };
    pauseWhenHidden();
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      element?.pause();
      document.removeEventListener("visibilitychange", pauseWhenHidden);
    };
  }, [visible, url]);

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
      if (ownedUrl) {
        // A hidden (Activity) or unmounted pane releases the decoded blob; the
        // fixed-size box keeps the layout while it reloads on reveal.
        URL.revokeObjectURL(ownedUrl);
        setUrl(undefined);
      }
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
        className="[margin-block:0.5rem] grid aspect-video w-80 max-w-full grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-clip rounded-xl border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised)"
      >
        {url && video ? (
          <video
            ref={player}
            src={url}
            controls
            playsInline
            preload="metadata"
            aria-label={label}
            onError={() => setFailed(true)}
            onPlay={(event) => {
              if (!visible || document.hidden) event.currentTarget.pause();
            }}
            className="block size-full object-contain"
          />
        ) : onOpen && image ? (
          <Button
            variant="item"
            layout="media"
            motion="none"
            fullWidth
            type="button"
            aria-label={label}
            onClick={onOpen}
            onContextMenu={onContextMenu}
            className="size-full min-w-0"
          >
            {image}
          </Button>
        ) : (
          image
        )}
      </span>
      {fallback}
    </>
  );
}
