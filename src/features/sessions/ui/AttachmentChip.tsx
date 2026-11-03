import { InlineMessage } from "../../../shared/ui/InlineError";
import { InlineAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { Link, X } from "../../../shared/ui/icons";
import { attachmentPreviewSrc } from "../model/attachments";
import { tokenLabel } from "../model/attachmentTokens";
import { attachmentPresentation } from "../model/attachmentPresentation";
import { AttachmentIdentity } from "./AttachmentIdentity";
import styles from "./AttachmentChip.module.css";
import type { Attachment } from "../model/session";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import { BrowserAnnotationDetails } from "../../host-tools/BrowserAnnotationDetails";
import { useAttachmentPreview } from "./useAttachmentPreview";
import { useState } from "react";
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
  /** Transcript thumbnails keep their reference inside the image, saving a caption row. */
  tokenLabelPlacement?: "below" | "overlay";
  /** Puts the token into the message text again. */
  onInsertToken?: () => void;
};

export function AttachmentChip({
  attachment,
  onRemove,
  token,
  tokenLabelPlacement = "below",
  onInsertToken,
}: Props) {
  const t = useT();
  const presentation = attachmentPresentation(attachment);
  const [failedThumbnail, setFailedThumbnail] = useState<string>();
  const size =
    Number.isFinite(attachment.size) && attachment.size > 0
      ? attachment.size < 1024
        ? `${attachment.size} B`
        : attachment.size < 1024 * 1024
          ? `${Math.round(attachment.size / 1024)} KB`
          : `${(attachment.size / (1024 * 1024)).toFixed(1)} MB`
      : null;
  const [openedFile, setOpenedFile] = useState<Attachment | null>(null);
  const fileOpen = sameFilePreviewSource(openedFile, attachment);
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
    ? "block max-w-14 truncate text-center text-ui-caption leading-5 text-(--ui-text-secondary)"
    : "shrink-0 rounded bg-(--ui-surface-raised) px-1 text-ui-caption leading-4 text-(--ui-text-secondary)";
  const labelNode =
    image && label && onInsertToken ? (
      <Button
        motion="none"
        variant={image ? "link" : "ghost"}
        layout={image ? "text" : undefined}
        className={image ? "block max-w-full truncate text-center" : undefined}
        type="button"
        tooltip={t("Insert {p0} into the message", { p0: token })}
        aria-label={t("Insert {p0} into the message", { p0: token })}
        // Keeps focus, and so the caret, in the message box.
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          onInsertToken();
        }}
      >
        <span className={image ? "text-ui-caption leading-5" : undefined}>{label}</span>
      </Button>
    ) : label ? (
      <span className={image && tokenLabelPlacement === "overlay" ? styles.reference : labelClass}>
        {label}
      </span>
    ) : null;

  const chip = (
    <>
      <div
        data-attachment-chip={image ? "image" : "file"}
        data-attachment-kind={presentation.kind}
        className={`group ${styles.card} ${image ? styles.image : styles.file}`}
        title={attachment.path ?? attachment.name}
      >
        {image ? (
          <span className="relative flex w-full shrink-0 flex-col items-center">
            <Button
              motion="none"
              layout="media"
              iconOnly
              label={t("Open {p0} full screen", { p0: attachment.name })}
              variant="ghost"
              type="button"
              aria-label={t("Open {p0} full screen", { p0: attachment.name })}
              tooltip={t("Open {p0} full screen", { p0: attachment.name })}
              onClick={(event) => {
                event.stopPropagation();
                void show();
              }}
              className={styles.thumbnail}
            >
              {failedThumbnail !== preview ? (
                <img
                  src={preview}
                  alt=""
                  draggable={false}
                  onError={() => setFailedThumbnail(preview)}
                  className="size-full object-cover"
                />
              ) : (
                <AttachmentIdentity attachment={attachment} />
              )}
            </Button>
            <span className={styles.imageName}>{attachment.name}</span>
            <span className={styles.metadata}>
              {t(presentation.label)}
              {size ? ` · ${size}` : ""}
            </span>
            {labelNode}
          </span>
        ) : (
          <>
            <span className={styles.fileBody}>
              {canOpen || canOpenFile ? (
                <Button
                  motion="none"
                  variant="ghost"
                  className="min-w-0 max-w-full"
                  type="button"
                  disabled={loading}
                  loading={loading}
                  aria-busy={loading}
                  aria-haspopup="dialog"
                  aria-label={t("Open {p0} full screen", { p0: attachment.name })}
                  tooltip={t("Open {p0} full screen", { p0: attachment.name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (canOpenFile) {
                      event.currentTarget.focus({ preventScroll: true });
                      setOpenedFile(attachment);
                    } else void show();
                  }}
                >
                  {labelNode}
                  <span className={styles.fileIcon}>
                    <AttachmentIdentity attachment={attachment} />
                  </span>
                  <span className={styles.fileDetails}>
                    <span className={styles.name}>{loading ? t("Loading…") : attachment.name}</span>
                    <span className={styles.metadata}>
                      {t(presentation.label)}
                      {size ? ` · ${size}` : ""}
                    </span>
                  </span>
                </Button>
              ) : (
                <span className="flex min-w-0 items-center gap-1.5">
                  {labelNode}
                  <span className={styles.fileIcon}>
                    <AttachmentIdentity attachment={attachment} />
                  </span>
                  <span className={styles.fileDetails}>
                    <span className={styles.name}>{attachment.name}</span>
                    <span className={styles.metadata}>
                      {t(presentation.label)}
                      {size ? ` · ${size}` : ""}
                    </span>
                  </span>
                </span>
              )}
            </span>
            {token && onInsertToken ? (
              <Button
                motion="none"
                variant="ghost"
                iconOnly
                label={t("Insert {p0} into the message", { p0: token })}
                className="shrink-0"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  onInsertToken();
                }}
              >
                <Link className="icon-xs" />
              </Button>
            ) : null}
            {previewError ? (
              <InlineMessage tone="warning" live="assertive">
                {t("Preview unavailable. Try again.")}
              </InlineMessage>
            ) : null}
            {attachment.missing ? (
              <span className="shrink-0 text-ui-caption leading-4 text-(--ui-tone-warning-fg)">
                {t("missing")}
              </span>
            ) : null}
          </>
        )}
        {onRemove && image ? (
          <Button
            motion="none"
            className="absolute right-0.5 top-0.5 shrink-0"
            iconOnly
            label={t("Remove {p0}", { p0: attachment.name })}
            variant="secondary"
            shape="pill"
            type="button"
            tooltip={t("Remove")}
            aria-label={t("Remove {p0}", { p0: attachment.name })}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <X className="icon-xs" strokeWidth={2} />
          </Button>
        ) : null}
        {onRemove && !image ? (
          <InlineAction
            reveal="always"
            className="shrink-0"
            label={t("Remove {p0}", { p0: attachment.name })}
            type="button"
            onClick={onRemove}
          >
            <X className="icon-xs" strokeWidth={2} />
          </InlineAction>
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
