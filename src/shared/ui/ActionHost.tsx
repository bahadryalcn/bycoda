import type {
  ComponentPropsWithRef,
  CSSProperties,
  DragEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
} from "react";
import { Button, type ButtonProps } from "./Button";
import styles from "./ActionHost.module.css";

export type ActionHostProps = ComponentPropsWithRef<"div"> & {
  /** The row, tab or card is the current one; the host paints the selected fill. */
  selected?: boolean;
  /** A saved custom resting colour (any CSS colour, may be translucent). The host keeps
   *  it at rest and paints hover, pressed and selected as solid layers above it, so a
   *  custom ground never hides a state. Prefer this over an inline `backgroundColor`. */
  ground?: string;
};

/**
 * A row, tab or card that owns its highlight while holding a primary control and
 * compact inline actions (close, remove, more). Hover, keyboard focus, press and
 * selection are painted on the host, so moving onto an inline action keeps the whole
 * item highlighted, while pressing an inline action (or anything marked `data-no-drag`)
 * never paints the row as if its main action were pressed. Put the primary Button as a
 * direct child (or give it `data-action-primary`) so it drops its own fills; it keeps
 * its text, focus ring and selected-tab indicator. Feature controllers keep roles,
 * selection and drag.
 */
export function ActionHost({ selected, ground, className, style, ...props }: ActionHostProps) {
  return (
    <div
      {...props}
      data-action-host=""
      data-selected={selected || undefined}
      data-ground={ground ? "" : undefined}
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
 * Compact icon action inside an `ActionHost`: about 20px, transparent overlay
 * hover/press, secondary ink. Its pointer, click, middle-click, activation keys and
 * drag start never reach the host, so closing a tab does not also select or drag it.
 */
export function InlineAction({ reveal = "interaction", ...props }: InlineActionProps) {
  return <InlineActionButton {...props} reveal={reveal} inset="icon" iconOnly />;
}

export type InlineTextActionProps = Omit<InlineActionButtonProps, "label"> & {
  /** Visible label; also the accessible name unless `aria-label` is given. */
  children: string;
  reveal?: "always" | "interaction";
};

/**
 * Text counterpart of `InlineAction`: a content-sized, 20px-high caption action
 * ("Undo", "Retry", "Show") that lives inside a row or card host with the same
 * overlay states, reveal rules and event isolation.
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
