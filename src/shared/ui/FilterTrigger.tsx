import type { ReactNode } from "react";
import { useT } from "../i18n";
import { ActionHost, InlineAction } from "./ActionHost";
import { Button, type ButtonProps } from "./Button";
import { ListFilter, X } from "./icons";

export type FilterTriggerProps = Omit<
  ButtonProps,
  "variant" | "iconOnly" | "label" | "children" | "selected" | "startIcon" | "inset"
> & {
  /** Accessible name and tooltip, for example "Filter sessions". */
  label: string;
  /** How many filters narrow the collection. Zero renders the plain ghost icon button. */
  activeCount?: number;
  /** Clears every active filter. Shown as an inline action next to the trigger while active. */
  onReset?: () => void;
  resetLabel?: string;
  icon?: ReactNode;
};

/**
 * The shared collection-filter trigger: a 28px ghost icon button that opens the
 * owner's filter Popover (pass `aria-haspopup`/`aria-expanded` and `ref` as usual).
 * While filters are active it shows the count with the selected fill and an inline
 * reset, so the narrowed scope and the way back are visible without opening the popup.
 */
export function FilterTrigger({
  label,
  activeCount = 0,
  onReset,
  resetLabel,
  icon,
  className,
  ...props
}: FilterTriggerProps) {
  const t = useT();
  const active = activeCount > 0;
  const glyph = icon ?? <ListFilter className="icon-sm" strokeWidth={1.75} />;
  // One stable element tree: the trigger button keeps its identity when filters
  // become active, so a Popover anchored to it can still return focus there.
  return (
    <ActionHost
      selected={active}
      className={className}
      data-filter-trigger=""
      data-filter-active={active ? "" : undefined}
    >
      <Button
        {...props}
        variant="ghost"
        iconOnly={!active}
        selected={active}
        label={label}
        tooltip={label}
        startIcon={active ? glyph : undefined}
        data-action-primary=""
      >
        {active ? <span className="tabular-nums">{activeCount}</span> : glyph}
      </Button>
      {active && onReset ? (
        <InlineAction reveal="always" label={resetLabel ?? t("Reset filters")} onClick={onReset}>
          <X className="icon-sm" strokeWidth={1.75} />
        </InlineAction>
      ) : null}
    </ActionHost>
  );
}
