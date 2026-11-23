import {
  actionContentAttributes,
  actionContentScopeAttributes,
} from "../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { motionAttributes } from "../../../shared/ui/Motion";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { useT } from "../../../shared/i18n";
import { Download, Link, X } from "../../../shared/ui/icons";
import { tokenLabel } from "../model/attachmentTokens";
import {
  attachmentPresentation,
  formatAttachmentSize,
  isPastedTextAttachment,
} from "../model/attachmentPresentation";
import { AttachmentIdentity } from "./AttachmentIdentity";
import styles from "./AttachmentChip.module.css";
import type { Attachment } from "../model/session";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import { usePointContextMenu, type ContextMenuActions } from "../../../shared/ui/ContextMenu";
import { BrowserAnnotationDetails } from "../../host-tools/BrowserAnnotationDetails";
import { useAttachmentPreview } from "./useAttachmentPreview";
import { useNearViewport } from "./useNearViewport";
import { useState } from "react";
import {
  AttachmentFilePreview,
  canOpenFileAttachment,
  sameFilePreviewSource,
} from "./AttachmentFilePreview";
import { useAttachmentMenu } from "./useAttachmentMenu";

type Props = {
  attachment: Attachment;
  onRemove?: () => void;
  draft?: { projectRoot: string };
  /** The token that refers to this attachment in the message text. */
  token?: string;
  /** Puts the token into the message text again. */
  onInsertToken?: () => void;
};

