import { Fragment, type ReactNode } from "react";
import type { Attachment } from "../model/session";
import { splitAttachmentTokens, tokenLabel } from "../model/attachmentTokens";
import { attachmentPresentation } from "../model/attachmentPresentation";
import { splitCitationTokens } from "../model/citationTokens";
import styles from "./ComposerAttachmentHighlight.module.css";

/**
 * Decoration only: every character retains its native textarea width. The hidden brackets
 * are the chip's padding; the label already names the kind, so the chip carries no icon.
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
        <span key={index} className={styles.token} data-composer-citation-token="">
          <span className={styles.bracket}>{"["}</span>
          {tokenLabel(part.token)}
          <span className={styles.bracket}>{"]"}</span>
        </span>
      ) : (
        <Fragment key={index}>{renderText(part.text)}</Fragment>
      ),
    );
  return splitAttachmentTokens(text, attachments).map((part, index) => {
    if (!("token" in part)) return <Fragment key={index}>{renderPlain(part.text)}</Fragment>;
    const presentation = attachmentPresentation(part.attachment);
    return (
      <span key={index} className={styles.token} data-composer-attachment-kind={presentation.kind}>
        <span className={styles.bracket}>{"["}</span>
        {part.label}
        <span className={styles.bracket}>{"]"}</span>
      </span>
    );
  });
}
