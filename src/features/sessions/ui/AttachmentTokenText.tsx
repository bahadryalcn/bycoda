import { LiveText } from "../../../shared/ui/LiveText";
import { Button } from "../../../shared/ui/Button";
import { useLocale, useT } from "../../../shared/i18n";
import { Fragment, useState } from "react";
import { splitAttachmentTokens } from "../model/attachmentTokens";
import { splitCitationTokens } from "../model/citationTokens";
import type { ChatCitation } from "../model/chatCitation";
import { CitationTokenPill } from "./ChatCitationText";
import type { Attachment } from "../model/session";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import { useAttachmentPreview } from "./useAttachmentPreview";
import { SkillTokenText } from "./SkillTokenText";
import { AttachmentIdentity } from "./AttachmentIdentity";
import { formatAttachmentSize } from "../model/attachmentPresentation";
import styles from "./AttachmentTokenText.module.css";
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

/** A token as a pill. It keeps its brackets in the DOM so selecting and copying give the text back. */
function TokenPill({ token, label, attachment }: PillProps) {
  const t = useT();
  const [openedFile, setOpenedFile] = useState<Attachment | null>(null);
  const fileOpen = sameFilePreviewSource(openedFile, attachment);
  const canOpenFile = canOpenFileAttachment(attachment);
  const {
    src: preview,
    canOpen,
    open: previewOpen,
    loading,
    error,
    show,
    retry,
    recover,
    close,
  } = useAttachmentPreview(attachment);
  const size = formatAttachmentSize(attachment.size);
  const body = (
    <span className={styles.token} title={attachment.name}>
      <span className={styles.icon} aria-hidden="true">
        <AttachmentIdentity attachment={attachment} size="pill" />
      </span>
      <span className="sr-only">[</span>
      {label}
      <span className="sr-only">]</span>
      {size ? (
        // Drawn from an attribute so copying the pill still gives back `[image1]`.
        <span className={styles.size} aria-hidden="true" data-size={size} />
      ) : null}
    </span>
  );
  if (!canOpen && !canOpenFile) {
    return <span title={attachment.path ?? attachment.name}>{body}</span>;
  }
  return (
    <>
      <Button
        motion="none"
        variant="link"
        layout="text"
        type="button"
        tooltip={t("Open {p0} full screen", { p0: attachment.name })}
        aria-label={t("Open {p0} ({p1}) full screen", {
          p0: token,
          p1: attachment.name,
        })}
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
      >
        {body}
      </Button>
      {loading ? (
        <span role="status" className="text-ui-caption text-(--ui-text-secondary)">
          {" "}
          {t("Loading…")}
        </span>
      ) : null}
      {error ? (
        // Phrasing-only: this renders inside <pre>/<p> prose, where the block InlineMessage (a div) is invalid.
        <>
          {" "}
          <LiveText
            mode="assertive"
            className="text-ui-caption text-(--ui-tone-warning-fg)"
            text={t("Preview unavailable. Try again.")}
          />
        </>
      ) : null}
      {previewOpen ? (
        <ImageLightbox
          src={preview ?? ""}
          alt={attachment.name}
          onClose={close}
          resetKey={attachment.id}
          loading={loading}
          error={error ? t("Preview unavailable. Try again.") : undefined}
          onRetry={retry}
          onImageError={recover}
        />
      ) : null}
      {fileOpen ? (
        <AttachmentFilePreview attachment={attachment} onClose={() => setOpenedFile(null)} />
      ) : null}
    </>
  );
}

/** Plain text with `[quoteN]` tokens that name one of `citations` shown as pills. */
function CitationTokenText({
  text,
  citations = [],
}: {
  text: string;
  citations?: readonly ChatCitation[];
}) {
  if (!citations.length) return <SkillTokenText text={text} />;
  return splitCitationTokens(text, citations.length).map((part, index) =>
    "token" in part ? (
      <CitationTokenPill key={index} token={part.token} citation={citations[part.index]} />
    ) : (
      <SkillTokenText key={index} text={part.text} />
    ),
  );
}

/** Message text with the tokens that name one of its attachments or citations shown as pills. */
export function AttachmentTokenText({
  text,
  attachments,
  citations,
}: {
  text: string;
  attachments: Attachment[] | undefined;
  citations?: readonly ChatCitation[];
}) {
  useLocale();
  if (!attachments?.length) return <CitationTokenText text={text} citations={citations} />;
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
            <CitationTokenText text={segment.text} citations={citations} />
          )}
        </Fragment>
      ))}
    </>
  );
}
