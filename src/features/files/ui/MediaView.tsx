import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  basename,
  preparedFileSize,
  prepareLocalFile,
  remoteMediaInfo,
  releaseRemoteMediaLease,
  remoteMediaStreamUrl,
} from "../../../platform/tauri/fs";
import { loadRemoteMediaMode } from "../../settings/public/remoteMediaMode";
import { Download, Play } from "../../../shared/ui/icons";
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
/** Where to continue after the stream URL was replaced mid-playback. */
type Resume = { at: number; play: boolean };

/** Frees the loopback gateway held for an open player; best effort, it also expires on its own. */
function releaseLease(held: { current: string | null }) {
  const id = held.current;
  held.current = null;
  if (id) releaseRemoteMediaLease(id).catch(() => undefined);
}
type State =
  | { status: "loading"; received?: number; total?: number }
  | { status: "cancelled"; source?: object; size?: number }
  /** Data saver: nothing has been transferred; the owner picks Play or Download. */
  | { status: "manual"; size: number; source?: object }
  | {
      status: "ready";
      url: string;
      source: object;
      size?: number;
      metadata?: VideoMetadata;
      /** The URL is a loopback stream whose gateway this player leases. */
      streamed?: boolean;
      resume?: Resume;
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
  // A Play/Download click overrides the saved mode for this file only.
  const [chosen, setChosen] = useState<{ path: string; mode: "stream" | "download" } | null>(null);
  const chosenMode = chosen?.path === path ? chosen.mode : undefined;
  const transfer = useRef<AbortController | null>(null);
  const lease = useRef<string | null>(null);
  const refreshed = useRef(false);
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
    refreshed.current = false;
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
          const copy = () =>
            prepareLocalFile(path, {
              signal: controller.signal,
              onProgress: (received, total) => {
                if (Number.isSafeInteger(total) && total >= 0) size = total;
                if (!controller.signal.aborted) setState({ status: "loading", received, total });
              },
            });
          let local: string | undefined;
          let streamed: string | undefined;
          if (transferable) {
            // Shared (mapped) folders and local files above keep their direct path in every mode.
            // A finished copy of this exact version is reused; otherwise the saved mode decides.
            const info = await remoteMediaInfo(path);
            if (controller.signal.aborted) return;
            size = info.size;
            const mode = chosenMode ?? loadRemoteMediaMode();
            if (info.cachedPath) local = info.cachedPath;
            else if (mode === "saver") {
              setState({ status: "manual", size: info.size });
              return;
            } else if (mode === "stream") {
              try {
                const stream = await remoteMediaStreamUrl(path);
                if (controller.signal.aborted) {
                  // The player closed while the URL was being prepared; do not leak its lease.
                  releaseRemoteMediaLease(stream.lease).catch(() => undefined);
                  return;
                }
                streamed = stream.url;
                releaseLease(lease);
                lease.current = stream.lease;
              } catch (reason) {
                // Without the gateway (older Host, closed folder) the whole-copy path still works.
                // The URL is a secret capability and is never logged.
                console.warn("Remote media streaming unavailable; copying instead", reason);
              }
              if (controller.signal.aborted) return;
            }
          }
          if (streamed) url = streamed;
          else {
            local ??= await copy();
            if (controller.signal.aborted) return;
            url = convertFileSrc(local);
            localPath = local;
          }
        }
        if (request !== generation.current) return;
        setState({
          status: "ready",
          url,
          source,
          size,
          streamed: !readBytes && localPath === undefined,
        });
        // Remote preparation already supplied the exact snapshot size. Stat only
        // the prepared native path when that information is absent, without delaying playback.
        if (isVideo && size === undefined && localPath) {
          void preparedFileSize(localPath)
            .then((fileSize) => {
              if (controller.signal.aborted || request !== generation.current) return;
              setState((current) =>
                current.status !== "loading" &&
                current.status !== "manual" &&
                current.source === source
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
      releaseLease(lease);
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
  }, [path, readBytes, mimeType, retry, shownOnce, source, isVideo, transferable, chosenMode]);

  const showPlaybackError = () =>
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
  const failPlayback = () => {
    if (state.status !== "ready" || state.source !== source || !state.streamed || refreshed.current)
      return showPlaybackError();
    // The gateway may have been replaced (closed folder, reconnect): ask for a fresh URL once
    // and continue where the player stopped, instead of reporting an unplayable format.
    refreshed.current = true;
    const element = player.current;
    const resume: Resume = { at: element?.currentTime ?? 0, play: !!element && !element.paused };
    const request = generation.current;
    remoteMediaStreamUrl(path).then(
      (fresh) => {
        if (request !== generation.current) {
          releaseRemoteMediaLease(fresh.lease).catch(() => undefined);
          return;
        }
        releaseLease(lease);
        lease.current = fresh.lease;
        setState((current) =>
          current.status === "ready" && current.source === source
            ? { ...current, url: fresh.url, resume }
            : current,
        );
      },
      () => {
        if (request === generation.current) showPlaybackError();
      },
    );
  };
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
            resume={state.resume}
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
          <DocumentMessage
            title={t("Couldn’t open {p0}", { p0: basename(path) })}
            error
            detail={state.message}
            onRetry={() => setRetry((value) => value + 1)}
          />
        ) : state.status === "manual" ? (
          <DocumentMessage title={basename(path)}>
            <span className="tabular-nums">{formatFileSize(state.size)}</span>
            <div className="mt-2 flex justify-center gap-2">
              <Button
                variant="primary"
                startIcon={<Play className="icon-sm" />}
                onClick={() => setChosen({ path, mode: "stream" })}
              >
                {t("Play")}
              </Button>
              <Button
                variant="ghost"
                startIcon={<Download className="icon-sm" />}
                onClick={() => setChosen({ path, mode: "download" })}
              >
                {t("Download")}
              </Button>
            </div>
          </DocumentMessage>
        ) : state.status === "cancelled" ? (
          <DocumentMessage
            title={t("Opening cancelled")}
            onRetry={() => setRetry((value) => value + 1)}
          />
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
            {duration ? <span className="whitespace-nowrap tabular-nums">{duration}</span> : null}
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
          <InlineError className="basis-full" details={openAction.error}>
            {t("Couldn’t open the file in its default app")}
          </InlineError>
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
  resume,
  visible,
  player,
  onError,
  onMetadata,
}: {
  path: string;
  url: string;
  resume?: Resume;
  visible: boolean;
  player: { current: HTMLMediaElement | null };
  onError: () => void;
  onMetadata: (metadata: VideoMetadata) => void;
}) {
  const elementRef = useRef<HTMLMediaElement | null>(null);
  const releaseSource = useRef<number | undefined>(undefined);
  const resumed = useRef(false);
  const applyResume = (element: HTMLMediaElement) => {
    if (!resume || resumed.current) return;
    resumed.current = true;
    if (resume.at > 0) element.currentTime = resume.at;
    if (resume.play && visible && !document.hidden) element.play().catch(() => undefined);
  };
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
    onLoadedMetadata: (event: { currentTarget: HTMLMediaElement }) => {
      applyResume(event.currentTarget);
      updateMetadata(event);
    },
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
