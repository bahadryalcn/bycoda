import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Progress } from "../../../shared/ui/Progress";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/technical";
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "../../../shared/ui/icons";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import {
  basename,
  openPathWithDefaultApp,
  prepareLocalFile,
  readBinaryFile,
} from "../../../platform/tauri/fs";
import { displayPath } from "../../../shared/lib/paths";
import { localExplorerPath } from "../../../shared/lib/remoteExplorerPaths";
import {
  documentErrorMessage,
  documentKind,
  documentSizeProblem,
  type DocumentKind,
} from "../model/documentViewer";
import { DocumentMessage } from "./DocumentMessage";
import { FileActionError } from "./FileActionError";
import { formatFileSize } from "../model/filePreview";
import { watchFile } from "../model/fileWatch";
import { SurfaceSelection } from "../../sessions/ui/SurfaceSelection";

// The parsers are big; each loads on first use so none reach the main bundle.
const PdfViewer = lazy(() => import("./PdfViewer"));
const DocxViewer = lazy(() => import("./DocxViewer"));
const SheetViewer = lazy(() => import("./SheetViewer"));

type Props = {
  path: string;
  cwd: string;
  readBytes?: () => Promise<Uint8Array>;
  externalPath?: string | null;
  /** Content-sized attachment previews; the editor keeps its full-height viewport. */
  fitContent?: boolean;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; bytes: Uint8Array }
  | { status: "error"; message: string };

/**
 * Read-only surface for PDF, Word and Excel files. Reads the bytes the same way
 * the image viewer does, then hands them to a lazily loaded format viewer.
 */
export function DocumentView({ path, cwd, readBytes, externalPath = path, fitContent = false }: Props) {
  useLocale();
  const kind = documentKind(path);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  // The error belongs to the file it came from; a different file shows none.
  const actionKey = JSON.stringify([path, externalPath ?? ""]);
  const [actionFailure, setActionFailure] = useState<{ key: string; message: string } | null>(
    null,
  );
  const actionError = actionFailure && actionFailure.key === actionKey ? actionFailure.message : null;
  const setActionError = (message: string | null) =>
    setActionFailure(message === null ? null : { key: actionKey, message });
  const actionRequest = useRef(0);
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  const name = basename(path);

  useEffect(() => {
    return () => {
      actionRequest.current += 1;
    };
  }, [path, externalPath]);

  useEffect(() => {
    // Legacy .doc has nothing to parse; don't read it.
    if (!kind || kind === "doc") return;
    let cancelled = false;
    const controller = new AbortController();
    setState({ status: "loading" });
    (readBytes
      ? readBytes()
      : parseRemotePath(path)
        ? prepareLocalFile(path, { signal: controller.signal, maxBytes: 25 * 1024 * 1024 }).then(
            (local) => {
              if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
              return readBinaryFile(local);
            },
          )
        : readBinaryFile(path)
    ).then(
      (bytes) => {
        if (cancelled) return;
        const problem = documentSizeProblem(bytes.byteLength);
        setState(problem ? { status: "error", message: problem } : { status: "ready", bytes });
      },
      (cause: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: documentErrorMessage(cause) });
        }
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path, kind, reloadKey, readBytes]);

  useEffect(() => {
    if (readBytes) return;
    let timer = 0;
    const stop = watchFile(path, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reload, 50);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [path, reload, readBytes]);

  const remote = !!parseRemotePath(externalPath ?? path);
  const localCopy = remote && !localExplorerPath(externalPath ?? path);
  const detail = (
    <p className="ui-caption-text mt-1 break-all font-mono">{displayPath(path, cwd)}</p>
  );

  const pdfReady = kind === "pdf" && state.status === "ready";
  const openButton = externalPath ? (
    <Button
      size="sm"
      variant="ghost"
      motion="none"
      type="button"
      tooltip={t(
        localCopy
          ? "Changes to this local copy are not saved to the connected machine."
          : "Open in default app",
      )}
      onClick={() => {
        setActionError(null);
        const request = ++actionRequest.current;
        void openPathWithDefaultApp(externalPath).catch((cause: unknown) => {
          if (request === actionRequest.current)
            setActionError(cause instanceof Error ? cause.message : String(cause));
        });
      }}
      className="flex items-center gap-1.5"
    >
      <ExternalLink className="icon-xs" strokeWidth={1.75} />
      {t(localCopy ? "Open local copy" : "Open in default app")}
    </Button>
  ) : null;

  let body: ReactNode;
  if (kind === "doc") {
    body = (
      <DocumentMessage title={t("{p0} can’t be previewed", { p0: name })}>
        {t(
          "Legacy .doc files aren’t supported. Convert it to .docx, or open it in the default app.",
        )}
        {detail}
      </DocumentMessage>
    );
  } else if (state.status === "error") {
    body = (
      <DocumentMessage title={t("Couldn’t open {p0}", { p0: name })} error>
        {state.message}
        {detail}
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          onClick={reload}
          className="mt-3"
        >
          {t("Retry")}
        </Button>
      </DocumentMessage>
    );
  } else if (state.status === "loading") {
    body = <Loading name={name} />;
  } else {
    body = (
      <Suspense fallback={<Loading name={name} />}>
        <FormatViewer kind={kind as DocumentKind} bytes={state.bytes} trailing={openButton} fitContent={fitContent} />
      </Suspense>
    );
  }

  return (
    <div className={`flex min-h-0 flex-col ${fitContent ? "" : "h-full"}`}>
      <SurfaceSelection
        className="min-h-0 flex-1"
        context={`@${displayPath(path, cwd)}`}
        cwd={cwd}
        contentVersion={state}
      >
        {body}
      </SurfaceSelection>
      {pdfReady ? null : (
        <footer className="flex min-h-(--ui-control-height-compact) shrink-0 flex-wrap items-center gap-3 border-t border-(--ui-pane-border) px-3 py-1 text-ui-caption text-(--ui-text-secondary)">
          <OverflowTooltip label={name}>
            <span className="min-w-0 flex-1 truncate">{name}</span>
          </OverflowTooltip>
          {state.status === "ready" ? (
            <span className="shrink-0 tabular-nums">{formatFileSize(state.bytes.byteLength)}</span>
          ) : null}
          {openButton}
        </footer>
      )}
      {actionError ? (
        <FileActionError message={actionError} onDismiss={() => setActionError(null)} />
      ) : null}
    </div>
  );
}

function FormatViewer({
  kind,
  bytes,
  trailing,
  fitContent,
}: {
  kind: DocumentKind;
  bytes: Uint8Array;
  trailing?: ReactNode;
  fitContent?: boolean;
}) {
  useLocale();
  if (kind === "pdf") return <PdfViewer bytes={bytes} trailing={trailing} />;
  if (kind === "docx") return <DocxViewer bytes={bytes} />;
  return <SheetViewer bytes={bytes} format={kind === "csv" || kind === "tsv" ? kind : undefined} fitContent={fitContent} />;
}

function Loading({ name }: { name: string }) {
  useLocale();
  return (
    <div className="grid h-full place-items-center p-3">
      <Progress label={t("Opening ") + name + "…"} compact />
    </div>
  );
}
