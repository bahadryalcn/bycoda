"use client";
import { forwardRef, useId } from "react";
import type { TextareaHTMLAttributes } from "react";
import { FieldMessage } from "../lib/field-message";
import { fieldDescribedBy, fieldMessageIds } from "../lib/field-ids";
import styles from "./textarea.module.css";
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  description?: string;
  error?: string;
  fieldClassName?: string;
  /** `form` (default) is comfortable; `compact` is the toolbar/inline composition. */
  fieldVariant?: "form" | "compact";
  hideLabel?: boolean;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    description,
    error,
    id,
    className,
    fieldClassName,
    fieldVariant = "form",
    hideLabel = false,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const { description: hintId, error: errorId } = fieldMessageIds(controlId, { description, error });
  return (
    <div
      className={[styles.field, fieldClassName].filter(Boolean).join(" ")}
      data-variant={fieldVariant}
    >
      {!hideLabel && <label htmlFor={controlId}>{label}</label>}
      <textarea
        {...props}
        aria-label={props["aria-label"] ?? (hideLabel ? label : undefined)}
        id={controlId}
        ref={ref}
        className={[styles.control, className].filter(Boolean).join(" ")}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={fieldDescribedBy(
          controlId,
          { description, error },
          props["aria-describedby"],
        )}
      />
      <FieldMessage id={errorId} text={error} className={styles.error} alert />
      <FieldMessage id={hintId} text={description} className={styles.hint} />
    </div>
  );
});
