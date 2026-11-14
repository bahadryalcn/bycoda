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
 * Decoration only: every character retains its native textarea width. Each token's
 * face (icon + `Image 1 · 54 KB` label) is drawn over its hidden source text.
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
          label={tokenLabel(part.token)}
          className={styles.token}
          data-composer-citation-token=""
        >
          {part.token.slice(1)}
        </DraftToken>
      ) : (
        <Fragment key={index}>{renderText(part.text)}</Fragment>
      ),
    );
  return splitAttachmentTokens(text, attachments).map((part, index) => {
    if (!("token" in part)) return <Fragment key={index}>{renderPlain(part.text)}</Fragment>;
    const presentation = attachmentPresentation(part.attachment);
    return (
      <DraftToken
        key={index}
        prefix="["
        icon={<AttachmentIdentity attachment={part.attachment} size="pill" />}
        label={part.label}
        className={styles.token}
        data-composer-attachment-kind={presentation.kind}
        data-attachment-kind={presentation.kind}
      >
        {part.token.slice(1)}
      </DraftToken>
    );
  });
}
