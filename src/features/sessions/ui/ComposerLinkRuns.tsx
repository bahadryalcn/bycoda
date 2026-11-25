import { Fragment, type ReactNode } from "react";
import { cachedUserLinkRanges } from "../model/linkPreview";
import styles from "./ComposerHighlight.module.css";

/** Paint the full URL in the textarea overlay so text and caret share the same layout. */
export function LinkRuns({
  text,
  renderText,
}: {
  text: string;
  renderText: (text: string) => ReactNode;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const { start, end, link } of cachedUserLinkRanges(text)) {
    parts.push(<Fragment key={`t${last}`}>{renderText(text.slice(last, start))}</Fragment>);
    parts.push(
      <span
        key={`l${start}`}
        className={styles.link}
        data-composer-link-token=""
        data-composer-reference="url"
        data-reference-value={link.url}
      >
        {text.slice(start, end)}
      </span>,
    );
    last = end;
  }
  parts.push(<Fragment key={`t${last}`}>{renderText(text.slice(last))}</Fragment>);
  return parts;
}
