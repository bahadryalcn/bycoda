import { Fragment, type ReactNode } from "react";
import { useLocale } from "../../../shared/i18n";
import { BlockQuote, File, MessageSquare } from "../../../shared/ui/icons";
import { DraftToken } from "../../../shared/ui/DraftToken";
import { AttachmentIdentity } from "./AttachmentIdentity";
import type { Attachment } from "../model/session";
import {
  splitAttachmentTokens,
  splitNamedAttachmentReferences,
  tokenLabel,
} from "../model/attachmentTokens";
import { attachmentPresentation, formatAttachmentSize } from "../model/attachmentPresentation";
import { splitCitationTokens } from "../model/citationTokens";
import { fileCommentLabel, type ComposerCitation } from "../model/chatCitation";
import styles from "./ComposerAttachmentHighlight.module.css";

/**
 * The draft spelling reserves space for the filename and size in the textarea.
 * The face keeps those native character advances and replaces the brackets and ordinal.
 */
export function ComposerAttachmentHighlight({
  text,
  attachments,
  citations = 0,
  citationSources,
  renderText,
}: {
  text: string;
  attachments: Attachment[];
  /** Number of draft citations whose `[quoteN]` tokens are painted as pills. */
  citations?: number;
  citationSources?: readonly ComposerCitation[];
  renderText: (text: string) => ReactNode;
}) {
  useLocale();
  const renderPlain = (plain: string) =>
    splitCitationTokens(plain, citations).map((part, index) => {
      if ("token" in part) {
        const file = citationSources?.[part.index]?.file;
        return (
          <DraftToken
            key={index}
            prefix="["
            icon={file ? <MessageSquare /> : <BlockQuote />}
            label={file ? fileCommentLabel(file) : tokenLabel(part.token)}
            className={styles.token}
            data-composer-citation-token=""
            data-file-comment={file ? "" : undefined}
          >
            {part.token.slice(1)}
          </DraftToken>
        );
      }
      return (
        <Fragment key={index}>
          {part.text.includes("; ref=")
            ? splitNamedAttachmentReferences(part.text).map((reference, position) =>
                "token" in reference ? (
                  <DraftToken
                    key={position}
                    prefix="["
                    icon={<File />}
                    label={reference.name}
                    className={styles.token}
                    data-composer-reference="missing"
                    data-reference-value={reference.name}
                  >
                    {reference.token.slice(1)}
                  </DraftToken>
                ) : (
                  <Fragment key={position}>{renderText(reference.text)}</Fragment>
                ),
              )
            : renderText(part.text)}
        </Fragment>
      );
    });
  return splitAttachmentTokens(text, attachments).map((part, index) => {
    if (!("token" in part)) return <Fragment key={index}>{renderPlain(part.text)}</Fragment>;
    const presentation = attachmentPresentation(part.attachment);
    const fullLabel = part.fullName;
    return (
      <DraftToken
        key={index}
        prefix="["
        icon={<AttachmentIdentity attachment={part.attachment} size="pill" />}
        label={
          fullLabel
            ? [part.attachment.name, formatAttachmentSize(part.attachment.size)]
                .filter(Boolean)
                .join(" · ")
            : part.label
        }
        className={styles.token}
        data-composer-attachment-kind={presentation.kind}
        data-full-attachment-label={fullLabel ? "" : undefined}
        data-attachment-kind={presentation.kind}
        data-composer-reference="attachment"
        data-reference-value={part.attachment.id}
      >
        {part.token.slice(1)}
      </DraftToken>
    );
  });
}
