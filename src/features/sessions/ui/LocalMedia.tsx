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
import { InlineAudio } from "./InlineAudio";
import { InlineVideo } from "./InlineVideo";
import { useNearViewport } from "./useNearViewport";
import { localMediaFrameStyle } from "./localMediaFrame";
import type { Attachment } from "../model/session";

export function isLocalMediaPath(path: string): boolean {
  return (
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(path) &&
    !/^[\\/]{2}/.test(path) &&
    (isImagePath(path) || mediaKind(path) !== null)
  );
}

/**
 * A sent video or audio attachment that plays inline from its file on this computer.
 * shortcut: an attachment read through another host's reader (remote history, uploaded
 * queue files) or held only as pasted bytes stays a chip that opens the media viewer;
 * stream those through the remote media gateway if inline playback is wanted there.
 */
export function inlineMediaAttachmentPath(attachment: Attachment): string | undefined {
  const { path, missing, kind, hostEnvironmentId, loadPreview } = attachment;
  if (!path || missing || kind === "image" || hostEnvironmentId || loadPreview) return undefined;
  return mediaKind(path) && isLocalMediaPath(path) ? path : undefined;
}

/** Same ceiling as `readProjectImage`; a larger local image shows the fallback card instead. */
export const LOCAL_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
/** Sources load this far from the transcript viewport and are released beyond the wider margin. */
const LOAD_MARGIN = 400;
const RELEASE_MARGIN = 2400;

/**
 * Near-view sources only. Images, videos and audio all get an exact native file grant
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
  const kind = mediaKind(path);
  const video = kind === "video";
  const audio = kind === "audio";
  const player = useRef<HTMLMediaElement | null>(null);
  const attachPlayer = (element: HTMLMediaElement | null) => {
    player.current = element;
  };
  const visible = useContext(MediaVisibilityContext);
  const pauseUnlessVisible = (element: HTMLMediaElement) => {
    if (!visible || document.hidden) element.pause();
  };
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- pauses the player when its pane or the window is hidden, and on unmount or source change
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

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- prepares the local media source near view and aborts a stale run on path change or release
  useEffect(() => {
    // Prepares the source for this exact path while it is near view. The cleanup aborts
    // the run (path change, release, hidden Activity pane, unmount), so a late reply
    // never publishes into a newer scope.
    if (!near || !isLocalMediaPath(path)) return;
    const controller = new AbortController();
    const maxBytes = kind ? undefined : LOCAL_IMAGE_MAX_BYTES;
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
      // bitmap; the measured box keeps the layout until it loads again. A video or
      // audio player keeps its element, which pauses on its own when hidden.
      if (!kind) setSource(undefined);
    };
  }, [near, path, kind]);

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

  if (audio)
    return (
      <>
        <span
          ref={box}
          data-local-media={path}
          className="[margin-block:0.5rem] block min-h-11 w-[26rem] max-w-full"
        >
          {url ? (
            <InlineAudio
              path={path}
              url={url}
              label={label}
              playerRef={attachPlayer}
              onFailed={() => setFailedPath(path)}
              onPlay={pauseUnlessVisible}
              onOpen={onOpen}
            />
          ) : null}
        </span>
        {fallback}
      </>
    );
  return (
    <>
      <span
        ref={box}
        data-local-media={path}
        style={frame}
        className={`[margin-block:0.5rem] grid max-w-full grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-clip rounded-xl border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised)${frame ? "" : " aspect-video w-80"}`}
      >
        {url && video ? (
          <InlineVideo
            url={url}
            label={label}
            playerRef={attachPlayer}
            onFailed={() => setFailedPath(path)}
            onPlay={pauseUnlessVisible}
            onMetadata={(size) => setMeasured({ path, ...size })}
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
