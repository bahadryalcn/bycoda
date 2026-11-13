import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { t, useLocale } from "../../../shared/i18n/technical";
import { formatBytes } from "../../../shared/i18n/format";
import { Folder, RotateCcw } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Progress } from "../../../shared/ui/Progress";
import { useEffect, useState } from "react";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { basename, revealPath } from "../../../platform/tauri/fs";
import { readTextFileSlice, type TextFileSlice } from "../data/largeTextFile";

const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open Containing Folder";

/** Prefix of the native editor-limit error (`read_text_file_sync` in `fs.rs`). */
const TOO_LARGE_TO_EDIT = "File is too large to edit";

export function isTooLargeToEdit(message: string): boolean {
  return message.startsWith(TOO_LARGE_TO_EDIT);
}

const reveal = (path: string) =>
  void revealPath(path).catch((error) => {
    console.warn("FileLoadError reveal failed", error);
  });

/** Shown when the editor cannot load a file. Local files over the editor limit
 * open as a read-only, paged view instead of a dead end. */
export function FileLoadError({
  path,
  message,
  onRetry,
}: {
  path: string;
  message: string;
  onRetry: () => void;
}) {
  useLocale();
  const local = !isRemoteProjectPath(path);
  const [fallback, setFallback] = useState<string | null>(null);
  if (local && isTooLargeToEdit(message) && fallback === null)
    return <LargeTextFileView key={path} path={path} onError={setFallback} />;
  return (
    <div className="grid h-full place-items-center p-6">
      <Alert tone="danger" className="max-w-md" title={`${t("Couldn’t open ")}${basename(path)}`}>
        <p>{fallback ?? message}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1">
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
          ) : null}
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
  onError: (message: string) => void;
}) {
  useLocale();
  // Start offsets of the pages before the current one, for "Previous".
  const [history, setHistory] = useState<number[]>([]);
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; slice: TextFileSlice } | null>(null);
  const key = `${path}:${offset}`;
  const page = loaded?.key === key ? loaded.slice : null;

  useEffect(() => {
    let cancelled = false;
    readTextFileSlice(path, offset).then(
      (slice) => {
        if (!cancelled) setLoaded({ key: `${path}:${offset}`, slice });
      },
      (error: unknown) => {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, offset, onError]);

  if (!page) {
    return (
      <div className="grid h-full place-items-center p-3">
        <Progress label={t("Opening ") + basename(path) + "…"} compact />
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
          { frame: "stroke", edge: "bottom" },
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
        <Button size="sm" variant="ghost" motion="none" type="button" onClick={() => reveal(path)}>
          <Folder className="icon-xs" strokeWidth={1.75} />
          {t(REVEAL_LABEL)}
        </Button>
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
