import { Progress } from "../../../shared/ui/Progress";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/technical";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MediaVisibilityContext } from "../model/mediaVisibility";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import { basename, prepareLocalFile, readBinaryFile } from "../../../platform/tauri/fs";
import { displayPath } from "../../../shared/lib/paths";
import { localExplorerPath } from "../../../shared/lib/remoteExplorerPaths";
import {
  documentKind,
  documentProblem,
  documentProblemDetail,
  documentSizeProblem,
  MAX_DOCUMENT_BYTES,
  type DocumentKind,
  type DocumentProblem,
} from "../model/documentViewer";
import { describeDocumentProblem } from "../model/documentProblemText";
import { DocumentMessage } from "./DocumentMessage";
import { FileActionError } from "./FileActionError";
import { FilePreviewSearch } from "./FilePreviewSearch";
import { FileTransferProgress } from "./FileTransferProgress";
import { OpenInDefaultAppButton, ViewerFooter } from "./ViewerFooter";
import { useDefaultAppOpen } from "./useDefaultAppOpen";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { formatFileSize } from "../model/filePreview";
import { watchFile } from "../model/fileWatch";
import { SurfaceSelection } from "../../sessions/public/SurfaceSelection";

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
  /**
   * False while a tab or pane keeps this viewer mounted but covered. It stays mounted (page,
   * zoom and scroll survive), but its first read waits for the first show and a file change
   * seen while covered reloads once when shown again. Combined with the owning pane's visibility.
   */
  visible?: boolean;
};

type LoadState =
  | { status: "loading"; received?: number; total?: number }
  | { status: "cancelled" }
  | { status: "ready"; path: string; bytes: Uint8Array }
  | { status: "error"; problem: DocumentProblem };

/**
 * Read-only surface for PDF, Word and Excel files. Reads the bytes the same way
 * the image viewer does, then hands them to a lazily loaded format viewer.
 */
