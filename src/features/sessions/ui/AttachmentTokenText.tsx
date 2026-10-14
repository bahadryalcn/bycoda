import { t, useLocale } from "../../../shared/i18n";
import { Fragment, useEffect, useState } from "react";
import { splitAttachmentTokens } from "../model/attachmentTokens";
import type { Attachment } from "../model/session";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import { useAttachmentPreview } from "./useAttachmentPreview";
import {
  AttachmentFilePreview,
  canOpenFileAttachment,
  sameFilePreviewSource,
} from "./AttachmentFilePreview";

type PillProps = {
  token: string;
  label: string;
  attachment: Attachment;
};

const PILL_CLASS =
  "mx-px rounded bg-content/12 px-1 py-px align-baseline text-[0.85em] text-content/80";

/** A token as a pill. It keeps its brackets in the DOM so selecting and copying give the text back. */
function TokenPill({ token, label, attachment }: PillProps) {
  useLocale();
  const [openedFile, setOpenedFile] = useState<Attachment | null>(null);
  const fileOpen = sameFilePreviewSource(openedFile, attachment);
  useEffect(() => {
    if (!fileOpen) setOpenedFile(null);
  }, [fileOpen]);
  const canOpenFile = canOpenFileAttachment(attachment);
  const {
    src: preview,
    canOpen,
    open: previewOpen,
    loading,
    error,
    show,
    close,
  } = useAttachmentPreview(attachment);
  const body = (
    <>
      <span className="sr-only">[</span>
      {label}
      <span className="sr-only">]</span>
    </>
  );
  if (!canOpen && !canOpenFile) {
    return (
      <span className={PILL_CLASS} title={attachment.path ?? attachment.name}>
        {body}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        title={t("Open {p0} full screen", { p0: attachment.name })}
        aria-label={t("Open {p0} ({p1}) full screen", { p0: token, p1: attachment.name })}
        aria-haspopup="dialog"
        aria-busy={loading}
        disabled={loading}
        onClick={(event) => {
          event.stopPropagation();
          if (canOpenFile) {
            event.currentTarget.focus({ preventScroll: true });
            setOpenedFile(attachment);
          } else void show();
        }}
        className={`${PILL_CLASS} cursor-zoom-in [@media(hover:hover)_and_(pointer:fine)]:hover:bg-content/20 active:bg-content/20 focus-visible:outline-2 focus-visible:outline-accent`}
      >
        {body}
      </button>
      {loading ? (
        <span role="status" className="text-xs text-content/60">
          {" "}
          {t("Loading…")}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-warning">
          {" "}
          {t("Preview unavailable. Try again.")}
        </span>
      ) : null}
      {previewOpen && preview ? (
        <ImageLightbox src={preview} alt={attachment.name} onClose={close} />
      ) : null}
      {fileOpen ? (
        <AttachmentFilePreview attachment={attachment} onClose={() => setOpenedFile(null)} />
      ) : null}
    </>
  );
}

/** Message text with the tokens that name one of its attachments shown as pills. */
export function AttachmentTokenText({
  text,
  attachments,
}: {
  text: string;
  attachments: Attachment[] | undefined;
}) {
  useLocale();
  if (!attachments?.length) return <>{text}</>;
  const segments = splitAttachmentTokens(text, attachments);
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {"token" in segment ? (
            <TokenPill
              token={segment.token}
              label={segment.label}
              attachment={segment.attachment}
            />
          ) : (
            segment.text
          )}
        </Fragment>
      ))}
    </>
  );
}
