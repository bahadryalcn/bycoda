"use client";

import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { FieldMessage } from "../lib/field-message";
import { fieldDescribedBy, fieldMessageIds } from "../lib/field-ids";
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
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const { description: hintId, error: errorId } = fieldMessageIds(controlId, { description, error });
  // The error follows the control directly and is described first; the helper stays below it.
  const describedBy = fieldDescribedBy(controlId, { description, error }, props["aria-describedby"]);
  const Control = clearable || props.type === "search" ? SearchInput : "input";
  const control = (
    <Control
      {...props}
      {...(Control === SearchInput ? { standalone: true } : {})}
      id={controlId}
      ref={ref}
      aria-label={props["aria-label"] ?? (hideLabel && label ? label : undefined)}
      className={[styles.input, endAdornment != null && styles.withEndAdornment, className]
        .filter(Boolean)
        .join(" ")}
      aria-invalid={error ? true : props["aria-invalid"]}
      aria-describedby={describedBy}
    />
  );
  return (
    <div
      className={[styles.field, fieldClassName].filter(Boolean).join(" ")}
      data-variant={fieldVariant}
    >
      {!hideLabel && (
        <label className={styles.label} htmlFor={controlId}>
          {label}
        </label>
      )}
      {endAdornment != null ? (
        <div className={styles.control}>
          {control}
          <div className={styles.endAdornment}>{endAdornment}</div>
        </div>
      ) : (
        control
      )}
      <FieldMessage id={errorId} text={error} className={styles.error} alert />
      <FieldMessage id={hintId} text={description} className={styles.description} />
    </div>
  );
});

Input.displayName = "Input";
