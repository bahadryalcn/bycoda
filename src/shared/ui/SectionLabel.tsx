import type { ComponentPropsWithRef, ReactNode } from "react";
import { ActionHost } from "./ActionHost";
import { Button } from "./Button";
import { ChevronRight } from "./icons";
import styles from "./SectionLabel.module.css";

type DataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

export type SectionLabelClassNames = {
  /** Heading element wrapping the label (and the disclosure button). */
  heading?: string;
  /** The disclosure button (`collapsible`). */
  toggle?: string;
  /** The leading mark (`icon`) and the chevron share this slot class. */
  icon?: string;
  /** The label text. */
  label?: string;
  /** The quiet count. */
  count?: string;
  /** The trailing actions slot. */
  actions?: string;
};

export type SectionLabelProps = Omit<ComponentPropsWithRef<"div">, "children"> & {
  /** The group name, in sentence case (no uppercase eyebrow). */
  children: ReactNode;
  /** Heading element for the label. Default `h3`; use `div`/`span` when it is not a heading. */
  as?: "h2" | "h3" | "h4" | "div" | "span";
  labelId?: string;
  /** Quiet count after the label (items in the group). */
  count?: number | null;
  /** Accessible context for the count, such as "4 conversations". */
  countLabel?: string;
  /** Trailing actions (add, overflow) in one aligned slot; always visible. The slot is marked
   *  `data-no-drag`, so a draggable header never starts a drag from an action. */
  actions?: ReactNode;
  /** Props for the actions slot (`data-*`, `className`, `onPointerDown`...). */
  actionsProps?: ComponentPropsWithRef<"div"> & DataAttributes;
  /** Leading mark before the label, for example a clock or a status dot. For a collapsible
   *  label it sits beside the chevron, or replaces it at rest with `chevron="hover"`. Decorative. */
  icon?: ReactNode;
  /** Any node before the heading, outside the disclosure button (a drag handle, a status dot
   *  that must not toggle). */
  leading?: ReactNode;
  /** Collapsible with an `icon`: `always` (default) shows chevron and icon; `hover` shows the
   *  icon at rest and swaps to the chevron on hover or keyboard focus. */
  chevron?: "always" | "hover";
  /** Render the row as an `ActionHost`: the whole header paints hover, focus and press fills
   *  (rail and tree section headers). Combine with `headerProps` for drag handles. */
  host?: boolean;
  /** Extra props for the row element (`tabIndex`, `aria-keyshortcuts`, drag handle props,
   *  `data-*`), for example `drag.headerProps`. Rest props win on conflict. */
  headerProps?: ComponentPropsWithRef<"div"> & DataAttributes;
  /** Class hooks for the inner parts, so a caller can keep container-query steps. */
  classNames?: SectionLabelClassNames;
  /** In a rail narrower than 140px (container named `rail`) the label, count and chevron hide
   *  and the icon is centred. Needs an ancestor with `@container/rail`. */
  compactRail?: boolean;
  /** Render the label as a disclosure button with a chevron and `aria-expanded`. */
  collapsible?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Id of the region the disclosure shows and hides. */
  controls?: string;
};

/**
 * Group/section label: caption size, medium weight, `--ui-text-secondary`, no uppercase.
 * Optional count, trailing actions and a collapsible disclosure (the heading wraps the
 * button, as in an accordion; actions stay outside the button).
 *
 * @example
 * <SectionLabel count={pinned.length} actions={<Button variant="ghost" iconOnly label={t("Add")}>…</Button>}>
 *   {t("Pinned")}
 * </SectionLabel>
 *
 * <SectionLabel collapsible expanded={open} onExpandedChange={setOpen} controls={listId}>
 *   {t("Groups")}
 * </SectionLabel>
 */
export function SectionLabel({
  children,
  as: Heading = "h3",
  labelId,
  count,
  countLabel,
  actions,
  actionsProps,
  icon,
  leading,
  chevron = "always",
  host = false,
  headerProps,
  classNames,
  compactRail = false,
  collapsible = false,
  expanded = false,
  onExpandedChange,
  controls,
  className,
  ...props
}: SectionLabelProps) {
  const hasCount = count !== null && count !== undefined;
  const swap = collapsible && icon != null && chevron === "hover";
  const mark = (extra?: string) => (
    <span className={[styles.mark, extra].filter(Boolean).join(" ")} data-swap={swap || undefined}>
      {collapsible ? (
        <span
          className={[styles.chevron, classNames?.icon].filter(Boolean).join(" ")}
          data-expanded={expanded || undefined}
          aria-hidden="true"
        >
          <ChevronRight />
        </span>
      ) : null}
      {icon != null ? (
        <span
          className={[styles.icon, classNames?.icon].filter(Boolean).join(" ")}
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
    </span>
  );
  const label = (
    <>
      <span id={labelId} className={[styles.text, classNames?.label].filter(Boolean).join(" ")}>
        {children}
      </span>
      {hasCount ? (
        <span className={[styles.count, classNames?.count].filter(Boolean).join(" ")}>
          {countLabel ? (
            <>
              <span aria-hidden="true">{count}</span>
              <span className="sr-only">{countLabel}</span>
            </>
          ) : (
            count
          )}
        </span>
      ) : null}
    </>
  );
  const Row = host ? ActionHost : "div";
  return (
    <Row
      {...headerProps}
      {...props}
      data-section-label=""
      data-compact-rail={compactRail || undefined}
      className={[styles.root, headerProps?.className, className].filter(Boolean).join(" ")}
    >
      {leading}
      <Heading className={[styles.heading, classNames?.heading].filter(Boolean).join(" ")}>
        {collapsible ? (
          <Button
            variant="item"
            size="sm"
            motion="none"
            aria-expanded={expanded}
            aria-controls={controls}
            className={[styles.toggle, classNames?.toggle].filter(Boolean).join(" ")}
            onClick={() => onExpandedChange?.(!expanded)}
          >
            {mark()}
            {label}
          </Button>
        ) : (
          <>
            {icon != null ? mark() : null}
            {label}
          </>
        )}
      </Heading>
      {actions != null ? (
        <div
          data-no-drag=""
          {...actionsProps}
          className={[styles.actions, actionsProps?.className, classNames?.actions]
            .filter(Boolean)
            .join(" ")}
        >
          {actions}
        </div>
      ) : null}
    </Row>
  );
}
