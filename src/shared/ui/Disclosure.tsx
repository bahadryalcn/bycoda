import { Badge } from "./Badge";
import {
  type ComponentPropsWithRef,
  type MouseEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronRight } from "./icons";
import { optionalTextAttributes, type TextSize, type TextTone, type TextRoles } from "./Text";
import styles from "./Disclosure.module.css";

const NATIVE_ACTIVATABLE = 'a[href],button,input,label,select,textarea,[role="button"]';

export type DisclosureProps = Omit<ComponentPropsWithRef<"details">, "children" | "onToggle"> & {
  /** The always-visible row label. */
  summary: ReactNode;
  /**
   * Trailing actions in the summary row: buttons and links only (no inputs, labels or plain text).
   * Clicks inside never toggle the disclosure.
   */
  summaryActions?: ReactNode;
  /** Quiet count after the label (items inside). */
  count?: number | null;
  /** Accessible context for the count, such as "4 conversations". */
  countLabel?: string;
  /** Controlled open state; pair with `onOpenChange`. */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** `plain` inline text-level, `row` list-row height, `card` framed like `Surface variant="outline"`. */
  variant?: "plain" | "row" | "card";
  size?: "sm" | "md";
  /** Summary text size; independent of row size. */
  textSize?: TextSize;
  /** Summary ink and weight; unset preserves existing styling. */
  tone?: TextTone;
  weight?: TextRoles["weight"];
  /** Line height role; `inherit` keeps the surrounding line height. */
  leading?: TextRoles["leading"];
  /** Side of the summary row that carries the chevron. */
  chevron?: "start" | "end";
  /** Shared `name` makes sibling disclosures exclusive (native accordion). */
  name?: string;
  children?: ReactNode;
};

/**
 * Native details/summary disclosure: chevron, label, optional count and trailing actions,
 * and a body that stays mounted while closed (drafts survive, find-in-page works).
 * Owns summary row height, body spacing, focus ring and the card frame.
 * @group layout
 * @use Show or hide supporting detail inside a page or dialog.
 * @avoid Switching views: Tabs. Group heading over a list: SectionLabel collapsible. One hint: Popover or InfoPopover.
 * @replaces details summary
 *
 * @example
 * <Disclosure summary={t("Details")} count={items.length}>{body}</Disclosure>
 */
export function Disclosure({
  summary,
  summaryActions,
  count,
  countLabel,
  open,
  defaultOpen,
  onOpenChange,
  variant = "plain",
  size = "md",
  textSize,
  tone,
  weight,
  leading,
  chevron = "start",
  name,
  className,
  children,
  ref,
  ...props
}: DisclosureProps) {
  const innerRef = useRef<HTMLDetailsElement | null>(null);
  const controlled = open !== undefined;
  const [, reassert] = useState(0);

  // Controlled: the DOM follows `open` after every render, so a native toggle the parent ignores
  // (it never changes the prop) snaps back instead of leaving the element out of sync.
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (el && controlled && el.open !== open) el.open = open;
  });

  const setRef = (el: HTMLDetailsElement | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };
  const hasCount = count !== null && count !== undefined;
  // A click on the summary toggles the details. Buttons and links inside the actions slot have
  // their own activation behavior, so the toggle is skipped for them; anything else (the slot's
  // gaps) is cancelled so it never toggles.
  const guardActions = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("[data-disclosure-actions]")) return;
    event.stopPropagation();
    if (!target.closest(NATIVE_ACTIVATABLE)) event.preventDefault();
  };
  const mark = (
    <span className={styles.chevron} aria-hidden="true">
      <ChevronRight />
    </span>
  );

  return (
    <details
      {...props}
      ref={setRef}
      name={name}
      open={controlled ? open : defaultOpen}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (!controlled) {
          onOpenChange?.(next);
          return;
        }
        if (next === open) return;
        onOpenChange?.(next);
        reassert((tick) => tick + 1);
      }}
      data-variant={variant}
      data-size={size}
      data-chevron={chevron}
      className={[styles.root, className].filter(Boolean).join(" ")}
    >
      <summary className={styles.summary} onClick={guardActions}>
        {chevron === "start" ? mark : null}
        <span
          {...optionalTextAttributes(
            { size: textSize ?? (weight ? "inherit" : undefined), tone, weight, leading },
            styles.label,
          )}
        >
          {summary}
        </span>
        {hasCount ? (
          <Badge variant="count" size="xs" label={countLabel} className={styles.count}>
            {count}
          </Badge>
        ) : null}
        {summaryActions != null ? (
          <span className={styles.actions} data-no-drag="" data-disclosure-actions="">
            {summaryActions}
          </span>
        ) : null}
        {chevron === "end" ? mark : null}
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}
