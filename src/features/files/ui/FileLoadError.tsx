import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { t, useLocale } from "../../../shared/i18n/technical";
import { formatBytes } from "../../../shared/i18n/format";
import { Folder } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
import { DocumentMessage } from "./DocumentMessage";
import { Progress } from "../../../shared/ui/Progress";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { useEffect, useRef, useState } from "react";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { isUnsupportedRemoteRoute } from "../../connections/public/remoteFailure";
import { useGracedFailure } from "../../connections/public/transientFailure";
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
  if (isTooLargeToEdit(message)) {
    return <LargeTextFileView key={path} path={path} onRetry={onRetry} />;
  }
  return <FileLoadFailure path={path} message={message} retryable={retryable} onRetry={onRetry} />;
}

function FileLoadFailure({
  path,
  message,
  retryable,
  onRetry,
}: {
  path: string;
  message: string;
  retryable: boolean;
  onRetry: () => void;
}) {
  useLocale();
  const local = !isRemoteProjectPath(path);
  const shownCentrally = useConnectionErrorShownCentrally(message);
  if (shownCentrally) return null;
  return (
    <DocumentMessage
      title={t("Couldn’t open {p0}", { p0: basename(path) })}
      error
      detail={message}
      onRetry={retryable ? onRetry : undefined}
      action={local ? { label: t(REVEAL_LABEL), onClick: () => reveal(path) } : undefined}
      extra={
        local ? undefined : (
          <CopyButton
            size="sm"
            variant="ghost"
            label={t("Copy path")}
            text={path}
            resetKeys={[path]}
          />
        )
      }
    />
  );
}

function LargeTextFileView({ path, onRetry }: { path: string; onRetry: () => void }) {
  useLocale();
  const local = !isRemoteProjectPath(path);
  // Start offsets of the pages before the current one, for "Previous".
  const [history, setHistory] = useState<number[]>([]);
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<{ key: string; attempt: number; error: unknown }>();
  const [loaded, setLoaded] = useState<{ key: string; slice: TextFileSlice } | null>(null);
  // Version of the file the first page came from; every later page must match it.
  const stamp = useRef<TextFileStamp | null>(null);
  const key = `${path}:${offset}`;
  const page = loaded?.key === key ? loaded.slice : null;
  const error = failed?.key === key ? failed.error : undefined;
  const { visibleError } = useGracedFailure({
    error,
    loading: !page && attempt !== failed?.attempt,
    retry: () => setAttempt((value) => value + 1),
    scope: key,
  });

  // Loads the page at the current byte offset from the host; a superseded request's reply is dropped.
  useEffect(() => {
    let cancelled = false;
    readTextFileSlice(path, offset, stamp.current).then(
      (slice) => {
        if (cancelled) return;
        stamp.current ??= { size: slice.size, modifiedUs: slice.modifiedUs };
        setLoaded({ key, slice });
        setFailed(undefined);
      },
      (error: unknown) => {
        if (!cancelled) setFailed({ key, attempt, error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, offset, key, attempt]);

  if (visibleError) {
    return (
      <FileLoadFailure
        path={path}
        message={visibleError}
        retryable={!isUnsupportedRemoteRoute(error)}
        onRetry={onRetry}
      />
    );
  }

  if (!page) {
    return (
      <div aria-busy className="grid h-full place-items-center p-3">
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
            startIcon={<Folder className="icon-xs" strokeWidth={1.75} />}
            onClick={() => reveal(path)}
          >
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
