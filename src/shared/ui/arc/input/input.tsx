"use client";

import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { FieldMessage } from "../lib/field-message";
import { fieldDescribedBy, fieldMessageIds } from "../lib/field-ids";
import { FieldControl } from "../../Field";
import styles from "./input.module.css";
import { SearchInput } from "../../SearchInput";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  description?: string;
  error?: string;
  /** Adapter hooks for a compact field with an existing visible label. */
  fieldClassName?: string;
  /** `form` (default) is comfortable; `compact` is the 28px toolbar/inline-filter composition. */
  fieldVariant?: "form" | "compact";
  hideLabel?: boolean;
  clearable?: boolean;
  /** A compact trailing icon action, separate from the label and messages. */
  endAdornment?: ReactNode;
  startAdornment?: ReactNode;
  appearance?: "default" | "quiet";
  fieldSize?: "sm" | "md";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    description,
    error,
    id,
    className,
    fieldClassName,
    fieldVariant = "form",
    hideLabel = false,
    clearable = false,
    endAdornment,
    startAdornment,
    appearance = "default",
    fieldSize,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const { description: hintId, error: errorId } = fieldMessageIds(controlId, {
    description,
    error,
  });
  // The error follows the control directly and is described first; the helper stays below it.
  const describedBy = fieldDescribedBy(
    controlId,
    { description, error },
    props["aria-describedby"],
  );
  const Control = clearable || props.type === "search" ? SearchInput : "input";
  const control = (
    <Control
      {...props}
      {...(Control === SearchInput
        ? {
            standalone: endAdornment == null && startAdornment == null,
            fieldSize: fieldSize ?? (fieldVariant === "compact" ? "sm" : "md"),
            appearance:
              appearance === "quiet" && endAdornment == null && startAdornment == null
                ? "quiet"
                : "bare",
          }
        : {})}
      id={controlId}
      ref={ref}
      aria-label={props["aria-label"] ?? (hideLabel && label ? label : undefined)}
      className={[styles.input, className].filter(Boolean).join(" ")}
      aria-invalid={error ? true : props["aria-invalid"]}
      aria-describedby={describedBy}
    />
  );
  return (
    <div
      className={[styles.field, fieldClassName].filter(Boolean).join(" ")}
      data-variant={fieldVariant}
      data-field-size={fieldSize}
      data-field-appearance={appearance}
    >
      {!hideLabel && (
        <label className={styles.label} htmlFor={controlId}>
          {label}
        </label>
      )}
      {endAdornment != null || startAdornment != null ? (
        <FieldControl
          startAdornment={startAdornment}
          endAdornment={endAdornment}
          appearance={appearance}
          size={fieldSize ?? (fieldVariant === "compact" ? "sm" : "md")}
        >
          {control}
        </FieldControl>
      ) : (
        control
      )}
      <FieldMessage id={errorId} text={error} className={styles.error} alert />
      <FieldMessage id={hintId} text={description} className={styles.description} />
    </div>
  );
});

Input.displayName = "Input";
