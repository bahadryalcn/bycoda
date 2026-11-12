import type { ComponentPropsWithRef, ReactNode } from "react";
import { optionalTextAttributes, type TextTone } from "./Text";
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
  /** Standalone menu caption or inline group label; section actions and disclosure do not apply. */
  variant?: "section" | "menu" | "inline";
  /** Type size: `caption` (12px, default), `micro` (11px), or `secondary` (13px). */
  size?: "caption" | "micro" | "secondary";
  /**
   * One line with an ellipsis, for the `inline` and `menu` variants (the section row always
   * truncates). Needs a block box: a flex or grid item.
   */
  truncate?: boolean;
  /** Label ink; unset preserves the section hierarchy. */
  tone?: TextTone;
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
  /** Selected navigation page, painted by the row host. */
  selected?: boolean;
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
  /** Collapsible only: makes the label text a second button that runs `onClick` (open the
   *  section's page) while the chevron button keeps collapsing. `label` names the label button
   *  ("Open Crews"); `toggleLabel` names the chevron button ("Crews"), since it no longer
   *  contains the text. */
  labelAction?: { label: string; toggleLabel: string; onClick: () => void; current?: boolean };
};

/**
 * Section caption over a list or group: caption size, medium weight, secondary colour, sentence case, never uppercase.
 * Optional `count`, trailing `actions` (always visible) and `collapsible` (heading wraps the button; actions stay outside).
 * `variant="menu"` is a compact standalone menu caption.
 * `variant="inline"` renders a standalone span without a row or actions.
 * `labelAction` (collapsible) splits the row: the chevron collapses, the label text opens the section's page.
 * @group text
 * @use Caption for a group of rows, or a collapsible group heading over a list (Pinned, Groups).
 * @avoid Showing or hiding detail content: Disclosure. Pane or panel titles: PanelHeader / PaneHeader.
 *
 * @example
 * <SectionLabel variant="inline" size="secondary">{t("Groups")}</SectionLabel>
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
  variant = "section",
  size = "caption",
  truncate = false,
  tone,
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
  selected = false,
  headerProps,
  classNames,
  compactRail = false,
  collapsible = false,
  expanded = false,
  onExpandedChange,
  controls,
  labelAction,
  className,
  ...props
}: SectionLabelProps) {
  if (variant === "inline") {
    return (
      <span
        {...(props as ComponentPropsWithRef<"span">)}
        id={labelId ?? props.id}
        {...optionalTextAttributes({ tone }, [styles.inline, className].filter(Boolean).join(" "))}
        data-size={size === "caption" ? undefined : size}
        data-truncate={truncate || undefined}
      >
        {children}
      </span>
    );
  }
  if (variant === "menu") {
    return (
      <div
        {...props}
        {...optionalTextAttributes({ tone })}
        className={[
          optionalTextAttributes({ tone }).className,
          "px-2 pb-0.5 pt-2 text-ui-caption font-medium text-(--ui-text-secondary)",
          truncate && "min-w-0 truncate",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
    );
  }
  const hasCount = count !== null && count !== undefined;
  const swap = collapsible && icon != null && chevron === "hover";
  const mark = (extra?: string) => (
    <span
      className={[styles.mark, extra].filter(Boolean).join(" ")}
      data-rail-section-mark={compactRail || undefined}
      data-swap={swap || undefined}
    >
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
      <span
        data-rail-section-text={compactRail || undefined}
        id={labelId}
        {...optionalTextAttributes(
          { tone },
          [styles.text, classNames?.label].filter(Boolean).join(" "),
        )}
      >
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
  const split = collapsible && labelAction != null;
  const Row = host ? ActionHost : "div";
  return (
    <Row
      {...headerProps}
      {...props}
      {...(host ? { selected } : {})}
      data-section-label=""
      data-size={size === "caption" ? undefined : size}
      data-compact-rail={compactRail || undefined}
      className={[styles.root, headerProps?.className, className].filter(Boolean).join(" ")}
    >
      {leading}
      <Heading className={[styles.heading, classNames?.heading].filter(Boolean).join(" ")}>
        {collapsible ? (
          <>
            <Button
              variant="item"
              size="sm"
              motion="none"
              aria-expanded={expanded}
              aria-controls={controls}
              aria-label={split ? labelAction.toggleLabel : undefined}
              data-rail-section-primary={compactRail || undefined}
              data-split={split || undefined}
              className={[styles.toggle, classNames?.toggle].filter(Boolean).join(" ")}
              onClick={() => onExpandedChange?.(!expanded)}
            >
              {mark()}
              {split ? null : label}
            </Button>
            {split ? (
              <Button
                variant="item"
                size="sm"
                motion="none"
                aria-label={labelAction.label}
                aria-current={labelAction.current ? "page" : undefined}
                data-rail-section-primary={compactRail || undefined}
                className={styles.labelButton}
                onClick={labelAction.onClick}
              >
                {label}
              </Button>
            ) : null}
          </>
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
