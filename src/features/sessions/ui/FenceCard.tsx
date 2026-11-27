import type { ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import styles from "./FenceCard.module.css";

/** Class for a flat tree/viewer placed in the card body. */
export const fenceTree = styles.tree;

/**
 * Card for a fenced block shown as something other than its highlighted source (a JSON tree, a Mermaid
 * diagram). The header matches a code block's: file icon and language at the left, view toggle and copy
 * at the right, so switching to the source view keeps every control where it was.
 */
export function FenceCard({
  language,
  icon,
  toggle,
  actions,
  children,
}: {
  language: string;
  icon: ReactNode;
  /** `FenceViewToggle`, positioned by its own class. */
  toggle: ReactNode;
  /** Copy button. */
  actions: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div
      {...surfaceAttributes(
        { variant: "card", radius: "card" },
        `markdown-code-shell ${styles.card}`,
      )}
      dir="ltr"
      role="region"
      aria-label={t("Code block")}
    >
      <span className="markdown-code-icon" aria-hidden="true">
        {icon}
      </span>
      <Text
        family="mono"
        size="caption"
        tone="inherit"
        leading="normal"
        className={`${styles.label} text-(--transcript-ink-chrome)`}
      >
        {language}
      </Text>
      {toggle}
      {actions}
      <div {...surfaceAttributes({ frame: "pane", edge: "top" }, styles.body)}>{children}</div>
    </div>
  );
}
