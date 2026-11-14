import {
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { observeResize } from "../lib/observeResize";
import styles from "./DraftToken.module.css";

/**
 * Decorative inline token for a textarea's aria-hidden highlight overlay.
 * Its icon covers the introducer; every original character keeps its advance width.
 * With `label`, the source text is hidden and a face (full-size icon + label) is
 * drawn over it instead, so narrow introducers such as `[` or `$` still get a
 * readable icon. The face does not track the caret inside the token: use it for
 * tokens edited as a whole. A face token the text wraps across lines (at a hyphen,
 * say) shows its source text instead, since one face cannot span two line boxes.
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
  label,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "prefix"> & {
  prefix: ReactNode;
  icon: ReactNode;
  /** Pointer shortcut only; the accessible textarea retains keyboard editing. */
  onIconClick?: MouseEventHandler<HTMLSpanElement>;
  /** Visible face drawn over the hidden source text; the source keeps its advance width. */
  label?: ReactNode;
}) {
  const face = useRef<HTMLSpanElement>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- DOM line-box layout: flags a wrapped face after each render and on container resize.
  useLayoutEffect(() => {
    const el = face.current;
    if (!el) return;
    let block = el.parentElement;
    while (block && getComputedStyle(block).display.startsWith("inline")) {
      block = block.parentElement;
    }
    const sync = () =>
      el.toggleAttribute("data-draft-token-wrapped", el.getClientRects().length > 1);
    sync();
    return block ? observeResize(block, sync) : undefined;
  });
  const iconSlot = (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Pointer shortcut in an aria-hidden editor overlay; native textarea owns keyboard input.
    <span
      className={styles.icon}
      aria-hidden="true"
      data-draft-token-action={onIconClick ? "" : undefined}
      onMouseDown={onIconClick ? (event) => event.preventDefault() : undefined}
      onClick={onIconClick}
    >
      {icon}
    </span>
  );
  if (label !== undefined) {
    return (
      <span
        {...props}
        ref={face}
        data-draft-token-face=""
        className={`${styles.token} ${className ?? ""}`}
      >
        <span className={styles.hidden}>
          {prefix}
          {children}
        </span>
        <span className={styles.face} aria-hidden="true">
          {iconSlot}
          <span className={styles.faceLabel}>{label}</span>
        </span>
      </span>
    );
  }
  return (
    <span {...props} className={`${styles.token} ${className ?? ""}`}>
      <span className={styles.prefix}>
        <span className={styles.hidden}>{prefix}</span>
        {iconSlot}
      </span>
      {children}
    </span>
  );
}
