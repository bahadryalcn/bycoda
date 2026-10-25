import { Progress } from "../../../shared/ui/Progress";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/technical";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Copy, Folder, Minus, Plus, RotateCcw } from "../../../shared/ui/icons";
import { ExplorerMenu } from "./ExplorerMenu";
import { FileTypeIcon } from "./FileTypeIcon";
import { copyText } from "../../../platform/tauri/clipboard";
import { formatFileSize, sniffImageMime } from "../model/filePreview";
import { watchFile } from "../model/fileWatch";
import {
  basename,
  copyFileToClipboard,
  readBinaryFile,
  revealPath,
} from "../../../platform/tauri/fs";
import { displayPath } from "../../../shared/lib/paths";
import { IS_MAC } from "../../../platform/tauri/platform";
import { useImageZoom } from "../../../shared/hooks/useImageZoom";

type Props = { path: string; cwd: string };

type LoadState =
  | { status: "loading" }
  | { status: "ready"; url: string; mime: string; size: number }
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

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setState({ status: "loading" });

    readBinaryFile(path).then(
      (bytes) => {
        if (cancelled) return;
        // The blob's MIME comes from the bytes, never the extension, so a file
        // named `.png` that holds markup can't become a same-origin document.
        const mime = sniffImageMime(bytes);
        if (!mime) {
          setState({ status: "unsupported", size: bytes.byteLength });
          return;
        }
        created = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setState({
          status: "ready",
          url: created,
          mime,
          size: bytes.byteLength,
        });
      },
      (cause: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      },
    );

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path, reloadKey]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    let timer = 0;
    const stop = watchFile(path, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reload, 50);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [path, reload]);

  if (state.status === "loading") {
    return (
      <div className="grid h-full place-items-center p-3">
        <Progress label={t("Opening ") + basename(path) + "…"} compact />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <FileCard
        path={path}
        cwd={cwd}
        title={t("Couldn’t open {p0}", { p0: basename(path) })}
        detail={state.message}
        icon={<AlertCircle className="mx-auto mb-3 size-5 text-danger" />}
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
        detail={`${formatFileSize(state.size)} · not a readable image`}
        icon={
          <div className="mx-auto mb-3 flex justify-center">
            <FileTypeIcon name={basename(path)} isDir={false} size={28} />
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
  const [copied, setCopied] = useState(false);
  const [copyPending, setCopyPending] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  const copying = useRef(false);
  const copyGeneration = useRef(0);
  const copiedTimer = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const imageZoom = useImageZoom(scrollRef, url);
  const zoom = imageZoom.value.scale;

  useEffect(
    () => () => {
      copyGeneration.current += 1;
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
      clearTimeout(clickTimer.current);
    },
    [],
  );

  const copyOriginal = useCallback(() => {
    if (copying.current) return;
    copying.current = true;
    const generation = copyGeneration.current;
    setMenu(null);
    setCopied(false);
    setCopyPending(true);
    setCopyError(undefined);
    void copyFileToClipboard(path).then(
      () => {
        if (generation !== copyGeneration.current) return;
        copying.current = false;
        setCopyPending(false);
        setCopied(true);
        if (copiedTimer.current != null) {
          window.clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
      },
      (error: unknown) => {
        if (generation !== copyGeneration.current) return;
        copying.current = false;
        setCopyPending(false);
        setCopyError(error instanceof Error ? error.message : String(error));
      },
    );
  }, [path]);

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
        className="grid min-h-0 flex-1 place-items-center overflow-clip overscroll-contain p-4"
        style={{
          // A checkerboard so transparent PNGs read as transparent rather than
          // as whatever the theme background happens to be.
          backgroundImage: "var(--ui-transparency-grid-image)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 8px 8px",
        }}
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
        <p role="alert" className="shrink-0 break-words px-3 py-2 text-ui-caption text-danger">
          {copyError}
        </p>
      ) : null}
      <footer className="flex min-h-8 shrink-0 flex-wrap items-center gap-3 border-t border-stroke px-3 text-[11px] text-[var(--ui-text-secondary)]">
        <span className="tabular-nums">{natural ? `${natural.w} × ${natural.h}` : "—"}</span>
        <span className="tabular-nums">{formatFileSize(size)}</span>
        <span className="uppercase">{mime.replace(/^image\//, "")}</span>
        <span className="flex-1" />
        {IS_MAC ? (
          <ZoomButton
            label={copied ? t("Copied") : t("Copy original file")}
            onClick={copyOriginal}
            loading={copyPending}
          >
            {copied ? (
              <Check className="size-3" strokeWidth={2} />
            ) : (
              <Copy className="size-3" strokeWidth={1.75} />
            )}
          </ZoomButton>
        ) : null}
        <ZoomButton label={t("Zoom out")} onClick={() => imageZoom.zoom(1 / 1.5)}>
          <Minus className="size-3" strokeWidth={1.75} />
        </ZoomButton>
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          title={t("Fit to window")}
          onClick={imageZoom.reset}
          className="w-11 text-center tabular-nums"
        >
          {zoom === 1
            ? t("Fit")
            : `${Math.round(zoom * (natural && imageRef.current?.offsetWidth ? imageRef.current.offsetWidth / natural.w : 1) * 100)}%`}
        </Button>
        <ZoomButton label={t("Zoom in")} onClick={() => imageZoom.zoom(1.5)}>
          <Plus className="size-3" strokeWidth={1.75} />
        </ZoomButton>
      </footer>
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
          ariaLabel="Image actions"
          onPick={(id) => {
            if (id === "copy-original") copyOriginal();
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
  loading,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  loading?: boolean;
}) {
  useLocale();
  return (
    <Button
      size="sm"
      iconOnly
      label={label}
      loading={loading}
      variant="ghost"
      motion="none"
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid place-items-center"
    >
      {children}
    </Button>
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
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      running.current = false;
      setPending(null);
    }
  };
  return (
    <div className="grid h-full min-w-0 place-items-center overflow-auto p-6">
      <div className="w-full min-w-0 max-w-md text-center">
        {icon}
        <p className="break-words text-[13px] text-content">{title}</p>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ui-text-secondary)]">{detail}</p>
        <p className="mt-1 truncate font-mono text-[11px] text-[var(--ui-text-muted)]">
          {displayPath(path, cwd)}
        </p>
        {error ? (
          <p role="alert" className="mt-2 break-words text-ui-caption text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <CardButton
              onClick={onRetry}
              disabled={pending !== null}
              startIcon={<RotateCcw className="size-3" strokeWidth={1.75} />}
            >
              {t("Retry")}
            </CardButton>
          ) : null}
          <CardButton
            disabled={pending !== null}
            loading={pending === "reveal"}
            startIcon={<Folder className="size-3" strokeWidth={1.75} />}
            onClick={() => void run("reveal", () => revealPath(path))}
          >
            {t("Reveal")}
          </CardButton>
          <CardButton
            disabled={pending !== null}
            loading={pending === "copy"}
            onClick={() => void run("copy", () => copyText(path))}
          >
            {t("Copy path")}
          </CardButton>
        </div>
      </div>
    </div>
  );
}

function CardButton({
  onClick,
  children,
  loading,
  disabled,
  startIcon,
}: {
  onClick: () => void;
  children: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  startIcon?: React.ReactNode;
}) {
  useLocale();
  return (
    <Button
      size="sm"
      variant="ghost"
      motion="none"
      type="button"
      onClick={onClick}
      loading={loading}
      disabled={disabled}
      startIcon={startIcon}
      className="flex items-center gap-1.5"
    >
      {children}
    </Button>
  );
}
