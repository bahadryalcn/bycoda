import { InlineMessage } from "../../../shared/ui/InlineError";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
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
    retry,
    recover,
    close,
  } = useAttachmentPreview(attachment, nearViewport);
  // A gone image has no picture worth showing; it reads as a marked file chip.
  const image = attachment.kind === "image" && canOpen;
  const label = token ? tokenLabel(token) : null;
  // An image card is only its thumbnail; the message text names it as `image1 113 KB`.
  const imageDetails = [label, attachment.name, size].filter(Boolean).join(" · ");

  const fileDetails = [attachment.name, t(presentation.label), size].filter(Boolean).join(" · ");
  const fileBody = (
    <span className={styles.fileBody}>
      <span className={styles.fileIcon}>
        <AttachmentIdentity attachment={attachment} />
      </span>
      <span className={styles.name}>{loading ? t("Loading…") : attachment.name}</span>
      <span className={styles.metadata}>
        {attachment.missing ? (
          <span className="text-(--ui-tone-warning-fg)">{t("missing")}</span>
        ) : (
          <>
            {t(presentation.label)}
            {size ? ` · ${size}` : ""}
          </>
        )}
      </span>
    </span>
  );

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
                  onError={() => {
                    setFailedThumbnail(preview);
                    recover(preview, true);
                  }}
                  className="size-full object-cover"
                />
              ) : (
                <AttachmentIdentity attachment={attachment} />
              )}
            </Button>
            {token && onInsertToken ? (
              <Button
                motion="none"
                className={`absolute bottom-1 left-1 ${styles.action}`}
                size="sm"
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
            {canOpen || canOpenFile ? (
              <Button
                motion="none"
                layout="media"
                variant="ghost"
                className={styles.thumbnail}
                type="button"
                disabled={loading}
                loading={loading}
                aria-busy={loading}
                aria-haspopup="dialog"
                aria-label={t("Open {p0} full screen", {
                  p0: attachment.name,
                })}
                tooltip={fileDetails}
                onClick={(event) => {
                  event.stopPropagation();
                  if (canOpenFile) {
                    event.currentTarget.focus({ preventScroll: true });
                    setOpenedFile(attachment);
                  } else void show();
                }}
              >
                {fileBody}
              </Button>
            ) : (
              <span className={styles.thumbnail}>{fileBody}</span>
            )}
            {token && onInsertToken ? (
              <Button
                motion="none"
                className={`absolute left-1 top-1 ${styles.action}`}
                size="sm"
                iconOnly
                label={t("Insert {p0} into the message", { p0: token })}
                variant="secondary"
                shape="pill"
                type="button"
                tooltip={t("Insert {p0} into the message", { p0: token })}
                aria-label={t("Insert {p0} into the message", { p0: token })}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  onInsertToken();
                }}
              >
                <Link className="icon-xs" />
              </Button>
            ) : null}
          </>
        )}
        {onRemove ? (
          <Button
            motion="none"
            className={`absolute right-1 top-1 ${styles.action}`}
            size="sm"
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
      </div>
      {previewError ? (
        <InlineMessage tone="warning" live="assertive">
          {t("Preview unavailable. Try again.")}
        </InlineMessage>
      ) : null}
      {attachment.browserAnnotation ? (
        <Disclosure
          size="sm"
          summary={t("Inspect browser element")}
          className="browser-annotation-chip"
        >
          <BrowserAnnotationDetails annotation={attachment.browserAnnotation} />
        </Disclosure>
      ) : null}
      {previewOpen ? (
        <ImageLightbox
          src={preview ?? ""}
          alt={attachment.name}
          onClose={close}
          resetKey={attachment.id}
          loading={loading}
          error={previewError ? t("Preview unavailable. Try again.") : undefined}
          onRetry={retry}
          onImageError={recover}
        />
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
