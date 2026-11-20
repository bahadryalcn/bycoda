import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { t, useLocale } from "../../../shared/i18n/technical";
import { formatBytes } from "../../../shared/i18n/format";
import { Folder, RotateCcw } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Progress } from "../../../shared/ui/Progress";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { useEffect, useRef, useState } from "react";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { isRemoteProjectPath } from "../../projects/public/recents";
import {
  isUnsupportedRemoteRoute,
  presentRemoteError,
} from "../../connections/public/remoteFailure";
import { basename, revealPath } from "../../../platform/tauri/fs";
import { readTextFileSlice, type TextFileSlice, type TextFileStamp } from "../data/largeTextFile";

const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open containing folder";

/** Prefix of the native editor-limit error (`read_text_file_sync` in `fs.rs`). */
const TOO_LARGE_TO_EDIT = "File is too large to edit";

export function isTooLargeToEdit(message: string): boolean {
  return message.startsWith(TOO_LARGE_TO_EDIT);
}

const reveal = (path: string) =>
  void revealPath(path).catch((error) => {
    console.warn("FileLoadError reveal failed", error);
  });

/** Why a paged read stopped: the sentence to show, and whether sending the same request again can help. */
type PagedFailure = { message: string; retryable: boolean };

/** Shown when the editor cannot load a file. A file over the editor limit opens as a read-only,
 * paged view, on this computer or on the connected machine that owns it. Where the same request
 * cannot succeed (an outdated Host), no Retry is offered: the message names the fix instead. */
export function FileLoadError({
  path,
  message,
  retryable = true,
  onRetry,
}: {
  path: string;
  message: string;
  retryable?: boolean;
  onRetry: () => void;
}) {
  useLocale();
  const local = !isRemoteProjectPath(path);
  const [fallback, setFallback] = useState<PagedFailure | null>(null);
  const shownCentrally = useConnectionErrorShownCentrally(message);
  if (isTooLargeToEdit(message) && fallback === null)
    return <LargeTextFileView key={path} path={path} onError={setFallback} />;
  if (shownCentrally) return null;
  const failure = fallback ?? { message, retryable };
  return (
    <div className="grid h-full place-items-center p-6">
      <Alert tone="danger" className="max-w-md" title={`${t("Couldn’t open ")}${basename(path)}`}>
        <p>{failure.message}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {failure.retryable ? (
            <Button
              size="sm"
              variant="ghost"
              motion="none"
              type="button"
              onClick={() => {
                setFallback(null);
                onRetry();
              }}
              className="shrink-0"
            >
              <RotateCcw className="icon-xs" strokeWidth={1.75} />
              {t("Retry")}
            </Button>
          ) : null}
          {local ? (
            <Button
              size="sm"
              variant="ghost"
              motion="none"
              type="button"
              onClick={() => reveal(path)}
              className="shrink-0"
            >
              <Folder className="icon-xs" strokeWidth={1.75} />
              {t(REVEAL_LABEL)}
            </Button>
          ) : (
            <CopyButton
              size="sm"
              variant="ghost"
              label={t("Copy path")}
              text={path}
              resetKeys={[path]}
            />
          )}
        </div>
      </Alert>
    </div>
  );
}

function LargeTextFileView({
  path,
  onError,
}: {
  path: string;
  onError: (failure: PagedFailure) => void;
}) {
  useLocale();
  const local = !isRemoteProjectPath(path);
  // Start offsets of the pages before the current one, for "Previous".
  const [history, setHistory] = useState<number[]>([]);
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; slice: TextFileSlice } | null>(null);
  // Version of the file the first page came from; every later page must match it.
  const stamp = useRef<TextFileStamp | null>(null);
  const key = `${path}:${offset}`;
  const page = loaded?.key === key ? loaded.slice : null;

  // Loads the page at the current byte offset from the host; a superseded request's reply is dropped.
  useEffect(() => {
    let cancelled = false;
    readTextFileSlice(path, offset, stamp.current).then(
      (slice) => {
        if (cancelled) return;
        stamp.current ??= { size: slice.size, modifiedUs: slice.modifiedUs };
        setLoaded({ key: `${path}:${offset}`, slice });
      },
      (error: unknown) => {
        if (!cancelled)
          onError({
            message: presentRemoteError(error, { explicit: true }),
            retryable: !isUnsupportedRemoteRoute(error),
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, offset, onError]);

  if (!page) {
    return (
      <div className="grid h-full place-items-center p-3">
        <Progress label={t("Opening {p0}…", { p0: basename(path) })} compact />
      </div>
    );
  }

  const hasNext = page.end < page.size && page.end > page.offset;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Text
        as="div"
        size="micro"
        tone="muted"
        {...surfaceAttributes(
          { frame: "pane", edge: "bottom" },
          "flex min-h-[var(--ui-control-height-compact)] shrink-0 flex-wrap items-center gap-1 px-2.5",
        )}
      >
        <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
          {t("Read-only preview, too large to edit · {p0}–{p1} of {p2}", {
            p0: formatBytes(page.offset),
            p1: formatBytes(page.end),
            p2: formatBytes(page.size),
          })}
        </Text>
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          disabled={history.length === 0}
          onClick={() => {
            setOffset(history[history.length - 1] ?? 0);
            setHistory((current) => current.slice(0, -1));
          }}
        >
          {t("Previous")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          disabled={!hasNext}
          onClick={() => {
            setHistory((current) => [...current, page.offset]);
            setOffset(page.end);
          }}
        >
          {t("Next")}
        </Button>
        {local ? (
          <Button
            size="sm"
            variant="ghost"
            motion="none"
            type="button"
            onClick={() => reveal(path)}
          >
            <Folder className="icon-xs" strokeWidth={1.75} />
            {t(REVEAL_LABEL)}
          </Button>
        ) : (
          <CopyButton
            size="sm"
            variant="ghost"
            label={t("Copy path")}
            text={path}
            resetKeys={[path]}
          />
        )}
      </Text>
      <OutputBlock
        size="secondary"
        tone="secondary"
        density="comfortable"
        className="min-h-0 min-w-0 flex-1 overflow-auto wrap-break-word px-4 py-3"
      >
        {page.text}
      </OutputBlock>
    </div>
  );
}
