import { Input as ArcInput, type InputProps } from "./arc/input/input";
import type { Ref } from "react";
import styles from "./TextField.module.css";

export type TextFieldProps = InputProps & {
  ref?: Ref<HTMLInputElement>;
  /** Code, paths, ids and tokens: the shared monospace face. */
  monospace?: boolean;
  /**
   * Short numeric text without steppers (ports, counts, limits): tabular digits and a numeric
   * keyboard (`inputMode`, unless given). For min/max/step steppers use `NumberField`.
   */
  numeric?: boolean;
};

/**
 * Single-line text input with label, hint and error built in; native input props and ref pass through.
 * `hideLabel` keeps `label` as the accessible name when visible context is elsewhere; `monospace` for code,
 * paths and ids; `numeric` for short digit-only text.
 * @group fields
 * @use Any single-line text, URL, email, search or id entry.
 * @avoid Multi-line: TextareaField. Secrets: PasswordField. Number with min/max/step: NumberField. Borderless prompt or editor surface: PromptField. Fixed choices: Select.
 * @replaces input
 * @arc input
 */
export function TextField({
  fieldClassName,
  monospace = false,
  numeric = false,
  className,
  inputMode,
  ...props
}: TextFieldProps) {
  return (
    <ArcInput
      {...props}
      inputMode={inputMode ?? (numeric ? "numeric" : undefined)}
      data-monospace={monospace ? "" : undefined}
      data-numeric={numeric ? "" : undefined}
      className={
        [monospace && styles.monospace, numeric && styles.numeric, className]
          .filter(Boolean)
          .join(" ") || undefined
      }
      fieldClassName={["bycoda-arc bycoda-arc-field", fieldClassName].filter(Boolean).join(" ")}
    />
  );
}
