import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { Check, Copy, ExternalLink, FolderOpen } from "../../../shared/ui/icons";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import { MediaToolbarButton } from "../../../shared/ui/MediaToolbar";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { copyText } from "../../../platform/tauri/clipboard";
import { basename, readBinaryFile, revealPath } from "../../../platform/tauri/fs";
import { localExplorerPath } from "../../../shared/lib/remoteExplorerPaths";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import { resolveFileOpenRequest } from "../../files/model/fileIndex";
import { sniffDocumentImageMime } from "../../files/model/filePreview";
import { mediaKind } from "../../files/model/mediaPreview";
import { REVEAL_LABEL } from "../../files/ui/explorerMenuItems";

/** Image formats a transcript file click previews in a dialog before any tab opens. */
const PREVIEW_IMAGE = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp)$/i;

const MediaView = lazySurface(
  async () => ({ default: (await import("../../files/ui/MediaView")).MediaView }),
  { fallback: <SurfaceLoading /> },
);

export function isTranscriptImagePath(path: string): boolean {
  return PREVIEW_IMAGE.test(path.trim());
}

/**
 * Images and videos that a transcript opens go to their media dialog first. Other files
 * follow the caller's file routing. Ctrl/Cmd+click skips the dialog. The transcript root reports each click's modifiers
 * through `noteClick` (capture phase, before the row's own handler runs), because the file
 * handlers receive only a path.
 */
export function useTranscriptImageOpen(
  cwd: string | undefined,
  onOpenFile: ((path: string) => void) | undefined,
) {
  const [path, setPath] = useState<string | null>(null);
  const directUntil = useRef(0);
  const open = useStableCallback(
    onOpenFile
      ? (target: string, ...rest: unknown[]) => {
          if (
            (!isTranscriptImagePath(target) && mediaKind(target) !== "video") ||
            performance.now() < directUntil.current
          ) {
            // Markdown links also pass editor navigation: forward everything unchanged.
            (onOpenFile as (...args: unknown[]) => void)(target, ...rest);
            return;
          }
          setPath(target);
        }
      : undefined,
  );
  const noteClick = (event: { ctrlKey: boolean; metaKey: boolean }) => {
    // Markdown links resolve their path asynchronously, so the modifier stays valid for a moment.
    directUntil.current = event.ctrlKey || event.metaKey ? performance.now() + 1000 : 0;
  };
  const preview: ReactNode =
    path !== null && onOpenFile ? (
      <TranscriptMediaPreview
        key={path}
        path={path}
        cwd={cwd}
        onClose={() => setPath(null)}
        onOpenTab={() => onOpenFile(path)}
      />
    ) : null;
  return { open, noteClick, preview };
}

function TranscriptMediaPreview(props: Parameters<typeof TranscriptImagePreview>[0]) {
  return mediaKind(props.path) === "video" ? (
    <TranscriptVideoPreview key={`${props.cwd ?? ""}:${props.path}`} {...props} />
  ) : (
    <TranscriptImagePreview {...props} />
  );
}

