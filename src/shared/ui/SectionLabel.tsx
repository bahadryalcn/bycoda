import type { ComponentPropsWithRef, ReactNode } from "react";
import { Button } from "./Button";
import { ChevronRight } from "./icons";
import styles from "./SectionLabel.module.css";

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
  /** Trailing actions (add, overflow) in one aligned slot; always visible. */
  actions?: ReactNode;
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
  collapsible = false,
  expanded = false,
  onExpandedChange,
  controls,
  className,
  ...props
}: SectionLabelProps) {
  const hasCount = count !== null && count !== undefined;
  const label = (
    <>
      <span id={labelId} className={styles.text}>
        {children}
      </span>
      {hasCount ? (
        <span className={styles.count}>
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
  return (
    <div {...props} className={[styles.root, className].filter(Boolean).join(" ")}>
      <Heading className={styles.heading}>
        {collapsible ? (
          <Button
            variant="item"
            size="sm"
            motion="none"
            aria-expanded={expanded}
            aria-controls={controls}
            className={styles.toggle}
            onClick={() => onExpandedChange?.(!expanded)}
          >
            <span className={styles.chevron} data-expanded={expanded || undefined} aria-hidden="true">
              <ChevronRight />
            </span>
            {label}
          </Button>
        ) : (
          label
        )}
      </Heading>
      {actions != null ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
