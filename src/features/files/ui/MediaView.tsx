import { Progress } from "../../../shared/ui/Progress";
import { Button } from "../../../shared/ui/Button";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  basename,
  openPathWithDefaultApp,
  preparedFileSize,
  prepareLocalFile,
} from "../../../platform/tauri/fs";
import { t, useLocale } from "../../../shared/i18n/technical";
import { mediaKind } from "../model/mediaPreview";
import { MediaVisibilityContext } from "../model/mediaVisibility";
import { DocumentMessage } from "./DocumentMessage";
import { formatFileSize, formatMediaDuration } from "../model/filePreview";
import { localExplorerPath } from "../../../shared/lib/remoteExplorerPaths";

type Props = {
  path: string;
  active?: boolean;
  visible?: boolean;
  readBytes?: () => Promise<Uint8Array>;
  mimeType?: string;
  externalPath?: string | null;
};
type VideoMetadata = { duration?: number; width?: number; height?: number };
type State =
  | { status: "loading"; received?: number; total?: number }
  | {
      status: "ready";
      url: string;
      source: object;
      size?: number;
      metadata?: VideoMetadata;
    }
  | { status: "error"; message: string; source?: object; size?: number };

/** Native controls stream authorized local/cache files without loading video into the JS heap. */
export function MediaView({
  path,
  active = true,
  visible = true,
  readBytes,
  mimeType,
  externalPath = path,
}: Props) {
  useLocale();
  const paneVisible = useContext(MediaVisibilityContext);
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [actionError, setActionError] = useState<string>();
  // Do not display the previous file's metadata during the render before effect cleanup.
  const source = useMemo(() => ({}), [path, readBytes, mimeType, retry, active]);
  const isVideo = mediaKind(path) === "video";
  const player = useRef<HTMLMediaElement | null>(null);
  const generation = useRef(0);
  const localCopy = !!externalPath?.startsWith("remote://") && !localExplorerPath(externalPath);
  useEffect(() => {
    if (!active) {
      setState({ status: "loading" });
      return;
    }
    const controller = new AbortController();
    const request = ++generation.current;
    let ownedUrl: string | undefined;
    let size: number | undefined;
    setState({ status: "loading" });
    setActionError(undefined);
    void (async () => {
      try {
        let url: string;
        let localPath: string | undefined;
        if (readBytes) {
          const bytes = await readBytes();
          if (controller.signal.aborted) return;
          size = bytes.byteLength;
          const type = /^(audio|video)\/[a-z0-9.+-]+$/i.test(mimeType ?? "") ? mimeType : undefined;
          ownedUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
          url = ownedUrl;
        } else {
          const local = await prepareLocalFile(path, {
            signal: controller.signal,
            onProgress: (received, total) => {
              if (Number.isSafeInteger(total) && total >= 0) size = total;
              if (!controller.signal.aborted) setState({ status: "loading", received, total });
            },
          });
          if (controller.signal.aborted) return;
          url = convertFileSrc(local);
          localPath = local;
        }
        if (request !== generation.current) return;
        setState({ status: "ready", url, source, size });
        // Remote preparation already supplied the exact snapshot size. Stat only
        // the prepared native path when that information is absent, without delaying playback.
        if (isVideo && size === undefined && localPath) {
          void preparedFileSize(localPath)
            .then((fileSize) => {
              if (controller.signal.aborted || request !== generation.current) return;
              setState((current) =>
                current.status !== "loading" && current.source === source
                  ? { ...current, size: fileSize }
                  : current,
              );
            })
            .catch(() => undefined);
        }
      } catch (reason) {
        if (!controller.signal.aborted) setState({ status: "error", message: String(reason) });
      }
    })();
    return () => {
      controller.abort();
      generation.current++;
      if (ownedUrl) {
        const url = ownedUrl;
        const element = player.current;
        // Detach the decoder before revoking its blob, including on a retry.
        window.setTimeout(() => {
          releaseMediaSource(element, url);
          URL.revokeObjectURL(url);
        });
      }
    };
  }, [path, readBytes, mimeType, retry, active, source, isVideo]);

  const failPlayback = () =>
    setState((current) =>
      current.status === "ready" && current.source === source
        ? {
            status: "error",
            source,
            size: current.size,
            message: t("This media format could not be played. Open it in the default app."),
          }
        : current,
    );
  const currentVideo = isVideo && active && state.status !== "loading" && state.source === source;
  const metadata = currentVideo && state.status === "ready" ? state.metadata : undefined;
  const duration = formatMediaDuration(metadata?.duration);
  // This is the filename's container extension, not a claim about the decoded codec.
  const format = isVideo ? basename(path).split(".").pop()?.toUpperCase() : undefined;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-3">
        {state.status === "ready" ? (
          <MediaPlayer
            key={`${mediaKind(path)}:${state.url}`}
            path={path}
            url={state.url}
            visible={active && visible && paneVisible}
            player={player}
            onError={failPlayback}
            onMetadata={(metadata) =>
              setState((current) =>
                current.status === "ready" && current.source === source
                  ? { ...current, metadata }
                  : current,
              )
            }
          />
        ) : state.status === "error" ? (
          <DocumentMessage title={t("Couldn’t open {p0}", { p0: basename(path) })} error>
            <span role="alert">{state.message}</span>
            <Button
              variant="ghost"
              motion="none"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("Retry")}
            </Button>
          </DocumentMessage>
        ) : (
          <div role="status">
            <Progress
              compact
              value={state.total ? (state.received ?? 0) : undefined}
              max={state.total ?? 1}
              label={
                t("Loading…") +
                (state.total
                  ? ` ${formatFileSize(state.received ?? 0)} / ${formatFileSize(state.total)}`
                  : "")
              }
            />
          </div>
        )}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-stroke px-3 py-2 text-xs text-[var(--ui-text-secondary)]">
        <span className="min-w-0 flex-1 truncate" title={path}>
          {basename(path)}
        </span>
        {isVideo ? (
          <>
            {metadata?.width && metadata.height ? (
              <span className="whitespace-nowrap tabular-nums">
                {metadata.width} × {metadata.height}
              </span>
            ) : null}
            {duration ? (
              <span className="whitespace-nowrap tabular-nums" title={t("Duration")}>
                {duration}
              </span>
            ) : null}
            {currentVideo && state.size !== undefined ? (
              <span className="whitespace-nowrap tabular-nums">{formatFileSize(state.size)}</span>
            ) : null}
            <span>{format}</span>
          </>
        ) : null}
        {externalPath ? (
          <Button
            variant="ghost"
            motion="none"
            type="button"
            title={
              localCopy
                ? t("Changes to this local copy are not saved to the connected machine.")
                : undefined
            }
            onClick={() => {
              const request = generation.current;
              setActionError(undefined);
              void openPathWithDefaultApp(externalPath).catch((reason: unknown) => {
                if (request === generation.current) setActionError(String(reason));
              });
            }}
          >
            {t(localCopy ? "Open local copy" : "Open in default app")}
          </Button>
        ) : null}
        {actionError ? (
          <span role="alert" className="basis-full text-danger">
            {actionError}
          </span>
        ) : null}
      </footer>
    </div>
  );
}

