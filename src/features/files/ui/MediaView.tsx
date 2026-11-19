import { Tooltip } from "../../../shared/ui/Tooltip";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { basename, preparedFileSize, prepareLocalFile } from "../../../platform/tauri/fs";
import { t, useLocale } from "../../../shared/i18n/technical";
import { mediaKind } from "../model/mediaPreview";
import { MediaVisibilityContext } from "../model/mediaVisibility";
import { DocumentMessage } from "./DocumentMessage";
import { FileTransferProgress } from "./FileTransferProgress";
import { formatFileSize, formatMediaDuration } from "../model/filePreview";
import { localExplorerPath } from "../../../shared/lib/remoteExplorerPaths";
import { OpenInDefaultAppButton, ViewerFooter } from "./ViewerFooter";
import { useDefaultAppOpen } from "./useDefaultAppOpen";

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
  | { status: "cancelled"; source?: object; size?: number }
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
  // Do not display the previous file's metadata during the render before effect cleanup.
  const source = useMemo(() => ({}), [path, readBytes, mimeType, retry]);
  // Load on first activation only. A hidden tab keeps its loaded player mounted (paused via
  // `visible`), so switching tabs keeps the playback position and does not re-transfer media.
  const [shownOnce, setShownOnce] = useState(active);
  useEffect(() => {
    // Latch the first activation; the load effect below waits for it.
    if (active) setShownOnce(true);
  }, [active]);
  // Open-in-app state belongs to the file/source it started for; a new owner starts clean.
  const actionOwner = useMemo(() => ({}), [externalPath, source]);
  const openAction = useDefaultAppOpen(actionOwner, externalPath ?? path);
  const loadShownCentrally = useConnectionErrorShownCentrally(
    state.status === "error" ? state.message : undefined,
  );
  const isVideo = mediaKind(path) === "video";
  const player = useRef<HTMLMediaElement | null>(null);
  const generation = useRef(0);
  const localCopy = !!externalPath?.startsWith("remote://") && !localExplorerPath(externalPath);
  // Only a copy from a connected machine has a transfer to abort.
  const transferable = !readBytes && path.startsWith("remote://") && !localExplorerPath(path);
  const transfer = useRef<AbortController | null>(null);
  const cancelTransfer = () => {
    transfer.current?.abort();
    setState({ status: "cancelled", source });
  };
  useEffect(() => {
    // Keeps loaded media (and its blob) in memory until the tab closes.
    // shortcut: no release after idle time, upgrade: release a hidden tab's source after a long idle period.
    if (!shownOnce) return;
    const controller = new AbortController();
    transfer.current = controller;
    const request = ++generation.current;
    let ownedUrl: string | undefined;
    let size: number | undefined;
    setState({ status: "loading" });
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
  }, [path, readBytes, mimeType, retry, shownOnce, source, isVideo]);

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
        ) : state.status === "error" && loadShownCentrally ? null : state.status === "error" ? (
          <DocumentMessage title={t("Couldn’t open {p0}", { p0: basename(path) })} error>
            <InlineError>{state.message}</InlineError>
            <Button
              variant="ghost"
              motion="none"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("Retry")}
            </Button>
          </DocumentMessage>
        ) : state.status === "cancelled" ? (
          <DocumentMessage title={t("Cancelled")}>
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
          <FileTransferProgress
            label={t("Loading…")}
            received={state.received}
            total={state.total}
            onCancel={transferable ? cancelTransfer : undefined}
          />
        )}
      </div>
      <ViewerFooter name={basename(path)}>
        {isVideo ? (
          <>
            {metadata?.width && metadata.height ? (
              <span className="whitespace-nowrap tabular-nums">
                {metadata.width} × {metadata.height}
              </span>
            ) : null}
            {duration ? (
              <Tooltip label={t("Duration")} asChild>
                <span className="whitespace-nowrap tabular-nums">{duration}</span>
              </Tooltip>
            ) : null}
            {currentVideo && state.size !== undefined ? (
              <span className="whitespace-nowrap tabular-nums">{formatFileSize(state.size)}</span>
            ) : null}
            <span>{format}</span>
          </>
        ) : null}
        {externalPath ? (
          <OpenInDefaultAppButton
            localCopy={localCopy}
            loading={openAction.opening}
            onOpen={openAction.open}
          />
        ) : null}
        {openAction.error ? (
          <InlineError className="basis-full">{openAction.error}</InlineError>
        ) : null}
      </ViewerFooter>
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
