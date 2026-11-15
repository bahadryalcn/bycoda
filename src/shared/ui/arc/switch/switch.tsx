"use client";

import { forwardRef, useId, useState } from "react";
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { optionalTextAttributes, type TextRoles } from "../../Text";
import styles from "./switch.module.css";

export interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  label?: ReactNode;
  /** Visible label typography; unset preserves Arc defaults. */
  labelText?: TextRoles;
  /** Which side of the track the label sits on. `start` suits settings rows with the switch at the end. */
  labelPosition?: "end" | "start";
  /** Secondary line under the label. Needs `label`. */
  description?: ReactNode;
  /** @deprecated One geometry now (36x20, thumb 16); the prop has no effect. */
  compact?: boolean;
}

export const Switch = forwardRef<ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  function Switch(
    {
      label,
      labelText,
      labelPosition = "end",
      description,
      compact,
      className,
      checked,
      defaultChecked,
      onCheckedChange,
      onPointerDown,
      onPointerUp,
      onPointerLeave,
      onPointerCancel,
      onKeyDown,
      onKeyUp,
      onBlur,
      ...props
    },
    ref,
  ) {
    const [internal, setInternal] = useState(defaultChecked ?? false);
    const [pressed, setPressed] = useState(false);
    const on = checked ?? internal;
    const descriptionId = useId();
    const hasDescription = label != null && label !== false && description != null;
    const classes = [styles.switch, className].filter(Boolean).join(" ");

    const textNode =
      label != null && label !== false && label !== "" ? (
        <span className={styles.text}>
          <span {...optionalTextAttributes(labelText ?? {}, styles.label)}>{label}</span>
          {hasDescription ? (
            <span id={descriptionId} className={styles.description}>
              {description}
            </span>
          ) : null}
        </span>
      ) : null;

    return (
      <SwitchPrimitive.Root
        {...props}
        ref={ref}
        checked={on}
        onCheckedChange={(next) => {
          if (checked === undefined) setInternal(next);
          onCheckedChange?.(next);
        }}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (event.button === 0) setPressed(true);
        }}
        onPointerUp={(event) => {
          onPointerUp?.(event);
          setPressed(false);
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          setPressed(false);
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.(event);
          setPressed(false);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key === " ") setPressed(true);
        }}
        onKeyUp={(event) => {
          onKeyUp?.(event);
          setPressed(false);
        }}
        onBlur={(event) => {
          onBlur?.(event);
          setPressed(false);
        }}
        className={classes}
        data-compact={compact || undefined}
        data-pressed={pressed && !props.disabled ? "" : undefined}
        aria-label={props["aria-label"] ?? (typeof label === "string" ? label : undefined)}
        aria-describedby={
          hasDescription
            ? [props["aria-describedby"], descriptionId].filter(Boolean).join(" ")
            : props["aria-describedby"]
        }
        data-label-position={labelPosition === "start" ? "start" : undefined}
      >
        {labelPosition === "start" ? textNode : null}
        <span className={styles.track}>
          <span className={styles.thumb} />
        </span>
        {labelPosition === "end" ? textNode : null}
      </SwitchPrimitive.Root>
    );
  },
);

Switch.displayName = "Switch";

export default Switch;
