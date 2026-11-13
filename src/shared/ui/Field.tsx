import { useId } from "react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { fieldDescribedBy, fieldMessageIds } from "./arc/lib/field-ids";
import { optionalTextAttributes, type TextRoles } from "./Text";
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
 * The one label, control, error and description composition for controls that do not own it
 * themselves (Select, SearchableSelect, pickers, color/range triggers). Label points at the control id;
 * `children` may be a function receiving `id`, `aria-describedby` and `aria-invalid`. `error` is announced
 * as an alert and shown above `description`; `hideLabel` keeps the label for assistive tech only
 * (the control then needs visible context). `variant` is `form` (label above) or `compact` (toolbar).
 * TextField and TextareaField render the same structure internally.
 * @group fields
 * @use A labelled control with optional help and error text.
 * @avoid Text inputs: TextField / TextareaField. Checkbox or switch rows: their own labels. A bare label tag in feature code is never right.
 * @replaces label
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
        <FieldLabel className={styles.label} htmlFor={controlId}>
          {label}
        </FieldLabel>
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

/**
 * The native `<label for>` of a control that sits elsewhere in the layout, such as the title of a settings row
 * whose control is in another column. Unstyled unless `size` or `tone` is set; the caller owns spacing. Field renders its own label.
 * @group fields
 * @use A row or card title that must name a custom control by id.
 * @avoid Label over a control you can wrap: Field, TextField, Checkbox, Switch. Caption over a group: SectionLabel.
 */
export function FieldLabel({
  children,
  size,
  tone,
  weight,
  leading,
  className,
  ...props
}: ComponentPropsWithRef<"label"> & {
  /** Type size of the label; unset keeps the surrounding size. */
  size?: TextRoles["size"];
  /** Ink of the label; unset keeps the surrounding colour. */
  tone?: TextRoles["tone"];
  /** Label weight; unset preserves the existing weight. */
  weight?: TextRoles["weight"];
  /** Label line height; unset follows the chosen size. */
  leading?: TextRoles["leading"];
}) {
  return (
    <label {...props} {...optionalTextAttributes({ size, tone, weight, leading }, className)}>
      {children}
    </label>
  );
}

/**
 * One control frame with intrinsic start and end adornment columns (no guessed padding, no overlapping text).
 * @group fields
 * @status internal
 * @use Adornment-aware control frame inside Field.
 * @avoid The complete labeled form row: Field.
 */
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
  appearance?: "default" | "quiet" | "bare";
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