export function DocumentView({
  path,
  cwd,
  readBytes,
  externalPath = path,
  fitContent = false,
  visible = true,
}: Props) {
  useLocale();
  const paneVisible = useContext(MediaVisibilityContext);
  const shown = visible && paneVisible;
  // A viewer that was never shown has nothing to display yet; the first show latches the load.
  const [opened, setOpened] = useState(shown);
  if (shown && !opened) setOpened(true);
  const shownRef = useRef(shown);
  // A change noticed while covered; the next show reloads once instead of polling in the background.
  const changedWhileHidden = useRef(false);
  const kind = documentKind(path);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  // The open action belongs to the file it came from; a different file starts clean.
  const actionOwner = useMemo(() => ({ path, externalPath }), [path, externalPath]);
  const openAction = useDefaultAppOpen(actionOwner, externalPath ?? path);
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  const name = basename(path);
  // Only a copy from a connected machine has a transfer to abort; local reads and attachments do not.
  const transferable = !readBytes && !!parseRemotePath(path);
  // `cancelledPath` keeps a file change from restarting a transfer the owner cancelled.
  const transfer = useRef<AbortController | null>(null);
  const cancelledPath = useRef<string | null>(null);
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
    // Legacy .doc has nothing to parse; a viewer never shown has no reader yet.
    if (!kind || kind === "doc" || !opened) return;
    // This read supersedes any change noticed before it started.
    changedWhileHidden.current = false;
    let cancelled = false;
    const controller = new AbortController();
    transfer.current = controller;
    // A reload of the same file keeps the viewer mounted (page and scroll stay).
    setState((current) =>
      current.status === "ready" && current.path === path ? current : { status: "loading" },
    );
    (readBytes
      ? readBytes()
      : parseRemotePath(path)
        ? prepareLocalFile(path, {
            signal: controller.signal,
            maxBytes: MAX_DOCUMENT_BYTES,
            onProgress: (received, total) => {
              if (controller.signal.aborted) return;
              // A reload of a shown document must not replace it with the progress bar.
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
        const problem = documentSizeProblem(bytes.byteLength);
        setState(problem ? { status: "error", problem } : { status: "ready", path, bytes });
      },
      (cause: unknown) => {
        // The Cancel button already showed its own state.
        if (!cancelled && !controller.signal.aborted) {
          setState({ status: "error", problem: documentProblem(cause) });
        }
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path, kind, reloadKey, readBytes, opened]);

  useEffect(() => {
    // Follow the shell's visibility; a covered viewer is reloaded on show, never in the background.
    shownRef.current = shown;
    if (!shown || !changedWhileHidden.current) return;
    changedWhileHidden.current = false;
    if (cancelledPath.current !== path) reload();
  }, [shown, path, reload]);

  useEffect(() => {
    if (readBytes) return;
    let timer = 0;
    const stop = watchFile(path, () => {
      if (!shownRef.current) {
        changedWhileHidden.current = true;
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Covered during the debounce: leave the reload for the next show.
        if (!shownRef.current) changedWhileHidden.current = true;
        else if (cancelledPath.current !== path) reload();
      }, 50);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [path, reload, readBytes]);

  const loadShownCentrally = useConnectionErrorShownCentrally(
    state.status === "error" ? documentProblemDetail(state.problem) : undefined,
  );
  const remote = !!parseRemotePath(externalPath ?? path);
  const localCopy = remote && !localExplorerPath(externalPath ?? path);
  const detail = (
    <span className="ui-caption-text mt-1 block break-all font-mono">{displayPath(path, cwd)}</span>
  );

  const openButton = externalPath ? (
    <OpenInDefaultAppButton
      localCopy={localCopy}
      loading={openAction.opening}
      onOpen={openAction.open}
    />
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
  } else if (state.status === "error" && loadShownCentrally) {
    body = null;
  } else if (state.status === "error") {
    body = (
      <DocumentMessage title={t("Couldn’t open {p0}", { p0: name })} error>
        {describeDocumentProblem(state.problem)}
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
  } else if (state.status === "cancelled") {
    body = (
      <DocumentMessage title={t("Cancelled")}>
        {name}
        {detail}
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          onClick={retry}
          className="mt-3"
        >
          {t("Retry")}
        </Button>
      </DocumentMessage>
    );
  } else if (state.status === "loading") {
    body = (
      <Loading
        name={name}
        received={state.received}
        total={state.total}
        onCancel={transferable ? cancelTransfer : undefined}
      />
    );
  } else {
    body = (
      <Suspense fallback={<Loading name={name} />}>
        <FormatViewer
          kind={kind as DocumentKind}
          bytes={state.bytes}
          path={path}
          fitContent={fitContent}
          shown={shown}
        />
      </Suspense>
    );
  }

  return (
    <div className={`flex min-h-0 flex-col ${fitContent ? "" : "h-full"}`}>
      <SurfaceSelection
        active={shown}
        className="min-h-0 flex-1"
        context={`@${displayPath(path, cwd)}`}
        cwd={cwd}
        contentVersion={state}
      >
        {body}
      </SurfaceSelection>
      <ViewerFooter name={name}>
        {state.status === "ready" ? (
          <span className="shrink-0 tabular-nums">{formatFileSize(state.bytes.byteLength)}</span>
        ) : null}
        {openButton}
      </ViewerFooter>
      {openAction.error ? (
        <FileActionError message={openAction.error} onDismiss={openAction.dismiss} />
      ) : null}
    </div>
  );
}

function FormatViewer({
  kind,
  bytes,
  path,
  fitContent,
  shown,
}: {
  kind: DocumentKind;
  bytes: Uint8Array;
  path: string;
  fitContent?: boolean;
  shown: boolean;
}) {
  useLocale();
  if (kind === "pdf") return <PdfViewer bytes={bytes} />;
  if (kind === "docx")
    return (
      <FilePreviewSearch active={shown} contentVersion={path}>
        <DocxViewer bytes={bytes} />
      </FilePreviewSearch>
    );
  return (
    <SheetViewer
      bytes={bytes}
      format={kind === "csv" || kind === "tsv" ? kind : undefined}
      fitContent={fitContent}
    />
  );
}

function Loading({
  name,
  received,
  total,
  onCancel,
}: {
  name: string;
  received?: number;
  total?: number;
  onCancel?: () => void;
}) {
  useLocale();
  return (
    <div className="grid h-full place-items-center p-3">
      {onCancel ? (
        <FileTransferProgress
          label={t("Opening {p0}…", { p0: name })}
          received={received}
          total={total}
          onCancel={onCancel}
        />
      ) : (
        <Progress label={t("Opening {p0}…", { p0: name })} compact />
      )}
    </div>
  );
}
