import { useId } from "react";
import type { ReactNode } from "react";
import styles from "./Field.module.css";

/** `form` is the comfortable label-above composition; `compact` is the toolbar/inline-filter one. */
export type FieldVariant = "form" | "compact";

export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

export interface FieldProps {
  label: string;
  /** Keep the label for assistive tech only; the control then needs its own visible context. */
  hideLabel?: boolean;
  description?: string;
  error?: string;
  variant?: FieldVariant;
  /** Control id; generated when omitted. The label points at it. */
  id?: string;
  className?: string;
  /** Receives the id and described-by/invalid props, or is placed as given. */
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
}

/** Ids a field owner must give its control so the error is described first and the help second. */
export function fieldMessageIds(id: string, parts: { description?: string; error?: string }) {
  return {
    description: parts.description ? `${id}-description` : undefined,
    error: parts.error ? `${id}-error` : undefined,
  };
}

/** `aria-describedby` for a control inside a Field: caller ids, then error, then help. */
export function fieldDescribedBy(
  id: string,
  parts: { description?: string; error?: string },
  extra?: string,
) {
  const ids = fieldMessageIds(id, parts);
  return [extra, ids.error, ids.description].filter(Boolean).join(" ") || undefined;
}

/**
 * The one label - control - help - error composition for fields that do not own it themselves
 * (Select, SearchableSelect, pickers, color/range triggers). TextField and TextareaField render the
 * same structure internally; both read the same `variant` roles.
 */
export function Field({
  label,
  hideLabel = false,
  description,
  error,
  variant = "form",
  id,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const ids = fieldMessageIds(controlId, { description, error });
  const control: FieldControlProps = {
    id: controlId,
    "aria-describedby": fieldDescribedBy(controlId, { description, error }),
    "aria-invalid": error ? true : undefined,
  };
  return (
    <div
      className={["bycoda-arc", styles.field, className].filter(Boolean).join(" ")}
      data-variant={variant}
      data-invalid={error ? "" : undefined}
    >
      {!hideLabel && (
        <label className={styles.label} htmlFor={controlId}>
          {label}
        </label>
      )}
      {typeof children === "function" ? children(control) : children}
      {error ? (
        <span id={ids.error} className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
      {description ? (
        <span id={ids.description} className={styles.description}>
          {description}
        </span>
      ) : null}
    </div>
  );
}
