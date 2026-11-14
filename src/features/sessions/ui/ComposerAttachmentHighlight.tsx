import { Fragment, type ReactNode } from "react";
import { BlockQuote } from "../../../shared/ui/icons";
import { DraftToken } from "../../../shared/ui/DraftToken";
import { AttachmentIdentity } from "./AttachmentIdentity";
import type { Attachment } from "../model/session";
import { splitAttachmentTokens, tokenLabel } from "../model/attachmentTokens";
import { attachmentPresentation } from "../model/attachmentPresentation";
import { splitCitationTokens } from "../model/citationTokens";
import styles from "./ComposerAttachmentHighlight.module.css";

/**
 * Decoration only: every character retains its native textarea width. The hidden
 * source text reserves a padded icon slot; the ordinal identifies the attachment.
 */
export function ComposerAttachmentHighlight({
  text,
  attachments,
  citations = 0,
  renderText,
}: {
  text: string;
  attachments: Attachment[];
  /** Number of draft citations whose `[quoteN]` tokens are painted as pills. */
  citations?: number;
  renderText: (text: string) => ReactNode;
}) {
  const renderPlain = (plain: string) =>
    splitCitationTokens(plain, citations).map((part, index) =>
      "token" in part ? (
        <DraftToken
          key={index}
          prefix="["
          icon={<BlockQuote />}
          className={styles.token}
          data-composer-citation-token=""
        >
          {tokenLabel(part.token)}
          <span className={styles.bracket}>{"]"}</span>
        </DraftToken>
      ) : (
        <Fragment key={index}>{renderText(part.text)}</Fragment>
      ),
    );
  return splitAttachmentTokens(text, attachments).map((part, index) => {
    if (!("token" in part)) return <Fragment key={index}>{renderPlain(part.text)}</Fragment>;
    const presentation = attachmentPresentation(part.attachment);
    const prefix = part.token.startsWith("[image") ? "[image" : "[file";
    return (
      <DraftToken
        key={index}
        prefix="["
        ordinal={part.token.slice(prefix.length, -1)}
        icon={<AttachmentIdentity attachment={part.attachment} size="pill" />}
        className={styles.token}
        data-composer-attachment-kind={presentation.kind}
        data-attachment-kind={presentation.kind}
      >
        {part.label}
        <span className={styles.bracket}>{"]"}</span>
      </DraftToken>
    );
  });
}
