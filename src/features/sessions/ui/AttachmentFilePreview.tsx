import { useCallback } from "react";
import type { Attachment } from "../model/session";
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

export function canOpenFileAttachment(attachment: Attachment): boolean {
  return (
    !attachment.missing &&
    attachment.kind !== "image" &&
    !!(documentKind(attachment.name) || mediaKind(attachment.name)) &&
    canPreviewFile(attachment.name) &&
    !!(attachment.path || attachment.data || attachment.loadPreview)
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
  return (
    <Modal
      title={attachment.name}
      onClose={onClose}
      size="lg"
      fitViewport
      className="h-[min(760px,85dvh)] bg-background-base"
    >
      <div className="h-full min-h-0">
        {mediaKind(attachment.name) ? (
          <MediaView
            path={externalPath ?? attachment.name}
            mimeType={attachment.mimeType}
            readBytes={externalPath ? undefined : readBytes}
            externalPath={externalPath}
          />
        ) : (
          <DocumentView
            path={attachment.name}
            cwd=""
            readBytes={readBytes}
            externalPath={externalPath}
          />
        )}
      </div>
    </Modal>
  );
}
