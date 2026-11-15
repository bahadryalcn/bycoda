import type { ComponentPropsWithRef, ReactNode } from "react";
import { ActionHost, actionContentAttributes, type ActionHostProps } from "./ActionHost";
import { Button, type ButtonProps } from "./Button";
import { Text } from "./Text";

export type CollectionRowProps = Omit<ActionHostProps, "title" | "children" | "onClick"> & {
  /** A sibling control before the row button (selection checkbox); it never nests in the button. */
  before?: ReactNode;
  /** Leading icon or avatar. */
  leading?: ReactNode;
  /** Row title, first and truncated. */
  title: ReactNode;
  /** Secondary text after the title (project, address, preview), truncated. */
  secondary?: ReactNode;
  /** Status word or relative time at the row end. Swapped for `action` while the row is hovered or focused. */
  trailing?: ReactNode;
  /** ONE action button (an InlineAction) that replaces `trailing` on hover or focus-within. Always shown on touch. */
  action?: ReactNode;
  /** The item was read or seen: the title recedes to secondary ink. */
  seen?: boolean;
  /** Whole-row primary target. */
  onOpen?: ButtonProps["onClick"];
  /** Extra props of the primary button (aria-label, handlers, data attributes, ref). */
  primary?: Omit<Extract<ButtonProps, { iconOnly?: false }>, "children" | "variant" | "onClick"> &
    Record<`data-${string}`, string | undefined>;
  className?: string;
  ref?: ComponentPropsWithRef<"div">["ref"];
};

/**
 * One-line collection row: leading icon, truncated title, optional secondary text, and a trailing status or time that
 * swaps for one action button while the row is hovered or focused. The whole row is the open target; the action is a
 * sibling so it never nests in the button. The swap shows the action on touch and keeps it Tab-reachable.
 * @group data
 * @use Dense lists of items with one status and at most one quick action: sessions, inbox, notes, tasks, servers.
 * @avoid Multi-line cards with badges or overlays: ActionHost. Option and menu rows: ListRow. Rows needing several actions: ActionHost with InlineAction.
 * @example <CollectionRow leading={<File />} title="Plan" trailing="2h" action={<InlineAction label="Delete">…</InlineAction>} onOpen={open} />
 */
export function CollectionRow({
  before,
  leading,
  title,
  secondary,
  trailing,
  action,
  seen,
  onOpen,
  primary,
  className,
  ...host
}: CollectionRowProps) {
  const swap = action != null && trailing != null;
  return (
    <ActionHost
      variant="row"
      controlHeight="compact"
      {...host}
      data-collection-row=""
      data-seen={seen ? "true" : undefined}
      className={["flex min-w-0 items-center gap-1", className].filter(Boolean).join(" ")}
    >
      {before}
      <Button
        data-action-primary=""
        {...primary}
        variant="item"
        onClick={onOpen}
        className={["min-w-0 flex-1 items-center gap-2 text-left", primary?.className]
          .filter(Boolean)
          .join(" ")}
      >
        {leading != null ? (
          <span aria-hidden="true" className="grid shrink-0 place-items-center">
            {leading}
          </span>
        ) : null}
        <Text
          as="span"
          size="secondary"
          tone={seen ? "secondary" : "primary"}
          weight={seen ? "regular" : "medium"}
          truncate
          className="min-w-0 shrink"
        >
          {title}
        </Text>
        {secondary != null ? (
          <Text as="span" size="caption" tone="muted" truncate className="min-w-0 flex-1">
            {secondary}
          </Text>
        ) : (
          <span className="flex-1" />
        )}
        {trailing != null ? (
          <span
            {...actionContentAttributes(
              { phase: swap ? "rest" : "always", hide: "display", display: "inline-flex" },
              "shrink-0 items-center gap-1 whitespace-nowrap tabular-nums",
            )}
          >
            <Text size="micro" tone="secondary" as="span">
              {trailing}
            </Text>
          </span>
        ) : null}
      </Button>
      {action != null ? (
        <span
          {...actionContentAttributes(
            { phase: "interaction", display: "inline-flex", focus: "within" },
            "shrink-0 items-center",
          )}
        >
          {action}
        </span>
      ) : null}
    </ActionHost>
  );
}
