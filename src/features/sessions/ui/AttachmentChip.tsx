import { InlineMessage } from "../../../shared/ui/InlineError";
import { InlineAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { Link, X } from "../../../shared/ui/icons";
import { tokenLabel } from "../model/attachmentTokens";
import { attachmentPresentation, formatAttachmentSize } from "../model/attachmentPresentation";
import { AttachmentIdentity } from "./AttachmentIdentity";
import styles from "./AttachmentChip.module.css";
import type { Attachment } from "../model/session";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import { BrowserAnnotationDetails } from "../../host-tools/BrowserAnnotationDetails";
import { useAttachmentPreview } from "./useAttachmentPreview";
import { useNearViewport } from "./useNearViewport";
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
  /** Puts the token into the message text again. */
  onInsertToken?: () => void;
};

export function AttachmentChip({ attachment, onRemove, token, onInsertToken }: Props) {
  const t = useT();
  const presentation = attachmentPresentation(attachment);
  const [failedThumbnail, setFailedThumbnail] = useState<string>();
  const size = formatAttachmentSize(attachment.size);
  const [openedFile, setOpenedFile] = useState<Attachment | null>(null);
  const fileOpen = sameFilePreviewSource(openedFile, attachment);
  const canOpenFile = canOpenFileAttachment(attachment);
  const [thumbnailBox, nearViewport] = useNearViewport<HTMLDivElement>();
  const {
    src: preview,
    canOpen,
    open: previewOpen,
    loading,
    error: previewError,
    show,
    close,
  } = useAttachmentPreview(attachment, nearViewport);
  // A gone image has no picture worth showing; it reads as a marked file chip.
  const image = attachment.kind === "image" && canOpen;
  const label = token ? tokenLabel(token) : null;
  const labelNode = label ? (
    <span className="shrink-0 rounded bg-(--ui-surface-raised) px-1 text-ui-caption leading-4 text-(--ui-text-secondary)">
      {label}
    </span>
  ) : null;
  // An image card is only its thumbnail; the message text names it as `image1 113 KB`.
  const imageDetails = [label, attachment.name, size].filter(Boolean).join(" · ");

  const chip = (
    <>
      <div
        ref={thumbnailBox}
        data-attachment-chip={image ? "image" : "file"}
        data-attachment-kind={presentation.kind}
        className={`group ${styles.card} ${image ? styles.image : styles.file}`}
        title={image ? undefined : (attachment.path ?? attachment.name)}
      >
        {image ? (
          <span className="relative flex size-full shrink-0">
            <Button
              motion="none"
              layout="media"
              iconOnly
              label={t("Open {p0} full screen", { p0: attachment.name })}
              variant="ghost"
              type="button"
              aria-label={t("Open {p0} full screen", { p0: attachment.name })}
              tooltip={imageDetails}
              disabled={loading}
              loading={loading}
              aria-busy={loading}
              aria-haspopup="dialog"
              onClick={(event) => {
                event.stopPropagation();
                void show();
              }}
              className={styles.thumbnail}
            >
              {preview && failedThumbnail !== preview ? (
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
            {token && onInsertToken ? (
              <Button
                motion="none"
                className="absolute bottom-0.5 left-0.5 shrink-0"
                iconOnly
                label={t("Insert {p0} into the message", { p0: token })}
                variant="secondary"
                shape="pill"
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
                <Link className="icon-xs" />
              </Button>
            ) : null}
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
      {previewError ? (
        <InlineMessage tone="warning" live="assertive">
          {t("Preview unavailable. Try again.")}
        </InlineMessage>
      ) : null}
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
