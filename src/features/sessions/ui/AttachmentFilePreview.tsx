import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { DocumentMessage } from "../../files/ui/DocumentMessage";
import type { Attachment } from "../model/session";
import { isAttachmentFolder } from "../model/attachments";
import { readBinaryFile } from "../../../platform/tauri/fs";
import { canPreviewFile } from "../../files/model/filePreview";
import { mediaKind } from "../../files/model/mediaPreview";
import { documentKind, MAX_DOCUMENT_BYTES } from "../../files/model/documentViewer";
import { DocumentView } from "../../files/ui/DocumentView";
import { Modal } from "../../../shared/ui/Modal";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { parseRemotePath, remotePath } from "../../connections/model/remoteProjects";

const MediaView = lazySurface(async () => ({
  default: (await import("../../files/ui/MediaView")).MediaView,
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
  if (!state) return <DocumentMessage title={t("Loading…")} />;
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
    <pre
      tabIndex={0}
      className="max-h-[min(620px,70dvh)] min-w-0 overflow-auto whitespace-pre-wrap break-words p-3 select-text font-mono text-(length:--ui-font-caption) text-content"
    >
      {state.text}
    </pre>
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
  const readBytes = useCallback(async () => {
    if (
      !Number.isSafeInteger(attachment.size) ||
      attachment.size < 0 ||
      attachment.size > MAX_DOCUMENT_BYTES
    )
      throw new Error("File is too large to preview (maximum 25 MB).");
    const data = attachment.loadPreview ? await attachment.loadPreview() : attachment.data;
    if (data !== undefined && data.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4)
      throw new Error("File is too large to preview (maximum 25 MB).");
    const bytes =
      data !== undefined
        ? Uint8Array.from(atob(data), (value) => value.charCodeAt(0))
        : path
          ? await readBinaryFile(path)
          : undefined;
    if (!bytes) throw new Error("This attachment is unavailable.");
    if (bytes.byteLength > MAX_DOCUMENT_BYTES)
      throw new Error("File is too large to preview (maximum 25 MB).");
    return bytes;
  }, [attachment.size, attachment.loadPreview, attachment.data, path]);
  // Session-only remote attachments use their authorized reader; never send their raw host path to an OS opener.
  const externalPath = attachment.loadPreview ? null : (path ?? null);
  const kind = documentKind(attachment.name);
  const fitContent = !mediaKind(attachment.name) && (!kind || kind === "csv" || kind === "tsv");
  return (
    <Modal
      title={attachment.name}
      onClose={onClose}
      size="lg"
      fitViewport
      className={`${fitContent ? "" : "h-[min(760px,85dvh)] "}bg-(--ui-surface)`}
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
