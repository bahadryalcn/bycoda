import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { DocumentMessage } from "../../files/public/DocumentMessage";
import type { Attachment } from "../model/session";
import { isAttachmentFolder } from "../model/attachments";
import { readBinaryFile } from "../../../platform/tauri/fs";
import { canPreviewFile } from "../../files/public/filePreviewMetadata";
import { mediaKind } from "../../files/public/mediaPreview";
import { documentKind, MAX_DOCUMENT_BYTES } from "../../files/public/documentViewer";
import { DocumentView } from "../../files/public/DocumentView";
import { Modal } from "../../../shared/ui/Modal";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { parseRemotePath, remotePath } from "../../connections/public/remoteProjects";

const MediaView = lazySurface(async () => ({
  default: (await import("../../files").then((entry) => entry.loadMediaView())).MediaView,
}));

function isTextAttachment(attachment: Attachment): boolean {
  return (
    attachment.mimeType.startsWith("text/") ||
    /^application\/(?:json|[^;]+\+json|xml|[^;]+\+xml|javascript)(?:;|$)/i.test(attachment.mimeType)
  );
}

export function canOpenFileAttachment(attachment: Attachment): boolean {
  return (
    !attachment.missing &&
    attachment.kind !== "image" &&
    !isAttachmentFolder(attachment) &&
    ((!!(documentKind(attachment.name) || mediaKind(attachment.name)) &&
      canPreviewFile(attachment.name)) ||
      isTextAttachment(attachment)) &&
    !!(attachment.path || attachment.data || attachment.loadPreview)
  );
}

/** Render attachment bytes as text, never as executable HTML or SVG. */
function AttachmentTextPreview({ readBytes }: { readBytes: () => Promise<Uint8Array> }) {
  const t = useT();
  const [state, setState] = useState<{ text: string } | { error: true } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void readBytes().then(
      (bytes) => {
        if (!cancelled) setState({ text: new TextDecoder().decode(bytes) });
      },
      () => {
        if (!cancelled) setState({ error: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [readBytes, retry]);
  if (!state) return <SurfaceLoading label={t("Loading…")} />;
  if ("error" in state)
    return (
      <DocumentMessage title={t("Preview unavailable. Try again.")} error>
        <Button
          variant="ghost"
          onClick={() => {
            setState(null);
            setRetry((value) => value + 1);
          }}
        >
          {t("Retry")}
        </Button>
      </DocumentMessage>
    );
  return (
    <OutputBlock
      tabIndex={0}
      tone="primary"
      scroll
      className="max-h-[min(620px,70dvh)] min-w-0 break-words p-3"
    >
      {state.text}
    </OutputBlock>
  );
}

/** Close immediately when a chip is rebound, before a new viewer can read another source. */
export function sameFilePreviewSource(opened: Attachment | null, current: Attachment): boolean {
  return (
    !!opened &&
    !current.missing &&
    opened.id === current.id &&
    opened.path === current.path &&
    opened.hostEnvironmentId === current.hostEnvironmentId &&
    opened.loadPreview === current.loadPreview &&
    opened.data === current.data &&
    opened.name === current.name
  );
}

/** The session reader takes precedence: a bare attachment path may belong to another OS. */
export function AttachmentFilePreview({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  const path =
    attachment.path && attachment.hostEnvironmentId && !parseRemotePath(attachment.path)
      ? remotePath(attachment.hostEnvironmentId, attachment.path)
      : attachment.path;
  const { size, loadPreview, data } = attachment;
  const readBytes = useCallback(async () => {
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_DOCUMENT_BYTES)
      throw new Error("File is too large to preview (maximum 25 MB).");
    const bytesData = loadPreview ? await loadPreview() : data;
    if (bytesData !== undefined && bytesData.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4)
      throw new Error("File is too large to preview (maximum 25 MB).");
    const bytes =
      bytesData !== undefined
        ? Uint8Array.from(atob(bytesData), (value) => value.charCodeAt(0))
        : path
          ? await readBinaryFile(path)
          : undefined;
    if (!bytes) throw new Error("This attachment is unavailable.");
    if (bytes.byteLength > MAX_DOCUMENT_BYTES)
      throw new Error("File is too large to preview (maximum 25 MB).");
    return bytes;
  }, [size, loadPreview, data, path]);
  // Session-only remote attachments use their authorized reader; never send their raw host path to an OS opener.
  const externalPath = attachment.loadPreview ? null : (path ?? null);
  const kind = documentKind(attachment.name);
  const fitContent = !mediaKind(attachment.name) && (!kind || kind === "csv" || kind === "tsv");
  return (
    <Modal
      padding="none"
      title={attachment.name}
      onClose={onClose}
      size="lg"
      fitViewport
      surface="floating"
      className={fitContent ? "" : "h-[min(760px,85dvh)]"}
    >
      <div className={fitContent ? "min-h-0" : "h-full min-h-0"}>
        {mediaKind(attachment.name) ? (
          <MediaView
            path={externalPath ?? attachment.name}
            mimeType={attachment.mimeType}
            readBytes={externalPath ? undefined : readBytes}
            externalPath={externalPath}
          />
        ) : documentKind(attachment.name) ? (
          <DocumentView
            path={attachment.name}
            cwd=""
            readBytes={readBytes}
            externalPath={externalPath}
            fitContent={fitContent}
          />
        ) : (
          <AttachmentTextPreview readBytes={readBytes} />
        )}
      </div>
    </Modal>
  );
}