function releaseMediaSource(element: HTMLMediaElement | null, url: string) {
  if (!element || element.getAttribute("src") !== url) return;
  element.pause();
  element.removeAttribute("src");
  element.load();
}

/** Keep native loading alive during effect replay, but release real retired sources. */
function MediaPlayer({
  path,
  url,
  visible,
  player,
  onError,
  onMetadata,
}: {
  path: string;
  url: string;
  visible: boolean;
  player: { current: HTMLMediaElement | null };
  onError: () => void;
  onMetadata: (metadata: VideoMetadata) => void;
}) {
  const elementRef = useRef<HTMLMediaElement | null>(null);
  const releaseSource = useRef<number | undefined>(undefined);
  const updateMetadata = (event: { currentTarget: HTMLMediaElement }) => {
    const element = event.currentTarget;
    if (
      mediaKind(path) !== "video" ||
      element.readyState < 1 ||
      element.getAttribute("src") !== url ||
      elementRef.current !== element
    )
      return;
    const video = element as HTMLVideoElement;
    onMetadata({
      duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined,
      width: video.videoWidth > 0 ? video.videoWidth : undefined,
      height: video.videoHeight > 0 ? video.videoHeight : undefined,
    });
  };

  useLayoutEffect(() => {
    const element = elementRef.current;
    window.clearTimeout(releaseSource.current);
    // Restart only if a previous cleanup actually detached the source. Aborting
    // and reloading in the same task can stall WebKit's metadata pipeline.
    if (element && !element.hasAttribute("src")) {
      element.src = url;
      element.load();
    }
    return () => {
      element?.pause();
      releaseSource.current = window.setTimeout(() => releaseMediaSource(element, url));
    };
  }, [url]);

  useLayoutEffect(() => {
    const element = elementRef.current;
    const pauseWhenHidden = () => {
      if (!visible || document.hidden) element?.pause();
    };
    pauseWhenHidden();
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, [visible]);

  const props = {
    ref: (element: HTMLMediaElement | null) => {
      elementRef.current = element;
      player.current = element;
    },
    "aria-label": basename(path),
    src: url,
    controls: true,
    preload: "metadata",
    onLoadedMetadata: updateMetadata,
    onDurationChange: updateMetadata,
    onPlay: (event: { currentTarget: HTMLMediaElement }) => {
      if (!visible || document.hidden) event.currentTarget.pause();
    },
    onError: (event: { currentTarget: HTMLMediaElement }) => {
      // Removing src and calling load can emit a late decoder error.
      if (
        event.currentTarget.getAttribute("src") === url &&
        elementRef.current === event.currentTarget
      )
        onError();
    },
  };
  return mediaKind(path) === "audio" ? (
    <audio {...props} className="w-full max-w-xl" />
  ) : (
    <video
      {...props}
      playsInline
      onResize={updateMetadata}
      className="max-h-full w-full object-contain"
    />
  );
}
