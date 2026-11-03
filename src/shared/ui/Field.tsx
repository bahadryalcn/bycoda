import { useId } from "react";
import type { ReactNode } from "react";
import { fieldDescribedBy, fieldMessageIds } from "./arc/lib/field-ids";
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

export { fieldDescribedBy, fieldMessageIds };

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

/** One frame and intrinsic action columns: no guessed padding or overlapping text. */
export function FieldControl({
  children,
  startAdornment,
  endAdornment,
  appearance = "default",
  size,
}: {
  children: ReactNode;
  startAdornment?: ReactNode;
  endAdornment?: ReactNode;
  appearance?: "default" | "quiet";
  size?: "sm" | "md";
}) {
  return (
    <div
      className={styles.control}
      data-field-control=""
      data-field-appearance={appearance}
      data-field-size={size}
    >
      {startAdornment != null && (
        <div className={styles.adornment} data-field-slot="start">
          {startAdornment}
        </div>
      )}
      <div className={styles.editor}>{children}</div>
      {endAdornment != null && (
        <div className={styles.adornment} data-field-slot="end">
          {endAdornment}
        </div>
      )}
    </div>
  );
}
