import type {
  ComponentPropsWithRef,
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
};

/**
 * A row, tab or card that owns its highlight while holding a primary control and
 * compact inline actions (close, remove, more). Hover, keyboard focus and selection
 * are painted on the host, so moving onto an inline action keeps the whole item
 * highlighted. Put the primary Button as a direct child (or give it
 * `data-action-primary`) so it drops its own fills; it keeps its text, focus ring
 * and selected-tab indicator. Feature controllers keep roles, selection and drag.
 */
export function ActionHost({ selected, className, ...props }: ActionHostProps) {
  return (
    <div
      {...props}
      data-action-host=""
      data-selected={selected || undefined}
      className={[styles.host, className].filter(Boolean).join(" ")}
    />
  );
}

export type InlineActionProps = Omit<
  ButtonProps,
  "iconOnly" | "inset" | "variant" | "label" | "size"
> & {
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
export function InlineAction({
  reveal = "interaction",
  onClick,
  onPointerDown,
  onMouseDown,
  onAuxClick,
  onKeyDown,
  onDragStart,
  ...props
}: InlineActionProps) {
  return (
    <Button
      {...props}
      variant="ghost"
      size="sm"
      iconOnly
      inset
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
