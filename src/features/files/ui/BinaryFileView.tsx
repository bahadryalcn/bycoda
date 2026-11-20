import { errorText } from "../../../shared/lib/errors";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { t, useLocale } from "../../../shared/i18n/technical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Copy, Folder, Minus, Plus, RotateCcw } from "../../../shared/ui/icons";
import { ExplorerMenu } from "./ExplorerMenu";
import { FileTransferProgress } from "./FileTransferProgress";
import { FileTypeIcon } from "./FileTypeIcon";
import { formatFileSize, sniffImageMime } from "../model/filePreview";
import { watchFile } from "../model/fileWatch";
import {
  basename,
  copyFileToClipboard,
  prepareLocalFile,
  readBinaryFile,
  revealPath,
} from "../../../platform/tauri/fs";
import { displayPath } from "../../../shared/lib/paths";
import { IS_MAC } from "../../../platform/tauri/platform";
import { useImageZoom } from "../../../shared/hooks/useImageZoom";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import { localExplorerPath } from "../../../shared/lib/remoteExplorerPaths";
import { OpenInDefaultAppButton, ViewerFooter } from "./ViewerFooter";
import { useDefaultAppOpen } from "./useDefaultAppOpen";

type Props = { path: string; cwd: string };

/** A connected machine's image is copied here first, bounded like its former host-side preview read. */
const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024;

type LoadState =
  | { status: "loading"; received?: number; total?: number }
  | { status: "cancelled" }
  | { status: "ready"; path: string; url: string; mime: string; size: number }
  | { status: "unsupported"; size: number }
  | { status: "error"; message: string };

/**
 * Read-only surface for files the editor can't open. Images render; bytes that
 * turn out not to be an image get a card pointing at the file on disk.
 */
