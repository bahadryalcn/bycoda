import { errorText } from "../../../shared/lib/errors";
import { bytesToBase64, decodeBase64 } from "../../../shared/lib/base64";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { DocumentMessage } from "../../files/public/DocumentMessage";
import type { Attachment } from "../model/session";
import { isAttachmentFolder, MAX_EMBED_BYTES } from "../model/attachments";
import { readBinaryFile, saveFileCopy } from "../../../platform/tauri/fs";
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
    opened.size === current.size &&
    opened.kind === current.kind &&
    opened.name === current.name
  );
}

/** A bare attachment path may belong to another OS; a recorded host identity routes it to its owner. */
function ownedAttachmentPath(attachment: Attachment): string | undefined {
  return attachment.path && attachment.hostEnvironmentId && !parseRemotePath(attachment.path)
    ? remotePath(attachment.hostEnvironmentId, attachment.path)
    : attachment.path;
}

/** The session reader takes precedence over a disk path; both are bounded by `limit` bytes. */
async function readAttachmentBytes(
  { size, loadPreview, data, path }: Pick<Attachment, "size" | "loadPreview" | "data" | "path">,
  limit: number,
  tooLarge: string,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(size) || size < 0 || size > limit) throw new Error(tooLarge);
  const bytesData = loadPreview ? await loadPreview() : data;
  if (bytesData !== undefined && bytesData.length > Math.ceil(limit / 3) * 4)
    throw new Error(tooLarge);
  const bytes =
    bytesData !== undefined
      ? decodeBase64(bytesData)
      : path
        ? await readBinaryFile(path)
        : undefined;
  if (!bytes) throw new Error("This attachment is unavailable.");
  if (bytes.byteLength > limit) throw new Error(tooLarge);
  return bytes;
}

/** Any attachment that is a real file with a reader can be saved, whether or not it previews. */
export function canSaveAttachmentCopy(attachment: Attachment): boolean {
  return (
    !attachment.missing &&
    !isAttachmentFolder(attachment) &&
    Boolean(attachment.path || attachment.data !== undefined || attachment.loadPreview)
  );
}

type SaveCopyState = { owner: Attachment; saving: boolean; error?: string };

// Module-level so the try/finally stays out of the hook the React Compiler compiles.
async function saveAttachmentCopy(
  attachment: Attachment,
  isCurrent: () => boolean,
  update: (patch: Pick<SaveCopyState, "saving" | "error">) => void,
  finish: () => void,
) {
  try {
    update({ saving: true, error: undefined });
    const bytes = await readAttachmentBytes(
      { ...attachment, path: ownedAttachmentPath(attachment) },
      MAX_EMBED_BYTES,
      "File is too large to save (maximum 20 MB).",
    );
    if (!isCurrent()) return;
    // The native dialog picks the destination; bytes are written as data, never opened.
    await saveFileCopy({ name: attachment.name, data: bytesToBase64(bytes) });
    update({ saving: false });
  } catch (cause) {
    update({
      saving: false,
      error: errorText(cause),
    });
  } finally {
    finish();
  }
}

/** Explicit "Save a copy": the owner picks the destination in a native dialog. */
export function useSaveAttachmentCopy(attachment: Attachment) {
  const [held, setHeld] = useState<SaveCopyState | null>(null);
  const liveAttachment = useRef<Attachment | null>(null);
  const flight = useRef<object | null>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Invalidate an outstanding file read before it opens a save dialog for a replaced attachment.
  useLayoutEffect(() => {
    if (!sameFilePreviewSource(liveAttachment.current, attachment)) {
      flight.current = null;
      if (liveAttachment.current) setHeld(null);
    }
    liveAttachment.current = attachment;
  }, [attachment]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Invalidate an outstanding save dialog request when its attachment unmounts.
  useLayoutEffect(
    () => () => {
      flight.current = null;
      liveAttachment.current = null;
    },
    [],
  );
  // Progress and errors belong to the source they were produced for.
  const current = held && sameFilePreviewSource(held.owner, attachment) ? held : null;
  const canSave = canSaveAttachmentCopy(attachment);
  const save = useStableCallback(() => {
    if (!canSave || flight.current || !sameFilePreviewSource(liveAttachment.current, attachment))
      return;
    const request = {};
    flight.current = request;
    const isCurrent = () => flight.current === request;
    void saveAttachmentCopy(
      attachment,
      isCurrent,
      (patch) => {
        if (isCurrent()) setHeld({ owner: attachment, ...patch });
      },
      () => {
        if (isCurrent()) flight.current = null;
      },
    );
  });
  return {
    canSave,
    saving: current?.saving ?? false,
    error: current?.error,
    save,
  };
}

/** The session reader takes precedence: a bare attachment path may belong to another OS. */
export function AttachmentFilePreview({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  const path = ownedAttachmentPath(attachment);
  const { size, loadPreview, data } = attachment;
  const readBytes = useCallback(
    () =>
      readAttachmentBytes(
        { size, loadPreview, data, path },
        MAX_DOCUMENT_BYTES,
        "File is too large to preview (maximum 25 MB).",
      ),
    [size, loadPreview, data, path],
  );
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
