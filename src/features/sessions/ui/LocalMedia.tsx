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
import { MediaVisibilityContext } from "../../files/public/mediaVisibility";
import { prepareLocalFile } from "../../../platform/tauri/fs";
import { isImagePath } from "../../files/public/filePreviewMetadata";
import { mediaKind } from "../../files/public/mediaPreview";
import { useNearViewport } from "./useNearViewport";
import { localMediaFrameStyle } from "./localMediaFrame";

export function isLocalMediaPath(path: string): boolean {
  return (
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(path) &&
    !/^[\\/]{2}/.test(path) &&
    (isImagePath(path) || mediaKind(path) === "video")
  );
}

/** Same ceiling as `readProjectImage`; a larger local image shows the fallback card instead. */
export const LOCAL_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
/** Sources load this far from the transcript viewport and are released beyond the wider margin. */
const LOAD_MARGIN = 400;
const RELEASE_MARGIN = 2400;

/**
 * Near-view sources only. Images and videos both get an exact native file grant
 * after the existing file-access decision; images are size-gated natively and never
 * enter the renderer as bytes, so there is no Blob or base64 copy to release. An
 * image leaving the wide margin drops its source while the measured box keeps its size.
 */
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
  // Source and failure are keyed by the path they belong to, so a late reply or an old
  // failure for a previous path is never shown for the current one.
  const [source, setSource] = useState<{ path: string; url: string }>();
  const [failedPath, setFailedPath] = useState<string>();
  const url = source?.path === path ? source.url : undefined;
  const failed = failedPath === path;
  // The fallback card replaces the box, so the box is observed again after a failure ends.
  const [box, near] = useNearViewport<HTMLSpanElement>(LOAD_MARGIN, RELEASE_MARGIN, failed);
  // Intrinsic size reported on load; keyed by path so a new file starts at the placeholder.
  const [measured, setMeasured] = useState<{ path: string; width: number; height: number }>();
  const frame = measured?.path === path ? localMediaFrameStyle(measured) : undefined;
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
    // Prepares the source for this exact path while it is near view. The cleanup aborts
    // the run (path change, release, hidden Activity pane, unmount), so a late reply
    // never publishes into a newer scope.
    if (!near || !isLocalMediaPath(path)) return;
    const controller = new AbortController();
    const maxBytes = video ? undefined : LOCAL_IMAGE_MAX_BYTES;
    void (async () => {
      try {
        // shortcut: the native size gate runs once at preparation; a file that grows
        // afterwards is still streamed by the asset protocol, add a native read cap
        // to the asset grant if that matters.
        const local = await prepareLocalFile(path, {
          signal: controller.signal,
          maxBytes,
        });
        if (controller.signal.aborted) return;
        setSource({ path, url: convertFileSrc(local) });
      } catch {
        if (!controller.signal.aborted) setFailedPath(path);
      }
    })();
    return () => {
      controller.abort();
      // A released or hidden image drops its source so the browser frees the decoded
      // bitmap; the measured box keeps the layout until it loads again. A video keeps
      // its element, which pauses on its own when hidden.
      if (!video) setSource(undefined);
    };
  }, [near, path, video]);

  if (failed || !isLocalMediaPath(path)) return <>{fallback}</>;
  const image = url ? (
    <img
      src={url}
      alt={label}
      draggable={false}
      decoding="async"
      onLoad={(event) =>
        setMeasured({
          path,
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        })
      }
      onError={() => setFailedPath(path)}
      className="block size-full object-contain"
    />
  ) : null;

  return (
    <>
      <span
        ref={box}
        data-local-media={path}
        style={frame}
        className={`[margin-block:0.5rem] grid max-w-full grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-clip rounded-xl border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised)${frame ? "" : " aspect-video w-80"}`}
      >
        {url && video ? (
          <video
            ref={player}
            src={url}
            controls
            playsInline
            preload="metadata"
            aria-label={label}
            onLoadedMetadata={(event) =>
              setMeasured({
                path,
                width: event.currentTarget.videoWidth,
                height: event.currentTarget.videoHeight,
              })
            }
            onError={() => setFailedPath(path)}
            onPlay={(event) => {
              if (!visible || document.hidden) event.currentTarget.pause();
            }}
            className="block size-full object-contain"
          />
        ) : onOpen && image ? (
          <Button
            variant="item"
            layout="media"
            controlHeight="fill"
            motion="none"
            fullWidth
            type="button"
            aria-label={label}
            onClick={onOpen}
            onContextMenu={onContextMenu}
            className="min-w-0"
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
