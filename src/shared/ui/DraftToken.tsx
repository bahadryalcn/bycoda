import type { HTMLAttributes, MouseEventHandler, ReactNode } from "react";
import styles from "./DraftToken.module.css";

/**
 * Decorative inline token for a textarea's aria-hidden highlight overlay.
 * Its icon covers the introducer; every original character keeps its advance width.
 * @group fields
 * @use Recognized references in textarea highlight overlays; inherit the caller's semantic ink.
 * @avoid Accessible editors: PromptField. Ordinary tags: Badge. Clickable references: Button.
 */
export function DraftToken({
  prefix,
  icon,
  children,
  className,
  onIconClick,
  ordinal,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "prefix"> & {
  prefix: ReactNode;
  icon: ReactNode;
  /** Pointer shortcut only; the accessible textarea retains keyboard editing. */
  onIconClick?: MouseEventHandler<HTMLSpanElement>;
  /** Compact attachment identity; source text keeps its original advance width. */
  ordinal?: string;
}) {
  return (
    <span
      {...props}
      data-draft-token-ordinal={ordinal}
      className={`${styles.token} ${className ?? ""}`}
    >
      <span className={styles.prefix}>
        <span className={styles.hidden}>{prefix}</span>
        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Pointer shortcut in an aria-hidden editor overlay; native textarea owns keyboard input. */}
        <span
          className={styles.icon}
          aria-hidden="true"
          data-draft-token-action={onIconClick ? "" : undefined}
          onMouseDown={onIconClick ? (event) => event.preventDefault() : undefined}
          onClick={onIconClick}
        >
          {icon}
        </span>
      </span>
      {ordinal ? <span className={styles.hidden}>{children}</span> : children}
    </span>
  );
}
