import type {
  ComponentPropsWithRef,
  CSSProperties,
  DragEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
} from "react";
import { Button, type ButtonProps } from "./Button";
import { MoreHorizontal } from "./icons";
import type { TextSize, TextTone } from "./Text";
import styles from "./ActionHost.module.css";

export type ActionHostElement = "div" | "article" | "li" | "section" | "aside";

export type ActionHostProps = ComponentPropsWithRef<"div"> & {
  /** Rendered element. Default `div`; use `article` for a card or `li` for a list item so the
   *  host carries the right semantics. Event and ref types stay those of the div form. */
  as?: ActionHostElement;
  /** The row, tab or card is the current one; the host paints the selected fill. */
  selected?: boolean;
  /** A saved custom resting colour (any CSS colour, may be translucent). The host keeps
   *  it at rest and paints hover, pressed and selected as solid layers above it, so a
   *  custom ground never hides a state. Prefer this over an inline `backgroundColor`. */
  ground?: string;
  /** Inline actions appear only on hover, keyboard focus or an open menu; selection and
   *  pointer focus left by a click do not keep them visible. Touch still always shows them. */
  hoverReveal?: boolean;
  /** Ink of the row's own text, a Text tone. Computed tones are fine (selected, disabled).
   *  It sits below utility classes, so a caller's `group-hover:text-…` or state class still
   *  wins; children that set their own colour (Buttons, Text) keep it. Unset keeps today's ink. */
  tone?: TextTone;
  /** Type size of the row's own text, a Text size. Unset keeps the surrounding size. */
  size?: TextSize;
};

/**
 * A row, tab or card that owns its highlight while holding a primary control and compact inline actions. Hover, focus, press and selection paint on the host, so moving onto an inline action keeps the whole item lit and pressing it never paints the row as pressed.
 * Make the primary Button a direct child (or mark it `data-action-primary`) so it drops its own fills. Feature controllers keep roles, selection and drag.
 * @group layout
 * @use Rail rows, tabs and cards with a main action plus close/remove/more inline actions.
 * @avoid A plain list row with no inline actions: Button variant="item". One standalone icon action: Button iconOnly.
 */
export function ActionHost({
  as,
  selected,
  ground,
  hoverReveal,
  tone,
  size,
  className,
  style,
  ...props
}: ActionHostProps) {
  // The element varies; the props are those of the div form (a ref typed for li or article is a div ref).
  const Element = (as ?? "div") as "div";
  return (
    <Element
      {...props}
      data-action-host=""
      data-selected={selected || undefined}
      data-ground={ground ? "" : undefined}
      data-hover-reveal={hoverReveal ? "" : undefined}
      data-tone={tone}
      data-size={size}
      style={ground ? ({ ...style, "--action-host-ground": ground } as CSSProperties) : style}
      className={[styles.host, className].filter(Boolean).join(" ")}
    />
  );
}

type InlineActionButtonProps = Omit<
  ButtonProps,
  "iconOnly" | "inset" | "variant" | "label" | "size"
>;

export type InlineActionProps = InlineActionButtonProps & {
  /** Accessible name and tooltip. */
  label: string;
  /** `interaction` (default) shows the action while its host is hovered, focused or
   *  selected; keyboard focus, an open menu and touch input always show it. */
  reveal?: "always" | "interaction";
};

const activationKeys = new Set(["Enter", " ", "Spacebar"]);

/**
 * Compact icon action inside an ActionHost: about 20px, transparent overlay hover/press, secondary ink. Its pointer, click, middle-click, activation keys and drag start never reach the host, so closing a tab does not also select or drag it.
 * @group actions
 * @use Frequent icon actions inside an ActionHost row, tab or card (close, remove, pin).
 * @avoid Outside an ActionHost: Button iconOnly. Rarely used actions: InlineMoreAction. Text action: InlineTextAction.
 */
export function InlineAction({ reveal = "interaction", ...props }: InlineActionProps) {
  return <InlineActionButton {...props} reveal={reveal} inset="icon" iconOnly />;
}

export type InlineMoreActionProps = Omit<
  InlineActionProps,
  "children" | "onClick" | "aria-haspopup" | "aria-expanded"
> & {
  /** Names the object the menu acts on, for example "Actions for server.ts". */
  label: string;
  /** The menu opened from this action is showing. Omit when the caller cannot tell. */
  expanded?: boolean;
  /** Opens the row's own menu at this anchor, with the same target and permissions as its context menu. */
  onOpen: (anchor: HTMLButtonElement) => void;
};

/**
 * The row's overflow entry for secondary actions. It opens the same menu as right-click and the context-menu key, so touch and keyboard users reach the same target.
 * Frequent actions stay direct InlineActions; status (counts, Git state, connection) stays visible in the row, never in this menu.
 * @group actions
 * @use Overflow button of an ActionHost row that opens the row's own ContextMenu.
 * @avoid Frequent actions: InlineAction. A menu detached from a row: DropdownMenu.
 */
export function InlineMoreAction({ expanded, onOpen, reveal, ...props }: InlineMoreActionProps) {
  return (
    <InlineAction
      {...props}
      reveal={reveal}
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <MoreHorizontal className="icon-sm" strokeWidth={1.75} aria-hidden />
    </InlineAction>
  );
}

export type InlineTextActionProps = Omit<InlineActionButtonProps, "label"> & {
  /** Visible label; also the accessible name unless `aria-label` is given. */
  children: string;
  reveal?: "always" | "interaction";
};

/**
 * Text counterpart of InlineAction: a content-sized 20px caption action ("Undo", "Retry", "Show") inside an ActionHost with the same overlay states, reveal rules and event isolation.
 * @group actions
 * @use Short text action inside an ActionHost row or card.
 * @avoid Outside an ActionHost: Button variant="ghost". Icon-only action: InlineAction.
 */
export function InlineTextAction({ reveal = "always", children, ...props }: InlineTextActionProps) {
  return (
    <InlineActionButton {...props} reveal={reveal} inset="text" iconOnly={false}>
      {children}
    </InlineActionButton>
  );
}

function InlineActionButton({
  reveal,
  inset,
  iconOnly,
  onClick,
  onPointerDown,
  onMouseDown,
  onAuxClick,
  onKeyDown,
  onDragStart,
  ...props
}: InlineActionButtonProps & {
  reveal: "always" | "interaction";
  inset: "icon" | "text";
  iconOnly: boolean;
  label?: string;
}) {
  return (
    <Button
      {...({ ...props, iconOnly } as ButtonProps)}
      variant="ghost"
      size="sm"
      inset={inset}
      data-action-inline=""
      data-action-reveal={reveal === "interaction" ? "" : undefined}
      draggable={false}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onPointerDown?.(event);
      }}
      onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onMouseDown?.(event);
      }}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onAuxClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onAuxClick?.(event);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (activationKeys.has(event.key)) event.stopPropagation();
        onKeyDown?.(event);
      }}
      onDragStart={(event: DragEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onDragStart?.(event);
      }}
    />
  );
}
