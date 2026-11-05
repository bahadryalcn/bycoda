import { Fragment, type ReactNode } from "react";
import type { Attachment } from "../model/session";
import { splitAttachmentTokens } from "../model/attachmentTokens";
import { attachmentPresentation } from "../model/attachmentPresentation";
import { AttachmentIdentity } from "./AttachmentIdentity";
import styles from "./ComposerAttachmentHighlight.module.css";

/** Decoration only: every character retains its native textarea width. */
export function ComposerAttachmentHighlight({
  text,
  attachments,
  renderText,
}: {
  text: string;
  attachments: Attachment[];
  renderText: (text: string) => ReactNode;
}) {
  return splitAttachmentTokens(text, attachments).map((part, index) => {
    if (!("token" in part)) return <Fragment key={index}>{renderText(part.text)}</Fragment>;
    const presentation = attachmentPresentation(part.attachment);
    return (
      <span key={index} className={styles.token} data-composer-attachment-kind={presentation.kind}>
        <span className={styles.bracket}>
          {"["}
          <span className={styles.icon} aria-hidden>
            <AttachmentIdentity attachment={part.attachment} size="token" />
          </span>
        </span>
        {part.label}
        <span className={styles.bracket}>{"]"}</span>
      </span>
    );
  });
}