/** Uses the existing player and native file grants; closing unmounts and pauses playback. */
function TranscriptVideoPreview({
  path,
  cwd,
  onClose,
  onOpenTab,
}: Parameters<typeof TranscriptImagePreview>[0]) {
  const t = useT();
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState<{ path: string } | { error: string }>();
  useEffect(() => {
    let cancelled = false;
    void (cwd ? resolveFileOpenRequest(cwd, path) : Promise.resolve(path)).then(
      (resolved) => {
        if (!cancelled) setSource({ path: resolved });
      },
      (reason: unknown) => {
        if (!cancelled)
          setSource({ error: reason instanceof Error ? reason.message : String(reason) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cwd, path, attempt]);
  return (
    <Modal
      title={basename(path)}
      onClose={onClose}
      size="xl"
      fitViewport
      expandable
      className="h-[min(760px,85dvh)]"
      toolbar={
        <MediaToolbarButton
          label={t("Open in new tab")}
          onClick={() => {
            onClose();
            window.setTimeout(onOpenTab, 0);
          }}
        >
          <ExternalLink className="icon-sm" aria-hidden />
        </MediaToolbarButton>
      }
    >
      <div className="h-full min-h-0">
        {!source ? (
          <SurfaceLoading />
        ) : "path" in source ? (
          <MediaView path={source.path} />
        ) : (
          <div className="flex flex-col gap-2 p-3">
            <InlineError>
              {t("Could not read {p0}: {p1}", { p0: basename(path), p1: source.error })}
            </InlineError>
            <Button
              variant="ghost"
              onClick={() => {
                setSource(undefined);
                setAttempt((value) => value + 1);
              }}
            >
              {t("Retry")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; detail?: string; file: string };

/**
 * The shared image dialog for one transcript file: zoom and pan come from `ImageLightbox`;
 * this adds the file actions (reveal, open in a tab, copy path) and the honest unreadable state.
 */
export function TranscriptImagePreview({
  path,
  cwd,
  onClose,
  onOpenTab,
}: {
  path: string;
  cwd: string | undefined;
  onClose: () => void;
  onOpenTab: () => void;
}) {
  const t = useT();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [resolved, setResolved] = useState(path);
  const reveal = useCopyFeedback({ resetKeys: [path] });
  const copied = useCopyFeedback({ resetKeys: [path] });

  useEffect(() => {
    let cancelled = false;
    let created: string | undefined;
    void (async () => {
      let file = path;
      try {
        file = cwd ? await resolveFileOpenRequest(cwd, path) : path;
        if (!cancelled) setResolved(file);
        const bytes = await readBinaryFile(file);
        if (cancelled) return;
        const mime = sniffDocumentImageMime(file, bytes);
        if (!mime) {
          setState({ status: "error", file });
          return;
        }
        created = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setState({ status: "ready", url: created });
      } catch (reason) {
        if (cancelled) return;
        const detail = reason instanceof Error ? reason.message : String(reason);
        setState({ status: "error", file, detail });
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [cwd, path, attempt]);

  const remote = resolved.startsWith(REMOTE_PATH_PREFIX) || !!cwd?.startsWith(REMOTE_PATH_PREFIX);
  const canReveal =
    !remote || (resolved.startsWith(REMOTE_PATH_PREFIX) && !!localExplorerPath(resolved));
  const revealLabel = t(REVEAL_LABEL);
  const name = basename(path);

  const actions = (
    <>
      <MediaToolbarButton
        label={
          canReveal
            ? revealLabel
            : t("Only files on this computer can be shown in the file manager.")
        }
        tooltip={
          canReveal
            ? revealLabel
            : t("Only files on this computer can be shown in the file manager.")
        }
        disabled={!canReveal || reveal.pending}
        onClick={() => reveal.copy(() => revealPath(resolved))}
      >
        <FolderOpen className="icon-sm" aria-hidden />
      </MediaToolbarButton>
      <MediaToolbarButton
        label={t("Open in new tab")}
        onClick={() => {
          onClose();
          // After the dialog's focus return, so the opened tab keeps the focus.
          window.setTimeout(onOpenTab, 0);
        }}
      >
        <ExternalLink className="icon-sm" aria-hidden />
      </MediaToolbarButton>
      <MediaToolbarButton
        label={t("Copy path")}
        disabled={copied.pending}
        onClick={() => copied.copy(() => copyText(resolved))}
      >
        {copied.copied ? (
          <Check className="icon-sm" aria-hidden />
        ) : (
          <Copy className="icon-sm" aria-hidden />
        )}
      </MediaToolbarButton>
    </>
  );
  const failure = reveal.failed
    ? t("Could not open the containing folder: {p0}", { p0: reveal.error ?? "" })
    : copied.failed
      ? t("Could not copy. Try again.")
      : undefined;

  return (
    <ImageLightbox
      src={state.status === "ready" ? state.url : ""}
      resetKey={path}
      alt={name}
      loading={state.status === "loading"}
      error={
        state.status !== "error"
          ? undefined
          : state.detail === undefined
            ? t("{p0} is not a readable image.", { p0: basename(state.file) })
            : t("Could not read {p0}: {p1}", { p0: basename(state.file), p1: state.detail })
      }
      notice={failure}
      actions={actions}
      onRetry={() => {
        setState({ status: "loading" });
        setAttempt((value) => value + 1);
      }}
      onClose={onClose}
    />
  );
}