export function BinaryFileView({ path, cwd }: Props) {
  useLocale();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  // Aborts the running remote copy; `cancelledPath` keeps a file change from restarting it.
  const transfer = useRef<AbortController | null>(null);
  const cancelledPath = useRef<string | null>(null);
  const remote = !!parseRemotePath(path);

  const liveUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (liveUrl.current) URL.revokeObjectURL(liveUrl.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    transfer.current = controller;
    // A reload of the same path keeps the current view mounted (zoom and pan stay).
    setState((current) =>
      current.status === "ready" && current.path === path ? current : { status: "loading" },
    );
    const settle = (next: LoadState) => {
      const previous = liveUrl.current;
      liveUrl.current = next.status === "ready" ? next.url : null;
      setState(next);
      if (previous) URL.revokeObjectURL(previous);
    };

    (parseRemotePath(path)
      ? prepareLocalFile(path, {
          signal: controller.signal,
          maxBytes: MAX_REMOTE_IMAGE_BYTES,
          onProgress: (received, total) => {
            if (controller.signal.aborted) return;
            // A reload of a shown image must not replace it with the progress bar.
            setState((current) =>
              current.status === "loading" ? { status: "loading", received, total } : current,
            );
          },
        }).then((local) => {
          if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
          return readBinaryFile(local);
        })
      : readBinaryFile(path)
    ).then(
      (bytes) => {
        if (cancelled) return;
        // The blob's MIME comes from the bytes, never the extension, so a file
        // named `.png` that holds markup can't become a same-origin document.
        const mime = sniffImageMime(bytes);
        if (!mime) {
          settle({ status: "unsupported", size: bytes.byteLength });
          return;
        }
        settle({
          status: "ready",
          path,
          url: URL.createObjectURL(new Blob([bytes], { type: mime })),
          mime,
          size: bytes.byteLength,
        });
      },
      (cause: unknown) => {
        // The Cancel button already showed its own state.
        if (cancelled || controller.signal.aborted) return;
        settle({
          status: "error",
          message: errorText(cause),
        });
      },
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path, reloadKey]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  const cancelTransfer = () => {
    cancelledPath.current = path;
    transfer.current?.abort();
    setState({ status: "cancelled" });
  };
  const retry = () => {
    cancelledPath.current = null;
    reload();
  };

  useEffect(() => {
    let timer = 0;
    const stop = watchFile(path, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (cancelledPath.current !== path) reload();
      }, 50);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [path, reload]);

  const loadShownCentrally = useConnectionErrorShownCentrally(
    state.status === "error" ? state.message : undefined,
  );

  if (state.status === "loading") {
    return (
      <div className="grid h-full place-items-center p-3">
        <FileTransferProgress
          label={t("Opening {p0}…", { p0: basename(path) })}
          received={state.received}
          total={state.total}
          onCancel={remote ? cancelTransfer : undefined}
        />
      </div>
    );
  }

  if (state.status === "cancelled") {
    return (
      <FileCard
        path={path}
        cwd={cwd}
        title={basename(path)}
        detail={t("Cancelled")}
        icon={
          <div className="mx-auto mb-3 flex justify-center">
            <FileTypeIcon name={basename(path)} isDir={false} size="lg" />
          </div>
        }
        onRetry={retry}
      />
    );
  }

  if (state.status === "error") {
    if (loadShownCentrally) return null;
    return (
      <FileCard
        path={path}
        cwd={cwd}
        title={t("Couldn’t open {p0}", { p0: basename(path) })}
        detail={state.message}
        icon={<AlertCircle tone="danger" className="mx-auto mb-3 icon-lg" />}
        onRetry={reload}
      />
    );
  }

  if (state.status === "unsupported") {
    return (
      <FileCard
        path={path}
        cwd={cwd}
        title={basename(path)}
        detail={`${formatFileSize(state.size)} · ${t("{p0} is not a readable image.", { p0: basename(path) })}`}
        icon={
          <div className="mx-auto mb-3 flex justify-center">
            <FileTypeIcon name={basename(path)} isDir={false} size="lg" />
          </div>
        }
      />
    );
  }

  return <ImageView path={path} url={state.url} size={state.size} mime={state.mime} />;
}

function ImageView({
  path,
  url,
  size,
  mime,
}: {
  path: string;
  url: string;
  size: number;
  mime: string;
}) {
  useLocale();
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // A different file abandons any copy in flight and its shown outcome.
  const {
    copy: runCopy,
    copied,
    pending: copyPending,
    error: copyError,
  } = useCopyFeedback({ resetKeys: [path], successMs: 1500 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Open-in-app state belongs to the file it started for; a different file starts clean.
  const openOwner = useMemo(() => ({ path }), [path]);
  const openAction = useDefaultAppOpen(openOwner, path);
  const localCopy = !!parseRemotePath(path) && !localExplorerPath(path);

  const imageZoom = useImageZoom(scrollRef, path);
  const zoom = imageZoom.value.scale;

  useEffect(
    () => () => {
      clearTimeout(clickTimer.current);
    },
    [],
  );

  const copyOriginal = useCallback(() => {
    setMenu(null);
    runCopy(() => copyFileToClipboard(path));
  }, [path, runCopy]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        tabIndex={0}
        role="group"
        aria-label={t("Image preview: {p0}", { p0: basename(path) })}
        {...imageZoom.bindings}
        onDoubleClick={(event) => {
          clearTimeout(clickTimer.current);
          imageZoom.bindings.onDoubleClick(event);
        }}
        {...surfaceAttributes(
          { variant: "transparency-grid" },
          "grid min-h-0 flex-1 place-items-center overflow-clip overscroll-contain p-4",
        )}
      >
        <img
          ref={imageRef}
          src={url}
          alt=""
          draggable={false}
          onLoad={(event) =>
            setNatural({
              w: event.currentTarget.naturalWidth,
              h: event.currentTarget.naturalHeight,
            })
          }
          onClick={(event) => {
            if (event.detail > 1 || imageZoom.consumeClick()) return;
            clearTimeout(clickTimer.current);
            clickTimer.current = setTimeout(() => {
              if (zoom !== 1) imageZoom.reset();
              else {
                const shown = imageRef.current?.offsetWidth;
                imageZoom.zoom(natural && shown ? natural.w / shown : 2);
              }
            }, 250);
          }}
          onContextMenu={
            IS_MAC
              ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenu({ x: event.clientX, y: event.clientY });
                }
              : undefined
          }
          className="max-h-full max-w-full object-contain"
          style={imageZoom.style}
        />
      </div>
      {copyError ? (
        <InlineError className="shrink-0 break-words px-3 py-2">{copyError}</InlineError>
      ) : null}
      {openAction.error ? (
        <InlineError className="shrink-0 break-words px-3 py-2">{openAction.error}</InlineError>
      ) : null}
      <ViewerFooter name={basename(path)}>
        <span className="tabular-nums">{natural ? `${natural.w} × ${natural.h}` : "—"}</span>
        <span className="tabular-nums">{formatFileSize(size)}</span>
        <span className="uppercase">{mime.replace(/^image\//, "")}</span>
        {IS_MAC ? (
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            label={copied ? t("Copied") : t("Copy original file")}
            onClick={copyOriginal}
            loading={copyPending}
          >
            {copied ? (
              <Check className="icon-xs" strokeWidth={2} />
            ) : (
              <Copy className="icon-xs" strokeWidth={1.75} />
            )}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          label={t("Zoom out")}
          onClick={() => imageZoom.zoom(1 / 1.5)}
        >
          <Minus className="icon-xs" strokeWidth={1.75} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          tooltip={t("Fit to window")}
          onClick={imageZoom.reset}
          className="w-11 text-center tabular-nums"
        >
          {zoom === 1
            ? t("Fit")
            : `${Math.round(zoom * (natural && imageRef.current?.offsetWidth ? imageRef.current.offsetWidth / natural.w : 1) * 100)}%`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          label={t("Zoom in")}
          onClick={() => imageZoom.zoom(1.5)}
        >
          <Plus className="icon-xs" strokeWidth={1.75} />
        </Button>
        <OpenInDefaultAppButton
          localCopy={localCopy}
          loading={openAction.opening}
          onOpen={openAction.open}
        />
      </ViewerFooter>
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              kind: "item",
              id: "copy-original",
              get label() {
                return t("Copy Original File");
              },
            },
          ]}
          ariaLabel={t("Image actions")}
          onPick={(id) => {
            if (id === "copy-original") copyOriginal();
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

function FileCard({
  path,
  cwd,
  title,
  detail,
  icon,
  onRetry,
}: {
  path: string;
  cwd: string;
  title: string;
  detail: string;
  icon: React.ReactNode;
  onRetry?: () => void;
}) {
  useLocale();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const running = useRef(false);
  const run = async (action: string, work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setPending(action);
    setError(undefined);
    try {
      await work();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      running.current = false;
      setPending(null);
    }
  };
  return (
    <div className="grid h-full min-w-0 place-items-center overflow-auto p-6">
      <div className="w-full min-w-0 max-w-md text-center">
        {icon}
        <Text as="p" size="secondary" tone="primary" className="break-words">
          {title}
        </Text>
        <Text as="p" size="secondary" tone="secondary" className="mt-1">
          {detail}
        </Text>
        <Text as="p" size="caption" tone="muted" className="mt-1 break-words font-mono">
          {displayPath(path, cwd)}
        </Text>
        {error ? (
          <InlineError className="mt-2 justify-center break-words">{error}</InlineError>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRetry}
              disabled={pending !== null}
              startIcon={<RotateCcw className="icon-xs" strokeWidth={1.75} />}
            >
              {t("Retry")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={pending !== null}
            loading={pending === "reveal"}
            startIcon={<Folder className="icon-xs" strokeWidth={1.75} />}
            onClick={() => void run("reveal", () => revealPath(path))}
          >
            {t("Reveal")}
          </Button>
          <CopyButton
            size="sm"
            variant="ghost"
            label={t("Copy path")}
            text={path}
            resetKeys={[path]}
          />
        </div>
      </div>
    </div>
  );
}