export function AttachmentChip({ attachment, onRemove, draft, token, onInsertToken }: Props) {
  const t = useT();
  const presentation = attachmentPresentation(attachment);
  const pastedText = isPastedTextAttachment(attachment);
  const displayName = pastedText ? t("Pasted text") : attachment.name;
  const [failedThumbnail, setFailedThumbnail] = useState<string>();
  const size = formatAttachmentSize(attachment.size);
  const [openedFile, setOpenedFile] = useState<Attachment | null>(null);
  const fileOpen = sameFilePreviewSource(openedFile, attachment);
  const canOpenFile = canOpenFileAttachment(attachment);
  const { actions, saveCopy } = useAttachmentMenu(attachment, draft?.projectRoot);
  const draftActions: ContextMenuActions | undefined = draft && {
    items: [
      ...actions.items,
      ...(token && onInsertToken
        ? [
            {
              kind: "item" as const,
              id: "insert",
              label: t("Insert {p0} into the message", { p0: token }),
            },
          ]
        : []),
      ...(onRemove
        ? [
            { kind: "sep" as const },
            {
              kind: "item" as const,
              id: "remove",
              label: t("Remove {p0}", { p0: attachment.name }),
              danger: true,
            },
          ]
        : []),
    ],
    onPick: (id) => {
      if (id === "remove") onRemove?.();
      else if (id === "insert") onInsertToken?.();
      else actions.onPick(id);
    },
  };
  const contextMenu = usePointContextMenu(draftActions);
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
  const canPreview = canOpen || canOpenFile;
  // A gone image has no picture worth showing; it reads as a marked file chip.
  const image = attachment.kind === "image" && canOpen;
  const imageSize = draft && size;
  const imageContent =
    preview && failedThumbnail !== preview ? (
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
    );
  const label = token ? tokenLabel(token) : null;
  const imageDetails = (label ? [label, attachment.name] : [attachment.name, size])
    .filter(Boolean)
    .join(" · ");

  const typeText = presentation.typeExtension ?? t(presentation.label);
  // The app tooltip carries what a native `title` would: the full path (or name), type and size.
  const fileTooltip = {
    label: attachment.path ?? attachment.name,
    details: [[typeText, size].filter(Boolean).join(" · ")],
  };
  const fileBody = (
    <span className={styles.fileBody}>
      <span
        {...(pastedText
          ? surfaceAttributes({ variant: "inset", radius: "control" }, styles.fileIcon)
          : { className: styles.fileIcon })}
      >
        <AttachmentIdentity attachment={attachment} size={pastedText ? 16 : undefined} />
      </span>
      <Text as="span" tone="inherit" weight="medium" className={styles.name}>
        {loading ? t("Loading…") : displayName}
      </Text>
      <Text
        as="span"
        size="caption"
        tone="secondary"
        weight={draft ? "regular" : undefined}
        className={styles.metadata}
      >
        {attachment.missing ? (
          <Text size="inherit" tone="warning">
            {t("missing")}
          </Text>
        ) : pastedText ? (
          size
        ) : (
          <>
            {typeText}
            {size ? ` · ${size}` : ""}
          </>
        )}
      </Text>
    </span>
  );

  const chip = (
    <>
      <div
        ref={thumbnailBox}
        data-attachment-chip={image ? "image" : "file"}
        data-attachment-kind={presentation.kind}
        data-attachment-name={attachment.name}
        data-pasted-text-attachment={pastedText ? "" : undefined}
        {...contextMenu.trigger}
        {...actionContentScopeAttributes()}
        {...surfaceAttributes(
          { radius: pastedText ? "popup" : "card", variant: "attachment" },
          `group ${styles.card} ${image ? styles.image : styles.file}`,
        )}
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
              {imageSize ? (
                <span className="flex size-full min-h-0 flex-col">
                  <span className="grid min-h-0 flex-1 place-items-center overflow-clip">
                    {imageContent}
                  </span>
                  <Text
                    as="span"
                    size="caption"
                    tone="secondary"
                    weight="regular"
                    truncate
                    className="shrink-0 px-1 pb-0.5"
                  >
                    {imageSize}
                  </Text>
                </span>
              ) : (
                imageContent
              )}
            </Button>
            {!draft && token && onInsertToken ? (
              <Button
                motion="none"
                {...motionAttributes({ transition: "opacity" })}
                {...actionContentAttributes(
                  { phase: "interaction", hide: "opacity", focus: "within" },
                  "absolute bottom-1 left-1",
                )}
                size="sm"
                iconOnly
                label={t("Insert {p0} into the message", { p0: token })}
                variant="secondary"
                shape="pill"
                type="button"
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
            {canPreview || draft ? (
              <Button
                motion="none"
                layout="media"
                variant="ghost"
                className={styles.thumbnail}
                type="button"
                disabled={loading}
                loading={loading}
                aria-busy={loading}
                aria-haspopup={canPreview ? "dialog" : "menu"}
                aria-label={
                  canPreview
                    ? pastedText
                      ? t("Open {p0}", { p0: displayName })
                      : t("Open {p0} full screen", { p0: displayName })
                    : undefined
                }
                tooltip={fileTooltip.label}
                tooltipDetails={fileTooltip.details}
                tooltipWide
                onClick={(event) => {
                  event.stopPropagation();
                  if (canOpenFile) {
                    event.currentTarget.focus({ preventScroll: true });
                    setOpenedFile(attachment);
                  } else if (canOpen) void show();
                  else contextMenu.openAt(event.currentTarget);
                }}
              >
                {fileBody}
              </Button>
            ) : (
              <Tooltip {...fileTooltip} wide>
                <span className={styles.thumbnail}>{fileBody}</span>
              </Tooltip>
            )}
            {!draft && token && onInsertToken ? (
              <Button
                motion="none"
                {...motionAttributes({ transition: "opacity" })}
                {...actionContentAttributes(
                  { phase: "interaction", hide: "opacity", focus: "within" },
                  "absolute bottom-1 left-1",
                )}
                size="sm"
                iconOnly
                label={t("Insert {p0} into the message", { p0: token })}
                variant="secondary"
                shape="pill"
                type="button"
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
        {!draft && saveCopy.canSave ? (
          <Button
            motion="none"
            {...motionAttributes({ transition: "opacity" })}
            {...actionContentAttributes(
              { phase: pastedText ? "always" : "interaction", hide: "opacity", focus: "within" },
              pastedText ? styles.pastedAction : "absolute bottom-1 right-1",
            )}
            size="sm"
            iconOnly
            label={t("Save {p0}", { p0: displayName })}
            variant={pastedText ? "ghost" : "secondary"}
            shape="pill"
            type="button"
            tooltip={t("Download")}
            aria-label={t("Save {p0}", { p0: displayName })}
            disabled={saveCopy.saving}
            loading={saveCopy.saving}
            onClick={(event) => {
              event.stopPropagation();
              saveCopy.save();
            }}
          >
            <Download className="icon-xs" strokeWidth={2} />
          </Button>
        ) : null}
        {onRemove ? (
          <Button
            motion="none"
            {...motionAttributes({ transition: "opacity" })}
            {...actionContentAttributes(
              { phase: pastedText ? "always" : "interaction", hide: "opacity", focus: "within" },
              pastedText ? styles.pastedAction : "absolute right-1 top-1",
            )}
            size={draft ? "xs" : "sm"}
            iconOnly
            label={t("Remove {p0}", { p0: displayName })}
            variant={pastedText ? "ghost" : "secondary"}
            shape="pill"
            type="button"
            tooltip={t("Remove")}
            aria-label={t("Remove {p0}", { p0: displayName })}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <X className="icon-xs" strokeWidth={2} />
          </Button>
        ) : null}
      </div>
      {contextMenu.menu}
      {previewError ? (
        <InlineMessage tone="warning" live="assertive">
          {t("Preview unavailable. Try again.")}
        </InlineMessage>
      ) : null}
      {saveCopy.error ? (
        <InlineMessage tone="warning" live="assertive">
          {saveCopy.error}
        </InlineMessage>
      ) : null}
      {attachment.browserAnnotation ? (
        <Disclosure
          size="sm"
          interactionTone="accent"
          summary={t("Inspect browser element")}
          {...surfaceAttributes({ frame: "card", radius: "card" }, "browser-annotation-chip")}
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
          contextActions={draft ? actions : undefined}
          notice={draft ? saveCopy.error : undefined}
        />
      ) : null}
      {fileOpen ? (
        <AttachmentFilePreview
          attachment={attachment}
          onClose={() => setOpenedFile(null)}
          contextActions={draft ? actions : undefined}
          notice={draft ? saveCopy.error : undefined}
        />
      ) : null}
    </>
  );
  return attachment.browserAnnotation ? (
    <div className="browser-annotation-attachment">{chip}</div>
  ) : (
    chip
  );
}
