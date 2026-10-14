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
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; bytes: Uint8Array }
  | { status: "error"; message: string };

/**
 * Read-only surface for PDF, Word and Excel files. Reads the bytes the same way
 * the image viewer does, then hands them to a lazily loaded format viewer.
 */
export function DocumentView({ path, cwd, readBytes, externalPath = path }: Props) {
  useLocale();
  const kind = documentKind(path);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionRequest = useRef(0);
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  const name = basename(path);

  useEffect(() => {
    setActionError(null);
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
        <button
          type="button"
          onClick={reload}
          className="mt-3 h-7 rounded-md bg-content/10 px-2.5 text-[12px] text-content hover:bg-content/15"
        >
          {t("Retry")}
        </button>
      </DocumentMessage>
    );
  } else if (state.status === "loading") {
    body = <Loading name={name} />;
  } else {
    body = (
      <Suspense fallback={<Loading name={name} />}>
        <FormatViewer kind={kind as DocumentKind} bytes={state.bytes} />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SurfaceSelection className="min-h-0 flex-1" context={`@${displayPath(path, cwd)}`} cwd={cwd} contentVersion={state}>
        {body}
      </SurfaceSelection>
      <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-stroke px-3 text-[11px] text-content/50">
        <span className="truncate">{name}</span>
        {state.status === "ready" ? (
          <span className="tabular-nums">{formatFileSize(state.bytes.byteLength)}</span>
        ) : null}
        <span className="flex-1" />
        {externalPath ? (
          <button
            type="button"
            title={t(
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
            className="flex h-5 items-center gap-1.5 rounded px-1.5 hover:bg-content/10 hover:text-content"
          >
            <ExternalLink className="size-3" strokeWidth={1.75} />
            {t(localCopy ? "Open local copy" : "Open in default app")}
          </button>
        ) : null}
      </footer>
      {actionError ? (
        <FileActionError message={actionError} onDismiss={() => setActionError(null)} />
      ) : null}
    </div>
  );
}

function FormatViewer({ kind, bytes }: { kind: DocumentKind; bytes: Uint8Array }) {
  useLocale();
  if (kind === "pdf") return <PdfViewer bytes={bytes} />;
  if (kind === "docx") return <DocxViewer bytes={bytes} />;
  return <SheetViewer bytes={bytes} format={kind === "csv" || kind === "tsv" ? kind : undefined} />;
}

function Loading({ name }: { name: string }) {
  useLocale();
  return (
    <div className="grid h-full place-items-center text-[12px] text-content/45">
      {t("Opening ")}
      {name}…
    </div>
  );
}
