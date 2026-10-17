import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { X } from "../../../shared/ui/icons";
import { attachmentPreviewSrc, isAttachmentFolder } from "../model/attachments";
import { tokenLabel } from "../model/attachmentTokens";
import type { Attachment } from "../model/session";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import { BrowserAnnotationDetails } from "../../host-tools/BrowserAnnotationDetails";
import { useAttachmentPreview } from "./useAttachmentPreview";
import { useEffect, useState } from "react";
import {
  AttachmentFilePreview,
  canOpenFileAttachment,
  sameFilePreviewSource,
} from "./AttachmentFilePreview";

type Props = {
  attachment: Attachment;
  onRemove?: () => void;
  /** The token that refers to this attachment in the message text. */
  token?: string;
  /** Puts the token into the message text again. */
  onInsertToken?: () => void;
};

export function AttachmentChip({ attachment, onRemove, token, onInsertToken }: Props) {
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
    error: previewError,
    show,
    close,
  } = useAttachmentPreview(attachment);
  // A gone image has no picture worth showing; it reads as a marked file chip.
  const image =
    attachment.kind === "image" && !attachment.missing && attachmentPreviewSrc(attachment);
  const label = token ? tokenLabel(token) : null;
  const labelClass = image
    ? "block max-w-14 truncate text-center text-(length:--ui-font-caption) leading-5 text-(--ui-text-secondary)"
    : "shrink-0 rounded bg-(--ui-surface-raised) px-1 text-[10px] leading-4 text-(--ui-text-secondary)";
  const labelNode =
    label && onInsertToken ? (
      <Button
        motion="none"
        variant="ghost"
        type="button"
        title={t("Insert {p0} into the message", { p0: token })}
        aria-label={t("Insert {p0} into the message", { p0: token })}
        // Keeps focus, and so the caret, in the message box.
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          onInsertToken();
        }}
      >
        {label}
      </Button>
    ) : label ? (
      <span className={labelClass}>{label}</span>
    ) : null;

  const chip = (
    <>
      <div
        data-attachment-chip={image ? "image" : "file"}
        className={`group relative flex min-w-0 items-center gap-1.5 rounded-md ${
          image ? "" : "bg-(--ui-surface-raised) py-0.5 pl-1 pr-1"
        }`}
        title={attachment.path ?? attachment.name}
      >
        {image ? (
          <span className="flex shrink-0 flex-col items-center gap-1">
            <Button
              motion="none"
              iconOnly
              label={t("Open {p0} full screen", { p0: attachment.name })}
              variant="ghost"
              type="button"
              aria-label={t("Open {p0} full screen", { p0: attachment.name })}
              title={t("Open {p0} full screen", { p0: attachment.name })}
              onClick={(event) => {
                event.stopPropagation();
                void show();
              }}
              className="size-14 shrink-0 overflow-clip"
            >
              <img src={preview} alt="" draggable={false} className="size-full object-cover" />
            </Button>
            {labelNode}
          </span>
        ) : (
          <>
            {labelNode}
            <span className="grid size-5 shrink-0 place-items-center">
              <FileTypeIcon
                name={attachment.name}
                isDir={isAttachmentFolder(attachment)}
                size={16}
              />
            </span>
            <span className="min-w-0 max-w-[140px] truncate text-[11px] leading-none text-(--ui-text-secondary)">
              {canOpen || canOpenFile ? (
                <Button
                  motion="none"
                  variant="ghost"
                  type="button"
                  disabled={loading}
                  aria-busy={loading}
                  aria-haspopup="dialog"
                  aria-label={t("Open {p0} full screen", { p0: attachment.name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (canOpenFile) {
                      event.currentTarget.focus({ preventScroll: true });
                      setOpenedFile(attachment);
                    } else void show();
                  }}
                >
                  {loading ? t("Loading…") : attachment.name}
                </Button>
              ) : (
                attachment.name
              )}
            </span>
            {previewError ? (
              <span role="alert" className="text-[10px] text-(--ui-tone-warning-fg)">
                {t("Preview unavailable. Try again.")}
              </span>
            ) : null}
            {attachment.missing ? (
              <span className="shrink-0 text-[10px] leading-none text-(--ui-tone-warning-fg)">
                {t("missing")}
              </span>
            ) : null}
          </>
        )}
        {onRemove ? (
          <Button
            motion="none"
            className="shrink-0"
            iconOnly
            label={t("Remove {p0}", { p0: attachment.name })}
            variant="ghost"
            type="button"
            title={t("Remove")}
            aria-label={t("Remove {p0}", { p0: attachment.name })}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <X className="size-3" strokeWidth={2} />
          </Button>
        ) : null}
      </div>
      {attachment.browserAnnotation ? (
        <details className="browser-annotation-chip">
          <summary>{t("Inspect browser element")}</summary>
          <BrowserAnnotationDetails annotation={attachment.browserAnnotation} />
        </details>
      ) : null}
      {preview && previewOpen ? (
        <ImageLightbox src={preview} alt={attachment.name} onClose={close} />
      ) : null}
      {fileOpen ? (
        <AttachmentFilePreview attachment={attachment} onClose={() => setOpenedFile(null)} />
      ) : null}
    </>
  );
  return attachment.browserAnnotation ? (
    <div className="browser-annotation-attachment">{chip}</div>
  ) : (
    chip
  );
}
